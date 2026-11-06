/** Shared synchronous subscription operations for HTTP and agent callers. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { parseOpml } from "./opml.js";

function failure(message, statusCode = 400, code = "invalid-subscription") {
  return Object.assign(new Error(message), { statusCode, code });
}
const revisionOf = (text) => createHash("sha256").update(text).digest("hex");
const labelOf = (node) => (node.getAttribute("title") || node.getAttribute("text") || "").replace(/\s+/gu, " ").trim().slice(0, 120);

/** Parse as XML, refusing malformed documents and unexpected OPML roots. */
export function readOpmlDocument(text) {
  let dom;
  try { dom = new JSDOM(text, { contentType: "text/xml" }); }
  catch { throw failure("OPML XML 格式无效，未修改文件。", 400, "invalid-opml"); }
  const doc = dom.window.document;
  if (doc.documentElement?.tagName !== "opml" || doc.querySelectorAll("opml > body").length !== 1 || doc.doctype) {
    dom.window.close();
    throw failure("需要不含 DOCTYPE 且具有单个 body 的 OPML 文档。", 400, "invalid-opml");
  }
  return dom;
}

function groupOf(node) {
  for (let parent = node.parentElement; parent?.tagName === "outline"; parent = parent.parentElement) {
    if (!parent.hasAttribute("xmlUrl") && labelOf(parent).trim()) return labelOf(parent).trim();
  }
  return "未分组";
}
function categoriesOf(doc, feeds) {
  const labels = [...doc.querySelectorAll("body outline:not([xmlUrl])")]
    .filter((node) => ![...node.children].some((child) => child.tagName === "outline" && !child.hasAttribute("xmlUrl")))
    .map(labelOf).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...labels, ...feeds.map((feed) => feed.group)])];
}
function boundedText(value, name, limit, empty = false) {
  if (typeof value !== "string" || !value.isWellFormed() || (!empty && !value.trim()) || value.length > limit || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\uFFFE\uFFFF]/u.test(value)) {
    throw failure(`${name} 必须是${empty ? "可为空的" : "非空"}单行字符串，最多 ${limit} 字符。`);
  }
  return value.replace(/\s+/gu, " ").trim();
}
function httpUrl(value, name, empty = false) {
  const text = boundedText(value, name, 2048, empty);
  if (empty && !text) return "";
  let url;
  try { url = new URL(text); } catch { throw failure(`${name} 必须是绝对 HTTP(S) URL。`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /\s/u.test(text)) throw failure(`${name} 必须是不含凭据的 HTTP(S) URL。`);
  return url.href;
}
function validateFeed(feed) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed) || Object.keys(feed).some((key) => !["title", "xmlUrl", "htmlUrl", "group"].includes(key))) throw failure("feed 字段无效。");
  return { title: boundedText(feed.title, "title", 300), xmlUrl: httpUrl(feed.xmlUrl, "xmlUrl"),
    htmlUrl: httpUrl(feed.htmlUrl, "htmlUrl", true), group: boundedText(feed.group, "group", 120) };
}
const md = (s) => String(s).replace(/[\\`*_[\]<>|#]/g, "\\$&");
function directoryText(feeds, categories, previous) {
  const notes = previous.match(/^## 说明\s*\r?\n[\s\S]*$/m)?.[0] ?? "";
  const overview = categories.map((group) => `| ${md(group)} | ${feeds.filter((feed) => feed.group === group).length} |`).join("\n");
  const sections = categories.map((group) => {
    const members = feeds.filter((feed) => feed.group === group);
    return `### ${md(group)}（${members.length}）\n\n` + members.map((feed) => `- [${md(feed.title)}](<${(feed.htmlUrl || feed.xmlUrl).replace(/>/g, "%3E")}>) · [RSS](<${feed.xmlUrl.replace(/>/g, "%3E")}>)\n`).join("");
  }).join("\n");
  return `# RSS 订阅分类目录\n\n共 ${feeds.length} 个订阅源，${categories.length} 个分类。\n\n## 分类概览\n\n| 分类 | 来源数 |\n|---|---:|\n${overview}\n\n## 完整目录\n\n${sections}\n${notes}`;
}

