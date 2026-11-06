/**
 * SQLite persistence for feeds, articles, reports, and scheduler metadata.
 * Uses the Node built-in `node:sqlite` driver, so the bundle needs no native
 * dependency. Every write is a synchronous statement inside a transaction.
 * @module rss-brief/db
 */

import { DatabaseSync } from "node:sqlite";
import { ASSESSMENT_VERSION, assessmentInput, validateAssessment } from "./ai.js";

/** Schema generation. Bump this and migrate when columns change. */
const SCHEMA_VERSION = 4;

/**
 * Open (and migrate) the plugin database.
 * @param file - database path or `:memory:`.
 * @returns an open database handle.
 */
export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Additive table for per-article read marks; safe on existing databases. */
function ensureReadsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reads (
      article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL
    );
  `);
}

/** Upgrade schema and version together; a failed migration leaves both untouched. */
function migrate(db) {
  transaction(db, () => {
    // Read the version after taking the write lock so concurrent opens agree.
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version < 1) db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      xml_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      html_url TEXT NOT NULL DEFAULT '',
      opml_group TEXT NOT NULL DEFAULT '未分组',
      enabled INTEGER NOT NULL DEFAULT 1,
      etag TEXT,
      last_modified TEXT,
      last_fetch_at TEXT,
      last_success_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      entry_key TEXT NOT NULL,
      guid TEXT,
      url TEXT,
      title TEXT NOT NULL,
      author TEXT,
      published_at TEXT NOT NULL,
      published_date TEXT NOT NULL,
      feed_summary TEXT,
      content_text TEXT,
      content_status TEXT NOT NULL DEFAULT 'pending',
      content_error TEXT,
      ai_status TEXT NOT NULL DEFAULT 'pending',
      category TEXT,
      relevance INTEGER,
      summary_zh TEXT,
      ai_error TEXT,
      first_seen_at TEXT NOT NULL,
      reported_at TEXT,
      UNIQUE(feed_id, entry_key)
    );

    CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(published_date, published_at);
    CREATE INDEX IF NOT EXISTS idx_articles_content ON articles(content_status, published_at);
    CREATE INDEX IF NOT EXISTS idx_articles_ai ON articles(ai_status, published_at);

    CREATE TABLE IF NOT EXISTS reports (
      report_date TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      path TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
    if (version < 2) {
      const columns = new Set(db.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
      const additions = {
        feed_content_html: "TEXT",
        feed_content_kind: "TEXT",
        feed_content_base_url: "TEXT",
        feed_content_truncated: "INTEGER NOT NULL DEFAULT 0",
        content_document_json: "TEXT",
        content_source: "TEXT",
        extracted_at: "TEXT",
        extraction_version: "INTEGER",
        content_attempt_at: "TEXT",
        content_attempt_error: "TEXT",
      };
      for (const [name, definition] of Object.entries(additions)) {
        if (!columns.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`);
      }
    }
    if (version < 3) {
      const columns = new Set(db.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
      const additions = {
        assessment_status: "TEXT NOT NULL DEFAULT 'pending'", assessment_score: "INTEGER",
        assessment_dimensions_json: "TEXT", assessment_summary: "TEXT", assessment_category: "TEXT",
        assessment_relevance: "INTEGER", assessment_reason: "TEXT", assessment_basis: "TEXT",
        assessment_provisional: "INTEGER", assessment_minutes: "INTEGER", assessment_model: "TEXT",
        assessment_at: "TEXT", assessment_version: "INTEGER", assessment_fingerprint: "TEXT",
        assessment_current_fingerprint: "TEXT", assessment_error: "TEXT", assessment_attempt_at: "TEXT",
        assessment_attempts: "INTEGER NOT NULL DEFAULT 0", assessment_retry_at: "TEXT",
      };
      for (const [name, definition] of Object.entries(additions)) {
        if (!columns.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`);
      }
      for (const row of db.prepare("SELECT * FROM articles").all()) refreshAssessmentIdentity(db, row.id);
      db.exec("CREATE INDEX IF NOT EXISTS idx_articles_assessment ON articles(assessment_status, published_at)");
    }
    if (version < 4) {
      const columns = new Set(db.prepare("PRAGMA table_info(articles)").all().map((row) => row.name));
      for (const [name, definition] of Object.entries({ discarded_at: "TEXT", discard_reason: "TEXT", content_type: "TEXT" })) {
        if (!columns.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`);
      }
      // The rule version changes the identity, but never auto-discards old rows.
      for (const row of db.prepare("SELECT id FROM articles").all()) refreshAssessmentIdentity(db, row.id);
    }
    ensureReadsTable(db);
    if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

/**
 * Insert new feeds, refresh existing metadata, and disable feeds that are no
 * longer present in the OPML.
 * @param db - database handle.
 * @param feeds - parsed OPML feeds.
 * @returns counts of inserted, updated, and disabled rows.
 */
export function upsertFeeds(db, feeds) {
  const existing = new Map(
    db
      .prepare("SELECT id, xml_url, enabled FROM feeds")
      .all()
      .map((row) => [row.xml_url, row]),
  );
  const insert = db.prepare(
    "INSERT INTO feeds (xml_url, title, html_url, opml_group, enabled) VALUES (?, ?, ?, ?, 1)",
  );
  const update = db.prepare(
    "UPDATE feeds SET title = ?, html_url = ?, opml_group = ?, enabled = 1 WHERE id = ?",
  );
  const disable = db.prepare("UPDATE feeds SET enabled = 0 WHERE id = ?");
  let inserted = 0;
  let updated = 0;
  let disabled = 0;
  transaction(db, () => {
    const seen = new Set();
    for (const feed of feeds) {
      seen.add(feed.xmlUrl);
      const row = existing.get(feed.xmlUrl);
      if (row !== undefined) {
        update.run(feed.title, feed.htmlUrl, feed.group, row.id);
        updated += 1;
      } else {
        insert.run(feed.xmlUrl, feed.title, feed.htmlUrl, feed.group);
        inserted += 1;
      }
    }
    for (const row of existing.values()) {
      if (!seen.has(row.xml_url) && Number(row.enabled) === 1) {
        disable.run(row.id);
        disabled += 1;
      }
    }
  });
  return { total: feeds.length, inserted, updated, disabled };
}

/**
 * Every feed that should be fetched.
 * @param db - database handle.
 * @returns enabled feed rows.
 */
export function enabledFeeds(db) {
  return db.prepare("SELECT * FROM feeds WHERE enabled = 1 ORDER BY id").all();
}

/**
 * Record one fetch outcome.
 * @param db - database handle.
 * @param id - feed id.
 * @param outcome - timestamp, validators, and optional error text.
 */
export function markFeedResult(db, id, outcome) {
  const at = outcome.at ?? new Date().toISOString();
  if (outcome.error) {
    db.prepare("UPDATE feeds SET last_fetch_at = ?, last_error = ? WHERE id = ?").run(
      at,
      String(outcome.error).slice(0, 500),
      id,
    );
    return;
  }
  db.prepare(
    `UPDATE feeds
        SET last_fetch_at = ?, last_success_at = ?, last_error = NULL,
            etag = ?, last_modified = ?
      WHERE id = ?`,
  ).run(at, at, outcome.etag || null, outcome.lastModified || null, id);
}

/**
 * Insert feed items and refresh retained feed content on duplicate keys.
 * Existing article, read, AI, and fetched-content state is never replaced.
 * @param db - database handle.
 * @param feedId - owning feed.
 * @param items - parsed feed items.
 * @param localDateOf - maps an ISO timestamp to the local calendar date.
 * @param firstSeenAt - ISO timestamp for this sync.
 * @returns the inserted articles, with their row ids.
 */
export function insertArticles(db, feedId, items, localDateOf, firstSeenAt) {
  const statement = db.prepare(
    `INSERT OR IGNORE INTO articles
       (feed_id, entry_key, guid, url, title, author, published_at, published_date,
        feed_summary, feed_content_html, feed_content_kind, feed_content_base_url,
        feed_content_truncated, content_status, ai_status, first_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?)`,
  );
  const refreshFeedContent = db.prepare(
    `UPDATE articles
        SET feed_content_html = ?, feed_content_kind = ?, feed_content_base_url = ?,
            feed_content_truncated = ?
      WHERE feed_id = ? AND entry_key = ?
        AND (COALESCE(feed_content_html, '') = '' OR (
          (COALESCE(feed_content_kind, 'description') <> 'full' OR ? = 'full')
          AND (COALESCE(feed_content_kind, 'description') <> ?
               OR feed_content_truncated = 1 OR ? = 0)))`,
  );
  const inserted = [];
  transaction(db, () => {
    for (const item of items) {
      const publishedAt = item.publishedAt ?? firstSeenAt;
      const feedHtml = item.feedContentHtml ?? null;
      const feedKind = item.feedContentKind === "full" ? "full" : "description";
      const feedTruncated = item.feedContentTruncated ? 1 : 0;
      const result = statement.run(
        feedId,
        item.entryKey,
        item.guid ?? null,
        item.url ?? null,
        item.title,
        item.author ?? null,
        publishedAt,
        localDateOf(publishedAt),
        item.summary ?? null,
        feedHtml,
        feedHtml === null ? null : feedKind,
        item.feedContentBaseUrl ?? item.url ?? null,
        feedTruncated,
        firstSeenAt,
      );
      if (Number(result.changes) > 0) {
        inserted.push({
          id: Number(result.lastInsertRowid),
          ...item,
          publishedAt,
          publishedDate: localDateOf(publishedAt),
        });
      } else if (typeof feedHtml === "string" && feedHtml.trim() !== "") {
        // A summary-only or truncated refresh must not downgrade a fuller copy.
        refreshFeedContent.run(
          feedHtml, feedKind, item.feedContentBaseUrl ?? item.url ?? null, feedTruncated,
          feedId, item.entryKey, feedKind, feedKind, feedTruncated,
        );
      }
      const stored = db.prepare("SELECT id FROM articles WHERE feed_id = ? AND entry_key = ?").get(feedId, item.entryKey);
      if (stored) refreshAssessmentIdentity(db, Number(stored.id));
    }
  });
  return inserted;
}

/**
 * Articles whose body still needs extraction.
 * @param db - database handle.
 * @param options - a date for report-time work, or a lower time bound for sync-time work.
 * @returns article rows joined with feed metadata.
 */
export function pendingContent(db, options) {
  const limit = options.limit ?? 40;
  const columns = `a.*, f.title AS feed_title, f.html_url AS feed_html_url,
                   f.xml_url AS feed_url, f.opml_group`;
  if (options.date !== undefined) {
    return db
      .prepare(
        `SELECT ${columns}
           FROM articles a JOIN feeds f ON f.id = a.feed_id
          WHERE a.published_date = ? AND a.discarded_at IS NULL
            AND a.content_status IN ('pending', 'failed')
            AND a.url IS NOT NULL
          ORDER BY a.published_at DESC
          LIMIT ?`,
      )
      .all(options.date, limit);
  }
  return db
    .prepare(
      `SELECT ${columns}
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE a.discarded_at IS NULL AND a.content_status = 'pending'
          AND a.url IS NOT NULL
          AND a.published_at >= ?
        ORDER BY a.published_at DESC
        LIMIT ?`,
    )
    .all(options.sinceIso ?? "1970-01-01T00:00:00.000Z", limit);
}

/**
 * Store one body extraction outcome.
 * @param db - database handle.
 * @param id - article id.
 * @param status - `ok`, `fallback`, or `failed`.
 * @param text - extracted or fallback body text.
 * @param error - failure reason.
 */
export function setContent(db, id, status, text, error) {
  db.prepare(
    "UPDATE articles SET content_text = ?, content_status = ?, content_error = ? WHERE id = ?",
  ).run(text ?? null, status, error ? String(error).slice(0, 500) : null, id);
  refreshAssessmentIdentity(db, id);
}

/**
 * Store successful extraction text, its structured document, and provenance.
 * `document` is a JSON-serializable object; optional `truncated` is stored in it.
 * Only `ok` and `fallback` are successful statuses. Attempt failures use
 * recordContentAttempt so an earlier successful extraction stays usable.
 */
export function setContentSuccess(db, id, outcome) {
  const status = outcome.status ?? "ok";
  if (status !== "ok" && status !== "fallback") {
    throw new TypeError("Successful content status must be ok or fallback");
  }
  const at = outcome.at ?? new Date().toISOString();
  const error = outcome.error ? String(outcome.error).slice(0, 500) : null;
  const document = outcome.document == null ? null
    : outcome.truncated === undefined ? outcome.document
    : { ...outcome.document, truncated: Boolean(outcome.truncated) };
  const json = document === null ? null : JSON.stringify(document);
  db.prepare(
    `UPDATE articles
        SET content_text = ?, content_status = ?, content_error = ?,
            content_document_json = ?, content_source = ?, extracted_at = ?,
            extraction_version = ?, content_attempt_at = ?, content_attempt_error = ?
      WHERE id = ?`,
  ).run(
    outcome.text ?? null, status, error, json, outcome.source ?? null,
    at, outcome.version ?? null, at, error, id,
  );
  refreshAssessmentIdentity(db, id);
}

/**
 * Record a failed extraction without replacing any prior successful body.
 * For an article without success, mark it failed and retain the attempted
 * version. A prior success keeps its status, error, version, and provenance.
 */
export function recordContentAttempt(db, id, outcome) {
  const at = outcome.at ?? new Date().toISOString();
  const error = outcome.error ? String(outcome.error).slice(0, 500) : null;
  db.prepare(
    `UPDATE articles
        SET content_attempt_at = ?, content_attempt_error = ?,
            content_status = CASE WHEN content_status IN ('ok', 'fallback')
                                  THEN content_status ELSE 'failed' END,
            content_error = CASE WHEN content_status IN ('ok', 'fallback')
                                 THEN content_error ELSE ? END,
            extraction_version = CASE WHEN content_status IN ('ok', 'fallback')
                                      THEN extraction_version ELSE COALESCE(?, extraction_version) END
      WHERE id = ?`,
  ).run(at, error, error, outcome.version ?? null, id);
}

/**
 * Mark one article read or unread.
 * @param db - database handle.
 * @param id - article id.
 * @param read - true stores a read mark; false removes it.
 * @param at - ISO timestamp for the read mark.
 */
export function setRead(db, id, read, at = new Date().toISOString()) {
  if (read) {
    db.prepare(
      `INSERT INTO reads (article_id, read_at) VALUES (?, ?)
       ON CONFLICT(article_id) DO UPDATE SET read_at = excluded.read_at`,
    ).run(id, at);
    return;
  }
  db.prepare("DELETE FROM reads WHERE article_id = ?").run(id);
}

/**
 * Every article id that is currently read.
 * @param db - database handle.
 * @returns a set of numeric article ids.
 */
export function getReadIds(db) {
  return new Set(
    db
      .prepare("SELECT r.article_id FROM reads r JOIN articles a ON a.id = r.article_id WHERE a.discarded_at IS NULL")
      .all()
      .map((row) => Number(row.article_id)),
  );
}

/**
 * Whether one article is read.
 * @param db - database handle.
 * @param id - article id.
 * @returns true when a read mark exists.
 */
export function isRead(db, id) {
  return db.prepare("SELECT 1 AS hit FROM reads WHERE article_id = ?").get(id) !== undefined;
}

/**
 * One article joined with its feed metadata.
 * @param db - database handle.
 * @param id - article id.
 * @returns the article row, or undefined.
 */
export function getArticle(db, id, { includeDiscarded = false } = {}) {
  return db
    .prepare(
      `SELECT a.*, f.title AS feed_title, f.html_url AS feed_html_url,
              f.xml_url AS feed_url, f.opml_group
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE a.id = ?${includeDiscarded ? "" : " AND a.discarded_at IS NULL"}`,
    )
    .get(id);
}

/**
 * The newest candidate articles of one local date, joined with feed metadata.
 * @param db - database handle.
 * @param date - `YYYY-MM-DD`.
 * @param limit - maximum candidates.
 * @returns article rows.
 */
export function reportCandidates(db, date, limit) {
  return db
    .prepare(
      `SELECT a.*, f.title AS feed_title, f.html_url AS feed_html_url,
              f.xml_url AS feed_url, f.opml_group
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE a.published_date = ? AND a.discarded_at IS NULL
        ORDER BY a.published_at DESC
        LIMIT ?`,
    )
    .all(date, limit);
}

/** Update cache identity after content/feed changes; earlier results stay readable. */
function refreshAssessmentIdentity(db, id) {
  const row = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!row) return;
  const fingerprint = assessmentInput(row).fingerprint;
  db.prepare(`UPDATE articles SET assessment_current_fingerprint = ?,
    assessment_attempts = CASE WHEN assessment_current_fingerprint IS ? THEN assessment_attempts ELSE 0 END,
    assessment_retry_at = CASE WHEN assessment_current_fingerprint IS ? THEN assessment_retry_at ELSE NULL END
    WHERE id = ?`).run(fingerprint, fingerprint, fingerprint, id);
}

