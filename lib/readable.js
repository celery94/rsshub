/**
 * Extract article bodies into a bounded, inert JSON tree. Readability selects
 * content; only the allowlist traversal below decides what may be rendered.
 * @module rss-brief/readable
 */
import { Buffer } from "node:buffer";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export const EXTRACTOR_VERSION = 3;

const LIMITS = { maxTextLength: 60000, maxDocumentBytes: 1024 * 1024, maxNodes: 10000, maxDepth: 32 };
const TYPES = new Set("p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code table thead tbody tr th td strong em a img figure figcaption br hr video".split(" "));
const BLOCKS = new Set("p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre table thead tbody tr figure figcaption".split(" "));
const ALIASES = { b: "strong", i: "em", dl: "ul", dd: "li", dt: "p" };
const DROP = "script,style,noscript,template,nav,footer,aside,form,input,button,select,textarea,frame,frameset,object,embed,svg,math,canvas,audio,track,link,meta,base";
// Known players keep their iframe through Readability; cleanPage removes every other iframe.
const VIDEO_HOSTS = /\/\/(?:player\.bilibili\.com|(?:www\.)?youtube(?:-nocookie)?\.com\/embed|player\.vimeo\.com|v\.qq\.com|player\.youku\.com)\//i;
const NOISE = /(?:^|[\s_-])(?:nav|navigation|menu|footer|sidebar|breadcrumbs?|cookie-banner|cookie-consent|share-buttons|social-share|related-posts|related-articles|related-content|comments|newsletter-signup|advertisement)(?:$|[\s_-])/i;
const CHALLENGE = /checking your browser|verify (?:that )?you(?:'re| are) (?:a )?human|enable javascript and cookies to continue|performing security verification|complete (?:the |a )?(?:security check|captcha)|请完成.{0,8}(?:验证|验证码)|验证您是人类/i;
const BLOCKED_TITLE = /^(?:just a moment\b|attention required\b|access denied\b|security check\b|checking your browser\b|robot check\b|captcha(?: challenge)?(?:\s*[|–—-]|\s*[.!?]*$)|verify (?:that )?you|sign[ -]?in(?:\s*[|–—-]|\s*[.!?]*$)|log[ -]?in(?:\s*[|–—-]|\s*[.!?]*$)|登录(?:页面)?(?:\s*[|–—-]|\s*[.!?]*$)|请登录|安全验证|人机验证)/i;

/**
 * @param {string} html Page HTML; scripts and external resources never run.
 * @param {object} [options] url is the final response URL. allowMailto defaults
 * to false. maxTextLength/maxDocumentBytes/maxNodes/maxDepth may lower hard caps.
 * @returns {{text:string,title:string|null,document:object,truncated:boolean,quality:object,extractorVersion:number}}
 * Empty/unusable pages have an empty document and quality.usable === false.
 */
export function extractReadable(html, options = {}) {
  const settings = limits(options);
  const dom = createDom(html, options.url);
  try {
    const page = dom.window.document;
    const title = cleanLabel(page.title, 500) || null;
    const blocked = blockedPage(page);
    if (blocked) return emptyResult(title, blocked);
    cleanPage(page);
    const semantic = semanticCandidate(page);
    let article = null;
    try {
      // Readability mutates its input. The original remains available for a
      // short semantic article that Readability decides not to select.
      article = new Readability(page.cloneNode(true), { charThreshold: 0, keepClasses: false, allowedVideoRegex: VIDEO_HOSTS }).parse();
    } catch {
      // Broken markup can defeat selection; only semantic fallback is allowed.
    }
    if (article?.content) {
      const fragment = page.createElement("template");
      fragment.innerHTML = article.content;
      cleanPage(fragment.content);
      const document = convert(fragment.content, options, settings);
      const text = contentDocumentText(document);
      const semanticText = semantic ? visibleText(semantic) : "";
      const matchesSemantic = semanticText.length >= 20 && text.includes(semanticText.slice(0, Math.min(60, semanticText.length)));
      const quality = assess(document, text, matchesSemantic, "readability");
      if (quality.usable) {
        return result(document, title || cleanLabel(article.title, 500) || null, quality, settings, {
          byline: cleanLabel(article.byline, 500) || null,
          excerpt: cleanLabel(article.excerpt, 1000) || null,
          lang: cleanLabel(article.lang || page.documentElement.lang, 80) || null,
        });
      }
    }
    if (semantic) {
      const document = convert(semantic, options, settings);
      const quality = assess(document, contentDocumentText(document), true, "semantic");
      if (quality.usable) return result(document, title, quality, settings);
    }
    return emptyResult(title, "no-usable-article");
  } finally {
    dom.window.close();
  }
}

/**
 * Convert already-selected feed HTML without running Readability. Returns the
 * document directly: {version:1,children:[allowlisted nodes],truncated:boolean}.
 * URLs use options.url; unsupported/active content is discarded, never emitted.
 */
export function buildContentDocument(html, options = {}) {
  const dom = createDom(html, options.url);
  try {
    const body = dom.window.document.body;
    // Atom type="html" can store an entirely entity-escaped fragment. Decode
    // through an inert DOM once, and still sanitize everything after parsing.
    const decoded = body.textContent;
    if (body.children.length === 0 && /^\s*<(?:p|h[1-6]|div|section|article|main|blockquote|ul|ol|li|pre|code|table|figure|img|a|strong|em|br|hr)\b/i.test(decoded)) {
      body.innerHTML = decoded;
    }
    cleanPage(body);
    return convert(body, options, limits(options));
  } finally {
    dom.window.close();
  }
}

/** Read the text of a content document, preserving pre/code whitespace. */
export function contentDocumentText(document) {
  return renderDocumentText(document).slice(0, LIMITS.maxTextLength);
}

function renderDocumentText(document) {
  function render(node) {
    if (node.type === "text") return typeof node.text === "string" ? node.text : "";
    const inner = (node.children || []).map(render).join("");
    if (node.type === "br") return "\n";
    if (node.type === "hr") return "\u0000";
    if (node.type === "video") return `\u0000[视频：${node.provider} ${node.url}]\u0000`;
    if (node.type === "td" || node.type === "th") return `${inner}\t`;
    if (BLOCKS.has(node.type)) return `\u0000${inner}\u0000`;
    return inner;
  }
  // Generated block separators are distinct from actual code newlines, so a
  // code block's leading/trailing blank lines and indentation survive intact.
  return (document?.children || []).map(render).join("")
    .replace(/^\u0000+|\u0000+$/g, "").replace(/\u0000(?:[ \t]*\u0000)*/g, "\n\n");
}

/** Whether a response content type can hold an article page. */
export function isHtmlContentType(contentType) {
  return /(?:text\/html|application\/xhtml\+xml|application\/xml|text\/xml)/i.test(String(contentType ?? ""));
}

function createDom(html, url) {
  const base = safeUrl(url, undefined, false);
  // Do not enable runScripts or resources, even for apparently trusted feeds.
  return new JSDOM(String(html ?? ""), base ? { url: base } : {});
}

function limits(options) {
  const settings = {};
  for (const [key, maximum] of Object.entries(LIMITS)) {
    const value = Number(options[key]);
    const minimum = key === "maxDocumentBytes" ? 128 : 1;
    settings[key] = Number.isFinite(value) && value > 0 ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : maximum;
  }
  return settings;
}

function cleanLabel(value, maximum) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function visibleText(node) {
  return cleanLabel(node?.textContent, 100000);
}

function blockedPage(page) {
  const title = cleanLabel(page.title, 500);
  const body = visibleText(page.body);
  const password = page.querySelector('input[type="password"]');
  const semantic = page.querySelector("article");
  const substantive = semantic && visibleText(semantic).length >= 200;
  if (BLOCKED_TITLE.test(title) && (!substantive || password)) return "challenge-or-login";
  if (password && !substantive) return "login-form";
  // A mention of CAPTCHA in a technical article is not itself a challenge.
  if (body.length < 1500 && CHALLENGE.test(body) && (!semantic || visibleText(semantic).length < 200)) return "challenge-page";
  const heading = cleanLabel(page.querySelector("h1,h2")?.textContent, 300);
  if (body.length < 800 && BLOCKED_TITLE.test(heading) && (!substantive || password)) return "challenge-or-login";
  return null;
}

function cleanPage(root) {
  if (!root) return;
  for (const node of root.querySelectorAll(DROP)) node.remove();
  for (const node of root.querySelectorAll("iframe")) {
    if (!VIDEO_HOSTS.test(protocolRelative(node.getAttribute("src")))) node.remove();
  }
  for (const node of root.querySelectorAll("*")) {
    const style = node.getAttribute("style") || "";
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true"
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style)
      || NOISE.test(`${node.id} ${node.className || ""}`)) {
      node.remove();
    } else if (node.localName === "header" && !node.closest("article,main,[role='main']")) {
      node.remove();
    }
  }
}

