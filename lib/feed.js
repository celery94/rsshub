/**
 * RSS 2.0, Atom, and RSS 1.0/RDF reader plus the shared HTTP text fetcher.
 * Parsing is deliberately tolerant: one malformed field never fails a feed.
 * @module rss-brief/feed
 */

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { decodeEntities, oneLine, stripHtml, truncate } from "./text.js";
import { collectBlocks, collectTagAttributes, parseAttributes, readElement } from "./xml.js";

/** Identification sent to feed servers and article pages. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) DeepSeekHarnessRSS/1.0";

/** Retain at most 512 Ki JavaScript characters per original feed body. */
export const MAX_FEED_CONTENT_CHARS = 512 * 1024;

/** A non-success HTTP response. */
export class HttpError extends Error {
  /**
   * @param status - HTTP status code.
   * @param url - requested URL.
   */
  constructor(status, url, details = {}) {
    const suffix = details.reason ? `：${details.reason}` : "";
    const redirect = details.finalUrl && details.finalUrl !== url ? `（最终地址：${details.finalUrl}）` : "";
    super(`HTTP ${status}${suffix}${redirect}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.finalUrl = details.finalUrl || url;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.reason = details.reason ?? "";
  }
}

/**
 * Parse one feed document.
 * @param xml - feed XML.
 * @param feedUrl - feed URL used to resolve relative article links.
 * @returns parsed items, newest first, and the detected format.
 */
export function parseFeed(xml, feedUrl) {
  const source = String(xml ?? "").replace(/^\uFEFF/, "");
  let blocks = collectBlocks(source, "item");
  let format = "rss";
  if (blocks.length === 0) {
    blocks = collectBlocks(source, "entry");
    format = "atom";
  }
  const items = [];
  const seen = new Set();
  for (const block of blocks) {
    const body = block.body;
    const attributes = parseAttributes(block.attributes);
    const guid = firstText([
      readElement(body, ["guid", "id"]),
      attributes["rdf:about"],
      attributes["rdf:resource"],
    ]);
    // Element text keeps XML entities (`&amp;` in query strings); attributes are already decoded.
    const rawLink = atomLink(body) ?? decodeEntities(firstText([
      readElement(body, ["link", "url"]),
      guid,
    ]));
    const link = resolveHttp(rawLink, feedUrl);
    const title =
      oneLine(readElement(body, ["title"]), 500) ||
      truncate(oneLine(link ?? ""), 120) ||
      "(无标题)";
    const published = parseDate(
      firstText([readElement(body, ["pubDate", "published", "updated", "dc:date", "date", "issued", "created"])]),
    );
    const summaryRaw = readElement(body, ["description", "summary", "dc:description", "itunes:summary"]) ?? "";
    const contentRaw = readElement(body, ["content:encoded", "content", "body"]);
    const hasFullContent = contentRaw !== null;
    // Keep the original markup separately from the short list/AI summary.
    // readElement unwraps CDATA but otherwise leaves inner XML untouched.
    const feedContent = hasFullContent ? contentRaw : summaryRaw;
    const summary = truncate(stripHtml(summaryRaw) || stripHtml(contentRaw), 2000);
    const author = authorOf(readElement(body, ["dc:creator", "creator", "author", "name"]));
    const key = guid !== "" ? guid : link ?? "";
    const entryKey = key !== ""
      ? key
      : `hash:${createHash("sha256").update(`${title}|${published?.toISOString() ?? ""}`).digest("hex")}`;
    if (seen.has(entryKey)) continue;
    seen.add(entryKey);
    items.push({
      entryKey: truncate(entryKey, 1000),
      guid: guid === "" ? null : truncate(guid, 1000),
      url: link,
      title,
      author,
      publishedAt: published === null ? null : published.toISOString(),
      summary,
      feedContentHtml: feedContent.slice(0, MAX_FEED_CONTENT_CHARS),
      feedContentKind: hasFullContent ? "full" : "description",
      feedContentBaseUrl: link ?? feedUrl,
      feedContentTruncated: feedContent.length > MAX_FEED_CONTENT_CHARS,
    });
  }
  items.sort((left, right) => timeOf(right.publishedAt) - timeOf(left.publishedAt));
  return { format, items };
}

/**
 * Parse a feed date from RFC 822, ISO 8601, or a Unix timestamp.
 * Dates more than two days in the future are treated as absent.
 * @param raw - date text.
 * @returns the date, or null.
 */
export function parseDate(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  if (/^\d{10,13}$/.test(text)) {
    const value = Number(text);
    return validDate(new Date(text.length >= 13 ? value : value * 1000));
  }
  return validDate(new Date(text));
}

/**
 * Fetch a text resource with a deadline, byte cap, and optional validators.
 * @param url - absolute URL.
 * @param options - headers, timeout, byte cap, caller signal, and user agent.
 * @returns status, decoded text, and cache validators.
 */
export async function fetchText(url, options = {}) {
  const retries = Number.isInteger(options.retries) ? Math.max(0, Math.min(2, options.retries)) : 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchTextAttempt(url, options);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      const transient = error instanceof HttpError
        ? [408, 429, 500, 502, 503, 504].includes(error.status)
        : error?.name === "TimeoutError" ||
          (error instanceof TypeError && error.message === "terminated") ||
          ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "Z_BUF_ERROR", "Z_DATA_ERROR"].includes(error?.cause?.code);
      if (attempt >= retries || !transient) {
        if (error instanceof TypeError && error.message === "terminated") {
          throw new Error(`响应体传输中断${error.cause?.code ? `（${error.cause.code}）` : ""}`, { cause: error });
        }
        throw error;
      }
      const waitMs = error.retryAfterMs ?? (options.retryDelayMs ?? 750) * (attempt + 1);
      // Never ignore a server's longer Retry-After or block the scheduler on it.
      if (waitMs > 5000) throw error;
      await delay(Math.max(0, waitMs), undefined, { signal: options.signal });
    }
  }
}

/** One bounded HTTP attempt; only transient failures are retried by the caller. */
async function fetchTextAttempt(url, options) {
  const {
    headers = {},
    timeoutMs = 20000,
    maxBytes = 5 * 1024 * 1024,
    signal,
    userAgent = DEFAULT_USER_AGENT,
  } = options;
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal !== undefined) signals.push(signal);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.any(signals),
    headers: {
      "user-agent": userAgent,
      accept: "*/*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...headers,
    },
  });
  const etag = response.headers.get("etag") ?? "";
  const lastModified = response.headers.get("last-modified") ?? "";
  if (response.status === 304) {
    return { status: 304, notModified: true, text: "", etag, lastModified, contentType: "", url: response.url };
  }
  if (!response.ok) {
    let excerpt = "";
    try {
      excerpt = decodeBuffer(await readLimited(response, 8192), response.headers.get("content-type") ?? "");
    } catch {
      // Headers still identify a challenge even when its body cannot be read.
    }
    let reason = "";
    if (response.headers.get("cf-mitigated") === "challenge" || /<title>\s*Just a moment/i.test(excerpt)) {
      reason = "Cloudflare 人机验证，普通 RSS 请求无法通过";
    } else if (/restrict access to rsshub\.app|rsshub\.app is intended for testing/i.test(excerpt)) {
      reason = "RSSHub 公共演示实例限制访问；需要官方源或自建实例";
    } else if (response.status === 404) {
      reason = "订阅地址不存在或服务未提供该路由";
    } else if ([502, 503, 504].includes(response.status)) {
      reason = "上游服务或网关暂时不可用";
    }
    const retryAfter = response.headers.get("retry-after");
    const retryAt = Date.parse(retryAfter ?? "");
    const retryAfterMs = retryAfter === null ? null
      : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000
      : Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
    throw new HttpError(response.status, url, { finalUrl: response.url, reason, retryAfterMs });
  }
  const buffer = await readLimited(response, maxBytes);
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    notModified: false,
    text: decodeBuffer(buffer, contentType),
    etag,
    lastModified,
    contentType,
    url: response.url,
  };
}

/**
 * Decode bytes using the response charset, the XML declaration, or a meta tag.
 * @param buffer - response bytes.
 * @param contentType - response content type.
 * @returns decoded text.
 */
export function decodeBuffer(buffer, contentType = "") {
  let label = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1];
  if (label === undefined) {
    // Some legacy GBK pages put the charset meta after several KB of inline scripts.
    const head = Buffer.from(buffer.subarray(0, 16384)).toString("latin1");
    label =
      /<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i.exec(head)?.[1] ??
      /<meta[^>]*charset\s*=\s*["']?([^"'\s/>]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * Read a complete response within `maxBytes`; never return cacheable truncated XML.
 * @param response - successful fetch response.
 * @param maxBytes - byte cap.
 * @returns body bytes.
 */
export async function readLimited(response, maxBytes) {
  if (response.body === null) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`响应超过大小上限（${maxBytes} 字节）`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (total + chunk.length > maxBytes) {
        throw new Error(`响应超过大小上限（${maxBytes} 字节）`);
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* an already closed stream needs no cancellation */
    }
  }
  return Buffer.concat(chunks);
}

/** Resolve an article link against the feed URL, accepting only http(s). */
function resolveHttp(raw, base) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  try {
    const url = new URL(text, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Pick the alternate Atom link, then any link with an href. */
function atomLink(body) {
  const links = collectTagAttributes(body, "link").filter((entry) => typeof entry.href === "string" && entry.href !== "");
  const alternate =
    links.find((entry) => String(entry.rel ?? "").toLowerCase() === "alternate") ??
    links.find((entry) => entry.rel === undefined || entry.rel === "");
  if (alternate !== undefined) return alternate.href;
  if (links.length > 0) return links[0].href;
  const text = readElement(body, ["link"]);
  return text === null ? null : decodeEntities(text);
}

/** Normalize an author element, including Atom's nested `<name>`. */
function authorOf(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const name = readElement(raw, ["name"]);
  const text = oneLine(name ?? raw, 200);
  return text === "" ? null : text;
}

/** First trimmed non-empty value. */
function firstText(values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text !== "") return text;
  }
  return "";
}

/** Numeric time for sorting, with missing dates last. */
function timeOf(value) {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? 0 : time;
}

/** Reject invalid and far-future dates. */
function validDate(date) {
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) return null;
  return date;
}