/** Pending/retryable assessment rows, prioritizing this sync's IDs then recency. */
export function pendingAssessments(db, options = {}) {
  const { limit = 40, sinceIso = "1970-01-01T00:00:00.000Z", date, force = false } = options;
  const ids = [...new Set(options.newIds ?? options.ids ?? [])].filter((id) => Number.isSafeInteger(id) && id > 0);
  const now = options.now ?? new Date().toISOString();
  const args = [];
  const predicates = ["f.enabled = 1", "a.discarded_at IS NULL", "a.published_at <= ?"];
  args.push(now);
  if (date !== undefined) { predicates.push("a.published_date = ?"); args.push(date); }
  else if (ids.length) { predicates.push(`(a.id IN (${ids.map(() => "?").join(",")}) OR a.published_at >= ?)`); args.push(...ids, sinceIso); }
  else { predicates.push("a.published_at >= ?"); args.push(sinceIso); }
  if (!force) {
    predicates.push(`(a.assessment_score IS NULL OR a.assessment_fingerprint IS NOT a.assessment_current_fingerprint OR a.assessment_version IS NOT ?)`);
    args.push(ASSESSMENT_VERSION);
    predicates.push("(a.assessment_retry_at IS NULL OR a.assessment_retry_at <= ?)");
    args.push(now);
  }
  predicates.push("length(trim(COALESCE(NULLIF(a.content_text, ''), a.feed_summary, ''))) > 0");
  const priority = ids.length ? `CASE WHEN a.id IN (${ids.map(() => "?").join(",")}) THEN 0 ELSE 1 END, ` : "";
  return db.prepare(`SELECT a.*, f.title AS feed_title, f.html_url AS feed_html_url,
    f.xml_url AS feed_url, f.opml_group FROM articles a JOIN feeds f ON f.id = a.feed_id
    WHERE ${predicates.join(" AND ")} ORDER BY ${priority}a.published_at DESC, a.id DESC LIMIT ?`)
    .all(...args, ...ids, Math.max(0, Math.min(1000, Number.isSafeInteger(limit) ? limit : 40)));
}

