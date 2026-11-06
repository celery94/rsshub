/** Real SQLite + loopback HTTP checks for the shared cache/extraction service. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createArticleContent } from "../lib/article-content.js";
import { openDatabase, closeDatabase, upsertFeeds, insertArticles, getArticle, setContentSuccess, setContent } from "../lib/db.js";
import { buildContentDocument, EXTRACTOR_VERSION } from "../lib/readable.js";

const workDir = mkdtempSync(join(tmpdir(), "rss-brief-article-content-"));
const events = new EventEmitter();
const hits = new Map();
const switches = new Map();
const held = new Map();
const controllers = [];
let active = 0;
let maxActive = 0;
let checks = 0;
const failures = [];
const stamp = new Date().toISOString();
const prose = "A detailed article about storing complete RSS bodies and preserving cached content. It explains database upgrades, extraction results, and practical examples for readers. ";
const html = `<!doctype html><html><head><title>Complete article</title></head><body><nav>Navigation noise</nav><article><h1>Complete article</h1>
  <p>${prose.repeat(8)}</p><p>Useful <a href="../related">relative link</a> and
  <a href="javascript:alert(1)">unsafe link text</a><a href="data:text/html,bad">bad data link</a>.</p>
  <figure><img src="/images/photo.png" alt="Useful photo"><figcaption>Retained caption</figcaption></figure>
  <img src="data:image/png;base64,AAAA"><script>globalThis.BAD_SCRIPT = true;</script>
  <p>${prose.repeat(3)}</p></article><footer>Footer noise</footer></body></html>`;

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  hits.set(path, (hits.get(path) || 0) + 1);
  active += 1;
  maxActive = Math.max(maxActive, active);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    active -= 1;
    const entries = held.get(path);
    if (entries) {
      const index = entries.indexOf(response);
      if (index >= 0) entries.splice(index, 1);
      if (!entries.length) held.delete(path);
    }
    events.emit("change");
  };
  response.once("finish", finish);
  response.once("close", finish);
  if (/^\/(?:shared|parallel|cancel)\//.test(path)) {
    if (!held.has(path)) held.set(path, []);
    held.get(path).push(response);
  } else if (path.startsWith("/deny/") || (path.startsWith("/switch/") && switches.get(path) !== "ok")) {
    response.writeHead(403, { "content-type": "text/html" });
    response.end("<html><title>Access denied</title><body>Forbidden</body></html>");
  } else if (path.startsWith("/json/")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"body":"not an HTML article"}');
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  }
  events.emit("change");
});

function waitFor(predicate, label, timeoutMs = 5000) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out: ${label}`)); }, timeoutMs);
    const changed = () => { if (predicate()) { cleanup(); resolvePromise(); } };
    function cleanup() { clearTimeout(timer); events.off("change", changed); }
    events.on("change", changed);
    changed();
  });
}
function deadline(promise, label, timeoutMs = 10000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolvePromise(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
function release(prefix) {
  for (const [path, responses] of [...held]) {
    if (!path.startsWith(prefix)) continue;
    for (const response of [...responses]) {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(html);
      }
    }
  }
}
function count(prefix) {
  return [...hits].filter(([path]) => path.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0);
}
function nodes(document) {
  const output = [];
  const visit = (node) => { output.push(node); for (const child of node.children || []) visit(child); };
  for (const child of document?.children || []) visit(child);
  return output;
}
async function check(label, body) {
  try {
    await body();
    console.log(`ok ${++checks} - ${label}`);
  } catch (error) {
    failures.push({ label, error });
    console.error(`not ok - ${label}\n${error.stack || error}`);
  }
}
let db;
try {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  db = openDatabase(join(workDir, "content.sqlite"));
  upsertFeeds(db, [{ xmlUrl: `${baseUrl}/feed.xml`, htmlUrl: baseUrl, title: "Loopback", group: "Tests" }]);
  const feedId = db.prepare("SELECT id FROM feeds").get().id;
  let sequence = 0;
  const put = (path, options = {}) => insertArticles(db, feedId, [{
    entryKey: `test-${++sequence}`, title: `Article ${sequence}`, publishedAt: stamp,
    url: options.url === undefined ? `${baseUrl}${path}` : options.url,
    summary: options.summary === undefined ? "Short feed fallback summary" : options.summary,
    feedContentHtml: options.feedContentHtml,
    feedContentKind: options.feedContentKind,
    feedContentBaseUrl: options.feedContentBaseUrl || `${baseUrl}/feed-base/article`,
    feedContentTruncated: options.feedContentTruncated,
  }], (iso) => iso.slice(0, 10), stamp)[0].id;
  const row = (id) => getArticle(db, id);
  function service() {
    const controller = new AbortController();
    controllers.push(controller);
    return { controller, content: createArticleContent({ getDb: () => db, signal: controller.signal, timeoutMs: 5000 }) };
  }
  const { content } = service();
  const seedSuccess = (id, text = "Previously cached complete article", source = "web") => {
    setContentSuccess(db, id, { status: "ok", text, document: buildContentDocument(`<p>${text}</p>`), source,
      version: EXTRACTOR_VERSION, at: "2026-01-02T03:04:05.000Z" });
  };

  await check("cache reads prepare full and description feed HTML without any network", async () => {
    const before = count("/");
    const fullId = put("/never/full", { feedContentHtml: '<h2>Full feed heading</h2><p>Complete feed body</p><img src="/feed-photo.jpg">', feedContentKind: "full" });
    const full = content.readCached(row(fullId));
    assert.match(full.contentText, /Complete feed body/);
    assert.equal(full.contentSource, "feed");
    assert.equal(full.contentStatus, "ok");
    assert.equal(full.needsExtraction, false);
    assert.equal(nodes(full.contentDocument).find((node) => node.type === "img").src, `${baseUrl}/feed-photo.jpg`);
    const descriptionId = put("/never/description", { feedContentHtml: "<p>Feed description excerpt</p>", feedContentKind: "description" });
    const description = content.readCached(row(descriptionId));
    assert.equal(description.contentText, "Feed description excerpt");
    assert.equal(description.contentSource, "feed-summary");
    assert.equal(description.contentStatus, "fallback");
    assert.equal(description.needsExtraction, true);
    const cachedId = put("/never/cached");
    seedSuccess(cachedId);
    const cached = content.readCached(row(cachedId));
    assert.equal(cached.contentSource, "web");
    assert.equal(cached.needsExtraction, false);
    const legacyId = put("/never/legacy");
    setContent(db, legacyId, "ok", "Old plain text body", null);
    assert.equal(content.readCached(row(legacyId)).contentText, "Old plain text body");
    assert.equal(count("/"), before);
    const reusedFull = await content.extract(row(fullId));
    const reusedWeb = await content.extract(row(cachedId));
    assert.equal(reusedFull.extracting, false, "completed feed cache reuse is not still extracting");
    assert.equal(reusedWeb.extracting, false, "completed web cache reuse is not still extracting");
    assert.equal(count("/"), before, "non-forced extraction must reuse complete current cache");
  });

  await check("full feed content never replaces a successful legacy fetched body", async () => {
    const path = "/deny/legacy-full";
    const id = put(path, { feedContentHtml: "<p>A shorter feed copy</p>", feedContentKind: "full" });
    setContent(db, id, "ok", "Previously fetched complete legacy article", null);
    const before = { ...row(id) };
    const hitsBefore = count("/");
    const cached = content.readCached(row(id));
    assert.equal(cached.contentText, before.content_text);
    assert.equal(cached.contentSource, "legacy");
    assert.equal(cached.contentStatus, "ok");
    assert.equal(cached.contentDocument, null);
    assert.deepEqual({ ...row(id) }, before, "cache preparation must not rewrite a valid fetched body");
    assert.equal(count("/"), hitsBefore);
    const refreshed = await content.extract(row(id), { force: true });
    assert.equal(refreshed.contentText, before.content_text);
    assert.equal(refreshed.contentSource, "legacy");
    assert.equal(refreshed.contentStatus, "ok");
    assert.equal(refreshed.extracting, false);
    assert.match(refreshed.refreshError, /403/);
    assert.equal(row(id).content_text, before.content_text);
    assert.equal(count(path), 1);
  });

  await check("nested image-only feed bodies remain usable without a text summary", async () => {
    const before = count("/");
    for (const kind of ["full", "description"]) {
      const id = put(`/never/nested-image-${kind}`, {
        summary: "", feedContentKind: kind,
        feedContentHtml: '<blockquote><p><img src="/nested-photo.jpg" alt="An image-only article"></p></blockquote>',
      });
      const cached = content.readCached(row(id));
      assert.equal(cached.contentText, "");
      assert.equal(cached.contentDocument.version, 1);
      assert.equal(cached.contentDocument.children[0].type, "blockquote");
      assert.ok(nodes(cached.contentDocument).some((node) => node.type === "img" && node.src === `${baseUrl}/nested-photo.jpg`));
      assert.equal(cached.contentStatus, kind === "full" ? "ok" : "fallback");
      assert.equal(cached.contentSource, kind === "full" ? "feed" : "feed-summary");
      assert.equal(cached.needsExtraction, kind !== "full");
      assert.ok(row(id).content_document_json);
    }
    assert.equal(count("/"), before);
  });

  await check("truncated full feed stays readable and requests later extraction", async () => {
    const id = put("/never/truncated", { feedContentHtml: "<p>A retained but incomplete full body</p>", feedContentKind: "full", feedContentTruncated: true });
    const cached = content.readCached(row(id));
    assert.equal(cached.truncated, true);
    assert.equal(cached.contentStatus, "fallback");
    assert.equal(cached.contentSource, "feed-summary");
    assert.equal(cached.needsExtraction, true);
    assert.equal(count("/never/truncated"), 0);
  });

  await check("web extraction stores sanitized structured content and resolves relative body URLs", async () => {
    const id = put("/ok/article");
    const result = await content.extract(row(id));
    assert.equal(count("/ok/article"), 1);
    assert.equal(result.contentStatus, "ok");
    assert.equal(result.contentSource, "web");
    assert.equal(result.extracting, false, "resolved successful extraction must be complete");
    assert.match(result.contentText, /detailed article about storing complete RSS bodies/);
    assert.doesNotMatch(result.contentText, /Navigation noise|Footer noise|BAD_SCRIPT/);
    const tree = nodes(result.contentDocument);
    assert.ok(tree.some((node) => node.type === "a" && node.href === `${baseUrl}/related`));
    assert.ok(tree.some((node) => node.type === "img" && node.src === `${baseUrl}/images/photo.png`));
    for (const node of tree) {
      if (node.href) assert.match(node.href, /^https?:\/\//);
      if (node.src) assert.match(node.src, /^https?:\/\//);
    }
    assert.equal(row(id).extraction_version, EXTRACTOR_VERSION);
    assert.equal(row(id).content_attempt_error, null);
    assert.equal(content.readCached(row(id)).extracting, false);
  });

  await check("forced HTTP403 preserves prior complete web and feed bodies", async () => {
    for (const source of ["web", "feed"]) {
      const path = `/deny/preserve-${source}`;
      const id = put(path);
      seedSuccess(id, `Stored ${source} article remains readable`, source);
      const before = row(id);
      const result = await content.extract(before, { force: true });
      const after = row(id);
      for (const key of ["content_text", "content_document_json", "content_source", "content_status", "content_error", "extracted_at", "extraction_version"]) {
        assert.equal(after[key], before[key], key);
      }
      assert.match(result.refreshError, /403/);
      assert.equal(result.extracting, false, "resolved failed refresh must be complete");
      assert.equal(result.needsExtraction, false);
      assert.equal(result.contentText, before.content_text);
      assert.equal(count(path), 1);
    }
  });

  await check("failed first attempt without summary records failed status rather than throwing", async () => {
    const id = put("/deny/no-summary", { summary: "" });
    const result = await content.extract(row(id));
    assert.equal(result.contentStatus, "failed");
    assert.equal(result.extracting, false, "resolved first failure must be complete");
    assert.equal(result.contentText, "");
    assert.match(result.refreshError, /403/);
    assert.equal(result.needsExtraction, false);
    assert.equal(row(id).content_document_json, null);
  });

  await check("retry cooldown blocks a second request, expires, and clears on success", async () => {
    const path = "/switch/retry";
    const id = put(path);
    const first = await content.extract(row(id));
    assert.equal(first.contentStatus, "fallback");
    assert.match(first.refreshError, /403/);
    assert.equal(count(path), 1);
    switches.set(path, "ok");
    await content.extract(row(id));
    assert.equal(count(path), 1, "a recent failed attempt is throttled");
    db.prepare("UPDATE articles SET content_attempt_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), id);
    assert.equal(content.needsExtraction(row(id)), true);
    const retried = await content.extract(row(id));
    assert.equal(count(path), 2);
    assert.equal(retried.contentStatus, "ok");
    assert.equal(retried.refreshError, null);
    assert.equal(retried.contentError, null);
    assert.equal(retried.needsExtraction, false);
  });

  await check("invalid article URLs do not fetch and non-HTML responses retain cached bodies", async () => {
    const before = count("/");
    for (const url of ["javascript:alert(1)", "/relative-article", `${baseUrl}/`, null]) {
      const id = put("/unused", { url });
      assert.equal(content.readCached(row(id)).needsExtraction, false);
      const result = await content.extract(row(id), { force: true });
      assert.equal(result.contentStatus, "fallback");
      assert.ok(result.refreshError);
    }
    assert.equal(count("/"), before);
    const id = put("/json/article");
    seedSuccess(id);
    const result = await content.extract(row(id), { force: true });
    assert.equal(result.contentText, "Previously cached complete article");
    assert.match(result.refreshError, /application\/json/);
  });

  await check("duplicate concurrent extraction shares one promise and one HTTP request", async () => {
    const id = put("/shared/article");
    const first = content.extract(row(id));
    const second = content.extract(row(id), { force: true });
    assert.equal(first, second);
    assert.equal(content.readCached(row(id)).extracting, true);
    try {
      await waitFor(() => count("/shared/article") >= 1, "shared request started");
      release("/shared/");
      const [a, b] = await deadline(Promise.all([first, second]), "shared extraction finishes");
      assert.deepEqual(a, b);
      assert.equal(count("/shared/article"), 1);
      assert.equal(content.readCached(row(id)).extracting, false);
    } finally {
      release("/shared/");
    }
  });

  await check("different articles share a three-request concurrency bound", async () => {
    await waitFor(() => active === 0, "previous requests finished");
    maxActive = 0;
    const ids = Array.from({ length: 8 }, (_, index) => put(`/parallel/${index}`));
    const tasks = ids.map((id) => content.extract(row(id)));
    try {
      await waitFor(() => count("/parallel/") >= 3, "first three requests started");
      assert.equal(count("/parallel/"), 3);
      assert.equal(active, 3);
      release("/parallel/");
      await waitFor(() => count("/parallel/") >= 6, "second three requests started");
      release("/parallel/");
      await waitFor(() => count("/parallel/") >= 8, "last two requests started");
      release("/parallel/");
      const results = await deadline(Promise.all(tasks), "parallel extraction finishes");
      assert.equal(results.length, 8);
      assert.ok(results.every((result) => result.contentStatus === "ok"));
      assert.equal(count("/parallel/"), 8);
      assert.equal(maxActive, 3);
    } finally {
      release("/parallel/");
    }
  });

  await check("abort rejects active and queued work and clears all shared tasks", async () => {
    await waitFor(() => active === 0, "parallel requests finished");
    const { content: cancellable, controller } = service();
    const ids = Array.from({ length: 7 }, (_, index) => put(`/cancel/${index}`));
    const tasks = ids.map((id) => cancellable.extract(row(id)));
    const settled = Promise.allSettled(tasks);
    await waitFor(() => count("/cancel/") >= 3, "three cancellation requests started");
    controller.abort(new Error("Cancel fixture"));
    const outcomes = await deadline(settled, "active and queued cancellation");
    assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
    assert.equal(count("/cancel/"), 3, "queued requests must never start");
    for (const id of ids) {
      assert.equal(cancellable.readCached(row(id)).extracting, false);
      assert.equal(row(id).content_attempt_at, null, "unload cancellation must not persist a failed extraction");
    }
    await assert.rejects(cancellable.extract(row(ids[0])), /Cancel fixture/);
    await waitFor(() => active === 0, "aborted sockets close");
  });

  console.log(`${checks} article content checks passed${failures.length ? `; ${failures.length} failed` : ""}`);
  if (failures.length) process.exitCode = 1;
} finally {
  for (const controller of controllers) controller.abort(new Error("Test cleanup"));
  for (const responses of held.values()) for (const response of responses) response.destroy();
  server.closeAllConnections();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (db) closeDatabase(db);
  // Verify the exact disposable target before recursive cleanup.
  assert.equal(resolve(workDir, ".."), resolve(tmpdir()));
  assert.ok(workDir.startsWith(join(tmpdir(), "rss-brief-article-content-")));
  rmSync(workDir, { recursive: true, force: true });
}