function semanticCandidate(page) {
  let best = null;
  let bestScore = 0;
  for (const node of page.querySelectorAll("article,main,[role='main']")) {
    const text = visibleText(node);
    const links = Array.from(node.querySelectorAll("a")).reduce((sum, link) => sum + visibleText(link).length, 0);
    const score = (text.length - links * 2) * (node.localName === "article" ? 1.25 : 1);
    if (score > bestScore) { bestScore = score; best = node; }
  }
  return best;
}

function safeUrl(value, base, allowMailto) {
  const raw = String(value ?? "").trim();
  if (!raw || /[\u0000-\u0020\u007f]/.test(raw) || raw.length > 4096) return null;
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:" && !(allowMailto && url.protocol === "mailto:")) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function protocolRelative(value) {
  const raw = String(value ?? "").trim();
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

/** Map an embedded player or native video to a watch link; unknown media yields null. */
function videoSource(node, base) {
  if (node.localName === "video") {
    const candidates = [node.getAttribute("src"), ...Array.from(node.querySelectorAll("source"), (source) => source.getAttribute("src"))];
    const url = candidates.map((candidate) => safeUrl(candidate, base, false)).find(Boolean);
    if (!url) return null;
    const poster = safeUrl(node.getAttribute("poster"), base, false);
    return { provider: "native", url, ...(poster ? { poster } : {}) };
  }
  const src = safeUrl(protocolRelative(node.getAttribute("src")), base, false);
  if (!src) return null;
  const url = new URL(src);
  const host = url.hostname.replace(/^www\./, "");
  const param = (name, pattern) => (pattern.test(url.searchParams.get(name) || "") ? url.searchParams.get(name) : null);
  const path = (pattern) => (url.pathname.match(pattern) || [])[1];
  let video = null;
  if (host === "player.bilibili.com") {
    const bvid = param("bvid", /^BV[0-9A-Za-z]{10}$/);
    const aid = param("aid", /^\d{1,20}$/);
    if (bvid || aid) video = { provider: "bilibili", url: `https://www.bilibili.com/video/${bvid || `av${aid}`}/` };
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = path(/^\/embed\/([\w-]{11})(?:\/|$)/);
    if (id) video = { provider: "youtube", url: `https://www.youtube.com/watch?v=${id}`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } else if (host === "player.vimeo.com") {
    const id = path(/^\/video\/(\d{1,20})(?:\/|$)/);
    if (id) video = { provider: "vimeo", url: `https://vimeo.com/${id}` };
  } else if (host === "v.qq.com") {
    const vid = param("vid", /^[0-9A-Za-z]{1,32}$/);
    if (vid) video = { provider: "qq", url: `https://v.qq.com/x/page/${vid}.html` };
  } else if (host === "player.youku.com") {
    const id = path(/^\/embed\/([0-9A-Za-z=]{1,64})(?:\/|$)/);
    if (id) video = { provider: "youku", url: `https://v.youku.com/v_show/id_${id}.html` };
  }
  return video;
}

function integerAttribute(node, name, maximum = 10000) {
  const value = node.getAttribute(name);
  if (!/^\d+(?:px)?$/.test(value || "")) return undefined;
  const number = Number.parseInt(value, 10);
  return number > 0 && number <= maximum ? number : undefined;
}

function imageSource(node, base) {
  const width = integerAttribute(node, "width");
  const height = integerAttribute(node, "height");
  if (width !== undefined && height !== undefined && width <= 1 && height <= 1) return null;
  const candidates = [];
  for (const attribute of ["data-src", "data-original", "data-lazy-src", "data-actualsrc", "data-url", "data-hi-res-src"]) {
    candidates.push(node.getAttribute(attribute));
  }
  for (const attribute of ["data-srcset", "srcset"]) {
    const entries = (node.getAttribute(attribute) || "").split(",").map((entry) => entry.trim().split(/\s+/)[0]);
    candidates.push(...entries.reverse());
  }
  candidates.push(node.getAttribute("src"));
  for (const candidate of candidates) {
    const src = safeUrl(candidate, base, false);
    if (!src || /(?:^|[/_.-])(?:pixel|spacer|tracking|beacon)(?:[/_.?\-]|$)/i.test(new URL(src).pathname)) continue;
    return src;
  }
  return null;
}

function convert(root, options, settings) {
  const document = { version: 1, children: [], truncated: false };
  const state = { nodes: 0, text: 0, bytes: Buffer.byteLength(JSON.stringify(document)), stopped: false };
  const base = safeUrl(options.url, undefined, false);
  function reserve(node, target) {
    const bytes = Buffer.byteLength(JSON.stringify(node)) + 1; // Conservative comma allowance.
    if (state.nodes >= settings.maxNodes || state.bytes + bytes > settings.maxDocumentBytes) {
      document.truncated = true;
      state.stopped = true;
      return false;
    }
    state.nodes += 1;
    state.bytes += bytes;
    target.push(node);
    return true;
  }
  function visit(input, target, depth, preserve) {
    if (state.stopped) return;
    if (depth > settings.maxDepth) { document.truncated = true; return; }
    if (input.nodeType === 3) {
      let text = input.nodeValue.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n");
      if (!preserve) text = text.replace(/[\s\u00a0]+/g, " ");
      if (!text) return;
      const remaining = settings.maxTextLength - state.text;
      if (text.length > remaining) { text = text.slice(0, remaining); document.truncated = true; }
      if (!text) { document.truncated = true; state.stopped = true; return; }
      // Fit a single large text node to the JSON byte cap as well as text cap.
      const availableBytes = settings.maxDocumentBytes - state.bytes - 1;
      if (Buffer.byteLength(JSON.stringify({ type: "text", text })) > availableBytes) {
        let low = 0;
        let high = text.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (Buffer.byteLength(JSON.stringify({ type: "text", text: text.slice(0, middle) })) <= availableBytes) low = middle;
          else high = middle - 1;
        }
        text = text.slice(0, low);
        document.truncated = true;
        if (!text) { state.stopped = true; return; }
      }
      if (reserve({ type: "text", text }, target)) state.text += text.length;
      return;
    }
    if (input.nodeType !== 1 && input.nodeType !== 11) return;
    const tag = input.localName;
    if (tag === "iframe" || tag === "video") {
      const video = videoSource(input, base);
      const title = cleanLabel(input.getAttribute("title"), 500);
      if (video) reserve({ type: "video", ...video, ...(title ? { title } : {}) }, target);
      return;
    }
    let type = ALIASES[tag] || tag;
    if (tag === "div" || tag === "section") {
      if (!Array.from(input.children).some((child) => BLOCKS.has(child.localName) || /^(?:div|section|article|main)$/.test(child.localName))) type = "p";
    }
    if (!TYPES.has(type)) {
      for (const child of input.childNodes) visit(child, target, depth + 1, preserve);
      return;
    }
    const node = { type };
    if (type === "a") {
      const href = safeUrl(input.getAttribute("href"), base, options.allowMailto === true);
      if (!href) {
        for (const child of input.childNodes) visit(child, target, depth + 1, preserve);
        return;
      }
      node.href = href;
    }
    if (type === "img") {
      const src = imageSource(input, base);
      if (!src) return;
      node.src = src;
      const alt = cleanLabel(input.getAttribute("alt"), 1000);
      if (alt) node.alt = alt;
      for (const attribute of ["width", "height"]) {
        const value = integerAttribute(input, attribute);
        if (value !== undefined) node[attribute] = value;
      }
    }
    if (type === "a" || type === "img") {
      const title = cleanLabel(input.getAttribute("title"), 500);
      if (title) node.title = title;
    }
    if (type === "ol") {
      const start = input.getAttribute("start");
      if (/^-?\d+$/.test(start || "") && Math.abs(Number(start)) <= 1000000) node.start = Number(start);
    }
    if (type === "td" || type === "th") {
      for (const [attribute, key] of [["colspan", "colSpan"], ["rowspan", "rowSpan"]]) {
        const value = integerAttribute(input, attribute, 1000);
        if (value !== undefined) node[key] = value;
      }
    }
    const leaf = type === "img" || type === "br" || type === "hr";
    if (!leaf) node.children = [];
    if (!reserve(node, target)) return;
    if (!leaf) {
      for (const child of input.childNodes) visit(child, node.children, depth + 1, preserve || type === "pre" || type === "code");
    }
  }
  for (const child of root.childNodes) visit(child, document.children, 1, false);
  // Empty wrappers and inter-block indentation need not reach storage/rendering.
  function prune(nodes) {
    return nodes.filter((node) => {
      if (node.children) node.children = prune(node.children);
      return !node.children || node.children.length > 0;
    });
  }
  document.children = prune(document.children);
  if (renderDocumentText(document).length > settings.maxTextLength) document.truncated = true;
  return document;
}

function assess(document, text, semantic, source) {
  let links = 0;
  let paragraphs = 0;
  let prose = 0;
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === "a") links += contentDocumentText({ children: node.children }).length;
      if (node.type === "p" || node.type === "pre" || node.type === "blockquote") {
        paragraphs += 1;
        prose += contentDocumentText({ children: node.children }).trim().length;
      }
      if (node.children) walk(node.children);
    }
  }
  walk(document.children);
  const length = text.trim().length;
  const linkDensity = length ? Math.min(1, links / length) : 0;
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  let reason = "usable";
  if (letters < (semantic ? 12 : 60) || length < (semantic ? 20 : 120)) reason = "insufficient-content";
  else if (linkDensity > (semantic ? 0.55 : 0.4)) reason = "link-heavy";
  else if (!semantic && (paragraphs === 0 || prose < 80)) reason = "no-article-prose";
  return { usable: reason === "usable", reason, source, textLength: length, linkDensity, semantic };
}

function result(document, title, quality, settings, metadata = {}) {
  const text = contentDocumentText(document).slice(0, settings.maxTextLength);
  return { text, title, document, truncated: document.truncated, quality: { ...quality, textLength: text.length }, extractorVersion: EXTRACTOR_VERSION, ...metadata };
}

function emptyResult(title, reason) {
  return {
    text: "", title, document: { version: 1, children: [], truncated: false }, truncated: false,
    quality: { usable: false, reason, source: "none", textLength: 0, linkDensity: 0, semantic: false },
    extractorVersion: EXTRACTOR_VERSION,
  };
}