/** Save a validated success; failures update attempt metadata without erasing results. */
export function saveAssessment(db, id, result) {
  const row = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!row || row.discarded_at) return false;
  const at = result.analyzedAt ?? result.at ?? new Date().toISOString();
  if (result.status === "failed" || result.error) {
    const attempts = Number(row.assessment_attempts ?? 0) + 1;
    const retryAt = new Date(Date.parse(at) + Math.min(1440, 5 * 2 ** Math.min(attempts - 1, 9)) * 60000).toISOString();
    db.prepare(`UPDATE articles SET assessment_status = CASE WHEN assessment_score IS NULL THEN 'failed' ELSE assessment_status END,
      assessment_error = ?, assessment_attempt_at = ?, assessment_attempts = ?, assessment_retry_at = ? WHERE id = ?`)
      .run(String(result.error ?? "AI 评估失败").slice(0, 500), at, attempts, retryAt, id);
    return false;
  }
  // Old persisted editorial callers remain compatible; model parsing has no default.
  const valid = validateAssessment({ ...result, contentType: Object.hasOwn(result, "contentType") ? result.contentType : "editorial" });
  const input = assessmentInput(row);
  const fingerprint = result.fingerprint ?? input.fingerprint;
  if (valid.contentType !== "editorial") {
    db.prepare(`UPDATE articles SET discarded_at = ?, discard_reason = ?, content_type = ?,
      assessment_status = 'discarded', assessment_model = ?, assessment_at = ?, assessment_version = ?,
      assessment_fingerprint = ?, assessment_current_fingerprint = ?, assessment_error = NULL,
      assessment_attempt_at = ?, assessment_attempts = 0, assessment_retry_at = NULL
      WHERE id = ? AND discarded_at IS NULL`).run(at, valid.discardReason, valid.contentType,
        result.model ?? null, at, result.version ?? ASSESSMENT_VERSION, fingerprint, input.fingerprint, at, id);
    return true;
  }
  // Preserve in-flight results against the input they actually assessed. A body
  // changed during the call therefore leaves this result stale, never current.
  const basis = result.basis ?? input.basis;
  const provisional = Boolean(result.provisional ?? input.provisional) || basis !== "full";
  db.prepare(`UPDATE articles SET content_type = 'editorial', assessment_status = 'ok', assessment_score = ?, assessment_dimensions_json = ?,
    assessment_summary = ?, assessment_category = ?, assessment_relevance = ?, assessment_reason = ?,
    assessment_basis = ?, assessment_provisional = ?, assessment_minutes = ?, assessment_model = ?,
    assessment_at = ?, assessment_version = ?, assessment_fingerprint = ?, assessment_current_fingerprint = ?,
    assessment_error = NULL, assessment_attempt_at = ?, assessment_attempts = 0, assessment_retry_at = NULL WHERE id = ?`)
    .run(valid.score, JSON.stringify(valid.dimensions), valid.summary, valid.category, valid.relevance, valid.reason,
      basis, provisional ? 1 : 0, result.minutes ?? input.minutes, result.model ?? null, at,
      result.version ?? ASSESSMENT_VERSION, fingerprint, input.fingerprint, at, id);
  return true;
}

