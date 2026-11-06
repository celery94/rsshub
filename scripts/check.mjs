/**
 * Offline checks for the RSS brief pipeline. Runs with a plain Node 24+ binary
 * and needs no Harness process: parsing, SQLite persistence, deduplication,
 * report rendering, time-zone windows, and AI response parsing are all pure.
 *
 *   node scripts/check.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseOpml } from "../lib/opml.js";
import { decodeBuffer, parseDate, parseFeed } from "../lib/feed.js";
import { extractReadable } from "../lib/readable.js";
import { decodeEntities, stripHtml } from "../lib/text.js";
import {
  addDateDays,
  localDate,
  parseHHMM,
  previousLocalDate,
  reportDue,
} from "../lib/time.js";
import {
  articleCounts,
  countArticlesByDate,
  getArticle,
  getReadIds,
  getReport,
  insertArticles,
  isRead,
  openDatabase,
  reportCandidates,
  setAiResult,
  setContent,
  setRead,
  upsertFeeds,
  upsertReport,
} from "../lib/db.js";
import { buildUserPrompt, parseAiResponse, classifyArticles } from "../lib/ai.js";
import { fallbackGroups, groupArticles, renderMarkdown } from "../lib/report.js";

let checks = 0;

/** Run one named assertion. */
function check(label, body) {
  body();
  checks += 1;
  console.log(`ok ${checks} - ${label}`);
}

// ---- OPML -----------------------------------------------------------------
const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline text="Articles">
    <outline text="Blogs">
      <outline text="A &amp; B" title="A &amp; B" xmlUrl="https://example.com/a?x=1&amp;y=2" htmlUrl="https://example.com/"></outline>
      <outline text="Same" xmlUrl="https://example.com/same"/></outline>
    <outline text="Dev">
      <outline text="D" xmlUrl="https://example.com/d"></outline>
    </outline>
  </outline>
</body></opml>`;

check("OPML groups, entities, and duplicates", () => {
  const feeds = parseOpml(OPML);
  assert.equal(feeds.length, 3);
  assert.equal(feeds[0].title, "A & B");
  assert.equal(feeds[0].xmlUrl, "https://example.com/a?x=1&y=2");
  assert.equal(feeds[0].group, "Blogs");
  assert.equal(feeds[1].group, "Blogs");
  assert.equal(feeds[2].group, "Dev");
});

// ---- Feed parsing ---------------------------------------------------------
const RSS = `<rss version="2.0"><channel>
  <item>
    <title>Hello &amp; World</title>
    <link>https://example.com/a</link>
    <guid isPermaLink="false">g-1</guid>
    <pubDate>Tue, 03 Nov 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[<p>Summary <b>here</b></p>]]></description>
    <content:encoded><![CDATA[<p>Body <em>text</em></p>]]></content:encoded>
  </item>
  <item><title>Second</title><link>/b</link><pubDate>Tue, 03 Nov 2026 13:00:00 GMT</pubDate></item>
</channel></rss>`;

check("RSS 2.0 fields, CDATA, relative link", () => {
  const parsed = parseFeed(RSS, "https://example.com/feed.xml");
  assert.equal(parsed.format, "rss");
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].title, "Second");
  const first = parsed.items.find((item) => item.title === "Hello & World");
  const second = parsed.items.find((item) => item.title === "Second");
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(first.title, "Hello & World");
  assert.equal(first.entryKey, "g-1");
  assert.equal(first.url, "https://example.com/a");
  assert.equal(first.summary, "Summary here");
  assert.equal(first.publishedAt, "2026-11-03T12:00:00.000Z");
  assert.equal(second.title, "Second");
  assert.equal(second.url, "https://example.com/b");
});

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Atom &amp; Entry</title>
    <link rel="self" href="https://example.com/feed.xml"/>
    <link rel="alternate" href="/post/1"/>
    <id>tag:example.com,2026:1</id>
    <updated>2026-11-03T10:00:00Z</updated>
    <summary>Atom summary</summary>
    <author><name>Alice</name></author>
  </entry>
</feed>`;

check("Atom entry link, id, author, date", () => {
  const parsed = parseFeed(ATOM, "https://example.com/feed.xml");
  assert.equal(parsed.format, "atom");
  assert.equal(parsed.items.length, 1);
  const [entry] = parsed.items;
  assert.equal(entry.title, "Atom & Entry");
  assert.equal(entry.entryKey, "tag:example.com,2026:1");
  assert.equal(entry.url, "https://example.com/post/1");
  assert.equal(entry.author, "Alice");
  assert.equal(entry.summary, "Atom summary");
  assert.equal(entry.publishedAt, "2026-11-03T10:00:00.000Z");
});

