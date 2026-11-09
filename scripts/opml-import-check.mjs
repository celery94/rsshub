/** Offline OPML import contracts, storage rollback and fake HTTP/agent parity. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import { createSubscriptions } from "../lib/subscriptions.js";
import { parseOpml } from "../lib/opml.js";
import { openDatabase, closeDatabase, upsertFeeds, insertArticles, setRead, getArticle, enabledFeeds } from "../lib/db.js";

const root = mkdtempSync(join(tmpdir(), "rss-opml-import-check-"));
const opmlPath = join(root, "feeds.opml"), directory = join(root, "订阅分类目录.md"), dataDir = join(root, "data");
const original = '<?xml version="1.0"?><opml version="2.0"><head><title>Retained &amp; title</title></head><body><!--keep--><outline text="Alpha"><outline text="Original One" xmlUrl="https://one.example/rss?a=1&amp;b=2" htmlUrl="https://one.example/" custom="retained"/><outline text="Original Two" xmlUrl="https://two.example/rss"/></outline><outline text="Original Three" xmlUrl="https://three.example/rss"/></body></opml>';
const notes = "old directory\n\n## 说明\n\nKeep my notes.\n";
const wrap = (text) => `<opml version="2.0"><body>${text}</body></opml>`;
const upload = wrap('<outline text="Outer"><outline text="Alpha"><outline text="Changed title" xmlUrl="https://ONE.example:443/rss?a=1&amp;b=2" htmlUrl="https://changed.example/"/></outline><outline title="Inner &amp; &quot;quotes&quot;"><outline title="New &amp; &lt;title&gt; &quot;quoted&quot;" xmlUrl="https://new.example/rss?a=1&amp;b=2" htmlUrl="https://new.example/"/><outline text="Duplicate" xmlUrl="https://NEW.example:443/rss?a=1&amp;b=2"/></outline><outline><outline text="Nearest named" xmlUrl="https://outer.example/rss"/></outline></outline><outline text="Root" xmlUrl="https://root.example/rss"/><outline xmlUrl="ftp://bad.example/rss"/><outline xmlUrl="https://user:pass@bad.example/rss"/><outline xmlUrl="https://bad-html.example/rss" htmlUrl="javascript:alert(1)"/><outline xmlUrl="https://long-title.example/rss" title="' + "t".repeat(301) + '"/><outline title="' + "g".repeat(121) + '"><outline xmlUrl="https://long-group.example/rss"/></outline><outline xmlUrl="https://url.example/' + "x".repeat(2048) + '"/><outline xmlUrl=""/>');
writeFileSync(opmlPath, original); writeFileSync(directory, notes);
const fetchBefore = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Import must never fetch"); };
let host, disk, admission = { peer: { principal: { kind: "owner" } } }, connection = true;
function mount() {
  const routes = new Map(), tools = new Map(), disposers = [];
  apply({ tools: { register: (tool) => tools.set(tool.name, tool) },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    get(name) { if (name === "skills") return undefined; if (name === "connection") return connection ? { admit: () => admission } : null; if (name === "agentDefaultModel") return null; throw new Error(`Unexpected service ${name}`); },
    effect(setup, label) { if (label.endsWith("tick")) return; const dispose = setup(); if (typeof dispose === "function") disposers.push(dispose); },
  }, { opmlPath, dataDir, analysisEnabled: false, contentPerSync: 0 });
  return { routes, tools, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}
async function request(body, { method = "POST", type = "application/json" } = {}) {
  const incoming = Object.assign(new EventEmitter(), { method, url: "/plugin/rss-brief/subscriptions", headers: { "content-type": type } });
  const outgoing = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = JSON.parse(text); } };
  const pending = host.routes.get(incoming.url)(incoming, outgoing);
  if (method === "POST") queueMicrotask(() => {
    const bytes = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    for (let start = 0; start < bytes.length; start += 16384) incoming.emit("data", bytes.subarray(start, start + 16384));
    incoming.emit("end");
  });
  await pending; assert.equal(outgoing.headers["cache-control"], "no-store"); return outgoing;
}
const tool = (args) => host.tools.get("rss_brief_subscriptions").execute(args);
const backups = (path = root) => readdirSync(path).filter((name) => name.endsWith(".bak"));
const state = () => ({ opml: readFileSync(opmlPath, "utf8"), directory: readFileSync(directory, "utf8"), files: readdirSync(root), feeds: disk.prepare("SELECT * FROM feeds ORDER BY id").all(), articles: disk.prepare("SELECT * FROM articles ORDER BY id").all(), reads: disk.prepare("SELECT * FROM reads ORDER BY article_id").all() });
function sizedXml(bytes, character = "a") {
  const prefix = '<opml><body/><!--', suffix = '--></opml>', room = bytes - Buffer.byteLength(prefix + suffix);
  const count = Math.floor(room / Buffer.byteLength(character));
  return prefix + character.repeat(count) + "a".repeat(room - count * Buffer.byteLength(character)) + suffix;
}
try {
  host = mount(); disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
  const existing = parseOpml(original), first = enabledFeeds(disk)[0];
  const [{ id }] = insertArticles(disk, first.id, [{ entryKey: "history", title: "History", url: "https://one.example/history", publishedAt: "2020-01-01T00:00:00Z", summary: "saved" }], iso => iso.slice(0, 10), "2020-01-01T00:00:00Z");
  setRead(disk, id, true, "2020-01-02T00:00:00Z");
  const before = state(), list = await tool({ action: "list" });
  const previewArgs = { action: "previewImport", opml: upload };
  const preview = await tool(previewArgs), httpPreview = await request(previewArgs);
  assert.equal(httpPreview.status, 200); assert.deepEqual(httpPreview.body, preview);
  assert.deepEqual(Object.keys(preview).sort(), ["import", "ok", "revision"]);
  assert.deepEqual({ ...preview.import, feeds: undefined }, { total: 12, added: 3, existing: 1, duplicates: 1, invalid: 7, feeds: undefined });
  assert.equal(preview.revision, list.revision);
  assert.deepEqual(preview.import.feeds.map(feed => [feed.group, feed.status]), [["Alpha", "existing"], ['Inner & "quotes"', "add"], ["Outer", "add"], ["未分组", "add"]]);
  assert.equal(preview.import.feeds[1].title, 'New & <title> "quoted"');
  assert.deepEqual(state(), before, "preview cannot touch files, backup, database, articles or reads");
  for (const opml of ["", "<opml><body></opml>", "<rss/>", "<opml><body/><body/></opml>", "<!DOCTYPE opml><opml><body/></opml>", '<!DOCTYPE opml [<!ENTITY name "value">]><opml><body/></opml>', "<opml><body/>\ud800</opml>"]) {
    const args = { action: "previewImport", opml };
    const failed = await tool(args); const http = await request(args);
    assert.equal(failed.ok, false); assert.equal(http.status, 400); assert.equal(http.body.code, failed.code);
  }
  for (const args of [{ ...previewArgs, revision: list.revision }, { ...previewArgs, feed: {} }, { action: "previewImport" }, { ...previewArgs, opml: null }, { ...previewArgs, opml: 123 }, { action: "import", opml: upload }, { action: "import", opml: upload, revision: list.revision, originalUrl: "https://x.example" }]) {
    assert.equal((await tool(args)).status, 400); assert.equal((await request(args)).status, 400);
  }
  const fallback = await tool({ action: "previewImport", opml: wrap('<outline xmlUrl="https://unnamed.example/rss"/>') });
  assert.deepEqual(fallback.import.feeds, [{ title: "unnamed.example", xmlUrl: "https://unnamed.example/rss", htmlUrl: "", group: "未分组", status: "add" }]);
  const empty = await tool({ action: "previewImport", opml: wrap("") });
  assert.deepEqual(empty.import, { total: 0, added: 0, existing: 0, duplicates: 0, invalid: 0, feeds: [] });
  assert.equal((await tool({ action: "import", opml: wrap(""), revision: list.revision })).changed, false);
  // The byte cap applies after JSON decoding, including multibyte Unicode and escaped JSON.
  const limit = 1024 * 1024, boundary = sizedXml(limit);
  assert.equal(Buffer.byteLength(boundary), limit);
  assert.equal((await tool({ action: "previewImport", opml: boundary })).ok, true);
  const escapedBody = JSON.stringify({ action: "previewImport", opml: boundary }).replaceAll("a", "\\u0061");
  assert.ok(Buffer.byteLength(escapedBody) > 6 * 1024 * 1024 - 1024);
  assert.equal((await request(escapedBody)).status, 200);
  assert.equal((await request({ action: "import", opml: boundary, revision: list.revision })).body.changed, false);
  const unicodeBoundary = sizedXml(limit, "汉");
  assert.equal(Buffer.byteLength(unicodeBoundary), limit);
  assert.equal((await tool({ action: "previewImport", opml: unicodeBoundary })).ok, true);
  for (const action of ["previewImport", "import"]) {
    const args = { action, opml: sizedXml(limit + 1), ...(action === "import" ? { revision: list.revision } : {}) };
    assert.equal((await tool(args)).status, 413); assert.equal((await request(args)).status, 413);
  }
  assert.equal((await request(" ".repeat(8 * 1024 * 1024 + 1))).status, 400);
  assert.equal((await request(" ".repeat(8192) + JSON.stringify({ action: "delete", revision: list.revision, originalUrl: existing[0].xmlUrl }))).status, 400, "old actions retain raw 8 KiB cap");
  for (const action of ["previewImport", "import"]) {
    const args = { action, opml: upload, ...(action === "import" ? { revision: list.revision } : {}) };
    for (const denied of [{ rejection: 401 }, { rejection: 403 }, { peer: { principal: { kind: "guest" } } }, {}]) {
      admission = denied; assert.equal((await request(args)).status, denied.rejection ?? 403);
    }
    connection = false; assert.equal((await request(args)).status, 503); connection = true;
    admission = { peer: { principal: { kind: "owner" } } };
    assert.equal((await request(args, { type: "text/plain" })).status, 415);
  }
  assert.deepEqual(state(), before);
  // A real transactional SQLite failure rolls back prior row changes and both files.
  disk.exec("CREATE TRIGGER reject_import BEFORE INSERT ON feeds WHEN NEW.xml_url LIKE 'https://outer.example/%' BEGIN SELECT RAISE(ABORT, 'injected import failure'); END");
  const failed = await tool({ action: "import", opml: upload, revision: preview.revision });
  assert.equal(failed.ok, false); assert.match(failed.message, /injected/);
  const afterFailure = state(); assert.equal(afterFailure.opml, before.opml); assert.equal(afterFailure.directory, before.directory);
  assert.deepEqual(afterFailure.feeds, before.feeds); assert.deepEqual(afterFailure.articles, before.articles); assert.deepEqual(afterFailure.reads, before.reads);
  assert.equal(backups().length, 1); assert.equal(readFileSync(join(root, backups()[0]), "utf8"), original);
  assert.ok(!readdirSync(root).some(name => name.endsWith(".tmp")));
  disk.exec("DROP TRIGGER reject_import");
  const imported = (await request({ action: "import", opml: upload, revision: preview.revision })).body;
  assert.equal(imported.changed, true); assert.deepEqual(imported.import, preview.import); assert.equal(imported.feeds.length, 6);
  assert.deepEqual(imported.feeds.filter(feed => existing.some(old => old.xmlUrl === feed.xmlUrl)), existing, "existing metadata and relative order retained");
  assert.deepEqual((await tool({ action: "list" })).feeds, imported.feeds);
  assert.equal(backups().length, 2); assert.match(readFileSync(opmlPath, "utf8"), /custom="retained"/); assert.match(readFileSync(opmlPath, "utf8"), /<!--keep-->/);
  assert.match(readFileSync(directory, "utf8"), /共 6 个订阅源/); assert.match(readFileSync(directory, "utf8"), /Keep my notes/);
  assert.equal(enabledFeeds(disk).length, 6); assert.equal(getArticle(disk, id).title, "History");
  assert.deepEqual(state().articles, before.articles); assert.deepEqual(state().reads, before.reads);
  const after = state();
  const repeated = await tool({ action: "import", opml: upload, revision: imported.revision });
  assert.equal(repeated.changed, false); assert.equal(repeated.import.added, 0); assert.equal(repeated.import.existing, 4);
  assert.equal(repeated.revision, imported.revision); assert.deepEqual(state(), after, "all existing URLs cause no backup/rewrite/reconcile");
  assert.deepEqual((await request({ action: "import", opml: upload, revision: imported.revision })).body, repeated);
  for (const caller of [tool, async args => { const response = await request(args); return { ...response.body, status: response.status }; }]) {
    const conflict = await caller({ action: "import", opml: upload, revision: preview.revision });
    assert.equal(conflict.code, "revision-conflict"); assert.equal(conflict.status, 409);
  }
  assert.deepEqual(state(), after);
  writeFileSync(opmlPath, after.opml.replace("<!--keep-->", "<!--external-->") );
  assert.equal((await tool({ action: "import", opml: upload, revision: imported.revision })).status, 409);
  assert.match(readFileSync(opmlPath, "utf8"), /<!--external-->/);
  // Direct API no-op must not even call reconciliation.
  let calls = 0;
  const direct = createSubscriptions({ opmlPath, reconcile() { calls += 1; } });
  const current = direct({ action: "list" });
  assert.equal(direct({ action: "import", opml: upload, revision: current.revision }).changed, false); assert.equal(calls, 0);
  const failureRoot = join(root, "failure"); mkdirSync(failureRoot);
  const failureOpml = join(failureRoot, "feeds.opml"); writeFileSync(failureOpml, original);
  mkdirSync(join(failureRoot, "订阅分类目录.md"));
  const broken = createSubscriptions({ opmlPath: failureOpml, reconcile() { throw new Error("unexpected reconcile"); } });
  assert.throws(() => broken({ action: "import", opml: upload, revision: list.revision }));
  assert.equal(readFileSync(failureOpml, "utf8"), original); assert.equal(backups(failureRoot).length, 0);
  const missingRoot = join(root, "missing-directory"); mkdirSync(missingRoot);
  const missingOpml = join(missingRoot, "feeds.opml"); writeFileSync(missingOpml, original);
  const missing = createSubscriptions({ opmlPath: missingOpml, reconcile() { throw new Error("injected missing-directory failure"); } });
  assert.throws(() => missing({ action: "import", opml: upload, revision: list.revision }), /injected/);
  assert.equal(readFileSync(missingOpml, "utf8"), original); assert.equal(existsSync(join(missingRoot, "订阅分类目录.md")), false);
  assert.equal(backups(missingRoot).length, 1); assert.ok(!readdirSync(missingRoot).some(name => name.endsWith(".tmp")));
  // Maximum allowed feed labels and URL normalize consistently without truncation.
  const edge = wrap(`<outline text="${"g".repeat(120)}"><outline title="${"t".repeat(300)}" xmlUrl="https://edge.example/rss"/></outline>`);
  const edgePreview = direct({ action: "previewImport", opml: edge }); assert.equal(edgePreview.import.added, 1);
  const edgeResult = direct({ action: "import", opml: edge, revision: current.revision });
  assert.equal(edgeResult.feeds.at(-1).title.length, 300); assert.equal(edgeResult.feeds.at(-1).group.length, 120); assert.equal(calls, 1);
  console.log("ok - OPML preview/import counts, merge preservation, nested groups/XML, UTF-8/JSON limits, revisions, backups/transaction rollback, owner HTTP/agent parity, no fetch and retained history (offline)");
} finally {
  host?.dispose(); if (disk) closeDatabase(disk); globalThis.fetch = fetchBefore;
  assert.ok(root.startsWith(join(tmpdir(), "rss-opml-import-check-")));
  rmSync(root, { recursive: true, force: true });
}
