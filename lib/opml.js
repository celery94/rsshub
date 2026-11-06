/**
 * OPML reader for the Folo export. It walks `<outline>` nesting to attach each
 * feed to its nearest named group and ignores duplicate `xmlUrl` entries.
 * @module rss-brief/opml
 */

import { JSDOM } from "jsdom";

const label = (value, limit) => String(value).replace(/\s+/gu, " ").trim().slice(0, limit);

/**
 * Parse an OPML document into feed records.
 * @param xml - OPML text.
 * @returns feeds in document order, deduplicated by URL.
 */
export function parseOpml(xml) {
  const feeds = [];
  const seen = new Set();
  const dom = new JSDOM(String(xml ?? ""), { contentType: "text/xml" });
  try {
    const doc = dom.window.document;
    if (doc.documentElement?.tagName !== "opml" || doc.querySelectorAll("opml > body").length !== 1 || doc.doctype) throw new Error("OPML XML 格式无效");
    for (const node of doc.querySelectorAll("body outline[xmlUrl]")) {
      const xmlUrl = normalizeHttp(node.getAttribute("xmlUrl"));
      if (!xmlUrl || seen.has(xmlUrl)) continue;
      seen.add(xmlUrl);
      const stack = [];
      for (let parent = node.parentElement; parent?.tagName === "outline"; parent = parent.parentElement) {
        stack.unshift(parent.hasAttribute("xmlUrl") ? null : label(parent.getAttribute("title") || parent.getAttribute("text") || "", 120));
      }
      feeds.push({ xmlUrl, title: label(node.getAttribute("title") || node.getAttribute("text") || hostOf(xmlUrl), 300),
        htmlUrl: normalizeHttp(node.getAttribute("htmlUrl")), group: groupOf(stack) });
    }
    return feeds;
  } finally { dom.window.close(); }
}

/**
 * The nearest named ancestor group.
 * @param stack - active outline labels, bottom first.
 * @returns the group label, or `未分组`.
 */
function groupOf(stack) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const value = stack[index];
    if (typeof value === "string" && value !== "") return value;
  }
  return "未分组";
}

/**
 * Normalize a URL to absolute http(s), or return an empty string.
 * @param value - candidate URL.
 * @returns normalized URL or "".
 */
function normalizeHttp(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Best-effort host name for an unlabeled feed. */
function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
