/** Offline schema and queue checks for topic tagging independent of quality scoring. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAGGING_VERSION, TOPIC_TAGS, FORMAT_TAGS } from "../lib/tags.js";
import { ASSESSMENT_VERSION, assessmentInput } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, setContent, setRead, getArticle, saveAssessment,
  pendingAssessments, commonTagVocabulary, latestArticles, assessmentCounts } from "../lib/db.js";
import { toReportArticle } from "../lib/report.js";

const NOW = "2026-11-09T08:00:00.000Z";
const SINCE = "2026-11-01T00:00:00.000Z";
const RETRY = "2026-11-09T08:06:00.000Z";
let checks = 0;
function check(name, run) { run(); console.log(`ok ${++checks} - ${name}`); }
function result(id, tags = ["数据与数据库", "研究报告"], taggingVersion = TAGGING_VERSION) {
  return { id, contentType: "editorial", tags, taggingVersion, score: 85,
    dimensions: { information: 22, evidence: 22, depth: 17, utility: 16, clarity: 8 },
    summary: "实验比较了索引扫描与查询延迟。", category: "engineering", relevance: 80,
    reason: "提供数据和复现方法，并说明局限。", analyzedAt: NOW };
}
function setup(db) {
  upsertFeeds(db, [
    { xmlUrl: "https://a.test/feed", title: "A", htmlUrl: "", group: "Dev" },
    { xmlUrl: "https://b.test/feed", title: "B", htmlUrl: "", group: "Dev" },
  ]);
  let sequence = 0;
  return ({ publishedAt = "2026-11-09T01:00:00.000Z", version = TAGGING_VERSION, feed = 1, tags = ["数据与数据库", "研究报告"] } = {}) => {
    const id = insertArticles(db, feed, [{ entryKey: `article-${++sequence}`, title: "Index study", summary: "Query latency", publishedAt }], (iso) => iso.slice(0, 10), NOW)[0].id;
    setContent(db, id, "ok", "Full index performance measurements", null);
    saveAssessment(db, id, result(id, tags, version));
    return id;
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in tag-version-check"); };
try {
  for (const schema of [4, 5]) check(`schema${schema} to6 preserves scores, read marks and available old tag links`, () => {
    const root = mkdtempSync(join(tmpdir(), "rss-tag-version-")); const file = join(root, "test.sqlite"); let db;
    try {
      db = openDatabase(file); const id = setup(db)({ version: 1 }); setRead(db, id, true, NOW);
      const before = { ...getArticle(db, id) }; delete before.tagging_version;
      const tags = db.prepare("SELECT * FROM article_tags WHERE article_id=?").all(id);
      db.exec("ALTER TABLE articles DROP COLUMN tagging_version");
      if (schema === 4) db.exec("DROP TABLE article_tags");
      db.exec(`PRAGMA user_version=${schema}`); db.close(); db = openDatabase(file);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
      const after = getArticle(db, id); assert.equal(after.tagging_version, null);
      for (const [key, value] of Object.entries(before)) if (key !== "tags_json") assert.equal(after[key], value, key);
      assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id=?").get(id).read_at, NOW);
      assert.deepEqual(db.prepare("SELECT * FROM article_tags WHERE article_id=?").all(id), schema === 5 ? tags : []);
      assert.equal(ASSESSMENT_VERSION, 2); assert.equal(TAGGING_VERSION, 3);
      assert.equal(assessmentInput(after).fingerprint, before.assessment_current_fingerprint);
      assert.equal(toReportArticle(after).assessment.highQuality, true);
      assert.equal(toReportArticle(after).assessment.stale, false);
      assert.equal(latestArticles(db, { now: NOW, quality: "high" }).pagination.total, 1);
      assert.equal(assessmentCounts(db).stale, 0);
      assert.deepEqual(pendingAssessments(db, { sinceIso: SINCE, now: NOW }).map((row) => row.id), [id]);
      db.close(); db = openDatabase(file); assert.equal(getArticle(db, id).tagging_version, null);
    } finally {
      db?.close(); assert.ok(root.startsWith(join(tmpdir(), "rss-tag-version-"))); rmSync(root, { recursive: true, force: true });
    }
  });
  check("old tag versions use recent bounded queue, new IDs priority and existing eligibility rules", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db);
      const old = add({ publishedAt: "2020-01-01T01:00:00.000Z", version: 1 });
      const recent = add({ version: 1 }); const newer = add({ version: 1, publishedAt: "2026-11-09T02:00:00.000Z" });
      const current = add(); const missingVersion = add(); db.prepare("UPDATE articles SET tagging_version=NULL WHERE id=?").run(missingVersion);
      const future = add({ version: 1, publishedAt: "2030-01-01T00:00:00.000Z" });
      const disabled = add({ version: 1, feed: 2 }); db.prepare("UPDATE feeds SET enabled=0 WHERE id=2").run();
      const empty = add({ version: 1 }); db.prepare("UPDATE articles SET content_text=NULL,feed_summary=NULL WHERE id=?").run(empty);
      const discarded = add({ version: 1 }); saveAssessment(db, discarded, { contentType: "advertisement", discardReason: "促销购买引导", analyzedAt: NOW });
      const scope = { sinceIso: SINCE, now: NOW };
      assert.deepEqual(pendingAssessments(db, scope).map((row) => row.id), [newer, missingVersion, recent]);
      assert.deepEqual(pendingAssessments(db, { ...scope, limit: 1 }).map((row) => row.id), [newer]);
      assert.deepEqual(pendingAssessments(db, { ...scope, newIds: [recent], limit: 2 }).map((row) => row.id), [recent, newer]);
      assert.deepEqual(pendingAssessments(db, { ...scope, newIds: [old], limit: 1 }).map((row) => row.id), [old]);
      assert.ok(!pendingAssessments(db, scope).some((row) => [old, current, future, disabled, empty, discarded].includes(row.id)));
      assert.deepEqual(pendingAssessments(db, { ...scope, limit: 0 }), []);
      saveAssessment(db, recent, { ...result(recent), taggingVersion: undefined });
      assert.equal(getArticle(db, recent).tagging_version, TAGGING_VERSION);
      assert.ok(!pendingAssessments(db, scope).some((row) => row.id === recent));
      saveAssessment(db, newer, result(newer, ["数据与数据库", "技术解析"], 2));
      assert.equal(getArticle(db, newer).tagging_version, 2);
      assert.ok(pendingAssessments(db, scope).some((row) => row.id === newer));
    } finally { db.close(); }
  });
  check("failed retag preserves tags, tagging version, score identity and quality while backing off", () => {
    const db = openDatabase(":memory:");
    try {
      const id = setup(db)({ version: 1 }); const before = getArticle(db, id);
      saveAssessment(db, id, { status: "failed", error: "temporary", at: NOW, taggingVersion: TAGGING_VERSION });
      const failed = getArticle(db, id);
      for (const key of ["tags_json", "tagging_version", "assessment_score", "assessment_version", "assessment_fingerprint", "assessment_current_fingerprint", "assessment_at"]) assert.equal(failed[key], before[key], key);
      assert.equal(toReportArticle(failed).assessment.highQuality, true); assert.equal(failed.assessment_attempts, 1);
      assert.deepEqual(pendingAssessments(db, { sinceIso: SINCE, now: NOW }), []);
      assert.deepEqual(pendingAssessments(db, { sinceIso: SINCE, now: RETRY }).map((row) => row.id), [id]);
      saveAssessment(db, id, result(id, ["数据与数据库", "技术解析"]));
      const current = getArticle(db, id); assert.equal(current.tagging_version, TAGGING_VERSION);
      assert.deepEqual(toReportArticle(current).tags, ["数据与数据库", "技术解析"]); assert.equal(current.assessment_retry_at, null);
      assert.equal(current.assessment_attempts, 0); assert.equal(current.assessment_error, null);
      assert.deepEqual(pendingAssessments(db, { sinceIso: SINCE, now: RETRY }), []);
    } finally { db.close(); }
  });
  check("legacy no-tags success preserves version and links, and new no-tags rows remain unversioned", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db); const id = add({ version: 1 });
      const legacy = result(id); delete legacy.tags;
      saveAssessment(db, id, legacy);
      assert.equal(getArticle(db, id).tagging_version, 1); assert.deepEqual(toReportArticle(getArticle(db, id)).tags, ["数据与数据库", "研究报告"]);
      assert.deepEqual(pendingAssessments(db, { sinceIso: SINCE, now: NOW }).map((row) => row.id), [id]);
      const current = add(); saveAssessment(db, current, { ...legacy, id: current, taggingVersion: 1 });
      assert.equal(getArticle(db, current).tagging_version, TAGGING_VERSION);
      const fresh = insertArticles(db, 1, [{ entryKey: "legacy", title: "Legacy", summary: "Summary", publishedAt: "2026-11-09T01:00:00.000Z" }], (iso) => iso.slice(0, 10), NOW)[0].id;
      saveAssessment(db, fresh, { ...legacy, id: fresh });
      assert.equal(getArticle(db, fresh).tagging_version, null); assert.deepEqual(toReportArticle(getArticle(db, fresh)).tags, []);
      assert.ok(pendingAssessments(db, { sinceIso: SINCE, now: NOW }).some((row) => row.id === fresh));
    } finally { db.close(); }
  });
  check("tagging version update failure rolls back tag replacement and all assessment fields", () => {
    const db = openDatabase(":memory:");
    try {
      const id = setup(db)({ version: 1 }); const before = { ...getArticle(db, id) };
      db.exec("CREATE TRIGGER fail_tag_version BEFORE UPDATE OF tagging_version ON articles WHEN NEW.tagging_version=3 BEGIN SELECT RAISE(ABORT,'tag version failure'); END");
      assert.throws(() => saveAssessment(db, id, { ...result(id, ["数据与数据库", "技术解析"]), summary: "New summary" }), /tag version failure/);
      assert.deepEqual({ ...getArticle(db, id) }, before);
    } finally { db.close(); }
  });
  check("common vocabulary returns fixed labels without rewriting historical free-form links", () => {
    const db = openDatabase(":memory:");
    try {
      const add = setup(db);
      const insert = db.prepare("INSERT INTO article_tags(article_id,tag_key,tag,position) VALUES(?,?,?,2)");
      for (let i = 0; i < 105; i++) {
        const id = add();
        // Historical labels bypass today's classification policy deliberately.
        insert.run(id, "ai", "AI");
      }
      const tags = commonTagVocabulary(db);
      assert.deepEqual(new Set(tags), new Set(["数据与数据库", "研究报告"]));
      assert.ok(tags.every((tag) => [...TOPIC_TAGS, ...FORMAT_TAGS].includes(tag)));
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM article_tags WHERE tag_key='ai'").get().n, 105, "vocabulary filtering does not rewrite historical links");
      const old = latestArticles(db, { now: NOW, tag: "ai", limit: 1 });
      assert.equal(old.pagination.total, 105); assert.deepEqual(toReportArticle(old.rows[0]).topics, ["数据与数据库"]);
      assert.equal(toReportArticle(old.rows[0]).format, "研究报告");
    } finally { db.close(); }
  });
  console.log(`\n${checks} offline tag version checks passed.`);
} finally { globalThis.fetch = originalFetch; }
