/**
 * Same-source replacements for public RSSHub demo routes that now refuse access.
 * Reads official public APIs / channel previews; no proxy, login, or challenge bypass.
 * The OPML URL remains the subscription identity for these three RSSHub routes.
 */
import { fetchText, parseDate, parseFeed } from "./feed.js";
import { decodeEntities, oneLine, stripHtml, truncate } from "./text.js";
import { parseAttributes } from "./xml.js";

const MATRIX_API = "https://sspai.com/api/v1/articles?offset=0&limit=20&is_matrix=1&sort=matrix_at&include_total=false";
const READHUB_API = "https://api.readhub.cn/daily";
const BAOYU_FEED = "https://baoyu.io/feed.xml";

/** Fetch and validate a feed, using a matching original-site adapter when needed. */
export async function fetchFeed(url, options = {}) {
  const { request = fetchText, limit = 20, ...http } = options;
  const address = new URL(url);
  const route = address.pathname.replace(/\/$/, "");
  if (address.hostname === "rsshub.app" && route === "/sspai/matrix") {
    const response = await request(MATRIX_API, http);
    if (response.notModified) return { response };
    const json = jsonOf(response.text, "Matrix");
    if (!Array.isArray(json.list)) throw new Error("Matrix 官方 API 格式改变：缺少 list");
    const warnings = [];
    const items = json.list.slice(0, limit).flatMap((item) => {
      const date = parseDate(item.released_at);
      if (!Number.isSafeInteger(Number(item.id)) || Number(item.id) <= 0 || !item.title || date === null) {
        warnings.push("Matrix 跳过缺少 ID、标题或有效发布时间的条目");
        return [];
      }
      const link = `https://sspai.com/post/${item.id}`;
      return [{ entryKey: link, guid: null, url: link, title: oneLine(item.title, 500),
        publishedAt: date.toISOString(), summary: truncate(stripHtml(item.summary ?? ""), 2000),
        author: oneLine(item.author?.nickname ?? "", 200) || null }];
    });
    return result(response, items, "sspai-matrix-api", warnings);
  }
  if (address.hostname === "rsshub.app" && route === "/readhub/daily") {
    const response = await request(READHUB_API, http);
    if (response.notModified) return { response };
    const json = jsonOf(response.text, "Readhub");
    if (!Array.isArray(json.data?.items)) throw new Error("Readhub 官方 API 格式改变：缺少 data.items");
    const candidates = json.data.items.slice(0, limit);
    const items = [];
    const warnings = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (next < candidates.length) {
        const candidate = candidates[next++];
        try {
          const uid = String(candidate.uid ?? "");
          if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error("条目 UID 无效");
          // The daily list has no dates. Never substitute today's date for a failed detail.
          const detailResponse = await request(`https://api.readhub.cn/topic/detail?uid=${encodeURIComponent(uid)}`, {
            ...http, headers: { accept: "application/json" },
          });
          const detail = jsonOf(detailResponse.text, "Readhub 详情").data?.items;
          const topic = Array.isArray(detail) ? detail.find((entry) => entry.uid === uid) : undefined;
          const date = parseDate(topic?.publishDate);
          if (!topic?.title || date === null) throw new Error("详情缺少匹配主题或有效 publishDate");
          const key = `readhub-${uid}`;
          items.push({ entryKey: key, guid: key, url: `https://readhub.cn/topic/${uid}`,
            title: oneLine(topic.title, 500), publishedAt: date.toISOString(),
            author: oneLine(topic.siteNameDisplay ?? "Readhub", 200),
            summary: truncate(stripHtml(topic.summary ?? candidate.summary ?? ""), 2000) });
        } catch (error) {
          if (http.signal?.aborted) throw http.signal.reason ?? error;
          warnings.push(`Readhub ${oneLine(String(candidate.uid ?? "?"), 60)} 详情失败：${error.message}`);
        }
      }
    }));
    if (candidates.length > 0 && items.length === 0) throw new Error(warnings[0] ?? "Readhub 所有条目详情均失败");
    return result(response, items, "readhub-daily-api", warnings);
  }
  const telegram = address.hostname === "rsshub.app" ? /^\/telegram\/channel\/([a-zA-Z][a-zA-Z0-9_]{4,31})$/.exec(route) : null;
  if (telegram !== null) {
    const channel = telegram[1];
    const response = await request(`https://t.me/s/${channel}`, http);
    if (response.notModified) return { response };
    const parsed = parseTelegramPreview(response.text, channel);
    if (parsed.items.length === 0) throw new Error("Telegram 公开预览未包含可读取的消息；频道可能不可用或页面格式改变");
    return result(response, parsed.items.slice(0, limit), "telegram-public-preview", parsed.warnings);
  }
  const isBaoyuBlog = (address.hostname === "rsshub.app" && route === "/baoyu/blog") ||
    (["baoyu.io", "s.baoyu.io"].includes(address.hostname) && route === "/feed.xml");
  const response = await request(isBaoyuBlog ? BAOYU_FEED : url, http);
  if (response.notModified) return { response };
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(response.text.slice(0, 3000))) {
    throw new Error("响应不是 RSS/Atom 文档，不能作为空订阅成功处理");
  }
  const parsed = parseFeed(response.text, response.url || url);
  // Preserve the original /baoyu/blog scope; the official feed also contains translations.
  if (isBaoyuBlog) parsed.items = parsed.items.filter((item) => {
    try { const link = new URL(item.url); return link.hostname === "baoyu.io" && link.pathname.startsWith("/blog/"); }
    catch { return false; }
  });
  return { response, parsed, source: isBaoyuBlog ? "baoyu-official-blog" : "rss", warnings: [] };
}