export function assessmentCounts(db) {
  const row = db.prepare(`SELECT SUM(CASE WHEN discarded_at IS NULL THEN 1 ELSE 0 END) AS total,
    SUM(CASE WHEN discarded_at IS NOT NULL THEN 1 ELSE 0 END) AS discarded,
    SUM(CASE WHEN discarded_at IS NULL AND assessment_score IS NOT NULL THEN 1 ELSE 0 END) AS assessed,
    SUM(CASE WHEN discarded_at IS NULL AND assessment_score IS NULL THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN discarded_at IS NULL AND assessment_error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN discarded_at IS NULL AND assessment_score IS NOT NULL AND (assessment_fingerprint IS NOT assessment_current_fingerprint OR assessment_version IS NOT ?) THEN 1 ELSE 0 END) AS stale
    FROM articles`).get(ASSESSMENT_VERSION);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
}

/**
 * Read stored, published articles across all dates, without fetching or AI work.
 * All filters and pagination run in SQL; the ID ceiling keeps inserts out of
 * subsequent pages. Facets ignore category/feed, and unread ignores its own switch.
 * @param db - database handle.
 * @param options - validated limit, offset, q, category, feed, unread, snapshot, and optional now.
 */
function latestScope(db, options = {}) {
  const { q = "", category, feed, unread = false } = options;
  if (feed !== undefined && (!Number.isSafeInteger(feed) || feed <= 0)) throw new TypeError("Invalid feed filter");
  const now = options.now ?? new Date().toISOString();
  const snapshot = options.snapshot ?? Number(
    db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM articles").get().id,
  );
  const from = `FROM articles a JOIN feeds f ON f.id = a.feed_id
                LEFT JOIN reads r ON r.article_id = a.id`;
  if (options.quality !== undefined && options.quality !== "all" && options.quality !== "high") throw new TypeError("Invalid quality filter");
  const threshold = Math.max(60, Number.isFinite(options.highQualityThreshold) ? options.highQualityThreshold : 60);
  const quality = options.quality === "high" ? ` AND a.assessment_score >= ?
    AND a.assessment_provisional = 0 AND a.assessment_basis = 'full'
    AND a.assessment_fingerprint = a.assessment_current_fingerprint AND a.assessment_version = ?` : "";
  const base = `f.enabled = 1 AND a.discarded_at IS NULL AND a.published_at <= ? AND a.id <= ?${quality}`;
  const baseArgs = [now, snapshot, ...(quality ? [threshold, ASSESSMENT_VERSION] : [])];
  // instr is a literal substring search: %, _ and backslashes have no special meaning.
  const search = q === "" ? "" : ` AND (
    instr(lower(a.title), lower(?)) > 0 OR instr(lower(f.title), lower(?)) > 0 OR
    instr(lower(COALESCE(NULLIF(a.assessment_summary, ''), NULLIF(a.summary_zh, ''), a.feed_summary, '')), lower(?)) > 0)`;
  const searchArgs = q === "" ? [] : [q, q, q];
  const categorySql = category === undefined ? "" : " AND ('opml:' || f.opml_group) = ?";
  const categoryArgs = category === undefined ? [] : [category];
  const feedSql = feed === undefined ? "" : " AND f.id = ?";
  const feedArgs = feed === undefined ? [] : [feed];
  const unreadSql = unread ? " AND r.article_id IS NULL" : "";
  const matched = `${base}${search}${categorySql}${feedSql}${unreadSql}`;
  const args = [...baseArgs, ...searchArgs, ...categoryArgs, ...feedArgs];
  return { from, base, baseArgs, search, searchArgs, categorySql, categoryArgs, feedSql, feedArgs, unreadSql, matched, args, snapshot, now };
}

