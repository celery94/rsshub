/**
 * Text helpers shared by the OPML, feed, readable-content, and report modules.
 * Everything here is pure and safe to use from a test harness.
 * @module rss-brief/text
 */

/** Common named entities, lower-cased. Unknown entities are left untouched. */
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  euro: "€",
  pound: "£",
  yen: "¥",
  sect: "§",
  para: "¶",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  zwj: "",
  zwnj: "",
  shy: "",
};

/**
 * Decode XML/HTML entities, including numeric and hex references. Runs at most
 * twice so double-encoded text such as `&amp;#39;` becomes an apostrophe.
 * @param value - raw text.
 * @returns decoded text.
 */
export function decodeEntities(value) {
  let text = String(value ?? "");
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    text = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, body) => {
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        changed = true;
        return String.fromCodePoint(code);
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      if (named === undefined) return match;
      changed = true;
      return named;
    });
    if (!changed) break;
  }
  return text;
}

/**
 * Normalize line endings, collapse horizontal whitespace, and bound blank runs.
 * @param value - text to normalize.
 * @returns normalized text.
 */
export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0\u2007\u202f]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert an HTML fragment into readable plain text with paragraph breaks.
 * Scripts, styles, and embedded documents are removed; entities are decoded.
 * @param value - HTML fragment.
 * @returns plain text.
 */
export function stripHtml(value) {
  if (typeof value !== "string" || value === "") return "";
  const text = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|li|ul|ol|h[1-6]|blockquote|tr|td|th|pre|figure|figcaption|table|dd|dt)\s*>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeEntities(text));
}

/**
 * Read one field as a single line and bound its length.
 * @param value - raw field value (may contain HTML).
 * @param max - maximum length; 0 means unbounded.
 * @returns trimmed one-line text.
 */
export function oneLine(value, max = 0) {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  return truncate(text, max);
}

/**
 * Bound text length with an ellipsis.
 * @param value - text to bound.
 * @param max - maximum length; 0 means unbounded.
 * @returns bounded text.
 */
export function truncate(value, max) {
  const text = String(value ?? "").trim();
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Escape Markdown-sensitive characters in a title or label.
 * @param value - raw text.
 * @returns one-line escaped text.
 */
export function escapeMarkdownText(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_[\]<>])/g, "\\$1")
    .trim();
}

/**
 * Clean an AI summary: drop control characters, collapse whitespace, trim
 * wrapping quotes, and bound the length.
 * @param value - model output.
 * @param max - maximum length.
 * @returns usable summary text.
 */
export function sanitizeSummary(value, max = 400) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
  return truncate(text, max);
}
