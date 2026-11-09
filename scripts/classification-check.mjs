/** Fixed topic + content-format classification, counts and bulk actions; entirely offline. */
import assert from "node:assert/strict";
import { TAGGING_VERSION, TOPIC_TAGS, FORMAT_TAGS } from "../lib/tags.js";
import { assessmentInput } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, setContent, setRead, isRead, getArticle, saveAssessment,
  latestArticles, markLatestRead, commonTagVocabulary, pendingAssessments } from "../lib/db.js";
import { toReportArticle } from "../lib/report.js";
import { parseBulkReadRequest } from "../lib/bulk-read.js";

const NOW = "2026-11-09T08:00:00.000Z";
const DEFAULT_TAGS = ["软件开发", "技术解析"];
let checks = 0;
function check(name, run) { run(); console.log(`ok ${++checks} - ${name}`); }
function valid(id, tags = DEFAULT_TAGS) {
  return { id, contentType: "editorial", tags, score: 85,
    dimensions: { information: 22, evidence: 22, depth: 17, utility: 16, clarity: 8 },
    category: "engineering", relevance: 80, summary: "独立实验比较了实现方法。", reason: "提供证据并说明局限。", at: NOW };
}
function setup(db) {
  upsertFeeds(db, [
    { xmlUrl: "https://a.test/rss", htmlUrl: "", title: "A", group: "Dev" },
    { xmlUrl: "https://b.test/rss", htmlUrl: "", title: "B", group: "Dev" },
    { xmlUrl: "https://c.test/rss", htmlUrl: "", title: "C", group: "Other" },
    { xmlUrl: "https://off.test/rss", htmlUrl: "", title: "Off", group: "Disabled" },
  ]);
  let sequence = 0;
  return ({ tags = DEFAULT_TAGS, feed = 1, title = "Target article", publishedAt = "2026-11-09T01:00:00.000Z", full = true } = {}) => {
    const id = insertArticles(db, feed, [{ entryKey: `article-${++sequence}`, title, summary: "Excerpt", publishedAt }], (iso) => iso.slice(0, 10), NOW)[0].id;
    if (full) setContent(db, id, "ok", "Full technical article", null);
    saveAssessment(db, id, valid(id, tags)); return id;
  };
}
const nonzero = (items) => Object.fromEntries(items.filter((item) => item.count).map((item) => [item.name, item.count]));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in classification-check"); };
try {
  check("empty fixed directories always expose every topic and format in declared order", () => {
    const db = openDatabase(":memory:");
    try {
      const page = latestArticles(db, { now: NOW });
      assert.deepEqual(page.latest.tagGroups.topics, TOPIC_TAGS.map((name) => ({ name, count: 0 })));
      assert.deepEqual(page.latest.tagGroups.formats, FORMAT_TAGS.map((name) => ({ name, count: 0 })));
      assert.deepEqual(page.latest.tags, []); assert.equal(page.pagination.total, 0);
    } finally { db.close(); }
  });
  check("new classifications are canonical and report exposes topics and format while retaining legacy labels", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db); const legacy = add();
      db.prepare("DELETE FROM article_tags WHERE article_id=?").run(legacy);
      const insert = db.prepare("INSERT INTO article_tags(article_id,tag_key,tag,position) VALUES(?,?,?,?)");
      insert.run(legacy, "rust", "Rust", 0); insert.run(legacy, "ai编程", "ai编程", 1);
      db.prepare("UPDATE articles SET tagging_version=2 WHERE id=?").run(legacy);
      const old = toReportArticle(getArticle(db, legacy));
      assert.deepEqual(old.tags, ["Rust", "ai编程"]); assert.deepEqual(old.topics, []); assert.equal(old.format, null);
      assert.equal(old.assessment.highQuality, true); assert.equal(old.assessment.stale, false);
      assert.ok(pendingAssessments(db, { now: NOW }).some((row) => row.id === legacy));
      const canonical = add({ tags: ["技术解析", "ai编程", "软件开发"] });
      const display = toReportArticle(getArticle(db, canonical));
      assert.deepEqual(display.tags, ["AI编程", "软件开发", "技术解析"]);
      assert.deepEqual(display.topics, ["AI编程", "软件开发"]); assert.equal(display.format, "技术解析");
      assert.equal(getArticle(db, canonical).tagging_version, TAGGING_VERSION);
      assert.deepEqual(latestArticles(db, { now: NOW, tag: "Ｒｕｓｔ" }).rows.map((row) => row.id), [legacy]);
      assert.equal(latestArticles(db, { now: NOW, tag: "ai编程" }).pagination.total, 2);
      assert.equal(latestArticles(db, { now: NOW }).latest.tagGroups.topics.find((item) => item.name === "AI编程").count, 2);
      assert.deepEqual(new Set(commonTagVocabulary(db)), new Set(["AI编程", "软件开发", "技术解析"]));
      const before = { ...getArticle(db, canonical) };
      for (const tags of [["软件开发"], ["技术解析"], ["Rust", "技术解析"], ["软件开发", "技术解析", "新闻动态"], ["软件开发", "数据与数据库", "AI编程", "技术解析"]]) assert.throws(() => saveAssessment(db, canonical, valid(canonical, tags)));
      assert.deepEqual({ ...getArticle(db, canonical) }, before);
      const noTags = valid(canonical); delete noTags.tags; saveAssessment(db, canonical, noTags);
      assert.deepEqual(toReportArticle(getArticle(db, canonical)).tags, display.tags);
    } finally { db.close(); }
  });
  check("topic-format intersection shares quality, search, unread, source, category and snapshot boundaries", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db); const one = add(); const multi = add({ tags: ["软件开发", "数据与数据库", "技术解析"] });
      const tutorial = add({ tags: ["软件开发", "教程指南"] }); const data = add({ tags: ["数据与数据库", "技术解析"] });
      const source = add({ feed: 2 }); const category = add({ feed: 3 }); const read = add(); setRead(db, read, true, NOW);
      const excerpt = add({ full: false }); const stale = add(); setContent(db, stale, "ok", "Changed article", null);
      const future = add({ publishedAt: "2030-01-01T00:00:00.000Z" }); const disabled = add({ feed: 4 }); db.prepare("UPDATE feeds SET enabled=0 WHERE id=4").run();
      const discarded = add(); saveAssessment(db, discarded, { contentType: "advertisement", discardReason: "促销购买引导", at: NOW });
      const nonmatch = add({ title: "Unrelated" });
      const snapshot = Number(db.prepare("SELECT MAX(id) AS id FROM articles").get().id); const late = add();
      const scope = { now: NOW, q: "Target", category: "opml:Dev", feed: 1, quality: "high", unread: true, snapshot, tag: "软件开发", format: "技术解析" };
      const page = latestArticles(db, { ...scope, limit: 1 });
      assert.deepEqual(page.rows.map((row) => row.id), [multi]); assert.equal(page.pagination.total, 2); assert.equal(page.pagination.hasMore, true);
      assert.deepEqual(latestArticles(db, { ...scope, limit: 1, offset: 1 }).rows.map((row) => row.id), [one]);
      assert.equal(page.latest.unread, 2); assert.equal(page.latest.total, 4);
      assert.deepEqual(Object.fromEntries(page.latest.categories.map((item) => [item.label, item.count])), { Dev: 3, Other: 1 });
      assert.deepEqual(Object.fromEntries(page.latest.sources.map((item) => [item.title, item.count])), { A: 2, B: 1, C: 1 });
      assert.deepEqual(nonzero(page.latest.tagGroups.topics), { 软件开发: 2, 数据与数据库: 2 });
      assert.deepEqual(nonzero(page.latest.tagGroups.formats), { 教程指南: 1, 技术解析: 2 });
      assert.deepEqual(nonzero(page.latest.tags), { 技术解析: 3, 数据与数据库: 2, 软件开发: 2 });
      assert.deepEqual(page.latest.tagGroups.topics.map((item) => item.name), TOPIC_TAGS); assert.deepEqual(page.latest.tagGroups.formats.map((item) => item.name), FORMAT_TAGS);
      const missing = latestArticles(db, { ...scope, tag: "Unknown legacy tag" });
      assert.equal(missing.pagination.total, 0); assert.equal(missing.latest.unread, 0); assert.equal(missing.latest.total, 0);
      assert.deepEqual(missing.latest.tagGroups.topics, page.latest.tagGroups.topics); assert.deepEqual(nonzero(missing.latest.tagGroups.formats), {});
      const guide = latestArticles(db, { ...scope, format: "教程指南" });
      assert.deepEqual(guide.rows.map((row) => row.id), [tutorial]); assert.deepEqual(nonzero(guide.latest.tagGroups.topics), { 软件开发: 1 });
      assert.deepEqual(guide.latest.tagGroups.formats, page.latest.tagGroups.formats);
      const withRead = latestArticles(db, { ...scope, unread: false }); assert.equal(withRead.pagination.total, 3); assert.equal(withRead.latest.unread, 2);
      assert.deepEqual(nonzero(withRead.latest.tagGroups.topics), { 软件开发: 3, 数据与数据库: 2 });
      assert.deepEqual(markLatestRead(db, scope, NOW).ids, [one, multi]);
      for (const id of [tutorial, data, source, category, excerpt, stale, future, disabled, discarded, nonmatch, late]) assert.equal(isRead(db, id), false, String(id));
      assert.equal(latestArticles(db, scope).pagination.total, 0);
    } finally { db.close(); }
  });
  check("format scopes span unloaded pages, compose with topic and preserve previously read timestamps", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db); const matches = Array.from({ length: 125 }, () => add());
      const otherFormat = add({ tags: ["软件开发", "教程指南"] }); const otherTopic = add({ tags: ["数据与数据库", "技术解析"] });
      setRead(db, matches[0], true, "2020-01-01T00:00:00.000Z");
      const page = latestArticles(db, { now: NOW, tag: "软件开发", format: "技术解析", limit: 1 }); assert.equal(page.pagination.total, 125);
      const body = { view: "latest", q: "", category: null, unread: false, snapshot: page.pagination.snapshot, tag: "#软件开发", format: " #技术解析 " };
      const scope = parseBulkReadRequest(body); assert.equal(scope.format, "技术解析"); assert.equal(scope.tag, "软件开发");
      const result = markLatestRead(db, { ...scope, now: NOW }, NOW); assert.equal(result.changed, 124);
      assert.ok(matches.every((id) => isRead(db, id))); assert.equal(isRead(db, otherFormat), false); assert.equal(isRead(db, otherTopic), false);
      assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id=?").get(matches[0]).read_at, "2020-01-01T00:00:00.000Z");
      assert.equal(markLatestRead(db, { ...scope, now: NOW }, NOW).changed, 0);
      assert.deepEqual(markLatestRead(db, { now: NOW, format: "教程指南" }, NOW).ids, [otherFormat]);
    } finally { db.close(); }
  });
  check("invalid format is rejected before any read changes and cannot widen to every article", () => {
    const db = openDatabase(":memory:");
    try {
      const id = setup(db)(); const page = latestArticles(db, { now: NOW });
      const body = { view: "latest", q: "", category: null, unread: false, snapshot: page.pagination.snapshot };
      for (const format of [null, "", "#", "软件开发", "Rust", "技术解析\n", "\t技术解析", [], {}, 1, true]) {
        assert.throws(() => parseBulkReadRequest({ ...body, format })); assert.throws(() => latestArticles(db, { format })); assert.throws(() => markLatestRead(db, { format }));
      }
      assert.equal(parseBulkReadRequest(body).format, undefined); assert.equal(isRead(db, id), false);
      assert.equal(assessmentInput(getArticle(db, id)).fingerprint, getArticle(db, id).assessment_current_fingerprint);
    } finally { db.close(); }
  });
  console.log(`\n${checks} offline fixed classification checks passed.`);
} finally { globalThis.fetch = originalFetch; }