/** Read one page using the same selection predicate as the bulk read action. */
export function latestArticles(db, options = {}) {
  const { limit = 100, offset = 0 } = options;
  const { from, base, baseArgs, search, searchArgs, categorySql, categoryArgs, feedSql, feedArgs, unreadSql, matched, args, snapshot, now } = latestScope(db, options);
  const total = Number(db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${matched}`).get(...args).n);
  const rows = db.prepare(
    `SELECT a.*, f.title AS feed_title, f.html_url AS feed_html_url,
            f.xml_url AS feed_url, f.opml_group, r.article_id IS NOT NULL AS is_read
       ${from} WHERE ${matched}
       ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?`,
  ).all(...args, limit, offset);
  const counts = new Map(db.prepare(
    `SELECT f.opml_group, COUNT(*) AS n ${from}
      WHERE ${base}${search}${unreadSql} GROUP BY f.opml_group`,
  ).all(...baseArgs, ...searchArgs).map((row) => [row.opml_group, Number(row.n)]));
  const categories = db.prepare(
    "SELECT DISTINCT opml_group FROM feeds WHERE enabled = 1 ORDER BY opml_group",
  ).all().map((row) => ({
    key: `opml:${row.opml_group}`, label: row.opml_group, count: counts.get(row.opml_group) ?? 0,
  }));
  const sourceCounts = new Map(db.prepare(
    `SELECT f.id, COUNT(*) AS n ${from}
      WHERE ${base}${search}${unreadSql} GROUP BY f.id`,
  ).all(...baseArgs, ...searchArgs).map((row) => [Number(row.id), Number(row.n)]));
  const sources = db.prepare(
    "SELECT id, title, html_url, xml_url, opml_group FROM feeds WHERE enabled = 1 ORDER BY opml_group, title, id",
  ).all().map((row) => ({
    id: Number(row.id), title: row.title, feedUrl: row.html_url || row.xml_url,
    category: `opml:${row.opml_group}`, count: sourceCounts.get(Number(row.id)) ?? 0,
  }));
  const unreadCount = Number(db.prepare(
    `SELECT COUNT(*) AS n ${from}
      WHERE ${base}${search}${categorySql}${feedSql} AND r.article_id IS NULL`,
  ).get(...baseArgs, ...searchArgs, ...categoryArgs, ...feedArgs).n);
  const available = Number(db.prepare(
    `SELECT COUNT(*) AS n FROM articles a JOIN feeds f ON f.id = a.feed_id
      WHERE f.enabled = 1 AND a.discarded_at IS NULL AND a.published_at <= ?`,
  ).get(now).n);
  const hasMore = offset + rows.length < total;
  return {
    rows,
    pagination: { offset, limit, total, hasMore, nextOffset: hasMore ? offset + rows.length : null, snapshot },
    latest: { categories, sources, total: categories.reduce((sum, item) => sum + item.count, 0), unread: unreadCount, available },
  };
}

/** Mark every unread match, including unloaded pages, in one write transaction. */
export function markLatestRead(db, options = {}, at = new Date().toISOString()) {
  return transaction(db, () => {
    const { from, matched, args } = latestScope(db, options);
    const ids = db.prepare(`SELECT a.id ${from} WHERE ${matched} AND r.article_id IS NULL ORDER BY a.id`).all(...args).map((row) => Number(row.id));
    insertReadMarks(db, ids, at);
    return { changed: ids.length, ids };
  });
}

/** Mark selected report IDs that still exist; preserve existing read timestamps. */
export function markArticlesRead(db, articleIds, at = new Date().toISOString()) {
  return transaction(db, () => {
    const unread = db.prepare("SELECT a.id FROM articles a LEFT JOIN reads r ON r.article_id = a.id WHERE a.id = ? AND a.discarded_at IS NULL AND r.article_id IS NULL");
    const ids = [...new Set(articleIds)].filter((id) => Number.isSafeInteger(id) && id > 0 && unread.get(id) !== undefined);
    insertReadMarks(db, ids, at);
    return { changed: ids.length, ids };
  });
}

function insertReadMarks(db, ids, at) {
  const insert = db.prepare("INSERT OR IGNORE INTO reads (article_id, read_at) VALUES (?, ?)");
  for (const id of ids) insert.run(id, at);
}

/** Number of stored articles for one local date. */
export function countArticlesByDate(db, date) {
  return Number(
    db.prepare("SELECT COUNT(*) AS total FROM articles WHERE discarded_at IS NULL AND published_date = ?").get(date)?.total ?? 0,
  );
}

/**
 * Record one AI classification outcome.
 * @param db - database handle.
 * @param id - article id.
 * @param result - status plus category, relevance, summary, or error.
 */
export function setAiResult(db, id, result) {
  db.prepare(
    `UPDATE articles
        SET ai_status = ?, category = ?, relevance = ?, summary_zh = ?, ai_error = ?
      WHERE id = ?`,
  ).run(
    result.status,
    result.category ?? null,
    Number.isFinite(result.relevance) ? result.relevance : null,
    result.summary ?? null,
    result.error ? String(result.error).slice(0, 500) : null,
    id,
  );
}

/**
 * Insert or replace one daily report row.
 * @param db - database handle.
 * @param report - date, timestamp, path, stats, and payload.
 */
export function upsertReport(db, report) {
  db.prepare(
    `INSERT INTO reports (report_date, generated_at, path, stats_json, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(report_date) DO UPDATE SET
       generated_at = excluded.generated_at,
       path = excluded.path,
       stats_json = excluded.stats_json,
       payload_json = excluded.payload_json`,
  ).run(
    report.date,
    report.generatedAt,
    report.path,
    JSON.stringify(report.stats ?? {}),
    JSON.stringify(report.payload ?? {}),
  );
}

/** One report row by date, or undefined. */
export function getReport(db, date) {
  return db.prepare("SELECT * FROM reports WHERE report_date = ?").get(date);
}

/** Newest report rows, without their potentially large payloads. */
export function listReports(db, limit = 7) {
  return db
    .prepare(
      "SELECT report_date, generated_at, path FROM reports ORDER BY report_date DESC LIMIT ?",
    )
    .all(limit);
}

/** Read one metadata value. */
export function getMeta(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;
}

/** Write one metadata value. */
export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

/** Enabled feeds whose last fetch failed. */
export function feedErrors(db, limit = 20) {
  return db
    .prepare(
      `SELECT title, xml_url, html_url, opml_group, last_error, last_fetch_at
         FROM feeds
        WHERE enabled = 1 AND last_error IS NOT NULL AND last_error <> ''
        ORDER BY last_fetch_at DESC
        LIMIT ?`,
    )
    .all(limit);
}

/** Count of enabled feeds. */
export function countEnabledFeeds(db) {
  return Number(db.prepare("SELECT COUNT(*) AS total FROM feeds WHERE enabled = 1").get()?.total ?? 0);
}

/** Pipeline counts for the status tool and panel. */
export function articleCounts(db) {
  const total = Number(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE discarded_at IS NULL").get()?.n ?? 0);
  const pendingContent = Number(
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE discarded_at IS NULL AND content_status = 'pending'").get()?.n ?? 0,
  );
  const pendingAi = Number(
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE discarded_at IS NULL AND ai_status = 'pending'").get()?.n ?? 0,
  );
  const dates = db
    .prepare(
      `SELECT published_date AS date, COUNT(*) AS n
         FROM articles
        WHERE discarded_at IS NULL GROUP BY published_date
        ORDER BY published_date DESC
        LIMIT 7`,
    )
    .all();
  return { total, pendingContent, pendingAi, dates };
}

/** Mark included articles as reported. */
export function markReported(db, ids, at) {
  if (ids.length === 0) return;
  const statement = db.prepare("UPDATE articles SET reported_at = ? WHERE id = ?");
  transaction(db, () => {
    for (const id of ids) statement.run(at, id);
  });
}

/** Close the database handle. */
export function closeDatabase(db) {
  try {
    db.close();
  } catch {
    /* an already closed handle needs no cleanup */
  }
}

/** Run a synchronous write transaction. */
function transaction(db, body) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = body();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* the original error is more useful */
    }
    throw error;
  }
}
