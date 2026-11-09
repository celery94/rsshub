/** Offline checks for retained feed bodies, v1 migration, and extraction attempts. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openDatabase, closeDatabase, insertArticles, getArticle, getReport, isRead,
  setContent, setContentSuccess, recordContentAttempt,
} from "../lib/db.js";
import { parseFeed, MAX_FEED_CONTENT_CHARS } from "../lib/feed.js";

const at = "2026-11-03T12:00:00.000Z";
const later = "2026-11-04T04:00:00.000Z";
const dateOf = (iso) => iso.slice(0, 10);
const feedUrl = "https://example.test/rss.xml";
let checks = 0;
function check(label, body) {
  body();
  console.log(`ok ${++checks} - ${label}`);
}

// This fixture deliberately defines v1 independently of the current migration.
const legacySchema = `
  CREATE TABLE feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, xml_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '', html_url TEXT NOT NULL DEFAULT '',
    opml_group TEXT NOT NULL DEFAULT '未分组', enabled INTEGER NOT NULL DEFAULT 1,
    etag TEXT, last_modified TEXT, last_fetch_at TEXT, last_success_at TEXT, last_error TEXT
  );
  CREATE TABLE articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    entry_key TEXT NOT NULL, guid TEXT, url TEXT, title TEXT NOT NULL, author TEXT,
    published_at TEXT NOT NULL, published_date TEXT NOT NULL, feed_summary TEXT,
    content_text TEXT, content_status TEXT NOT NULL DEFAULT 'pending', content_error TEXT,
    ai_status TEXT NOT NULL DEFAULT 'pending', category TEXT, relevance INTEGER,
    summary_zh TEXT, ai_error TEXT, first_seen_at TEXT NOT NULL, reported_at TEXT,
    UNIQUE(feed_id, entry_key)
  );
  CREATE INDEX idx_articles_date ON articles(published_date, published_at);
  CREATE INDEX idx_articles_content ON articles(content_status, published_at);
  CREATE INDEX idx_articles_ai ON articles(ai_status, published_at);
  CREATE TABLE reports (
    report_date TEXT PRIMARY KEY, generated_at TEXT NOT NULL, path TEXT NOT NULL,
    stats_json TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE reads (
    article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL
  );
  PRAGMA user_version = 1;
`;
const newColumns = [
  "feed_content_html", "feed_content_kind", "feed_content_base_url", "feed_content_truncated",
  "content_document_json", "content_source", "extracted_at", "extraction_version",
  "content_attempt_at", "content_attempt_error",
];
const workDir = mkdtempSync(join(tmpdir(), "rss-brief-content-storage-"));
const databasePath = join(workDir, "legacy.sqlite");
let db;
try {
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(legacySchema);
  legacy.prepare("INSERT INTO feeds (id, xml_url, title) VALUES (7, ?, 'Legacy feed')").run(feedUrl);
  legacy.prepare(`INSERT INTO articles
    (id, feed_id, entry_key, guid, url, title, author, published_at, published_date,
     feed_summary, content_text, content_status, content_error, ai_status, category,
     relevance, summary_zh, first_seen_at, reported_at)
    VALUES (41, 7, 'legacy-key', 'guid-41', 'https://example.test/article', 'Original title',
      'Author', ?, '2026-11-03', 'Old summary', 'Previously fetched complete body', 'ok',
      NULL, 'ok', 'ai', 91, '原有摘要', ?, ?)`)
    .run(at, at, later);
  legacy.prepare("INSERT INTO reads (article_id, read_at) VALUES (41, ?)").run(later);
  legacy.prepare("INSERT INTO reports VALUES ('2026-11-03', ?, 'report.md', ?, ?)")
    .run(later, JSON.stringify({ included: 1 }), JSON.stringify({ ids: [41] }));
  legacy.prepare("INSERT INTO meta VALUES ('last-report', '2026-11-03')").run();
  const original = { ...legacy.prepare("SELECT * FROM articles WHERE id = 41").get() };
  const originalReport = { ...legacy.prepare("SELECT * FROM reports").get() };
  legacy.close();

  check("v1 migration preserves article, read, report, metadata, and indexes", () => {
    db = openDatabase(databasePath);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 6);
    const columns = new Set(db.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
    for (const name of newColumns) assert.ok(columns.has(name), name);
    const migrated = db.prepare("SELECT * FROM articles WHERE id = 41").get();
    for (const [name, value] of Object.entries(original)) assert.equal(migrated[name], value, name);
    assert.equal(migrated.feed_content_truncated, 0);
    assert.equal(migrated.content_document_json, null);
    assert.equal(migrated.tagging_version, null);
    assert.equal(isRead(db, 41), true);
    assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id = 41").get().read_at, later);
    assert.deepEqual({ ...getReport(db, "2026-11-03") }, originalReport);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'last-report'").get().value, "2026-11-03");
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_articles_%'").get().n, 4);
  });

  check("reopening schema v2 is idempotent", () => {
    const before = db.prepare("PRAGMA table_info(articles)").all();
    closeDatabase(db);
    db = openDatabase(databasePath);
    assert.deepEqual(db.prepare("PRAGMA table_info(articles)").all(), before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM articles").get().n, 1);
    assert.equal(isRead(db, 41), true);
  });

  const fullHtml = `<article><h2>Original heading</h2><p>${"Long body &amp; original markup. ".repeat(150)}</p><figure><img src="/photo.png"><figcaption>Caption</figcaption></figure></article>`;
  const parsed = parseFeed(`<rss><channel><item><guid>legacy-key</guid><link>/article</link>
    <title>Updated feed title</title><description><![CDATA[<p>${"Summary. ".repeat(400)}</p>]]></description>
    <content:encoded><![CDATA[${fullHtml}]]></content:encoded></item></channel></rss>`, feedUrl).items[0];

  check("RSS original rich HTML longer than 2000 is retained independently of summary", () => {
    assert.equal(parsed.summary.length, 2000);
    assert.equal(parsed.feedContentHtml, fullHtml);
    assert.ok(parsed.feedContentHtml.length > 2000);
    assert.equal(parsed.feedContentKind, "full");
    assert.equal(parsed.feedContentBaseUrl, "https://example.test/article");
    assert.equal(parsed.feedContentTruncated, false);
  });

  check("duplicate sync fills the legacy row without changing read, AI, identity, or fetched body", () => {
    assert.equal(insertArticles(db, 7, [parsed], dateOf, later).length, 0);
    const row = getArticle(db, 41);
    assert.equal(row.feed_content_html, fullHtml);
    assert.equal(row.feed_content_kind, "full");
    assert.equal(row.feed_content_base_url, "https://example.test/article");
    for (const [name, value] of Object.entries(original)) assert.equal(row[name], value, name);
    assert.equal(isRead(db, 41), true);
    assert.equal(db.prepare("SELECT read_at FROM reads WHERE article_id = 41").get().read_at, later);
    assert.equal(db.prepare("SELECT count(*) AS n FROM articles").get().n, 1);
    assert.deepEqual({ ...getReport(db, "2026-11-03") }, originalReport);
    const updated = { ...parsed, feedContentHtml: `${fullHtml}<p>New feed revision</p>` };
    assert.equal(insertArticles(db, 7, [updated], dateOf, later).length, 0);
    assert.equal(getArticle(db, 41).feed_content_html, updated.feedContentHtml);
    insertArticles(db, 7, [{ ...parsed, feedContentKind: "description", feedContentHtml: "Short summary" }], dateOf, later);
    insertArticles(db, 7, [{ ...parsed, feedContentTruncated: true, feedContentHtml: "Partial body" }], dateOf, later);
    assert.equal(getArticle(db, 41).feed_content_html, updated.feedContentHtml, "refreshes must not downgrade retained full content");
  });

  check("Atom HTML/XHTML and description fallback preserve original inner markup and base URL", () => {
    const escaped = "&lt;p&gt;Escaped HTML &amp;amp; text&lt;/p&gt;";
    const xhtml = '<div xmlns="http://www.w3.org/1999/xhtml"><p>Nested <strong>body</strong></p></div>';
    const atom = parseFeed(`<feed><entry><id>atom-html</id><link href="/atom"/><content type="html">${escaped}</content></entry>
      <entry><id>urn:atom-xhtml</id><content type="xhtml">${xhtml}</content></entry></feed>`, feedUrl).items;
    assert.equal(atom[0].feedContentHtml, escaped);
    assert.equal(atom[0].feedContentKind, "full");
    assert.equal(atom[1].feedContentHtml, xhtml);
    assert.equal(atom[1].feedContentBaseUrl, feedUrl);
    const description = `<p>${"Description text ".repeat(250)}</p><img src="relative.png">`;
    const item = parseFeed(`<rss><channel><item><guid>opaque-id</guid><description><![CDATA[${description}]]></description></item></channel></rss>`, feedUrl).items[0];
    assert.equal(item.feedContentHtml, description);
    assert.equal(item.feedContentKind, "description");
    assert.equal(item.feedContentBaseUrl, "https://example.test/opaque-id");
    assert.equal(item.summary.length, 2000);
    const noLink = parseFeed(`<feed><entry><title>No link</title><summary><![CDATA[${description}]]></summary></entry></feed>`, feedUrl).items[0];
    assert.equal(noLink.feedContentBaseUrl, feedUrl);
    const inserted = insertArticles(db, 7, [item, noLink], dateOf, later);
    assert.equal(inserted.length, 2);
    const saved = getArticle(db, inserted[0].id);
    assert.equal(saved.feed_content_html, description);
    assert.equal(saved.feed_content_truncated, 0);
  });

  check("512 Ki-character cap is explicit, exact at the boundary, and persisted", () => {
    const parseBody = (body, key) => parseFeed(`<rss><channel><item><guid>${key}</guid><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`, feedUrl).items[0];
    const body = "x".repeat(MAX_FEED_CONTENT_CHARS + 123);
    const capped = parseBody(body, "capped");
    assert.equal(capped.feedContentHtml, body.slice(0, MAX_FEED_CONTENT_CHARS));
    assert.equal(capped.feedContentTruncated, true);
    assert.equal(capped.summary.length, 2000);
    assert.equal(parseBody("x".repeat(MAX_FEED_CONTENT_CHARS), "exact").feedContentTruncated, false);
    const id = insertArticles(db, 7, [capped], dateOf, later)[0].id;
    assert.equal(getArticle(db, id).feed_content_truncated, 1);
    assert.equal(getArticle(db, id).feed_content_html.length, MAX_FEED_CONTENT_CHARS);
  });

  check("success stores structured content and failed refresh preserves all successful fields", () => {
    const document = { version: 1, blocks: [{ type: "paragraph", text: "Retained article" }] };
    setContentSuccess(db, 41, {
      status: "ok", text: "Retained article", document, source: "article", version: 3, at,
      truncated: true,
    });
    const success = { ...getArticle(db, 41) };
    assert.deepEqual(JSON.parse(success.content_document_json), { ...document, truncated: true });
    assert.equal(success.content_source, "article");
    assert.equal(success.extracted_at, at);
    assert.equal(success.extraction_version, 3);
    assert.equal(success.content_attempt_at, at);
    assert.equal(success.content_attempt_error, null);
    recordContentAttempt(db, 41, { at: later, error: "Refresh failed", version: 99 });
    const failed = { ...getArticle(db, 41) };
    assert.equal(failed.content_attempt_at, later);
    assert.equal(failed.content_attempt_error, "Refresh failed");
    delete failed.content_attempt_at;
    delete failed.content_attempt_error;
    delete success.content_attempt_at;
    delete success.content_attempt_error;
    assert.deepEqual(failed, success);
    assert.equal(isRead(db, 41), true);
    assert.throws(() => setContentSuccess(db, 41, { status: "failed", text: "bad" }), /status/);
    assert.equal(getArticle(db, 41).content_text, "Retained article");
  });

  check("first failure records diagnostics and retry success clears them; legacy setter still works", () => {
    const id = insertArticles(db, 7, [{ entryKey: "retry", title: "Retry" }], dateOf, later)[0].id;
    recordContentAttempt(db, id, { at, error: "First extraction failed", version: 2 });
    const failed = getArticle(db, id);
    assert.equal(failed.content_status, "failed");
    assert.equal(failed.content_text, null);
    assert.equal(failed.content_document_json, null);
    assert.equal(failed.extracted_at, null);
    assert.equal(failed.extraction_version, 2);
    assert.equal(failed.content_attempt_error, "First extraction failed");
    setContentSuccess(db, id, { status: "fallback", text: "Feed body", document: { blocks: [] }, source: "feed", version: 3, at: later });
    assert.equal(getArticle(db, id).content_status, "fallback");
    assert.equal(getArticle(db, id).content_attempt_error, null);
    assert.equal(getArticle(db, id).content_error, null);
    recordContentAttempt(db, id, { at, error: "Later failure", version: 4 });
    assert.equal(getArticle(db, id).content_status, "fallback");
    assert.equal(getArticle(db, id).content_text, "Feed body");
    assert.equal(getArticle(db, id).extraction_version, 3);
    setContent(db, id, "ok", "Legacy text setter", null);
    assert.equal(getArticle(db, id).content_text, "Legacy text setter");
  });

  check("fresh database upgrades to v6 and creates reads in the same schema", () => {
    const fresh = openDatabase(":memory:");
    try {
      assert.equal(fresh.prepare("PRAGMA user_version").get().user_version, 6);
      const columns = new Set(fresh.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
      for (const name of newColumns) assert.ok(columns.has(name), name);
      assert.equal(fresh.prepare("SELECT count(*) AS n FROM reads").get().n, 0);
    } finally {
      closeDatabase(fresh);
    }
  });

  check("failed v1 upgrade rolls back new columns and PRAGMA version together", () => {
    const rollbackPath = join(workDir, "rollback.sqlite");
    const fixture = new DatabaseSync(rollbackPath);
    fixture.exec(legacySchema);
    fixture.exec("DROP TABLE reads; CREATE INDEX reads ON articles(id)");
    fixture.close();
    assert.throws(() => {
      const unexpectedlyOpened = openDatabase(rollbackPath);
      closeDatabase(unexpectedlyOpened);
    }, /reads/);
    const after = new DatabaseSync(rollbackPath);
    try {
      assert.equal(after.prepare("PRAGMA user_version").get().user_version, 1);
      const columns = new Set(after.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
      for (const name of newColumns) assert.equal(columns.has(name), false, name);
    } finally {
      after.close();
    }
  });

  console.log(`${checks} content storage checks passed`);
} finally {
  if (db) closeDatabase(db);
  // The cleanup target is the exact disposable directory created above.
  assert.equal(resolve(workDir, ".."), resolve(tmpdir()));
  assert.ok(workDir.startsWith(join(tmpdir(), "rss-brief-content-storage-")));
  rmSync(workDir, { recursive: true, force: true });
}
