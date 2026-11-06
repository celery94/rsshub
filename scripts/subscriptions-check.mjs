/** Offline subscription CRUD and fake HTTP/tool checks. No listeners or real data. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import { createSubscriptions } from "../lib/subscriptions.js";
import { parseOpml } from "../lib/opml.js";
import { openDatabase, closeDatabase, upsertFeeds, insertArticles, setRead, isRead, getArticle, enabledFeeds } from "../lib/db.js";

const root = mkdtempSync(join(tmpdir(), "rss-subscriptions-check-"));
const opmlPath = join(root, "folo.opml"), directory = join(root, "订阅分类目录.md"), dataDir = join(root, "data");
const original = '<?xml version="1.0"?><opml version="2.0"><head><title>Keep &amp; title</title></head><body><!--keep--><outline text="Alpha"><outline text="First" xmlUrl="https://one.example/rss?a=1&amp;b=2" htmlUrl="https://one.example/" custom="retain"/><outline text="Second" xmlUrl="https://two.example/rss"/></outline><outline text="Empty"/><outline text="Third" xmlUrl="https://three.example/rss"/></body></opml>';
const originalDirectory = "original directory\n\n## 说明\n\nKeep my subscription notes.\n";
writeFileSync(opmlPath, original); writeFileSync(directory, originalDirectory);
let admission = { peer: { principal: { kind: "owner" } } }, connection = true, host, disk;
const fetchBefore = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Subscription operation unexpectedly fetched a site"); };
function mount() {
  const routes = new Map(), tools = new Map(), disposers = [];
  apply({ tools: { register: (tool) => tools.set(tool.name, tool) },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    get(name) { if (name === "skills") return undefined; if (name === "connection") return connection ? { admit: () => admission } : null; if (name === "agentDefaultModel") return null; throw new Error(`Unexpected service ${name}`); },
    effect(setup, label) { if (label.endsWith("tick")) return; const dispose = setup(); if (typeof dispose === "function") disposers.push(dispose); },
  }, { opmlPath, dataDir, analysisEnabled: false, contentPerSync: 0 });
  return { routes, tools, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}
async function request(body, { method = "GET", type = "application/json" } = {}) {
  const incoming = Object.assign(new EventEmitter(), { method, url: "/plugin/rss-brief/subscriptions", headers: { "content-type": type } });
  const outgoing = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = JSON.parse(text); } };
  const pending = host.routes.get(incoming.url)(incoming, outgoing);
  if (method === "POST") queueMicrotask(() => { incoming.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body))); incoming.emit("end"); });
  await pending;
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return outgoing;
}
const tool = (args) => host.tools.get("rss_brief_subscriptions").execute(args);
const backups = () => readdirSync(root).filter((name) => name.endsWith(".bak"));
try {
  host = mount(); disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
  const records = parseOpml(original); const first = enabledFeeds(disk)[0];
  const [{ id }] = insertArticles(disk, first.id, [{ entryKey: "history", title: "History", url: "https://one.example/history", publishedAt: "2020-01-01T00:00:00Z", summary: "saved" }], (iso) => iso.slice(0, 10), "2020-01-01T00:00:00Z");
  setRead(disk, id, true, "2020-01-02T00:00:00Z");
  const history = { ...getArticle(disk, id) }, read = disk.prepare("SELECT * FROM reads").all();
  const historicalRows = disk.prepare("SELECT * FROM articles ORDER BY id").all();
  let snapshot = (await request()).body;
  assert.equal(snapshot.ok, true); assert.equal(snapshot.feeds.length, 3); assert.match(snapshot.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.categories, ["Alpha", "Empty", "未分组"]);
  assert.deepEqual(await tool({ action: "list" }), snapshot);
  assert.equal(readFileSync(opmlPath, "utf8"), original); assert.equal(readFileSync(directory, "utf8"), originalDirectory); assert.equal(backups().length, 0);
  const feed = { title: 'New & <title> "quoted"', xmlUrl: "https://new.example/rss?a=1&b=2", htmlUrl: "https://new.example/", group: 'New & <group> "quoted"' };
  const beforeInvalid = readFileSync(opmlPath, "utf8");
  for (const body of [null, [], {}, "{", " ".repeat(9000), { action: "list" }, { action: "add", revision: snapshot.revision, feed: { ...feed, title: "" } },
    ...["ftp://bad.example/", "javascript:alert(1)", "not a URL", "https://user:password@bad.example/"].map((xmlUrl) => ({ action: "add", revision: snapshot.revision, feed: { ...feed, xmlUrl } })),
    { action: "add", revision: snapshot.revision, feed: { ...feed, group: "bad\nline" } },
    { action: "add", revision: snapshot.revision, feed: { ...feed, htmlUrl: "invalid" } },
    { action: "add", revision: snapshot.revision, feed: { ...feed, htmlUrl: null } },
    { action: "add", revision: snapshot.revision, feed: { ...feed, title: "bad\ud800" } },
    { action: "add", revision: snapshot.revision, feed: { ...feed, title: "x".repeat(301) } },
    { action: "add", revision: snapshot.revision, feed: { ...feed, group: "x".repeat(121) } },
    { action: "delete", originalUrl: feed.xmlUrl },
    { action: "delete", revision: snapshot.revision, originalUrl: "https://unknown.example/feed" },
    { action: "add", revision: snapshot.revision, feed: { ...feed, extra: true } },
    { action: "add", revision: snapshot.revision, feed: records[0] }]) {
    assert.equal((await request(body, { method: "POST" })).status, 400, JSON.stringify(body).slice(0, 120));
    assert.equal(readFileSync(opmlPath, "utf8"), beforeInvalid);
  }
  assert.equal(backups().length, 0);
  for (const method of ["GET", "POST"]) {
    for (const denied of [{ rejection: 401 }, { rejection: 403 }, { peer: { principal: { kind: "guest" } } }, {}]) {
      admission = denied; assert.equal((await request({}, { method })).status, denied.rejection ?? 403);
    }
    connection = false; assert.equal((await request({}, { method })).status, 503); connection = true;
  }
  admission = { peer: { principal: { kind: "owner" } } };
  assert.equal((await request({}, { method: "POST", type: "text/plain" })).status, 415);
  assert.equal((await request({}, { method: "PUT" })).status, 405);
  let response = await request({ action: "add", revision: snapshot.revision, feed }, { method: "POST" });
  assert.equal(response.status, 200); const oldRevision = snapshot.revision; snapshot = response.body;
  assert.deepEqual(snapshot.feeds.slice(0, 3), records); assert.deepEqual(snapshot.feeds[3], feed);
  assert.equal(backups().length, 1); assert.equal(readFileSync(join(root, backups()[0]), "utf8"), original);
  assert.match(readFileSync(directory, "utf8"), /Keep my subscription notes/);
  assert.match(readFileSync(directory, "utf8"), /共 4 个订阅源/); assert.match(readFileSync(directory, "utf8"), /https:\/\/new.example\/rss\?a=1&b=2/);
  assert.match(readFileSync(opmlPath, "utf8"), /<!--keep-->/); assert.match(readFileSync(opmlPath, "utf8"), /custom="retain"/);
  assert.equal(enabledFeeds(disk).length, 4);
  assert.equal((await request({ action: "delete", revision: oldRevision, originalUrl: feed.xmlUrl }, { method: "POST" })).status, 409);
  assert.equal((await tool({ action: "delete", revision: oldRevision, originalUrl: feed.xmlUrl })).status, 409);
  const moved = { ...records[1], title: "Second updated", group: feed.group, xmlUrl: "https://replacement.example/rss" };
  snapshot = await tool({ action: "update", revision: snapshot.revision, originalUrl: records[1].xmlUrl, feed: moved });
  assert.equal(snapshot.ok, true); assert.deepEqual(snapshot.feeds.filter((item) => item.xmlUrl !== moved.xmlUrl), [records[0], records[2], feed]);
  assert.equal(disk.prepare("SELECT enabled FROM feeds WHERE xml_url = ?").get(records[1].xmlUrl).enabled, 0);
  assert.equal(disk.prepare("SELECT enabled FROM feeds WHERE xml_url = ?").get(moved.xmlUrl).enabled, 1);
  assert.equal((await tool({ action: "update", revision: snapshot.revision, originalUrl: moved.xmlUrl, feed: { ...moved, xmlUrl: feed.xmlUrl } })).status, 400);
  // External XML edit invalidates the snapshot without being overwritten.
  writeFileSync(opmlPath, readFileSync(opmlPath, "utf8").replace("<!--keep-->", "<!--external edit-->"));
  assert.equal((await tool({ action: "delete", revision: snapshot.revision, originalUrl: moved.xmlUrl })).status, 409);
  snapshot = await tool({ action: "list" });
  for (const item of [...snapshot.feeds]) snapshot = await tool({ action: "delete", revision: snapshot.revision, originalUrl: item.xmlUrl });
  assert.deepEqual(snapshot.feeds, []); assert.equal(enabledFeeds(disk).length, 0);
  assert.equal(isRead(disk, id), true); assert.deepEqual(disk.prepare("SELECT * FROM reads").all(), read);
  assert.deepEqual(disk.prepare("SELECT * FROM articles ORDER BY id").all(), historicalRows);
  assert.equal(getArticle(disk, id).title, history.title); assert.equal(getArticle(disk, id).feed_url, history.feed_url);
  assert.match(readFileSync(directory, "utf8"), /共 0 个订阅源/);
  host.dispose(); host = mount();
  assert.deepEqual((await tool({ action: "list" })).feeds, []);
  assert.equal((await host.tools.get("rss_brief_status").execute({})).opmlError, null);
  const sync = await host.tools.get("rss_brief_sync").execute({ wait: true });
  assert.equal(sync.completed, true); assert.equal(sync.result.feeds, 0); assert.equal(enabledFeeds(disk).length, 0);
  assert.equal(isRead(disk, id), true);
  snapshot = await tool({ action: "list" });
  snapshot = await tool({ action: "add", revision: snapshot.revision, feed }); assert.equal(snapshot.feeds.length, 1);
  // Malformed XML must never become a silently empty source list or be rewritten.
  const valid = readFileSync(opmlPath, "utf8");
  for (const malformed of ['<opml><body><outline text="broken"></body></opml>', '<opml><body/><body/></opml>', '<!DOCTYPE opml><opml><body/></opml>']) {
    writeFileSync(opmlPath, malformed); assert.throws(() => parseOpml(malformed));
    assert.equal((await tool({ action: "list" })).ok, false); assert.equal(readFileSync(opmlPath, "utf8"), malformed);
  }
  writeFileSync(opmlPath, valid);
  // A directory replacement failure restores OPML and leaves DB unchanged.
  const failureRoot = join(root, "failure"); mkdirSync(failureRoot);
  const failureOpml = join(failureRoot, "feeds.opml"); writeFileSync(failureOpml, original);
  mkdirSync(join(failureRoot, "订阅分类目录.md"));
  let reconciled = false;
  const fail = createSubscriptions({ opmlPath: failureOpml, reconcile() { reconciled = true; } });
  const baseline = fail({ action: "list" });
  assert.throws(() => fail({ action: "add", revision: baseline.revision, feed }));
  assert.equal(reconciled, false); assert.equal(readFileSync(failureOpml, "utf8"), original);
  // Reconciliation failure restores both existing files (the DB upsert itself is transactional).
  rmSync(join(failureRoot, "订阅分类目录.md"), { recursive: true });
  writeFileSync(join(failureRoot, "订阅分类目录.md"), "retained directory");
  const failReconcile = createSubscriptions({ opmlPath: failureOpml, reconcile() { throw new Error("injected database failure"); } });
  assert.throws(() => failReconcile({ action: "add", revision: baseline.revision, feed }), /injected/);
  assert.equal(readFileSync(failureOpml, "utf8"), original); assert.equal(readFileSync(join(failureRoot, "订阅分类目录.md"), "utf8"), "retained directory");
  const wrappedPath = join(root, "wrapped.opml");
  writeFileSync(wrappedPath, '<opml><body><outline text="Articles"><outline text="AI"><outline text="Example" xmlUrl="https://ai.example/rss"/></outline><outline text="Empty"/></outline></body></opml>');
  const wrapped = createSubscriptions({ opmlPath: wrappedPath, reconcile() {} });
  const grouped = wrapped({ action: "list" });
  assert.deepEqual(grouped.categories, ["AI", "Empty"], "Folo's Articles wrapper is not an editable category");
  const regrouped = wrapped({ action: "add", revision: grouped.revision, feed: { ...feed, group: "AI" } });
  assert.equal(regrouped.feeds.length, 2); assert.ok(regrouped.feeds.every((item) => item.group === "AI"));
  assert.equal(existsSync(join(root, "runtime")), false);
  console.log("ok - subscriptions CRUD, XML preservation, validation, owner API/tool parity, revisions, backups, rollback, empty lifecycle and retained history (offline)");
} finally {
  host?.dispose(); if (disk) closeDatabase(disk); globalThis.fetch = fetchBefore;
  assert.ok(root.startsWith(join(tmpdir(), "rss-subscriptions-check-")));
  rmSync(root, { recursive: true, force: true });
}
