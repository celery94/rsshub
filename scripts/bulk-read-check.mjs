/** Offline bulk-read scope, transaction and actual route checks. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import {
  openDatabase, closeDatabase, upsertFeeds, enabledFeeds, insertArticles,
  setRead, isRead, latestArticles, markLatestRead, markArticlesRead, setAiResult, upsertReport,
} from "../lib/db.js";
import { parseBulkReadRequest } from "../lib/bulk-read.js";

const NOW = "2026-01-02T12:00:00Z";
const PUBLISHED = "2026-01-01T12:00:00Z";
const feeds = [
  { title: "Source %_ Engineering", group: "Engineering", xmlUrl: "https://source.example/engineering", htmlUrl: "" },
  { title: "News", group: "News", xmlUrl: "https://source.example/news", htmlUrl: "" },
  { title: "Disabled", group: "Disabled", xmlUrl: "https://source.example/disabled", htmlUrl: "" },
];
function seed(db) {
  upsertFeeds(db, feeds);
  const groups = new Map(enabledFeeds(db).map((row) => [row.opml_group, row.id]));
  let serial = 0;
  const put = (group, title, publishedAt = PUBLISHED, summary = "Summary") => insertArticles(db, groups.get(group), [{
    entryKey: `item-${++serial}`, title, url: `https://source.example/item/${serial}`, publishedAt, summary,
  }], (iso) => iso.slice(0, 10), NOW)[0].id;
  const targets = Array.from({ length: 125 }, (_, index) => put("Engineering", `Target ${index}`));
  const nonmatch = put("Engineering", "Other title");
  const news = put("News", "Target outside category");
  const future = put("Engineering", "Target future", "2099-01-01T00:00:00Z");
  const disabled = put("Disabled", "Target disabled");
  upsertFeeds(db, feeds.slice(0, 2));
  setRead(db, targets[0], true, "2020-01-01T00:00:00Z");
  return { targets, nonmatch, news, future, disabled, put };
}
let checks = 0;
async function check(name, run) { await run(); console.log(`ok ${++checks} - ${name}`); }
const db = openDatabase(":memory:");
try {
  const ids = seed(db);
  const page = latestArticles(db, { limit: 100, q: "Target", category: "opml:Engineering", now: NOW });
  const scope = { q: "Target", category: "opml:Engineering", snapshot: page.pagination.snapshot, now: NOW };
  const late = ids.put("Engineering", "Target inserted after list snapshot");
  await check("all matching pages are updated while snapshot, category and publication boundaries are retained", () => {
    assert.equal(page.rows.length, 100);
    assert.equal(page.pagination.total, 125);
    const result = markLatestRead(db, scope, NOW);
    assert.equal(result.changed, 124);
    assert.deepEqual(new Set(result.ids), new Set(ids.targets.slice(1)));
    for (const id of ids.targets) assert.equal(isRead(db, id), true);
    for (const id of [ids.nonmatch, ids.news, ids.future, ids.disabled, late]) assert.equal(isRead(db, id), false, String(id));
    assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id = ?").get(ids.targets[0]).read_at, "2020-01-01T00:00:00Z");
  });
  await check("repeated bulk read is idempotent and clears the matching unread count", () => {
    assert.deepEqual(markLatestRead(db, { ...scope, unread: true }, NOW), { changed: 0, ids: [] });
    assert.equal(latestArticles(db, { ...scope, unread: true }).pagination.total, 0);
  });
  await check("search uses literal SQL substring semantics and the same AI-summary precedence", () => {
    const literal = ids.put("News", "Literal %_ article");
    const wildcard = ids.put("News", "Literal XY article");
    const ai = ids.put("News", "AI summary article", PUBLISHED, "hidden phrase");
    setAiResult(db, ai, { status: "ok", summary: "Selected summary phrase", relevance: 80 });
    assert.deepEqual(markLatestRead(db, { q: "%_", category: "opml:News", now: NOW }).ids, [literal]);
    assert.equal(isRead(db, wildcard), false);
    assert.equal(markLatestRead(db, { q: "hidden phrase", now: NOW }).changed, 0);
    assert.deepEqual(markLatestRead(db, { q: "SELECTED SUMMARY", now: NOW }).ids, [ai]);
  });
  await check("an explicit empty snapshot cannot expand to the whole database", () => {
    assert.equal(markLatestRead(db, { snapshot: 0, now: NOW }).changed, 0);
  });
  await check("a database write failure rolls back the entire filtered batch", () => {
    const first = ids.put("Engineering", "Rollback first");
    const second = ids.put("Engineering", "Rollback second");
    db.exec(`CREATE TRIGGER fail_bulk_read BEFORE INSERT ON reads WHEN NEW.article_id = ${second} BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    try {
      assert.throws(() => markLatestRead(db, { q: "Rollback", now: NOW }));
      assert.equal(isRead(db, first), false);
      assert.equal(isRead(db, second), false);
    } finally { db.exec("DROP TRIGGER fail_bulk_read"); }
  });
  await check("malformed filters are rejected instead of becoming an all-articles action", () => {
    const valid = { view: "latest", q: "Target", category: null, unread: false, snapshot: 10 };
    assert.equal(parseBulkReadRequest(valid).snapshot, 10);
    for (const body of [null, [], {}, { ...valid, view: "all" }, { ...valid, snapshot: undefined }, { ...valid, snapshot: -1 }, { ...valid, snapshot: "10" }, { ...valid, category: "ai" }, { ...valid, q: null }, { ...valid, unread: "true" }, { ...valid, ids: [1] }, { view: "daily", q: "", category: null, unread: false, date: "bad" }]) {
      assert.throws(() => parseBulkReadRequest(body), JSON.stringify(body));
    }
  });
} finally { closeDatabase(db); }

const root = mkdtempSync(join(tmpdir(), "rss-bulk-read-route-"));
const dataDir = join(root, "data");
const opmlPath = join(root, "feeds.opml");
mkdirSync(dataDir);
writeFileSync(opmlPath, '<opml version="2.0"><body><outline text="Engineering"><outline text="Source %_ Engineering" xmlUrl="https://source.example/engineering"/></outline><outline text="News"><outline text="News" xmlUrl="https://source.example/news"/></outline></body></opml>');
const disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
const ids = seed(disk);
const routes = new Map();
const disposers = [];
let admission = { peer: { principal: { kind: "owner" } } };
const ctx = {
  tools: { register() { return () => {}; } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  get(name) { if (name === "skills") return undefined; if (name === "connection") return { admit: () => admission }; throw new Error("No model or background service is needed for bulk reads"); },
  effect(setup, label) { if (label?.endsWith("tick")) return; const dispose = setup(); if (typeof dispose === "function") disposers.push(dispose); return dispose; },
};
async function request(body, { method = "POST", type = "application/json" } = {}) {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: "/plugin/rss-brief/read-all", headers: { "content-type": type } });
  const outgoing = { status: 0, headers: {}, text: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.text = text ?? ""; } };
  const pending = routes.get("/plugin/rss-brief/read-all").handler(incoming, outgoing);
  if (method === "POST") queueMicrotask(() => { incoming.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body))); incoming.emit("end"); });
  await pending;
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return { status: outgoing.status, body: JSON.parse(outgoing.text) };
}
try {
  apply(ctx, { dataDir, opmlPath });
  const latest = { view: "latest", q: "Target", category: "opml:Engineering", unread: true, snapshot: latestArticles(disk).pagination.snapshot };
  await check("bulk route enforces authentication, content type and strict scope before writes", async () => {
    assert.equal((await request(latest, { method: "GET" })).status, 405);
    admission = { rejection: 401 }; assert.equal((await request(latest)).status, 401);
    admission = { rejection: 403 }; assert.equal((await request(latest)).status, 403);
    admission = { peer: { principal: { kind: "owner" } } };
    assert.equal((await request(latest, { type: "text/plain" })).status, 415);
    assert.equal((await request({ ...latest, snapshot: undefined })).status, 400);
    assert.equal((await request("bad JSON")).status, 400);
    for (const feed of [null, "1", 0, -1, 1.5, true, 9007199254740992]) {
      assert.equal((await request({ ...latest, feed })).status, 400, `invalid feed ${feed}`);
    }
    const newsFeed = enabledFeeds(disk).find((feed) => feed.opml_group === "News").id;
    assert.equal((await request({ ...latest, feed: newsFeed })).body.changed, 0, "source composes with category instead of replacing it");
    assert.equal(isRead(disk, ids.targets[1]), false);
  });
  await check("actual latest route updates every filtered unread article and returns changed IDs", async () => {
    const feed = enabledFeeds(disk).find((source) => source.opml_group === "Engineering").id;
    const response = await request({ ...latest, feed });
    assert.equal(response.status, 200);
    assert.equal(response.body.changed, 124);
    assert.equal(response.body.ids.length, 124);
    assert.equal(isRead(disk, ids.news), false);
    assert.equal((await request(latest)).body.changed, 0);
  });
  await check("retired daily scope is rejected without changing historical articles", async () => {
    const scope = { view: "daily", date: "2026-01-01", q: "release", category: "ai", unread: false };
    upsertReport(disk, { date: scope.date, generatedAt: NOW, path: "fixture.md", payload: { groups: [
      { id: "ai", label: "AI", items: [{ id: ids.news, title: "Release", feed: "News" }] },
    ] } });
    assert.equal((await request(scope)).status, 400);
    assert.equal(isRead(disk, ids.news), false);
  });
  console.log(`PASS ${checks} offline bulk-read checks; no user data or model calls.`);
} finally {
  for (const dispose of disposers.reverse()) await dispose();
  closeDatabase(disk);
  rmSync(root, { recursive: true, force: true });
}
