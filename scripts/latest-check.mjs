/** Offline latest query/Host checks; all writes stay in memory or a disposable directory. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import {
  openDatabase, closeDatabase, upsertFeeds, enabledFeeds, insertArticles,
  setAiResult, setRead, latestArticles, upsertReport, getReport,
} from "../lib/db.js";

const now = new Date();
const stamp = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const feeds = [
  { xmlUrl: "https://example.test/blog", htmlUrl: "https://example.test", title: "Blog %_ Feed", group: "Blogs" },
  { xmlUrl: "https://example.test/news", htmlUrl: "", title: "News", group: "News" },
  { xmlUrl: "https://example.test/empty", htmlUrl: "", title: "Empty", group: "Empty" },
  { xmlUrl: "https://example.test/off", htmlUrl: "", title: "Disabled", group: "Disabled" },
];
function seed(db) {
  upsertFeeds(db, feeds);
  const byGroup = new Map(enabledFeeds(db).map((feed) => [feed.opml_group, feed.id]));
  const put = (group, key, days, summary = "feed fallback") => insertArticles(db, byGroup.get(group), [{
    entryKey: key, title: key, url: `https://example.test/${key}`, publishedAt: stamp(days), summary,
  }], (iso) => iso.slice(0, 10), now.toISOString())[0].id;
  const today = put("Blogs", "today pending", 0.001);
  const yesterday = put("News", "yesterday", 1);
  const older = put("Blogs", "older", 10);
  const tie = put("Blogs", "same timestamp newer ID", 0.001);
  const literal = put("News", "literal %_ title", 2, "contains %_ literally");
  const wildcard = put("News", "literal XY title", 3);
  put("Blogs", "future", -1);
  put("Disabled", "disabled", 0.0001);
  setAiResult(db, older, { status: "ok", relevance: 99, summary: "AI chosen summary" });
  setAiResult(db, literal, { status: "ok", relevance: 42, summary: "replacement without symbols" });
  setRead(db, today, true);
  upsertFeeds(db, feeds.slice(0, 3));
  return { today, yesterday, older, tie, literal, wildcard, byGroup };
}
const db = openDatabase(":memory:");
try {
  const ids = seed(db);
  const first = latestArticles(db, { limit: 2, now: now.toISOString() });
  assert.deepEqual(first.rows.map((row) => row.id), [ids.tie, ids.today]);
  assert.equal(first.pagination.total, 6);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.nextOffset, 2);
  assert.equal(first.latest.available, 6);
  assert.equal(first.latest.unread, 5);
  assert.deepEqual(first.latest.categories.map((c) => [c.key, c.count]), [["opml:Blogs", 3], ["opml:Empty", 0], ["opml:News", 3]]);
  assert.equal(first.rows[1].ai_status, "pending");
  const fresh = insertArticles(db, ids.byGroup.get("News"), [{
    entryKey: "new insert", title: "new insert", publishedAt: stamp(0.0005),
  }], (iso) => iso.slice(0, 10), now.toISOString())[0].id;
  const next = latestArticles(db, { limit: 2, offset: 2, snapshot: first.pagination.snapshot, now: now.toISOString() });
  assert.deepEqual(next.rows.map((row) => row.id), [ids.yesterday, ids.literal]);
  assert.equal(next.pagination.total, 6);
  assert.equal(next.latest.available, 7);
  assert.ok(!next.rows.some((row) => row.id === fresh));
  assert.equal(latestArticles(db, { now: now.toISOString() }).rows[0].id, fresh);
  const literal = latestArticles(db, { q: "%_", now: now.toISOString() });
  assert.deepEqual(new Set(literal.rows.map((row) => row.id)), new Set([ids.today, ids.older, ids.tie, ids.literal]));
  assert.equal(latestArticles(db, { q: "contains", now: now.toISOString() }).pagination.total, 0, "AI summary replaces feed summary for search");
  assert.equal(latestArticles(db, { q: "chosen", now: now.toISOString() }).rows[0].id, ids.older);
  const combined = latestArticles(db, { q: "%_", category: "opml:Blogs", unread: true, now: now.toISOString() });
  assert.equal(combined.pagination.total, 2);
  assert.equal(combined.latest.total, 3, "facet total ignores category");
  assert.equal(combined.latest.unread, 2);
  assert.equal(combined.latest.categories.find((c) => c.label === "News").count, 1);
  const unknown = latestArticles(db, { category: "opml:missing", now: now.toISOString() });
  assert.equal(unknown.rows.length, 0);
  assert.equal(unknown.latest.categories.length, 3);
  assert.equal(unknown.latest.total, 7);
  setRead(db, ids.tie, true);
  assert.equal(latestArticles(db, { category: "opml:Blogs", unread: true }).pagination.total, 1);
  setRead(db, ids.tie, false);
  assert.equal(latestArticles(db, { category: "opml:Blogs", unread: true }).pagination.total, 2);
  assert.equal(latestArticles(db, { snapshot: 0 }).pagination.total, 0);
  const beyond = latestArticles(db, { offset: 999 });
  assert.equal(beyond.pagination.hasMore, false);
  assert.equal(beyond.pagination.nextOffset, null);
  assert.equal(beyond.rows.length, 0);
} finally {
  closeDatabase(db);
}

const workDir = mkdtempSync(join(tmpdir(), "rss-brief-latest-check-"));
const dataDir = join(workDir, "data");
const opmlPath = join(workDir, "feeds.opml");
const routes = new Map();
const disposers = [];
const tools = new Map();
const ctx = {
  tools: { register(tool) { tools.set(tool.name, tool); } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  get() { throw new Error("Latest must not call a model service"); },
  effect(setup, label) {
    if (label.endsWith("tick")) return;
    const dispose = setup();
    if (typeof dispose === "function") disposers.push(dispose);
  },
};
// buildStatus reads default model selection, but latest must never prepare an LLM call.
ctx.get = (name) => {
  if (name === "skills") return undefined;
  assert.equal(name, "agentDefaultModel");
  return undefined;
};
async function request(path, method = "GET", body) {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: path });
  const outgoing = {
    status: 0, headers: {}, text: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(text) { this.text = text ?? ""; },
  };
  const pending = routes.get(path.split("?")[0]).handler(incoming, outgoing);
  if (body !== undefined) incoming.emit("data", Buffer.from(JSON.stringify(body)));
  incoming.emit("end");
  await pending;
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return { ...outgoing, body: outgoing.text ? JSON.parse(outgoing.text) : null };
}
try {
  mkdirSync(dataDir);
  writeFileSync(opmlPath, `<opml version="2.0"><body>${feeds.slice(0, 3).map((f) => `<outline text="${f.group}"><outline text="${f.title}" xmlUrl="${f.xmlUrl}" /></outline>`).join("")}</body></opml>`);
  const disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
  const ids = seed(disk);
  const payload = { groups: [{ id: "ai", label: "AI", items: [{ id: ids.today, title: "daily cached" }] }], stats: { included: 1 } };
  upsertReport(disk, { date: "2020-01-01", generatedAt: stamp(1), path: join(workDir, "daily.md"), payload });
  closeDatabase(disk);
  apply(ctx, { dataDir, opmlPath });
  const latest = await request("/plugin/rss-brief/latest");
  assert.equal(latest.status, 200);
  assert.deepEqual(Object.keys(latest.body).sort(), ["ok", "view", "date", "dates", "report", "pagination", "latest", "feeds", "schedule", "running", "lastRun", "analysis"].sort());
  assert.equal(latest.body.view, "latest");
  assert.equal(latest.body.date, null);
  assert.deepEqual(latest.body.dates, []);
  assert.equal(latest.body.pagination.limit, 100);
  assert.equal(latest.body.pagination.offset, 0);
  assert.equal(latest.body.report.stats.included, 6);
  assert.equal(latest.body.report.generatedAt, null);
  assert.equal(latest.body.report.fallback, false);
  assert.equal(latest.body.analysis.enabled, true);
  assert.equal(latest.body.analysis.effective, null);
  assert.match(latest.body.report.warnings[0], /文章分析.*模型/, "missing analysis route is visible without blocking latest articles");
  assert.equal(latest.body.schedule.timeZone, "Asia/Shanghai");
  assert.equal("reportAt" in latest.body.schedule, false);
  assert.equal("nextReportAt" in latest.body.schedule, false);
  const items = latest.body.report.groups.flatMap((g) => g.items);
  assert.equal(items.find((a) => a.id === ids.today).relevance, null);
  assert.equal(items.find((a) => a.id === ids.today).summary, "feed fallback");
  assert.equal(items.find((a) => a.id === ids.older).summary, "AI chosen summary");
  assert.equal(items.find((a) => a.id === ids.today).read, true);
  assert.equal((await request("/plugin/rss-brief/latest", "HEAD")).text, "");
  assert.equal((await request("/plugin/rss-brief/latest", "POST")).status, 405);
  for (const query of ["limit=0", "limit=201", "limit=2x", "limit=1.5", "offset=-1", "offset=", "snapshot=-1", "snapshot=9007199254740992", "unread=yes", "category=Blogs", "limit=1&limit=2", "feed=", "feed=0", "feed=-1", "feed=1.5", "feed=1x", "feed=1e2", "feed=%201", "feed=9007199254740992", "feed=1&feed=2"]) {
    assert.equal((await request(`/plugin/rss-brief/latest?${query}`)).status, 400, query);
  }
  const sourcePage = await request(`/plugin/rss-brief/latest?feed=${ids.byGroup.get("Blogs")}&limit=1`);
  assert.equal(sourcePage.body.pagination.total, 3);
  assert.equal(sourcePage.body.latest.unread, 2);
  assert.equal(sourcePage.body.latest.sources.length, 3);
  assert.deepEqual(sourcePage.body.latest.sources.map((source) => [source.category, source.count]), [["opml:Blogs", 3], ["opml:Empty", 0], ["opml:News", 3]]);
  const sourceNext = await request(`/plugin/rss-brief/latest?feed=${ids.byGroup.get("Blogs")}&limit=1&offset=1&snapshot=${sourcePage.body.pagination.snapshot}`);
  assert.equal(sourceNext.body.report.groups[0].items[0].id, ids.today);
  const sourceState = await request(`/plugin/rss-brief/state?feed=${ids.byGroup.get("News")}&category=opml%3ABlogs`);
  assert.equal(sourceState.body.pagination.total, 0, "state composes category and feed");
  assert.equal(sourceState.body.latest.sources.find((source) => source.category === "opml:News").count, 3);
  assert.equal((await request("/plugin/rss-brief/latest?limit=200&snapshot=0")).status, 200);
  assert.equal((await request("/plugin/rss-brief/latest?category=opml%3Amissing")).body.pagination.total, 0);
  assert.equal((await request("/plugin/rss-brief/latest?unread=1")).body.pagination.total, 5);
  assert.equal((await request("/plugin/rss-brief/read", "POST", { id: ids.today, read: false })).status, 200);
  assert.equal((await request("/plugin/rss-brief/latest?unread=1")).body.pagination.total, 6);
  const state = await request("/plugin/rss-brief/state?date=2020-01-01");
  assert.equal(state.body.view, "latest", "legacy state route serves latest articles");
  assert.deepEqual(state.body.dates, []);
  assert.equal(state.body.report.stats.included, 6);
  assert.ok(!state.body.report.groups.flatMap((group) => group.items).some((item) => item.title === "daily cached"));
  assert.equal(tools.has("rss_brief_report"), false);
  assert.equal(routes.has("/plugin/rss-brief/report"), false);
  const preserved = openDatabase(join(dataDir, "rss-brief.sqlite"));
  assert.equal(getReport(preserved, "2020-01-01").payload_json, JSON.stringify(payload), "historical report data is preserved");
  closeDatabase(preserved);
  // Shutdown clears storage; read routes must return 503 without reopening it.
  disposers.pop()();
  assert.equal((await request("/plugin/rss-brief/latest")).status, 503);
  console.log("latest checks passed (memory SQL, temporary Host, HTTP semantics, latest state alias and historical data)");
} finally {
  for (const dispose of disposers.reverse()) dispose();
  // workDir is the exact directory created above by mkdtempSync.
  assert.ok(workDir.startsWith(join(tmpdir(), "rss-brief-latest-check-")));
  rmSync(workDir, { recursive: true, force: true });
}
