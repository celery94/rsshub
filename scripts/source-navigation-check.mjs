/** Offline source navigation regressions: counts, composed SQL pages and bulk scope. */
import assert from "node:assert/strict";
import { assessmentInput } from "../lib/ai.js";
import { parseBulkReadRequest } from "../lib/bulk-read.js";
import {
  openDatabase, upsertFeeds, enabledFeeds, insertArticles, getArticle,
  setContent, saveAssessment, setRead, isRead, latestArticles, markLatestRead,
} from "../lib/db.js";

const NOW = "2026-11-04T12:00:00.000Z";
const PUBLISHED = "2026-11-04T10:00:00.000Z";
const feeds = [
  { title: "Alpha", group: "Dev", xmlUrl: "https://example.test/a" },
  { title: "Beta", group: "Dev", xmlUrl: "https://example.test/b" },
  { title: "Empty", group: "Dev", xmlUrl: "https://example.test/empty" },
  { title: "News", group: "News", xmlUrl: "https://example.test/news" },
  { title: "Disabled", group: "News", xmlUrl: "https://example.test/off" },
].map((feed) => ({ ...feed, htmlUrl: "" }));
const db = openDatabase(":memory:");
let checks = 0;
function check(label, run) { run(); console.log(`ok ${++checks} - ${label}`); }
try {
  upsertFeeds(db, feeds);
  const sources = new Map(enabledFeeds(db).map((feed) => [feed.title, feed.id]));
  let serial = 0;
  const add = (source, title = "Target", publishedAt = PUBLISHED) => insertArticles(db, sources.get(source), [{
    entryKey: String(++serial), title, url: `https://example.test/${serial}`, publishedAt, summary: "Summary",
  }], (iso) => iso.slice(0, 10), NOW)[0].id;
  const alpha = [], beta = [];
  for (let i = 0; i < 125; i++) { alpha.push(add("Alpha")); beta.push(add("Beta")); }
  const nonmatch = add("Alpha", "Other");
  const news = add("News");
  const future = add("Alpha", "Target", "2099-01-01T00:00:00.000Z");
  const disabled = add("Disabled");
  const discarded = add("Alpha");
  db.prepare("UPDATE articles SET discarded_at = ? WHERE id = ?").run(NOW, discarded);
  upsertFeeds(db, feeds.slice(0, -1));
  setRead(db, alpha[0], true, "2020-01-01T00:00:00.000Z");
  const options = { now: NOW, q: "Target", unread: true, category: "opml:Dev", feed: sources.get("Alpha"), limit: 100 };
  const page = latestArticles(db, options);
  const snapshot = page.pagination.snapshot;
  const countMap = (result) => Object.fromEntries(result.latest.sources.map((source) => [source.title, source.count]));

  check("enabled source directory includes zero counts and exact OPML category keys", () => {
    assert.deepEqual(countMap(page), { Alpha: 124, Beta: 125, Empty: 0, News: 1 });
    assert.deepEqual(page.latest.sources.find((source) => source.title === "Alpha"), {
      id: sources.get("Alpha"), title: "Alpha", feedUrl: "https://example.test/a", category: "opml:Dev", count: 124,
    });
    for (const category of page.latest.categories) {
      assert.equal(category.count, page.latest.sources.filter((source) => source.category === category.key).reduce((n, source) => n + source.count, 0));
    }
    assert.equal(page.latest.total, 250);
    assert.equal(page.latest.unread, 124, "unread count honors selected source");
  });
  check("source predicate applies before SQL paging and composes with category/search/unread", () => {
    assert.equal(page.pagination.total, 124);
    assert.equal(page.rows.length, 100);
    assert.ok(page.rows.every((row) => row.feed_id === sources.get("Alpha")));
    const next = latestArticles(db, { ...options, offset: 100, snapshot });
    assert.equal(next.rows.length, 24);
    assert.equal(next.pagination.hasMore, false);
    assert.deepEqual(new Set([...page.rows, ...next.rows].map((row) => row.id)), new Set(alpha.slice(1)));
    assert.equal(latestArticles(db, { ...options, category: "opml:News" }).pagination.total, 0);
    assert.equal(latestArticles(db, { ...options, feed: sources.get("Empty") }).pagination.total, 0);
    assert.equal(latestArticles(db, { ...options, feed: sources.get("Disabled") }).pagination.total, 0);
    assert.equal(latestArticles(db, { ...options, feed: 99999 }).pagination.total, 0);
    assert.deepEqual(countMap(latestArticles(db, { ...options, category: "opml:missing", feed: 99999 })), countMap(page));
  });
  const late = add("Alpha");
  check("source counts and pages retain snapshot while excluding future/disabled/discarded rows", () => {
    assert.equal(countMap(latestArticles(db, { ...options, snapshot })).Alpha, 124);
    assert.equal(countMap(latestArticles(db, options)).Alpha, 125);
    const empty = latestArticles(db, { ...options, snapshot: 0 });
    assert.equal(empty.pagination.total, 0);
    assert.deepEqual(countMap(empty), { Alpha: 0, Beta: 0, Empty: 0, News: 0 });
  });
  check("quality source facets use the same current complete assessment criteria as categories", () => {
    for (const id of [alpha[1], beta[0], news]) {
      setContent(db, id, "ok", "Complete body", null);
      saveAssessment(db, id, { ...assessmentInput(getArticle(db, id)), status: "ok", contentType: "editorial",
        score: 80, dimensions: { information: 20, evidence: 20, depth: 16, utility: 16, clarity: 8 },
        summary: "Target summary", category: "engineering", relevance: 80, reason: "Detailed evidence", analyzedAt: NOW });
    }
    const quality = latestArticles(db, { ...options, quality: "high", snapshot });
    assert.deepEqual(countMap(quality), { Alpha: 1, Beta: 1, Empty: 0, News: 1 });
    assert.deepEqual(quality.rows.map((row) => row.id), [alpha[1]]);
    assert.equal(latestArticles(db, { ...options, quality: "high", highQualityThreshold: 90 }).pagination.total, 0);
    assert.deepEqual(markLatestRead(db, { ...options, quality: "high", snapshot }, NOW).ids, [alpha[1]]);
    assert.equal(isRead(db, beta[0]), false);
    assert.equal(isRead(db, news), false);
  });
  check("bulk read spans all source pages and retains every composed boundary", () => {
    const result = markLatestRead(db, { ...options, snapshot }, NOW);
    assert.equal(result.changed, 123);
    for (const id of alpha) assert.equal(isRead(db, id), true);
    for (const id of [...beta, nonmatch, news, future, disabled, discarded, late]) assert.equal(isRead(db, id), false, String(id));
    assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id = ?").get(alpha[0]).read_at, "2020-01-01T00:00:00.000Z");
    assert.equal(markLatestRead(db, { ...options, snapshot }, NOW).changed, 0);
  });
  check("strict source validation rejects coercion and unsafe IDs without expanding bulk scope", () => {
    const body = { view: "latest", q: "Target", category: null, unread: false, snapshot };
    assert.equal(parseBulkReadRequest({ ...body, feed: sources.get("Alpha") }).feed, sources.get("Alpha"));
    assert.equal(parseBulkReadRequest(body).feed, undefined);
    for (const feed of [null, "1", "", 0, -1, 1.5, true, [], {}, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => parseBulkReadRequest({ ...body, feed }));
      assert.throws(() => latestArticles(db, { feed }));
      assert.throws(() => markLatestRead(db, { feed }));
    }
    assert.equal(isRead(db, news), false);
  });
  console.log(`PASS ${checks} source navigation checks; in-memory database, no network/model calls.`);
} finally { db.close(); }
