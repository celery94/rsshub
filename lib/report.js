/**
 * Daily report shaping and Markdown rendering. The report is the only place
 * that turns database rows into user-visible prose, so the panel and the file
 * always share one payload.
 * @module rss-brief/report
 */

import { CATEGORY_IDS, CATEGORY_LABELS, normalizeCategory } from "./categories.js";
import { ASSESSMENT_VERSION } from "./ai.js";
import { TOPIC_TAGS, FORMAT_TAGS } from "./tags.js";
import { escapeMarkdownText, sanitizeSummary } from "./text.js";
import { formatLocalDateTime, formatLocalTime } from "./time.js";

/**
 * Group included articles by category in report order.
 * @param articles - articles with `category`, `relevance`, `publishedAt`.
 * @returns non-empty groups.
 */
export function groupArticles(articles) {
  const buckets = new Map(CATEGORY_IDS.map((id) => [id, []]));
  for (const article of articles) {
    buckets.get(normalizeCategory(article.category)).push(article);
  }
  return CATEGORY_IDS.filter((id) => buckets.get(id).length > 0).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    items: [...buckets.get(id)].sort(compareArticles),
  }));
}

/**
 * Group articles by their OPML group, used when AI summaries are unavailable.
 * @param articles - articles with `opmlGroup`.
 * @returns non-empty groups in label order.
 */
export function fallbackGroups(articles) {
  const buckets = new Map();
  for (const article of articles) {
    const label = article.opmlGroup || "未分组";
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(article);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([label, items]) => ({
      id: `opml:${label}`,
      label,
      items: [...items].sort(compareArticles),
    }));
}

/**
 * Build the exact article shape the report and the panel consume.
 * @param row - joined article/feed database row.
 * @returns display article.
 */
export function toReportArticle(row, { highQualityThreshold = 60 } = {}) {
  const discarded = Boolean(row.discarded_at);
  const score = !discarded && row.assessment_score != null && Number.isInteger(row.assessment_score) ? row.assessment_score : null;
  const stale = score !== null && (row.assessment_fingerprint !== row.assessment_current_fingerprint || row.assessment_version !== ASSESSMENT_VERSION);
  let dimensions = null;
  try { dimensions = row.assessment_dimensions_json ? JSON.parse(row.assessment_dimensions_json) : null; } catch { /* legacy or corrupt data */ }
  const provisional = score !== null && Boolean(row.assessment_provisional);
  const assessment = {
    status: discarded ? "discarded" : row.assessment_status ?? "pending", score,
    discarded, discardedAt: row.discarded_at ?? null, discardReason: row.discard_reason ?? null, contentType: row.content_type ?? null,
    recommendation: score === null ? "pending" : score >= 80 ? "recommended" : score >= 60 ? "optional" : "skip",
    reason: row.assessment_reason ?? null, dimensions,
    minutes: row.assessment_minutes ?? null, provisional, basis: row.assessment_basis ?? null,
    model: row.assessment_model ?? null, analyzedAt: row.assessment_at ?? null, stale,
    highQuality: score !== null && score >= Math.max(60, highQualityThreshold) && !provisional && !stale && row.assessment_basis === "full",
    error: row.assessment_error ?? null,
  };
  let tags = [];
  if (!discarded) {
    try { tags = row.tags_json ? JSON.parse(row.tags_json) : []; } catch { /* legacy rows have no tags */ }
  }
  return {
    id: row.id,
    tags,
    topics: tags.filter((tag) => TOPIC_TAGS.includes(tag)),
    format: tags.find((tag) => FORMAT_TAGS.includes(tag)) ?? null,
    title: row.title,
    url: row.url,
    feedId: row.feed_id,
    feed: row.feed_title || row.feed_url,
    feedUrl: row.feed_html_url || row.feed_url,
    publishedAt: row.published_at,
    publishedDate: row.published_date,
    category: row.assessment_category || row.category,
    relevance: row.assessment_relevance ?? (row.relevance != null && Number.isFinite(Number(row.relevance)) ? Number(row.relevance) : null),
    summary: sanitizeSummary(row.assessment_summary || row.summary_zh || row.feed_summary || "", 300),
    assessment,
    opmlGroup: row.opml_group || "未分组",
  };
}

/**
 * Render the Markdown report from a payload.
 * @param payload - report payload produced for one date.
 * @param timeZone - IANA zone used for clock times.
 * @returns Markdown text.
 */
export function renderMarkdown(payload, timeZone) {
  const lines = [`# RSS 日报 · ${payload.date}`, ""];
  const stats = payload.stats ?? {};
  const summary = [];
  if (stats.feeds) summary.push(`${stats.feeds} 个订阅源`);
  if (stats.newArticles !== undefined) summary.push(`新增 ${stats.newArticles} 篇`);
  if (stats.included !== undefined) summary.push(`入选 ${stats.included} 篇`);
  if (payload.model) summary.push(`由 ${payload.model} 生成`);
  if (payload.generatedAt) summary.push(`生成于 ${formatLocalDateTime(payload.generatedAt, timeZone)}`);
  if (summary.length > 0) lines.push(`> ${summary.join(" · ")}`, "");

  if (payload.fallback) {
    lines.push("> ⚠ AI 摘要不可用，以下按 OPML 分组展示订阅源摘要。", "");
  }
  for (const warning of payload.warnings ?? []) {
    lines.push(`> ⚠ ${warning}`, "");
  }

  const groups = payload.groups ?? [];
  for (const group of groups) {
    lines.push(`## ${group.label}（${group.items.length}）`, "");
    for (const item of group.items) {
      const title = escapeMarkdownText(item.title);
      const url = String(item.url ?? "").replace(/[<>]/g, encodeURIComponent);
      const meta = [item.feed, formatLocalTime(item.publishedAt, timeZone), item.relevance === null ? "" : `相关度 ${item.relevance}`]
        .filter((part) => part !== "")
        .join(" · ");
      lines.push(`- **[${title}](<${url}>)**${meta === "" ? "" : ` — ${meta}`}`);
      if (item.summary) lines.push(`  ${sanitizeSummary(item.summary, 300)}`);
      lines.push("");
    }
  }
  if (groups.length === 0) {
    lines.push("当天没有符合条件的新文章。", "");
  }

  const failures = payload.feedErrors ?? [];
  if (failures.length > 0) {
    lines.push("## 抓取异常", "");
    for (const failure of failures) {
      const label = escapeMarkdownText(failure.title || failure.url || "未知源");
      const reason = escapeMarkdownText(failure.error || "未知错误");
      lines.push(`- ${label}：${reason}`);
    }
    lines.push("");
  }

  lines.push("---", `生成工具：RSS 日报插件（${payload.timeZone ?? timeZone}）`, "");
  return lines.join("\n");
}

/** Relevance first, then recency, then title. */
function compareArticles(left, right) {
  const leftRelevance = Number.isFinite(left.relevance) ? left.relevance : -1;
  const rightRelevance = Number.isFinite(right.relevance) ? right.relevance : -1;
  if (rightRelevance !== leftRelevance) return rightRelevance - leftRelevance;
  const byDate = String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
  if (byDate !== 0) return byDate;
  return String(left.title ?? "").localeCompare(String(right.title ?? ""), "zh-CN");
}
