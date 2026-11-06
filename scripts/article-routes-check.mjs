/** Mount the actual Host half and exercise article route cache/HTTP semantics. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apply } from "../index.js";
import {
  openDatabase, closeDatabase, upsertFeeds, insertArticles, getArticle, setMeta,
  setAiResult, setRead,
} from "../lib/db.js";
import { EXTRACTOR_VERSION } from "../lib/readable.js";

const workDir = mkdtempSync(join(tmpdir(), "rss-brief-article-routes-"));
const dataDir = join(workDir, "data");
const opmlPath = join(workDir, "feeds.opml");
const routes = new Map();
const tools = new Map();
const disposers = [];
const skippedTicks = [];
const hits = new Map();
const deny = new Set();
let checks = 0;
let disk;
const server = createServer((incoming, outgoing) => {
  const path = new URL(incoming.url, "http://localhost").pathname;
  hits.set(path, (hits.get(path) || 0) + 1);
  if (path === "/guarded.png" || path === "/not-image") {
    // Mimic a hotlink-protected CDN: only the article site's Referer is accepted.
    const allowed = incoming.headers.referer === `http://${incoming.headers.host}/`;
    outgoing.writeHead(allowed ? 200 : 403, { "content-type": allowed && path === "/guarded.png" ? "image/png" : "text/html" });
    outgoing.end(allowed ? "PNGDATA" : "denied");
    return;
  }
  if (deny.has(path)) {
    outgoing.writeHead(403, { "content-type": "text/html" });
    outgoing.end("<html><title>Access denied</title><body>Forbidden</body></html>");
    return;
  }
  outgoing.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  outgoing.end(`<!doctype html><html><head><title>Fetched heading differs from DB title</title></head><body>
    <article><h1>Fetched article heading</h1><p>${"A complete original article with retained body text, a useful explanation, and several concrete details. ".repeat(12)}</p>
    <p><strong>Important detail</strong> and <a href="/reference">reference link</a>.</p>
    <figure><img src="/photo.png" alt="A retained photo"><figcaption>Original caption</figcaption></figure>
    </article></body></html>`);
});
const ctx = {
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  get(name) {
    if (name === "skills") return undefined;
    assert.equal(name, "agentDefaultModel", "article routes must not access the LLM service");
    return undefined;
  },
  effect(setup, label) {
    if (label.endsWith("tick")) { skippedTicks.push(label); return; }
    const dispose = setup();
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose;
  },
};
async function request(query, method = "GET") {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: `/plugin/rss-brief/article${query}` });
  const outgoing = {
    status: 0, headers: {}, text: "", destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(text) { this.text = text ?? ""; },
  };
  await routes.get("/plugin/rss-brief/article").handler(incoming, outgoing);
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return { ...outgoing, body: outgoing.text ? JSON.parse(outgoing.text) : null };
}
function hitCount() { return [...hits.values()].reduce((sum, n) => sum + n, 0); }
async function check(label, body) {
  await body();
  console.log(`ok ${++checks} - ${label}`);
}
try {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const xmlUrl = `${baseUrl}/feed.xml`;
  mkdirSync(dataDir);
  writeFileSync(opmlPath, `<opml version="2.0"><body><outline text="Test group"><outline text="Database feed" xmlUrl="${xmlUrl}" htmlUrl="${baseUrl}/feed-home"/></outline></body></opml>`);
  disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
  upsertFeeds(disk, [{ xmlUrl, htmlUrl: `${baseUrl}/feed-home`, title: "Database feed", group: "Test group" }]);
  // Scheduler setup is skipped in the stub; future metadata also makes work not due.
  setMeta(disk, "lastFetchAt", "2999-01-01T00:00:00.000Z");
  setMeta(disk, "lastReportDate", "2999-01-01");
  const feedId = disk.prepare("SELECT id FROM feeds").get().id;
  const stamp = new Date(Date.now() - 60_000).toISOString();
  let sequence = 0;
  const put = (path, options = {}) => insertArticles(disk, feedId, [{
    entryKey: `route-${++sequence}`, guid: `guid-${sequence}`, url: `${baseUrl}${path}`,
    title: options.title || `Stored title ${sequence}`, author: "Stored author", publishedAt: stamp,
    summary: options.summary || "Stored feed summary", feedContentHtml: options.html,
    feedContentKind: options.kind, feedContentBaseUrl: `${baseUrl}/base/article`,
  }], (iso) => iso.slice(0, 10), stamp)[0].id;
  const pendingId = put("/pending", { title: "Pending database title" });
  const extractId = put("/article", { title: "Canonical database title" });
  const fullId = put("/full-feed", { html: "<h2>Full feed heading</h2><p>Complete stored feed content.</p>", kind: "full" });
  const imageId = put("/image-feed", { html: `<p>Stored image article.</p><img src="${baseUrl}/guarded.png"><img src="${baseUrl}/not-image">`, kind: "full" });
  const descriptionId = put("/description-feed", { html: "<p>Stored description content.</p>", kind: "description" });
  setAiResult(disk, extractId, { status: "ok", category: "ai", relevance: 87, summary: "数据库中的摘要" });
  setRead(disk, extractId, true, stamp);
  apply(ctx, { dataDir, opmlPath, requestTimeoutMs: 5000 });
  assert.ok(routes.has("/plugin/rss-brief/article"));
  assert.equal(skippedTicks.length, 2);

  await check("cacheOnly pending route and HEAD never fetch, including refresh query", async () => {
    const before = hitCount();
    const cached = await request(`?id=${pendingId}&cacheOnly=1`);
    assert.equal(cached.status, 200);
    assert.equal(cached.body.article.title, "Pending database title");
    assert.equal(cached.body.article.contentText, "Stored feed summary");
    assert.equal(cached.body.article.contentStatus, "pending");
    assert.equal(cached.body.article.contentDocument, null);
    assert.equal(cached.body.article.needsExtraction, true);
    assert.equal(cached.body.article.extracting, false);
    const head = await request(`?id=${pendingId}`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
    assert.equal(head.body, null);
    const refreshHead = await request(`?id=${pendingId}&refresh=1`, "HEAD");
    assert.equal(refreshHead.text, "");
    await request(`?id=${pendingId}&cacheOnly=1&refresh=1`);
    assert.equal(hitCount(), before);
    assert.equal(getArticle(disk, pendingId).content_status, "pending");
    assert.equal(getArticle(disk, pendingId).content_attempt_at, null);
  });

  await check("article IDs require a safe positive integer and reject malformed input", async () => {
    const before = hitCount();
    for (const id of ["1junk", "0", "-1", "", "1.5", "1e2", "9007199254740992", "%201"]) {
      const result = await request(`?id=${id}`);
      assert.equal(result.status, 400, id);
      assert.equal(result.body.code, "invalid-id", id);
    }
    assert.equal((await request("")).status, 400);
    const missing = await request("?id=9999999");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "article-not-found");
    assert.equal((await request(`?id=${pendingId}`, "POST")).status, 405);
    assert.equal(hitCount(), before);
  });

  await check("cached feed full and description routes render stored bodies without fetching", async () => {
    const before = hitCount();
    const full = (await request(`?id=${fullId}&cacheOnly=1`)).body.article;
    assert.match(full.contentText, /Complete stored feed content/);
    assert.equal(full.contentSource, "feed");
    assert.equal(full.contentStatus, "ok");
    assert.equal(full.needsExtraction, false);
    assert.equal(full.contentDocument.version, 1);
    const description = (await request(`?id=${descriptionId}&cacheOnly=1`)).body.article;
    assert.equal(description.contentText, "Stored description content.");
    assert.equal(description.contentSource, "feed-summary");
    assert.equal(description.contentStatus, "fallback");
    assert.equal(description.needsExtraction, true);
    assert.equal(hitCount(), before);
  });

  let extracted;
  await check("normal GET extracts once and returns body fields plus database metadata", async () => {
    const result = await request(`?id=${extractId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    extracted = result.body.article;
    assert.equal(hits.get("/article"), 1);
    assert.equal(extracted.title, "Canonical database title");
    assert.equal(extracted.url, `${baseUrl}/article`);
    assert.equal(extracted.feed, "Database feed");
    assert.equal(extracted.feedUrl, `${baseUrl}/feed-home`);
    assert.equal(extracted.author, "Stored author");
    assert.equal(extracted.publishedAt, stamp);
    assert.equal(extracted.publishedDate, stamp.slice(0, 10));
    assert.equal(extracted.summary, "数据库中的摘要");
    assert.equal(extracted.category, "ai");
    assert.equal(extracted.opmlGroup, "Test group");
    assert.equal(extracted.relevance, 87);
    assert.equal(extracted.read, true);
    assert.equal(extracted.contentStatus, "ok");
    assert.equal(extracted.contentSource, "web");
    assert.equal(extracted.contentDocument.version, 1);
    assert.ok(Array.isArray(extracted.contentDocument.children));
    assert.match(extracted.contentText, /complete original article/);
    assert.equal(extracted.chars, extracted.contentText.replace(/\s+/g, "").length);
    assert.equal(extracted.needsExtraction, false);
    assert.equal(extracted.extracting, false);
    assert.equal(extracted.refreshError, null);
    assert.equal(extracted.truncated, false);
    assert.ok(extracted.extractedAt);
    assert.equal(getArticle(disk, extractId).extraction_version, EXTRACTOR_VERSION);
    await request(`?id=${extractId}`);
    assert.equal(hits.get("/article"), 1, "subsequent normal GET reuses the body");
  });

  await check("forced refresh403 keeps body and provenance while exposing refreshError", async () => {
    deny.add("/article");
    const refreshed = (await request(`?id=${extractId}&refresh=1`)).body.article;
    assert.equal(hits.get("/article"), 2);
    for (const key of ["contentText", "contentDocument", "contentSource", "contentStatus", "contentError", "extractedAt", "title", "read"]) {
      assert.deepEqual(refreshed[key], extracted[key], key);
    }
    assert.match(refreshed.refreshError, /403/);
    assert.equal(refreshed.needsExtraction, false);
    assert.equal(refreshed.extracting, false);
    const before = hitCount();
    const cache = (await request(`?id=${extractId}&cacheOnly=1`)).body.article;
    assert.equal(cache.contentText, extracted.contentText);
    assert.match(cache.refreshError, /403/);
    assert.equal(hitCount(), before);
  });

  await check("cacheOnly metadata follows current database title and read state", async () => {
    const before = hitCount();
    disk.prepare("UPDATE articles SET title = ?, author = ? WHERE id = ?")
      .run("Updated database title", "Updated database author", extractId);
    setRead(disk, extractId, false);
    const cached = (await request(`?id=${extractId}&cacheOnly=1`)).body.article;
    assert.equal(cached.title, "Updated database title");
    assert.equal(cached.author, "Updated database author");
    assert.equal(cached.read, false);
    assert.equal(cached.contentText, extracted.contentText);
    assert.equal(hitCount(), before);
  });

  await check("image route fetches only the article's own images with the article Referer", async () => {
    const image = async (id, src) => {
      const outgoing = {
        status: 0, headers: {}, text: "", destroyed: false, headersSent: false,
        writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.text = body ?? ""; },
      };
      const incoming = Object.assign(new EventEmitter(), { method: "GET", url: `/plugin/rss-brief/image?id=${id}&src=${encodeURIComponent(src)}` });
      await routes.get("/plugin/rss-brief/image").handler(incoming, outgoing);
      return outgoing;
    };
    const ok = await image(imageId, `${baseUrl}/guarded.png`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["content-type"], "image/png");
    assert.match(ok.headers["content-security-policy"], /sandbox/);
    assert.equal(Buffer.from(ok.text).toString(), "PNGDATA");
    const before = hitCount();
    assert.equal((await image(imageId, `${baseUrl}/article`)).status, 404, "URL outside the article document");
    assert.equal((await image(999999, `${baseUrl}/guarded.png`)).status, 404, "unknown article");
    assert.equal(hitCount(), before, "rejected requests never reach the network");
    assert.equal((await image(imageId, `${baseUrl}/not-image`)).status, 502, "non-image response");
  });

  console.log(`${checks} article route checks passed`);
} finally {
  for (const dispose of disposers.reverse()) await dispose();
  if (disk) closeDatabase(disk);
  server.closeAllConnections();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert.equal(resolve(workDir, ".."), resolve(tmpdir()));
  assert.ok(workDir.startsWith(join(tmpdir(), "rss-brief-article-routes-")));
  rmSync(workDir, { recursive: true, force: true });
}