/** Parse public Telegram messages without using counts/preview dates as article dates. */
export function parseTelegramPreview(html, channel) {
  const openings = [...String(html).matchAll(/<div\b([^>]*\bdata-post\s*=\s*["'][^"']+["'][^>]*)>/gi)]
    .map((match) => ({ start: match.index, end: match.index + match[0].length, attrs: parseAttributes(match[1]) }));
  const items = [];
  const warnings = [];
  const seen = new Set();
  for (let index = 0; index < openings.length; index += 1) {
    const message = openings[index];
    const post = message.attrs["data-post"] ?? "";
    if (!post.startsWith(`${channel}/`) || !/^\d+$/.test(post.slice(channel.length + 1)) || seen.has(post)) continue;
    const chunk = html.slice(message.end, openings[index + 1]?.start ?? html.length);
    const body = classFragment(chunk, "tgme_widget_message_text");
    if (body === null) continue;
    const dateLink = classFragment(chunk, "tgme_widget_message_date");
    const date = parseDate(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)/i.exec(dateLink ?? "")?.[1]);
    if (date === null) { warnings.push(`Telegram ${post} 缺少有效发布时间`); continue; }
    const text = stripHtml(body);
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const headline = /^(BBC(?: Chinese)?)$/i.test(lines[0] ?? "") ? lines[1] : lines[0];
    const title = oneLine(headline || classFragment(chunk, "link_preview_title") || text, 500);
    if (!title) continue;
    const source = /<a\b([^>]+)>\s*原文链接\s*<\/a>/i.exec(body);
    const original = source ? parseAttributes(source[1]).href : null;
    const link = httpUrl(original) ?? `https://t.me/${post}`;
    seen.add(post);
    items.push({ entryKey: `https://t.me/${post}`, guid: `https://t.me/${post}`, url: link,
      title, author: channel, publishedAt: date.toISOString(), summary: truncate(text, 2000) });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { items, warnings };
}

/** Extract an element's inner HTML by class, handling nested elements of the same tag. */
function classFragment(html, className) {
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*\bclass\s*=\s*["'][^"']*["'][^>]*)>/gi)) {
    const attrs = parseAttributes(match[2]);
    if (!(attrs.class ?? "").split(/\s+/).includes(className)) continue;
    const start = match.index + match[0].length;
    const tokens = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, "gi");
    tokens.lastIndex = start;
    let depth = 1;
    let token;
    while ((token = tokens.exec(html)) !== null) {
      if (token[0].startsWith("</")) depth -= 1;
      else if (!token[0].endsWith("/>")) depth += 1;
      if (depth === 0) return html.slice(start, token.index);
    }
    return null;
  }
  return null;
}

function jsonOf(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} 返回的不是 JSON`); }
}
function result(response, items, format, warnings = []) {
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { response, parsed: { format, items }, source: format, warnings };
}
function httpUrl(value) {
  try { const url = new URL(decodeEntities(value ?? "")); return /^https?:$/.test(url.protocol) ? url.href : null; }
  catch { return null; }
}
