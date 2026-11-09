import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTag, normalizeTagKey, normalizeTags, TOPIC_TAGS, FORMAT_TAGS } from "../lib/tags.js";
import { ASSESSMENT_VERSION, assessArticles, parseAssessmentResponse } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, getArticle, reportCandidates, saveAssessment, pendingAssessments,
  latestArticles, markLatestRead, setContent, setRead, isRead, commonTagVocabulary } from "../lib/db.js";
import { toReportArticle } from "../lib/report.js";
import { parseBulkReadRequest } from "../lib/bulk-read.js";

const NOW = "2026-11-09T08:00:00.000Z";
const DATE = NOW.slice(0, 10);
const DEFAULT_TAGS = ["软件开发", "技术解析"];
let checks = 0;
async function check(name, run) { await run(); console.log(`ok ${++checks} - ${name}`); }
function valid(id, tags = DEFAULT_TAGS) {
  return { id, contentType: "editorial", tags, score: 85,
    dimensions: { information: 22, evidence: 22, depth: 17, utility: 16, clarity: 8 },
    category: "engineering", relevance: 80, summary: "独立实验报告提供具体数据。", reason: "证据充分，并说明实验局限。", at: NOW };
}
function fixture(db) {
  upsertFeeds(db, [
    { xmlUrl: "https://a.test/rss", htmlUrl: "", title: "A", group: "Dev" },
    { xmlUrl: "https://b.test/rss", htmlUrl: "", title: "B", group: "News" },
    { xmlUrl: "https://off.test/rss", htmlUrl: "", title: "Disabled", group: "Disabled" },
  ]);
  let sequence = 0;
  return ({ feed = 1, title = "Target", publishedAt = "2026-11-09T01:00:00.000Z", tags = DEFAULT_TAGS, full = true } = {}) => {
    const id = insertArticles(db, feed, [{ entryKey: `article-${++sequence}`, title, summary: "An excerpt", publishedAt }], (iso) => iso.slice(0, 10), NOW)[0].id;
    if (full) setContent(db, id, "ok", "Complete technical report", null);
    if (tags !== null) saveAssessment(db, id, valid(id, tags));
    return id;
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in tags-check"); };
try {
  await check("legacy tag normalization retains NFKC, Unicode lengths and case-insensitive deduplication", () => {
    assert.equal(normalizeTag("  ＃＃Ｒｕｓｔ  "), "Rust");
    assert.equal(normalizeTag("#  machine　 learning"), "machine learning");
    assert.equal(normalizeTagKey("ÉＣＯＬＥ"), "école");
    assert.deepEqual(normalizeTags(["#Rust", "ＲＵＳＴ", "rust", "École", "école"]), ["Rust", "École"]);
    assert.deepEqual(normalizeTags(["Rust", "rust", "ＲＵＳＴ", "#Rust", "RUST", " rust "]), ["Rust"]);
    assert.equal(normalizeTag("😀".repeat(24)), "😀".repeat(24));
    for (const invalid of [null, undefined, true, 1, [], {}, "", "  ", "###", "a".repeat(25), "😀".repeat(25), "\nRust", "Rust\t", "Ru\u0000st", "Ru\u200bst", "\ufeffRust"]) assert.throws(() => normalizeTag(invalid));
    for (const invalid of [undefined, null, "Rust", [], ["Rust", "AI", "SQL", "DB", "Go", "JS"], [42]]) assert.throws(() => normalizeTags(invalid));
  });
  await check("editorial model tags require fixed topics and one format, ads need no tags", async () => {
    const missing = valid(1); delete missing.tags;
    for (const tags of [undefined, null, [], "Rust", [""], [1], ["\n软件开发", "技术解析"], ["Rust", "技术解析"], ["软件开发"], ["技术解析"], ["软件开发", "技术解析", "研究报告"]]) {
      assert.throws(() => parseAssessmentResponse(JSON.stringify([{ ...valid(1), tags }]), new Set([1])));
    }
    assert.throws(() => parseAssessmentResponse(JSON.stringify([missing]), new Set([1])));
    const parsed = parseAssessmentResponse(JSON.stringify([valid(1, ["技术解析", "#软件开发", "软件开发"]), { id: 2, contentType: "advertisement", discardReason: "促销购买引导" }]), new Set([1, 2]));
    assert.deepEqual(parsed.get(1).tags, DEFAULT_TAGS); assert.equal(parsed.get(2).tags, undefined);
    assert.deepEqual([...parseAssessmentResponse(JSON.stringify([valid(1), { ...valid(2), tags: [] }]), new Set([1, 2])).keys()], [1]);
    let calls = 0;
    const result = await assessArticles({ articles: [{ id: 1, text: "body" }], callModel: async ({ system }) => {
      assert.ok(system.includes("软件开发") && system.includes("技术解析"));
      return JSON.stringify([++calls === 1 ? missing : valid(1)]);
    } });
    assert.equal(calls, 2); assert.equal(result.results.length, 1); assert.deepEqual(result.results[0].tags, DEFAULT_TAGS);
  });
  await check("success replaces classification, while failure and legacy callers retain tags and old links remain visible", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const a = add(); const b = add();
      assert.deepEqual(toReportArticle(reportCandidates(db, DATE, 100).find((row) => row.id === a)).tags, DEFAULT_TAGS);
      saveAssessment(db, a, valid(a, ["数据与数据库", "研究报告"]));
      const replacement = ["数据与数据库", "研究报告"]; const before = getArticle(db, a);
      saveAssessment(db, a, { status: "failed", error: "temporary", at: NOW });
      assert.deepEqual(toReportArticle(getArticle(db, a)).tags, replacement); assert.equal(getArticle(db, a).assessment_score, before.assessment_score);
      const legacy = valid(a); delete legacy.tags; delete legacy.contentType; saveAssessment(db, a, legacy);
      assert.deepEqual(toReportArticle(getArticle(db, a)).tags, replacement);
      for (const tags of [[], ["Rust"], ["软件开发"], ["软件开发", "自由标签", "技术解析"]]) assert.throws(() => saveAssessment(db, a, valid(a, tags)));
      assert.deepEqual(toReportArticle(getArticle(db, a)).tags, replacement);
      const untagged = add({ tags: null }); saveAssessment(db, untagged, { ...legacy, id: untagged });
      assert.deepEqual(toReportArticle(getArticle(db, untagged)).tags, []); assert.ok(pendingAssessments(db, { now: NOW }).some((row) => row.id === untagged));
      db.prepare("INSERT INTO article_tags(article_id,tag_key,tag,position) VALUES(?,?,?,2)").run(a, "école", "École");
      assert.deepEqual(toReportArticle(getArticle(db, a)).tags, [...replacement, "École"]);
      assert.deepEqual(latestArticles(db, { now: NOW, tag: "ÉCOLE" }).rows.map((row) => row.id), [a]);
      saveAssessment(db, b, { contentType: "advertorial", discardReason: "品牌宣传与购买链接", at: NOW });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM article_tags WHERE article_id=?").get(b).n, 0);
      assert.deepEqual(toReportArticle(getArticle(db, b, { includeDiscarded: true })).tags, []);
      assert.deepEqual(new Set(commonTagVocabulary(db)), new Set(replacement));
      db.prepare("DELETE FROM articles WHERE id=?").run(a); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM article_tags").get().n, 0);
    } finally { db.close(); }
  });
  await check("classification insertion and discard cleanup failures roll back assessment writes", () => {
    const db = openDatabase(":memory:");
    try {
      const id = fixture(db)(); const before = getArticle(db, id);
      db.exec("CREATE TRIGGER fail_tag BEFORE INSERT ON article_tags WHEN NEW.tag_key='研究报告' BEGIN SELECT RAISE(ABORT,'tag failure'); END");
      assert.throws(() => saveAssessment(db, id, { ...valid(id, ["数据与数据库", "研究报告"]), summary: "Replacement summary" }), /tag failure/);
      assert.deepEqual(toReportArticle(getArticle(db, id)).tags, DEFAULT_TAGS); assert.equal(getArticle(db, id).assessment_summary, before.assessment_summary);
      db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON article_tags BEGIN SELECT RAISE(ABORT,'cleanup failure'); END");
      assert.throws(() => saveAssessment(db, id, { contentType: "advertisement", discardReason: "促销", at: NOW }), /cleanup failure/);
      assert.equal(getArticle(db, id).discarded_at, null); assert.deepEqual(toReportArticle(getArticle(db, id)).tags, DEFAULT_TAGS);
    } finally { db.close(); }
  });
  await check("schema4 adds tags and version without invalidating quality; missing classifications backfill with retries", () => {
    const root = mkdtempSync(join(tmpdir(), "rss-tags-schema-")); const file = join(root, "test.sqlite"); let db;
    try {
      db = openDatabase(file); const add = fixture(db); const recent = add(); const old = add({ publishedAt: "2020-01-01T01:00:00.000Z" });
      const empty = add({ tags: null }); db.prepare("UPDATE articles SET feed_summary=NULL,content_text=NULL WHERE id=?").run(empty);
      const future = add({ publishedAt: "2030-01-01T00:00:00.000Z" }); const disabled = add({ feed: 3 }); db.prepare("UPDATE feeds SET enabled=0 WHERE id=3").run();
      const before = getArticle(db, recent); db.exec("DROP TABLE article_tags; ALTER TABLE articles DROP COLUMN tagging_version; PRAGMA user_version=4"); db.close(); db = openDatabase(file);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6); assert.equal(ASSESSMENT_VERSION, 2);
      const row = getArticle(db, recent);
      for (const key of ["assessment_score", "assessment_version", "assessment_fingerprint", "assessment_current_fingerprint"]) assert.equal(row[key], before[key]);
      assert.equal(toReportArticle(row).assessment.highQuality, true); assert.deepEqual(toReportArticle(row).tags, []);
      assert.deepEqual(pendingAssessments(db, { sinceIso: "2026-11-01", now: NOW }).map((item) => item.id), [recent]);
      saveAssessment(db, recent, { status: "failed", error: "no model", at: NOW }); assert.equal(pendingAssessments(db, { sinceIso: "2026-11-01", now: NOW }).length, 0);
      assert.deepEqual(pendingAssessments(db, { sinceIso: "2026-11-01", now: "2026-11-09T08:06:00.000Z" }).map((item) => item.id), [recent]);
      assert.ok(!pendingAssessments(db, { sinceIso: "2026-11-01", now: NOW, force: true }).some((item) => [old, empty, future, disabled].includes(item.id)));
      db.exec("PRAGMA user_version=4"); db.close(); db = openDatabase(file); assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
    } finally { db?.close(); assert.ok(root.startsWith(join(tmpdir(), "rss-tags-schema-"))); rmSync(root, { recursive: true, force: true }); }
  });
  await check("tag facets and unread counts retain search, quality, snapshot and source scope", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const software = add(); const data = add({ tags: ["数据与数据库", "技术解析"] });
      const news = add({ feed: 2 }); const excerpt = add({ full: false }); const read = add(); setRead(db, read, true, NOW);
      add({ title: "Unrelated" }); add({ publishedAt: "2030-01-01T00:00:00.000Z" }); add({ feed: 3 }); db.prepare("UPDATE feeds SET enabled=0 WHERE id=3").run();
      const discarded = add(); saveAssessment(db, discarded, { contentType: "advertisement", discardReason: "促销", at: NOW });
      const snapshot = Number(db.prepare("SELECT MAX(id) AS id FROM articles").get().id); const late = add();
      const scope = { now: NOW, q: "Target", quality: "high", category: "opml:Dev", feed: 1, unread: true, snapshot, tag: "#软件开发" };
      const page = latestArticles(db, { ...scope, limit: 1 }); assert.deepEqual(page.rows.map((row) => row.id), [software]);
      assert.equal(page.pagination.total, 1); assert.equal(page.latest.unread, 1); assert.equal(page.latest.total, 2);
      assert.deepEqual(page.latest.categories.filter((item) => item.count).map((item) => [item.label, item.count]), [["Dev", 1], ["News", 1]]);
      assert.deepEqual(new Map(page.latest.tags.map((item) => [item.name, item.count])), new Map([["软件开发", 1], ["数据与数据库", 1], ["技术解析", 2]]));
      const unknown = latestArticles(db, { ...scope, tag: "Missing" }); assert.equal(unknown.pagination.total, 0); assert.equal(unknown.latest.unread, 0); assert.deepEqual(unknown.latest.tags, page.latest.tags);
      assert.equal(latestArticles(db, { ...scope, unread: false }).pagination.total, 2); assert.equal(latestArticles(db, { ...scope, unread: false }).latest.unread, 1);
      assert.deepEqual(markLatestRead(db, scope, NOW).ids, [software]); for (const id of [data, news, excerpt, late]) assert.equal(isRead(db, id), false);
    } finally { db.close(); }
  });
  await check("tag bulk read spans unloaded pages and invalid values never widen scope", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const ids = Array.from({ length: 125 }, () => add()); const other = add({ tags: ["数据与数据库", "技术解析"] });
      const page = latestArticles(db, { now: NOW, tag: "软件开发", limit: 1 }); assert.equal(page.pagination.total, 125);
      const body = { view: "latest", q: "", category: null, unread: true, snapshot: page.pagination.snapshot, tag: " ＃软件开发 " };
      const scope = parseBulkReadRequest(body); assert.equal(scope.tag, "软件开发");
      for (const tag of [null, "", "#", [], 1, "\n软件开发", "软件开发\t", "x".repeat(25)]) { assert.throws(() => parseBulkReadRequest({ ...body, tag })); assert.throws(() => latestArticles(db, { tag })); assert.throws(() => markLatestRead(db, { tag })); }
      assert.ok(ids.every((id) => !isRead(db, id))); assert.equal(markLatestRead(db, { ...scope, now: NOW }, NOW).changed, 125); assert.equal(isRead(db, other), false);
      assert.equal(markLatestRead(db, { ...scope, now: NOW }, NOW).changed, 0);
    } finally { db.close(); }
  });
  await check("classification vocabulary excludes legacy, disabled and discarded labels", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const id = add(); add(); const off = add({ feed: 3, tags: ["AI编程", "教程指南"] }); db.prepare("UPDATE feeds SET enabled=0 WHERE id=3").run();
      const ad = add({ tags: ["生活与随笔", "观点评论"] }); saveAssessment(db, ad, { contentType: "advertisement", discardReason: "促销", at: NOW });
      db.prepare("INSERT INTO article_tags(article_id,tag_key,tag,position) VALUES(?,?,?,2)").run(id, "rust", "Rust");
      const tags = commonTagVocabulary(db); assert.deepEqual(new Set(tags), new Set(DEFAULT_TAGS)); assert.ok(tags.every((tag) => [...TOPIC_TAGS, ...FORMAT_TAGS].includes(tag)));
      assert.ok(getArticle(db, off)); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM article_tags WHERE tag_key='rust'").get().n, 1);
    } finally { db.close(); }
  });
  console.log(`\n${checks} offline tag checks passed.`);
} finally { globalThis.fetch = originalFetch; }