const RDF = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <item rdf:about="https://example.com/rdf">
    <title>RDF entry</title>
    <link>https://example.com/rdf</link>
    <dc:date>2026-11-02T08:00:00Z</dc:date>
    <description>RDF summary</description>
  </item>
</rdf:RDF>`;

check("RDF item uses rdf:about as the key", () => {
  const parsed = parseFeed(RDF, "https://example.com/feed.xml");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].entryKey, "https://example.com/rdf");
  assert.equal(parsed.items[0].publishedAt, "2026-11-02T08:00:00.000Z");
});

check("RSS element links decode XML entities; Atom href stays single-decoded", () => {
  const rdf = parseFeed(`<rdf:RDF><item rdf:about="https://news.example.com/story?utm_source=rss1.0mainlinkanon&amp;utm_medium=feed">
    <title>Entity link</title>
    <link>https://news.example.com/story?utm_source=rss1.0mainlinkanon&amp;utm_medium=feed</link>
  </item></rdf:RDF>`, "https://example.com/feed.xml");
  assert.equal(rdf.items[0].url, "https://news.example.com/story?utm_source=rss1.0mainlinkanon&utm_medium=feed");
  assert.equal(rdf.items[0].entryKey, "https://news.example.com/story?utm_source=rss1.0mainlinkanon&utm_medium=feed");
  const rss = parseFeed('<rss><channel><item><title>A</title><link>/a?x=1&amp;y=2&#38;z=3</link></item></channel></rss>', "https://example.com/feed.xml");
  assert.equal(rss.items[0].url, "https://example.com/a?x=1&y=2&z=3");
  const guidOnly = parseFeed('<rss><channel><item><title>G</title><guid>https://example.com/g?a=1&amp;b=2</guid></item></channel></rss>', "https://example.com/feed.xml");
  assert.equal(guidOnly.items[0].url, "https://example.com/g?a=1&b=2");
  const atom = parseFeed('<feed><entry><id>e</id><title>E</title><link rel="alternate" href="https://example.com/e?a=1&amp;b=2"/></entry></feed>', "https://example.com/feed.xml");
  assert.equal(atom.items[0].url, "https://example.com/e?a=1&b=2");
});

check("date parsing and future guard", () => {
  assert.equal(parseDate("2026-11-03T12:00:00Z").toISOString(), "2026-11-03T12:00:00.000Z");
  assert.equal(parseDate("1700000000").toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(parseDate("not a date"), null);
  assert.equal(parseDate("2999-01-01T00:00:00Z"), null);
});

check("GBK decoding", () => {
  assert.equal(decodeBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), "text/xml; charset=gbk"), "中文");
  // HTML whose charset meta appears after 2 KB of scripts and whose header has no charset.
  const gbkHtml = Buffer.concat([
    Buffer.from(`<html><head><meta name="referrer" content="never"><script>${"x".repeat(3000)}</script>`, "latin1"),
    Buffer.from("<meta http-equiv='content-type' content='text/html; charset=gb2312' /></head><body><p>", "latin1"),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from("</p></body></html>", "latin1"),
  ]);
  const decodedHtml = decodeBuffer(gbkHtml, "text/html");
  assert.match(decodedHtml, /<p>中文<\/p>/);
  assert.ok(!decodedHtml.includes("\ufffd"));
  assert.equal(decodeEntities("&amp;#39;"), "'");
  assert.equal(stripHtml("<p>one</p><p>two &amp; three</p>"), "one\n\ntwo & three");
});

// ---- Readable -------------------------------------------------------------
check("article extraction removes scripts and navigation", () => {
  const page = `<html><head><title>Page title</title></head><body>
    <nav>menu item</nav>
    <article><h1>Heading</h1><p>First &amp; second.</p><script>bad()</script>
    <p>${"Long body text. ".repeat(20)}</p></article>
    <footer>footer item</footer></body></html>`;
  const readable = extractReadable(page);
  assert.equal(readable.title, "Page title");
  assert.ok(readable.text.includes("First & second."));
  assert.ok(!readable.text.includes("bad()"));
  assert.ok(!readable.text.includes("menu item"));
  assert.ok(readable.text.length >= 200);
});

// ---- Time -----------------------------------------------------------------
check("local dates, previous day, due window, HH:MM", () => {
  assert.equal(localDate(new Date("2026-11-03T20:00:00Z"), "Asia/Shanghai"), "2026-11-04");
  assert.equal(previousLocalDate(new Date("2026-11-04T02:00:00Z"), "Asia/Shanghai"), "2026-11-03");
  assert.equal(addDateDays("2026-11-03", 1), "2026-11-04");
  assert.deepEqual(parseHHMM("08:00"), { text: "08:00", minutes: 480 });
  const before = new Date("2026-11-03T23:59:00Z"); // 07:59 on Nov 4, Shanghai
  const at = new Date("2026-11-04T00:00:00Z"); // 08:00 on Nov 4, Shanghai
  assert.equal(reportDue(before, "2026-11-02", "08:00", "Asia/Shanghai"), false);
  assert.equal(reportDue(at, "2026-11-02", "08:00", "Asia/Shanghai"), true);
  assert.equal(reportDue(at, "2026-11-03", "08:00", "Asia/Shanghai"), false);
});

// ---- Database -------------------------------------------------------------
check("SQLite schema, feed upsert, dedupe, content, AI, report", () => {
  const db = openDatabase(":memory:");
  try {
    const feeds = parseOpml(OPML);
    const first = upsertFeeds(db, feeds);
    assert.equal(first.total, 3);
    assert.equal(first.inserted, 3);
    const again = upsertFeeds(db, feeds.slice(0, 2));
    assert.equal(again.disabled, 1);

    const enabled = db.prepare("SELECT * FROM feeds WHERE enabled = 1").all();
    assert.equal(enabled.length, 2);
    const feed = enabled[0];
    const item = {
      entryKey: "g-1",
      guid: "g-1",
      url: "https://example.com/a",
      title: "Hello",
      author: null,
      publishedAt: "2026-11-03T12:00:00.000Z",
      summary: "Summary",
    };
    const inserted = insertArticles(db, feed.id, [item], () => "2026-11-03", "2026-11-04T02:00:00.000Z");
    assert.equal(inserted.length, 1);
    const duplicate = insertArticles(db, feed.id, [item], () => "2026-11-03", "2026-11-04T03:00:00.000Z");
    assert.equal(duplicate.length, 0);
    assert.equal(countArticlesByDate(db, "2026-11-03"), 1);

    const candidates = reportCandidates(db, "2026-11-03", 10);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].feed_title, "A & B");
    setContent(db, candidates[0].id, "ok", "Body text", null);
    const articleRow = getArticle(db, candidates[0].id);
    assert.equal(articleRow.content_text, "Body text");
    assert.equal(articleRow.feed_title, "A & B");
    assert.equal(isRead(db, candidates[0].id), false);
    setRead(db, candidates[0].id, true);
    assert.equal(isRead(db, candidates[0].id), true);
    assert.ok(getReadIds(db).has(candidates[0].id));
    setRead(db, candidates[0].id, false);
    assert.equal(isRead(db, candidates[0].id), false);
    setAiResult(db, candidates[0].id, {
      status: "ok",
      category: "ai",
      relevance: 88,
      summary: "中文摘要",
    });
    const after = reportCandidates(db, "2026-11-03", 10);
    assert.equal(after[0].content_status, "ok");
    assert.equal(after[0].ai_status, "ok");
    assert.equal(after[0].relevance, 88);

    upsertReport(db, {
      date: "2026-11-03",
      generatedAt: "2026-11-04T00:05:00.000Z",
      path: "D:/tmp/2026-11-03.md",
      stats: { included: 1 },
      payload: { date: "2026-11-03" },
    });
    const report = getReport(db, "2026-11-03");
    assert.equal(report.path, "D:/tmp/2026-11-03.md");
    assert.equal(JSON.parse(report.stats_json).included, 1);
    assert.equal(articleCounts(db).total, 1);
  } finally {
    db.close();
  }
});

/** Run one named async assertion. */
async function checkAsync(label, body) {
  await body();
  checks += 1;
  console.log(`ok ${checks} - ${label}`);
}

// ---- AI response ----------------------------------------------------------
check("AI response parsing, clamps, and prompt bounds", () => {
  const expected = new Set([1, 2]);
  const parsed = parseAiResponse(
    '```json\n[{"id":1,"category":"ai","relevance":120,"summary":"摘要一"},{"id":2,"category":"unknown","relevance":"bad","summary":"摘要二"}]\n```',
    expected,
  );
  assert.equal(parsed.get(1).relevance, 100);
  assert.equal(parsed.get(2).category, "other");
  assert.equal(parsed.get(2).relevance, 40);
  assert.throws(() => parseAiResponse("no json", expected));
  const prompt = buildUserPrompt([{ id: 1, title: "T", text: "x".repeat(1000) }]);
  assert.ok(prompt.includes('"id":1'));
  assert.ok(!prompt.includes("x".repeat(800)));
});

await checkAsync("AI batches retry malformed output and stop on fatal errors", async () => {
  const articles = [
    { id: 1, feed: "F", title: "One", publishedDate: "2026-11-03", text: "a" },
    { id: 2, feed: "F", title: "Two", publishedDate: "2026-11-03", text: "b" },
  ];
  let calls = 0;
  const malformed = await classifyArticles({
    articles,
    batchSize: 2,
    callModel: async () => {
      calls += 1;
      return calls === 1 ? "not json" : "[]";
    },
  });
  assert.equal(calls, 2);
  assert.equal(malformed.results.length, 0);
  assert.equal(malformed.failures.length, 2);

  let partialCalls = 0;
  const partial = await classifyArticles({
    articles,
    batchSize: 2,
    callModel: async () => {
      partialCalls += 1;
      return '```json\n[{"id":1,"category":"ai","relevance":80,"summary":"只返回一条"}]\n```';
    },
  });
  assert.equal(partialCalls, 1);
  assert.equal(partial.results.length, 1);
  assert.equal(partial.failures.length, 1);

  const fatal = await classifyArticles({
    articles,
    batchSize: 1,
    callModel: async () => {
      const error = new Error("no adapter");
      error.code = "NO_ADAPTER";
      throw error;
    },
  });
  assert.equal(fatal.modelError !== null, true);
  assert.equal(fatal.failures.length, 2);
});

// ---- Report ---------------------------------------------------------------
check("report groups, fallback groups, and Markdown", () => {
  const articles = [
    {
      id: 1,
      title: "A & B",
      url: "https://example.com/a",
      feed: "Feed",
      publishedAt: "2026-11-03T12:00:00.000Z",
      publishedDate: "2026-11-03",
      category: "ai",
      relevance: 90,
      summary: "摘要一",
      opmlGroup: "AI",
    },
    {
      id: 2,
      title: "Second",
      url: "https://example.com/b",
      feed: "Feed",
      publishedAt: "2026-11-03T13:00:00.000Z",
      publishedDate: "2026-11-03",
      category: "engineering",
      relevance: 70,
      summary: "摘要二",
      opmlGroup: "Dev",
    },
  ];
  const groups = groupArticles(articles);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, "ai");
  const fallback = fallbackGroups(articles);
  assert.equal(fallback.length, 2);
  const markdown = renderMarkdown(
    {
      date: "2026-11-03",
      generatedAt: "2026-11-04T00:05:00.000Z",
      timeZone: "Asia/Shanghai",
      model: "deepseek-official/deepseek-flash",
      stats: { feeds: 3, newArticles: 2, included: 2 },
      warnings: ["测试警告"],
      groups,
      reportPath: "D:/tmp/2026-11-03.md",
    },
    "Asia/Shanghai",
  );
  assert.ok(markdown.includes("# RSS 日报 · 2026-11-03"));
  assert.ok(markdown.includes("## AI 与大模型（1）"));
  assert.ok(markdown.includes("[A & B](<https://example.com/a>)"));
  assert.ok(markdown.includes("相关度 90"));
  assert.ok(markdown.includes("测试警告"));
});

// ---- Portable example and optional user-selected OPML ---------------------
check("the shipped empty subscription example parses", () => {
  assert.deepEqual(parseOpml(readFileSync(new URL("../examples/subscriptions.opml", import.meta.url), "utf8")), []);
});
const realOpml = process.env.DSH_RSS_BRIEF_OPML;
if (realOpml) {
  check("explicitly selected OPML parses", () => {
    assert.ok(existsSync(realOpml), "Selected OPML must exist");
    const feeds = parseOpml(readFileSync(realOpml, "utf8"));
    assert.ok(feeds.every((feed) => feed.xmlUrl.startsWith("http")));
  });
}

console.log(`\n${checks} checks passed.`);
