/**
 * Minimal, namespace-tolerant XML helpers for OPML and RSS/Atom documents.
 * These are intentionally not a general XML parser: feeds are treated as
 * well-formed enough for local-name extraction, and malformed input degrades
 * to "no field" instead of throwing.
 * @module rss-brief/xml
 */

import { decodeEntities } from "./text.js";

/**
 * Escape a string for interpolation into a regular expression.
 * @param value - literal text.
 * @returns escaped text.
 */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse XML attributes into a plain record. Values are entity-decoded.
 * @param source - attribute source inside a start tag.
 * @returns attribute map.
 */
export function parseAttributes(source) {
  const attributes = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(String(source ?? "")))) {
    attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/**
 * Remove one surrounding CDATA section, when present.
 * @param value - element content.
 * @returns raw text without CDATA markers.
 */
export function unwrapCdata(value) {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(String(value ?? ""));
  return match ? match[1] : String(value ?? "");
}

/**
 * Read the first non-empty element among several local names.
 * @param body - enclosing item/entry body.
 * @param names - candidate element names, in priority order.
 * @returns raw element content, or null.
 */
export function readElement(body, names) {
  const source = String(body ?? "");
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i");
    const match = re.exec(source);
    if (match) return unwrapCdata(match[1]);
  }
  return null;
}

/**
 * Collect every element with one local name, exposing its attributes and body.
 * @param xml - document text.
 * @param tag - local element name.
 * @returns blocks in document order.
 */
export function collectBlocks(xml, tag) {
  const escaped = escapeRegExp(tag);
  const re = new RegExp(`<${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/${escaped}\\s*>`, "gi");
  const blocks = [];
  let match;
  while ((match = re.exec(String(xml ?? "")))) {
    blocks.push({ attributes: match[1], body: match[2] });
  }
  return blocks;
}

/**
 * Collect the attributes of every start or self-closing tag with one name.
 * @param body - document or fragment text.
 * @param tag - local element name.
 * @returns parsed attribute maps in document order.
 */
export function collectTagAttributes(body, tag) {
  const escaped = escapeRegExp(tag);
  const re = new RegExp(`<${escaped}\\b([^>]*?)\\/?>`, "gi");
  const tags = [];
  let match;
  while ((match = re.exec(String(body ?? "")))) {
    tags.push(parseAttributes(match[1]));
  }
  return tags;
}
