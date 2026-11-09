import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSESSMENT_VERSION, assessArticles, assessmentInput, parseAssessmentResponse, validateAssessment } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, getArticle, saveAssessment, pendingAssessments, pendingContent,
  latestArticles, markLatestRead, markArticlesRead, assessmentCounts, articleCounts, countArticlesByDate,
  reportCandidates, setContent, setContentSuccess, setRead, getReadIds } from "../lib/db.js";
import { toReportArticle } from "../lib/report.js";

const NOW = "2026-11-04T08:00:00.000Z";
let checks = 0;
async function check(name, run) { await run(); console.log(`ok ${++checks} - ${name}`); }
const editorial = (id) => ({ id, contentType: "editorial", tags: ["软件开发", "技术解析"], score: 85,
  dimensions: { information: 22, evidence: 22, depth: 17, utility: 16, clarity: 8 },
  summary: "独立测试比较了产品性能、成本与局限。", category: "engineering", relevance: 80, reason: "测量充分，涵盖优缺点。" });
const ad = (id, contentType = "advertisement") => ({ id, contentType, discardReason: "正文以优惠购买入口为主，缺少独立分析。" });
function setup(db) {
  upsertFeeds(db, [{ xmlUrl: "https://example.test/feed", title: "Example", htmlUrl: "https://example.test/", group: "Dev" }]);
  return (key) => ({ entryKey: key, title: key, url: `https://example.test/${key}`, summary: `Summary ${key}`, publishedAt: "2026-11-04T01:00:00.000Z" });
}
function insert(db, item) { return insertArticles(db, 1, [item], () => "2026-11-04", NOW)[0].id; }
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access"); };
try {
  await check("model parser requires explicit content type and nonempty ad reason without inventing scores", () => {
    for (const type of ["advertisement", "advertorial"]) {
      const result = parseAssessmentResponse(JSON.stringify([ad(1, type)]), new Set([1])).get(1);
      assert.equal(result.contentType, type); assert.equal(result.score, undefined); assert.equal(result.dimensions, undefined);
    }
    const legacy = editorial(1); delete legacy.contentType;
    for (const invalid of [legacy, { ...ad(1), contentType: "sponsored" }, { ...ad(1), discardReason: " " },
      { ...ad(1), discardReason: null }, { contentType: "editorial", id: 1 }]) {
      assert.throws(() => parseAssessmentResponse(JSON.stringify([invalid]), new Set([1])));
    }
    assert.throws(() => validateAssessment(legacy));
  });
  await check("simulated ad/advertorial short-circuit while named-brand independent review stays editorial", async () => {
    const articles = [ { id: 1, title: "MacBook independent review", text: "Measured performance and battery life versus price; strengths and limitations.", content_status: "ok" },
      { id: 2, title: "Sale", text: "Buy now, 50% off, limited offer." },
      { id: 3, title: "A sponsored story", text: "Sponsored brand promotion with purchase links." } ];
    const result = await assessArticles({ articles, callModel: async ({ system }) => {
      assert.ok(system.includes("不能仅因出现品牌") && system.includes("不继续评分"));
      return JSON.stringify([editorial(1), ad(2), ad(3, "advertorial")]);
    } });
    assert.equal(result.failures.length, 0); assert.equal(result.results.length, 3);
    assert.deepEqual(result.results.map((item) => item.status), ["ok", "discarded", "discarded"]);
    assert.equal(result.results[0].score, 85); assert.equal(result.results[1].score, undefined);
    assert.equal(result.results[2].version, 2);
  });
  await check("discard is terminal, keeps dedupe, provenance and internal old scores; late saves never resurrect", () => {
    const db = openDatabase(":memory:");
    try {
      const item = setup(db)("campaign"); const id = insert(db, item);
      setContent(db, id, "ok", "Initial review", null);
      saveAssessment(db, id, { ...editorial(id), ...assessmentInput(getArticle(db, id)), model: "old/model", analyzedAt: NOW });
      assert.equal(toReportArticle(getArticle(db, id)).assessment.highQuality, true);
      saveAssessment(db, id, { ...ad(id), model: "new/model", analyzedAt: NOW, ...assessmentInput(getArticle(db, id)) });
      assert.equal(getArticle(db, id), undefined);
      const raw = getArticle(db, id, { includeDiscarded: true });
      assert.equal(raw.assessment_score, 85); assert.equal(raw.assessment_model, "new/model");
      assert.equal(raw.assessment_status, "discarded"); assert.equal(raw.content_type, "advertisement");
      assert.equal(raw.discarded_at, NOW); assert.ok(raw.assessment_fingerprint);
      const display = toReportArticle(raw).assessment;
      assert.equal(display.score, null); assert.equal(display.highQuality, false); assert.equal(display.discarded, true);
      assert.equal(saveAssessment(db, id, { ...editorial(id), analyzedAt: NOW }), false);
      assert.equal(saveAssessment(db, id, { status: "failed", error: "late failure", at: NOW }), false);
      setContentSuccess(db, id, { text: "Late extraction", source: "web" });
      const duplicate = insertArticles(db, 1, [{ ...item, feedContentHtml: "<p>updated</p>", feedContentKind: "full" }], () => "2026-11-04", NOW);
      assert.equal(duplicate.length, 0); assert.equal(getArticle(db, id), undefined);
      const retained = getArticle(db, id, { includeDiscarded: true });
      assert.equal(retained.discarded_at, NOW); assert.equal(retained.discard_reason, raw.discard_reason);
      assert.equal(retained.assessment_error, null); assert.equal(db.prepare("SELECT COUNT(*) n FROM articles").get().n, 1);
      let calls = 0;
      return assessArticles({ articles: [retained], callModel: async () => { calls++; return "[]"; } }).then((result) => {
        assert.equal(calls, 0); assert.equal(result.results.length, 0);
      });
    } finally { db.close(); }
  });
  await check("all visible selections, SQL counters, unread scopes and extraction exclude discarded rows", () => {
    const db = openDatabase(":memory:");
    try {
      const item = setup(db); const keep = insert(db, item("Independent brand review")); const discarded = insert(db, item("Ad"));
      setContent(db, keep, "ok", "Independent technical testing", null);
      const legacy = editorial(keep); delete legacy.contentType;
      saveAssessment(db, keep, legacy); // Only persistence supports pre-field callers.
      setRead(db, discarded, true, NOW); saveAssessment(db, discarded, ad(discarded, "advertorial"));
      assert.equal(pendingContent(db, { sinceIso: "1970-01-01", limit: 100 }).length, 0);
      assert.equal(pendingContent(db, { date: "2026-11-04", limit: 100 }).length, 0);
      assert.deepEqual(pendingAssessments(db, { force: true, newIds: [discarded], now: NOW }).map((row) => row.id), [keep]);
      const page = latestArticles(db, { now: NOW });
      assert.deepEqual(page.rows.map((row) => row.id), [keep]);
      assert.equal(page.pagination.total, 1); assert.equal(page.latest.available, 1); assert.equal(page.latest.unread, 1);
      assert.equal(page.latest.categories[0].count, 1);
      assert.equal(latestArticles(db, { quality: "high", now: NOW }).pagination.total, 1);
      assert.equal(countArticlesByDate(db, "2026-11-04"), 1); assert.equal(reportCandidates(db, "2026-11-04", 100).length, 1);
      assert.equal(getReadIds(db).has(discarded), false);
      assert.deepEqual(markArticlesRead(db, [discarded], NOW).ids, []);
      assert.deepEqual(markLatestRead(db, { now: NOW }, NOW).ids, [keep]);
      assert.deepEqual(assessmentCounts(db), { total: 1, discarded: 1, assessed: 1, pending: 0, failed: 0, stale: 0 });
      assert.equal(articleCounts(db).total, 1); assert.equal(articleCounts(db).pendingContent, 0);
    } finally { db.close(); }
  });
  await check("schema3 migration keeps legacy high scores but marks them stale for new explicit-type analysis", () => {
    const dir = mkdtempSync(join(tmpdir(), "rss-discard-"));
    let db;
    try {
      const file = join(dir, "migration.sqlite"); db = openDatabase(file);
      const id = insert(db, setup(db)("Legacy brand article")); setContent(db, id, "ok", "Unchanged content", null);
      saveAssessment(db, id, editorial(id));
      db.prepare("UPDATE articles SET assessment_version=1, assessment_fingerprint='legacy', assessment_current_fingerprint='legacy' WHERE id=?").run(id);
      for (const name of ["discarded_at", "discard_reason", "content_type"]) db.exec(`ALTER TABLE articles DROP COLUMN ${name}`);
      db.exec("PRAGMA user_version=3"); db.close(); db = openDatabase(file);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
      const row = getArticle(db, id); assert.ok(row); assert.equal(row.assessment_score, 85); assert.equal(row.discarded_at, null);
      assert.equal(toReportArticle(row).assessment.stale, true); assert.equal(toReportArticle(row).assessment.highQuality, false);
      assert.equal(pendingAssessments(db, { now: NOW })[0].id, id); assert.equal(assessmentCounts(db).discarded, 0);
      assert.equal(ASSESSMENT_VERSION, 2);
    } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  console.log(`\n${checks} offline discard checks passed.`);
} finally { globalThis.fetch = originalFetch; }
