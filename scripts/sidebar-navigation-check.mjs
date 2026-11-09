/** Sidebar totals match the All articles action without summing overlapping topics. */
import assert from "node:assert/strict";
import { assessmentInput } from "../lib/ai.js";
import { openDatabase, upsertFeeds, insertArticles, setContent, getArticle, saveAssessment, latestArticles, setRead, markLatestRead } from "../lib/db.js";

const NOW = "2026-11-09T08:00:00.000Z";
const db = openDatabase(":memory:");
let checks = 0;
function check(name, run) { run(); console.log(`ok ${++checks} - ${name}`); }
try {
  const feeds = [
    { title: "Software", group: "Dev", xmlUrl: "https://software.test/rss", htmlUrl: "" },
    { title: "AI", group: "News", xmlUrl: "https://ai.test/rss", htmlUrl: "" },
    { title: "Disabled", group: "Off", xmlUrl: "https://off.test/rss", htmlUrl: "" },
  ];
  upsertFeeds(db, feeds);
  let serial = 0;
  const add = ({ feed = 1, tags = ["软件开发", "教程指南"], title = "Target", publishedAt = "2026-11-09T01:00:00.000Z" } = {}) => {
    const id = insertArticles(db, feed, [{ entryKey: `item-${++serial}`, title, summary: "Stored text", publishedAt }], iso => iso.slice(0, 10), NOW)[0].id;
    if (tags) {
      setContent(db, id, "ok", "Full content with practical examples", null);
      saveAssessment(db, id, { ...assessmentInput(getArticle(db, id)), contentType: "editorial", tags,
        score: 80, dimensions: { information: 20, evidence: 20, depth: 16, utility: 16, clarity: 8 },
        category: "engineering", relevance: 90, summary: "记录实现方法和实验结果。", reason: "方法具体，说明了限制。", analyzedAt: NOW });
    }
    return id;
  };
  const guide = add(), theory = add({ tags: ["软件开发", "技术解析"] });
  const ai = add({ feed: 2, tags: ["AI编程", "教程指南"] });
  const overlap = add({ tags: ["软件开发", "数据与数据库", "教程指南"] });
  const legacy = add({ tags: null });
  db.prepare("INSERT INTO article_tags(article_id,tag_key,tag,position) VALUES (?, 'rust', 'Rust', 0)").run(legacy);
  add({ title: "Other article", tags: null });
  add({ feed: 3 }); add({ publishedAt: "2099-01-01T00:00:00.000Z" });
  const discarded = add(); saveAssessment(db, discarded, { contentType: "advertisement", discardReason: "促销购买引导", analyzedAt: NOW });
  upsertFeeds(db, feeds.slice(0, 2)); setRead(db, theory, true, NOW);
  check("all count is distinct and includes untagged and historical articles", () => {
    const page = latestArticles(db, { now: NOW });
    assert.equal(page.latest.navigation.total, 6);
    assert.equal(page.pagination.total, 6);
    const sum = page.latest.tagGroups.topics.reduce((n, t) => n + t.count, 0);
    assert.notEqual(sum, page.latest.navigation.total, "topics can overlap and do not cover historical labels");
    assert.equal(latestArticles(db, { now: NOW, tag: "Rust" }).latest.navigation.total, 6);
  });
  const options = { now: NOW, q: "Target", unread: true, quality: "high", category: "opml:Dev", feed: 1, tag: "软件开发", format: "教程指南" };
  const page = latestArticles(db, options), snapshot = page.pagination.snapshot;
  check("all ignores source/category/topic/form but retains search, unread, quality and snapshot", () => {
    assert.equal(page.pagination.total, 2); assert.equal(page.latest.navigation.total, 3);
    assert.equal(latestArticles(db, { ...options, category: "opml:missing", feed: 999, tag: "unknown" }).latest.navigation.total, 3);
    assert.equal(latestArticles(db, { ...options, q: "missing" }).latest.navigation.total, 0);
    assert.equal(latestArticles(db, { ...options, snapshot: 0 }).latest.navigation.total, 0);
    add();
    assert.equal(latestArticles(db, { ...options, snapshot }).latest.navigation.total, 3);
    assert.equal(latestArticles(db, options).latest.navigation.total, 4);
  });
  check("sidebar total tracks read changes across the filtered batch while other matches remain", () => {
    const scope = { ...options, snapshot };
    assert.deepEqual(markLatestRead(db, scope, NOW).ids, [guide, overlap]);
    const after = latestArticles(db, scope);
    assert.equal(after.pagination.total, 0); assert.equal(after.latest.navigation.total, 1);
    const all = latestArticles(db, { now: NOW, snapshot, q: "Target", unread: true, quality: "high" });
    assert.deepEqual(all.rows.map(row => row.id), [ai]); assert.equal(all.latest.navigation.total, 1);
    assert.equal(latestArticles(db, { now: NOW, snapshot, q: "Target", quality: "high" }).latest.navigation.total, 4);
  });
  console.log(`Passed ${checks} sidebar navigation count checks (offline).`);
} finally { db.close(); }