/** List is read-only; mutations back up OPML, update its directory, then reconcile storage. */
export function createSubscriptions({ opmlPath, reconcile }) {
  return function subscriptions(args) {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !["action", "revision", "originalUrl", "feed"].includes(key)) || !["list", "add", "update", "delete"].includes(args.action)) throw failure("action 必须是 list/add/update/delete。");
    if (!opmlPath || !existsSync(opmlPath)) throw failure("OPML 文件不可用。", 503, "opml-unavailable");
    const original = readFileSync(opmlPath, "utf8");
    const revision = revisionOf(original);
    const dom = readOpmlDocument(original);
    try {
      const doc = dom.window.document;
      const feeds = parseOpml(original);
      const snapshot = (text, records) => ({ ok: true, revision: revisionOf(text), feeds: records, categories: categoriesOf(doc, records) });
      if (args.action === "list") {
        if (Object.keys(args).some((key) => key !== "action")) throw failure("list 只接受 action。");
        return snapshot(original, feeds);
      }
      if (typeof args.revision !== "string" || !/^[a-f0-9]{64}$/.test(args.revision)) throw failure("请提供列表返回的 revision。");
      if (args.revision !== revision) throw failure("订阅已被修改，请刷新后重试。", 409, "revision-conflict");
      if (args.action === "add" && args.originalUrl !== undefined || args.action === "delete" && args.feed !== undefined) throw failure("请求字段与 action 不匹配。");
      const originalUrl = args.action === "add" ? null : httpUrl(args.originalUrl, "originalUrl");
      const nodes = [...doc.querySelectorAll("body outline[xmlUrl]")];
      const matches = nodes.filter((node) => { try { return new URL(node.getAttribute("xmlUrl")).href === originalUrl; } catch { return false; } });
      if (originalUrl && matches.length !== 1) throw failure("未找到唯一的原订阅源。");
      const feed = args.action === "delete" ? null : validateFeed(args.feed);
      if (feed && nodes.some((node) => node !== matches[0] && (() => { try { return new URL(node.getAttribute("xmlUrl")).href === feed.xmlUrl; } catch { return false; } })())) throw failure("该订阅 URL 已存在。", 400, "duplicate-url");
      if (args.action === "delete") matches[0].remove();
      else {
        const node = matches[0] ?? doc.createElement("outline");
        const oldGroup = matches[0] ? groupOf(node) : null;
        for (const [key, value] of Object.entries({ type: "rss", text: feed.title, title: feed.title, xmlUrl: feed.xmlUrl, htmlUrl: feed.htmlUrl })) node.setAttribute(key, value);
        if (oldGroup !== feed.group) {
          const body = doc.querySelector("opml > body");
          let group = [...doc.querySelectorAll("body outline:not([xmlUrl])")].find((item) => labelOf(item).trim() === feed.group);
          if (!group && feed.group !== "未分组") {
            group = doc.createElement("outline"); group.setAttribute("text", feed.group); group.setAttribute("title", feed.group); body.append(group);
          }
          (group ?? body).append(node);
        }
      }
      const next = dom.serialize();
      const nextFeeds = parseOpml(next);
      const result = snapshot(next, nextFeeds);
      if (next === original) return { ...result, changed: false };
      const directory = join(dirname(opmlPath), "订阅分类目录.md");
      const hadDirectory = existsSync(directory);
      const oldDirectory = hadDirectory ? readFileSync(directory) : null;
      const token = randomUUID();
      const opmlTemp = `${opmlPath}.${token}.tmp`, directoryTemp = `${directory}.${token}.tmp`;
      const backup = `${opmlPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.${token}.bak`;
      let wroteOpml = false, wroteDirectory = false;
      try {
        writeFileSync(opmlTemp, next, { flag: "wx" });
        writeFileSync(directoryTemp, directoryText(nextFeeds, result.categories, oldDirectory?.toString("utf8") ?? ""), { flag: "wx" });
        if (revisionOf(readFileSync(opmlPath, "utf8")) !== revision) throw failure("订阅已被修改，请刷新后重试。", 409, "revision-conflict");
        writeFileSync(backup, original, { flag: "wx" });
        renameSync(opmlTemp, opmlPath); wroteOpml = true;
        renameSync(directoryTemp, directory); wroteDirectory = true;
        reconcile(nextFeeds);
      } catch (error) {
        const restoration = [];
        if (wroteOpml) try { writeFileSync(opmlPath, original); } catch (e) { restoration.push(e.message); }
        if (wroteDirectory) try { if (hadDirectory) writeFileSync(directory, oldDirectory); else unlinkSync(directory); } catch (e) { restoration.push(e.message); }
        if (restoration.length) throw failure(`保存失败且恢复不完整；原 OPML 备份：${backup}。${restoration.join("；")}`, 503, "restore-failed");
        throw error;
      } finally {
        for (const path of [opmlTemp, directoryTemp]) if (existsSync(path)) try { unlinkSync(path); } catch { /* preserve original failure */ }
      }
      return { ...result, changed: true };
    } finally { dom.window.close(); }
  };
}
