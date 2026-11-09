import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessArticles, assessmentInput, parseAssessmentResponse, classifyArticles } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, getArticle, setContent, setContentSuccess, saveAssessment,
  pendingAssessments, assessmentCounts, latestArticles, markLatestRead, setRead } from "../lib/db.js";
import { toReportArticle } from "../lib/report.js";
import { parseBulkReadRequest } from "../lib/bulk-read.js";

const NOW = "2026-11-04T08:00:00.000Z";
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }
function valid(id, score = 85) {
  const dimensions = score === 85 ? { information: 22, evidence: 22, depth: 17, utility: 16, clarity: 8 }
    : score === 80 ? { information: 20, evidence: 20, depth: 16, utility: 16, clarity: 8 }
    : score === 60 ? { information: 15, evidence: 15, depth: 12, utility: 12, clarity: 6 }
    : { information: 0, evidence: 0, depth: 0, utility: 0, clarity: 0 };
  return { id, contentType: "editorial", tags: ["软件开发", "技术解析"], score, dimensions, summary: "实验测试给出了明确的数据与可复现的方法。", category: "engineering", relevance: 70, reason: "信息具体且证据充分；局限是仅覆盖一种运行环境。" };
}
function fixture(db) {
  upsertFeeds(db, [{ xmlUrl: "https://example.test/feed", title: "Engineering", htmlUrl: "https://example.test/", group: "Dev" },
    { xmlUrl: "https://news.test/feed", title: "News", htmlUrl: "https://news.test/", group: "News" }]);
  return (key, hour = 1, feed = 1) => insertArticles(db, feed, [{ entryKey: key, title: `Target ${key}`, url: `https://example.test/${key}`,
    publishedAt: `2026-11-04T0${hour}:00:00.000Z`, summary: `Excerpt ${key}` }], () => "2026-11-04", NOW)[0].id;
}
function score(db, id, value = 85) {
  return saveAssessment(db, id, { ...valid(id, value), ...assessmentInput(getArticle(db, id)), status: "ok", model: "fixture/model", analyzedAt: NOW });
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in assessment-check"); };
try {
  await check("bounded head/middle/tail samples and honest completeness", () => {
    const text = "H".repeat(8000) + "M".repeat(8000) + "T".repeat(8000);
    const input = assessmentInput({ text, contentStatus: "ok" });
    assert.ok(input.text.length <= 12000);
    assert.ok(input.text.startsWith("H") && input.text.includes("M") && input.text.endsWith("T"));
    assert.equal(input.basis, "sampled"); assert.equal(input.provisional, true);
    assert.equal(assessmentInput({ text: "full", contentStatus: "ok" }).provisional, false);
    assert.equal(assessmentInput({ text: "summary" }).provisional, true);
    assert.equal(assessmentInput({ text: "truncated", content_status: "ok", content_document_json: '{"truncated":true}' }).basis, "excerpt");
  });
  await check("strict five dimensions, total, required metadata and per-item failures", () => {
    const expected = new Set([1, 2]);
    assert.equal(parseAssessmentResponse(JSON.stringify([valid(1), { ...valid(2), score: 99 }]), expected).size, 1);
    for (const invalid of [ { ...valid(1), score: "85" }, { ...valid(1), dimensions: { ...valid(1).dimensions, evidence: 26 } },
      { ...valid(1), dimensions: { ...valid(1).dimensions, information: 21.5 } }, { ...valid(1), category: "invented" },
      { ...valid(1), relevance: null }, { ...valid(1), reason: "" }, { ...valid(1), summary: null },
      { ...valid(1), dimensions: { ...valid(1).dimensions, extra: 0 } } ]) {
      assert.throws(() => parseAssessmentResponse(JSON.stringify([invalid]), expected));
    }
    assert.throws(() => parseAssessmentResponse(JSON.stringify([valid(1), valid(1)]), expected));
  });
  await check("simulated model preserves scores, provenance and individual failure", async () => {
    const result = await assessArticles({ articles: [{ id: 1, text: "Complete body", content_status: "ok" }, { id: 2, text: "Summary" }], model: "simulated/model", callModel: async ({ system, user }) => {
      assert.ok(system.includes("0-25") && system.includes("不可信"));
      assert.ok(user.includes("Complete body"));
      return JSON.stringify([valid(1), { ...valid(2), score: 100 }]);
    } });
    assert.equal(result.results[0].score, 85); assert.equal(result.results[0].basis, "full");
    assert.equal(result.results[0].model, "simulated/model"); assert.equal(result.failures[0][0], 2);
  });
  await check("malformed response retries, fatal failures stop calls, cancellation propagates", async () => {
    let calls = 0;
    const result = await assessArticles({ articles: [{ id: 1, text: "x" }], callModel: async () => ++calls === 1 ? "bad" : JSON.stringify([valid(1)]) });
    assert.equal(calls, 2); assert.equal(result.results.length, 1);
    calls = 0;
    const fatal = await assessArticles({ articles: [{ id: 1, text: "body" }, { id: 2, text: "body" }], batchSize: 1, callModel: async () => { calls++; throw Object.assign(new Error("credentials"), { code: "MISSING_CREDENTIAL" }); } });
    assert.equal(calls, 1); assert.equal(fatal.failures.length, 2); assert.equal(fatal.modelError, "credentials");
    const controller = new AbortController(); controller.abort();
    await assert.rejects(assessArticles({ articles: [{ id: 1 }], signal: controller.signal, callModel: async () => "[]" }));
    const legacy = await classifyArticles({ articles: [{ id: 1, text: "legacy" }], callModel: async () => JSON.stringify([{ id: 1, category: "engineering", summary: "旧分类仍可使用", relevance: 80 }]) });
    assert.equal(legacy.results.length, 1);
  });
  await check("empty direct inputs skip model; missing model stops batches; mixed reading time is estimated", async () => {
    let calls = 0;
    const empty = await assessArticles({ articles: [{ id: 1, text: "  " }], callModel: async () => { calls++; return "[]"; } });
    assert.equal(calls, 0); assert.equal(empty.failures.length, 1);
    const unavailable = await assessArticles({ articles: [{ id: 1, text: "body" }, { id: 2, text: "body" }], batchSize: 1,
      callModel: async () => { calls++; throw Object.assign(new Error("missing model"), { code: "MODEL_NOT_FOUND" }); } });
    assert.equal(calls, 1); assert.equal(unavailable.failures.length, 2);
    assert.equal(assessmentInput({ text: "中".repeat(1000) + " word".repeat(440) }).minutes, 4);
    assert.equal(assessmentInput({ content_text: "", feed_summary: "Fallback text" }).text, "Fallback text");
  });
  await check("schema v2 upgrades additively and keeps legacy classification/read state", () => {
    const dir = mkdtempSync(join(tmpdir(), "rss-assessment-"));
    const file = join(dir, "migration.sqlite");
    let db;
    try {
      db = openDatabase(file); const add = fixture(db); const id = add("legacy");
      setRead(db, id, true, NOW);
      db.prepare("UPDATE articles SET ai_status='ok', summary_zh='Legacy preserved', relevance=99 WHERE id=?").run(id);
      const assessmentColumns = db.prepare("PRAGMA table_info(articles)").all().filter((column) => column.name.startsWith("assessment_"));
      db.exec("DROP INDEX idx_articles_assessment");
      for (const column of assessmentColumns) db.exec(`ALTER TABLE articles DROP COLUMN ${column.name}`);
      db.exec("PRAGMA user_version=2"); db.close(); db = openDatabase(file);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
      assert.equal(getArticle(db, id).summary_zh, "Legacy preserved");
      assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id=?").get(id).read_at, NOW);
      assert.equal(toReportArticle(getArticle(db, id)).assessment.score, null);
      assert.ok(getArticle(db, id).assessment_current_fingerprint);
    } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  await check("new IDs outrank recent backfill; cache hits skip; failures back off and preserve results", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const old = add("old", 1); const recent = add("recent", 3);
      assert.deepEqual(pendingAssessments(db, { newIds: [old], limit: 2, now: NOW }).map((row) => row.id), [old, recent]);
      setContent(db, old, "ok", "Full body", null); score(db, old);
      assert.deepEqual(pendingAssessments(db, { now: NOW }).map((row) => row.id), [recent]);
      const before = getArticle(db, old);
      saveAssessment(db, old, { status: "failed", error: "temporary", at: NOW });
      const after = getArticle(db, old);
      assert.equal(after.assessment_score, before.assessment_score); assert.equal(after.assessment_at, before.assessment_at);
      assert.equal(after.assessment_model, before.assessment_model); assert.equal(after.assessment_error, "temporary");
      saveAssessment(db, recent, { status: "failed", error: "temporary", at: NOW });
      assert.equal(pendingAssessments(db, { now: NOW }).length, 0);
      assert.equal(pendingAssessments(db, { now: "2026-11-04T08:06:00.000Z" }).length, 1);
      assert.equal(assessmentCounts(db).assessed, 1);
      assert.throws(() => saveAssessment(db, recent, { ...valid(recent), score: 99 }));
    } finally { db.close(); }
  });
  await check("content changes invalidate cached quality, preserve score and allow immediate reassessment", () => {
    const db = openDatabase(":memory:");
    try {
      const id = fixture(db)("change"); setContentSuccess(db, id, { text: "Original body", source: "web", version: 1 }); score(db, id);
      const original = getArticle(db, id); assert.equal(toReportArticle(original).assessment.highQuality, true);
      setContentSuccess(db, id, { text: "New body", source: "web", version: 1 });
      const changed = getArticle(db, id);
      assert.equal(toReportArticle(changed).assessment.stale, true); assert.equal(toReportArticle(changed).assessment.score, 85);
      assert.equal(latestArticles(db, { quality: "high", now: NOW }).rows.length, 0);
      assert.equal(pendingAssessments(db, { now: NOW })[0].id, id);
      saveAssessment(db, id, { ...valid(id), ...assessmentInput(original), analyzedAt: NOW });
      assert.equal(toReportArticle(getArticle(db, id)).assessment.stale, true, "in-flight old input cannot overwrite current cache identity");
      score(db, id); assert.equal(toReportArticle(getArticle(db, id)).assessment.highQuality, true);
      setContentSuccess(db, id, { text: "New body", document: { truncated: true }, source: "web" });
      assert.equal(toReportArticle(getArticle(db, id)).assessment.stale, true, "completeness changes invalidate identity");
    } finally { db.close(); }
  });
  await check("80/60 recommendations, absent scores, provisional exclusion and shared SQL/bulk scope", () => {
    const db = openDatabase(":memory:");
    try {
      const add = fixture(db); const high = add("high", 1); const edge = add("edge", 2, 2); const optional = add("optional", 3);
      const sampled = add("sampled", 4); const excerpt = add("excerpt", 5); const missing = add("missing", 6);
      for (const id of [high, edge, optional]) setContent(db, id, "ok", "Complete body", null);
      setContent(db, sampled, "ok", "sample".repeat(3000), null);
      for (const [id, value] of [[high, 85], [edge, 80], [optional, 60], [sampled, 85], [excerpt, 85]]) score(db, id, value);
      assert.equal(toReportArticle(getArticle(db, optional)).assessment.recommendation, "optional");
      assert.equal(toReportArticle(getArticle(db, optional)).assessment.highQuality, true);
      assert.equal(toReportArticle(getArticle(db, missing)).assessment.score, null);
      assert.equal(toReportArticle(getArticle(db, missing)).relevance, null);
      assert.equal(toReportArticle(getArticle(db, sampled)).assessment.highQuality, false);
      assert.equal(toReportArticle(getArticle(db, excerpt)).assessment.provisional, true);
      const page = latestArticles(db, { quality: "high", limit: 1, category: "opml:Dev", now: NOW });
      assert.deepEqual(page.rows.map((row) => row.id), [optional]);
      assert.equal(page.pagination.total, 2); assert.equal(page.latest.unread, 2);
      assert.deepEqual(page.latest.categories.map((group) => group.count).sort(), [1, 2]);
      assert.equal(latestArticles(db, { quality: "high", highQualityThreshold: 90, now: NOW }).pagination.total, 0);
      const scope = parseBulkReadRequest({ view: "latest", q: "Target", category: "opml:Dev", quality: "high", unread: true, snapshot: page.pagination.snapshot });
      assert.deepEqual(markLatestRead(db, { ...scope, now: NOW }, NOW).ids, [high, optional]);
      assert.equal(latestArticles(db, { quality: "high", unread: true, now: NOW }).pagination.total, 1);
      assert.throws(() => parseBulkReadRequest({ ...scope, quality: "bogus", category: "opml:Dev" }));
      assert.throws(() => latestArticles(db, { quality: "bogus", now: NOW }));
      assert.deepEqual(latestArticles(db, { quality: "all", now: NOW }).rows.length, 6);
      assert.equal(toReportArticle(getArticle(db, edge)).assessment.highQuality, true);
      saveAssessment(db, optional, { ...valid(optional, 0), ...assessmentInput(getArticle(db, optional)) });
      assert.equal(toReportArticle(getArticle(db, optional)).assessment.recommendation, "skip");
    } finally { db.close(); }
  });
  console.log(`\n${checks} assessment checks passed (offline simulated model, no installs).`);
} finally { globalThis.fetch = originalFetch; }
