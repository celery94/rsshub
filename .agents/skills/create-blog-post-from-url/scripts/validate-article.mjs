#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FIELDS = [
  "pubDatetime",
  "title",
  "description",
  "tags",
  "slug",
  "source",
];

// Keep in sync with references/chinese-style-and-deai.md「句式黑名单」.
const BANNED_PATTERNS = [
  {
    label: "宣布拆解问题（把问题拆开/本文拆解）",
    pattern:
      /(?:把|将)[^。！？\n]{0,12}(?:问题|事情|这件事|话题|主题|难点|误解)[^。！？\n]{0,6}拆(?:开|成|分|解)|(?:本文|这篇|下文|下面|我们|接下来|上一篇)[^。！？\n]{0,12}拆(?:开|成|分|解)|(?:逐一|逐个|深度|技术)拆解|拆开(?:来)?(?:看|讲|说|聊)/gu,
  },
  {
    label: "带你看懂/带你了解",
    pattern:
      /带(?:你|大家|读者)们?(?:一起|快速|从零)?(?:看|读|搞|弄|了解|理解|认识|走|过|梳理|入门|上手|体验|探索|掌握|学)|一文(?:看|读|搞|弄)懂|手把手/gu,
  },
  {
    label: "不是……而是……（及并非/不在于……而在于、不是 A，是 B）",
    pattern:
      /(?:不是|并非|不在于)[^。！？；\n]{1,60}?(?:而是|而在于)|与其说[^。！？；\n]{1,60}?不如说|(?<![而但])不是[^。！？；，,\n]{1,30}[，,]\s*是(?![否的]|为了|因为)/gu,
  },
  {
    label: "你以为……其实……",
    pattern:
      /你(?:可能|也许|或许|大概)?以为|(?:我们|大家|很多人|多数人|不少人|有人)(?:可能|也许|或许|一直|往往|通常)?(?:以为|觉得|认为)[^\n]{0,60}?(?:其实|实际上|事实上)|(?:表面上|乍看)[^\n]{0,40}?(?:其实|实际上)/gu,
  },
  {
    label: "宣布反直觉/意外（一个反直觉的观察）",
    pattern:
      /反直觉|违反直觉|违背直觉|反常识|出人意料|出乎意料|(?:一个|这个)(?:有趣|意外|反常)的(?:观察|发现|现象)/gu,
  },
];

function stripNonProse(body) {
  const lines = body.split("\n");
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      inFence = !inFence;
      kept.push("");
      continue;
    }
    if (inFence) {
      kept.push("");
      continue;
    }
    if (/^##\s+参考\s*$/u.test(line)) {
      break;
    }
    if (/^\s*>/u.test(line)) {
      kept.push("");
      continue;
    }
    kept.push(line.replace(/`[^`\n]*`/gu, "``"));
  }
  return kept;
}

export function findBannedPhrases({ title = "", description = "", body = "" }) {
  const hits = [];
  const segments = [
    { where: "title", lines: [title] },
    { where: "description", lines: [description] },
    { where: "正文", lines: stripNonProse(body), numbered: true },
  ];
  for (const { where, lines, numbered } of segments) {
    lines.forEach((line, index) => {
      for (const { label, pattern } of BANNED_PATTERNS) {
        for (const match of line.matchAll(pattern)) {
          const start = Math.max(0, match.index - 12);
          const snippet = line
            .slice(start, match.index + match[0].length + 12)
            .trim();
          const location = numbered ? `${where}第 ${index + 1} 行` : where;
          hits.push(`${location} 命中禁用句式「${label}」: …${snippet}…`);
        }
      }
    });
  }
  return hits;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return { error: "文件必须以 YAML frontmatter 开头" };
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { error: "找不到 frontmatter 结束标记" };
  }

  const values = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z][\w]*):\s*(.*)$/);
    if (match) {
      values[match[1]] = parseScalar(match[2]);
    }
  }

  return { values, body: normalized.slice(end + 5) };
}

function charLength(value) {
  return [...value].length;
}

function resolveLocalReference(articlePath, reference) {
  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  return path.resolve(path.dirname(articlePath), clean);
}

function validateCoverBrief(briefPath, title, errors) {
  let brief;
  try {
    brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
  } catch (error) {
    errors.push(`封面 brief 无法读取: ${error.message}`);
    return;
  }

  const required = [
    "article_title",
    "cover_type",
    "core_theme",
    "reader_takeaway",
    "summary_angle",
    "narrative_flow",
    "information_blocks",
    "selected_style",
    "selected_style_prompt_descriptor",
    "final_prompt",
  ];
  for (const field of required) {
    if (
      brief[field] === undefined ||
      brief[field] === null ||
      brief[field] === ""
    ) {
      errors.push(`cover-brief.json 缺少 ${field}`);
    }
  }

  if (brief.article_title && brief.article_title !== title) {
    errors.push("cover-brief.json 的 article_title 与文章标题不一致");
  }
  if (
    !Array.isArray(brief.information_blocks) ||
    brief.information_blocks.length < 2 ||
    brief.information_blocks.length > 4
  ) {
    errors.push("cover-brief.json 的 information_blocks 必须为 2–4 项");
  } else if (
    brief.information_blocks.some(
      block => !block || typeof block.source_anchor !== "string" || !block.source_anchor.trim()
    )
  ) {
    errors.push("每个 information_blocks 项都必须包含 source_anchor");
  }
}

// RSS articles use local, inline Markdown images so the publisher and validator
// resolve exactly the same assets. Ignore example code and HTML comments.
export function rssImageSource(body) {
  let fence = null;
  const lines = body.replace(/<!--[\s\S]*?(?:-->|$)/gu, "").split("\n");
  return lines.map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*[`~]+\s*$/u.test(line)) fence = null;
      return "";
    }
    if (marker) { fence = marker[1]; return ""; }
    // Keep required illustrations in their own paragraphs, outside code samples.
    if (/^(?: {4}|\t)/u.test(line)) return "";
    return line;
  }).join("\n").replace(/(`+)[\s\S]*?\1/gu, "");
}

// Match the simple closed inline syntax supported by the existing publisher.
// An escaped exclamation mark is prose, not an illustration.
export function extractRssImages(body) {
  const source = rssImageSource(body).split(/^##\s+参考\s*$/mu)[0];
  return [...source.matchAll(/(?<!\\)!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)]
    .map(match => ({ alt: match[1], reference: match[2], index: match.index, syntax: match[0] }));
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateRssImage(articlePath, reference, errors) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(reference)) {
    errors.push(`RSS 图片必须使用任务内本地资源: ${reference}`);
    return null;
  }
  let localPath;
  try {
    localPath = resolveLocalReference(articlePath, reference);
    const taskRoot = path.dirname(articlePath);
    if (!isWithin(taskRoot, localPath)) {
      errors.push(`RSS 图片路径越出任务目录: ${reference}`);
      return null;
    }
    if (!/\.(?:png|jpg)$/iu.test(localPath)) {
      errors.push(`RSS 图片只支持 PNG/JPG: ${reference}`);
      return null;
    }
    if (!/^\.\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(reference)) {
      errors.push(`RSS 图片必须引用 ./assets/ 下的英文文件名，不含 URL 参数、转义或空格: ${reference}`);
      return null;
    }
    if (!fs.statSync(localPath).isFile()) {
      errors.push(`RSS 图片不是普通文件: ${reference}`);
      return null;
    }
    const realPath = fs.realpathSync(localPath);
    if (!isWithin(fs.realpathSync(taskRoot), realPath)) {
      errors.push(`RSS 图片实际路径越出任务目录: ${reference}`);
      return null;
    }
    const bytes = Buffer.alloc(8);
    const descriptor = fs.openSync(localPath, "r");
    try {
      fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    const isPng = bytes.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if ((/\.png$/iu.test(localPath) && !isPng) || (/\.jpe?g$/iu.test(localPath) && !isJpeg)) {
      errors.push(`RSS 图片文件头与 PNG/JPG 扩展名不符: ${reference}`);
      return null;
    }
    return realPath;
  } catch {
    errors.push(`RSS 图片无法读取或不存在: ${reference}`);
    return null;
  }
}

export function validateArticle(articlePath, options = {}) {
  const errors = [];
  const rssMode = options.mode === "rss-article";
  const wechat = options.wechat || rssMode;
  if (options.mode && !["blog", "rss-article"].includes(options.mode)) {
    return [`不支持的文章模式: ${options.mode}`];
  }
  const resolvedArticle = path.resolve(articlePath);
  let text;

  try {
    text = fs.readFileSync(resolvedArticle, "utf8");
  } catch (error) {
    return [`文章无法读取: ${error.message}`];
  }

  const parsed = parseFrontmatter(text);
  if (parsed.error) {
    return [parsed.error];
  }

  const { values, body } = parsed;
  for (const field of REQUIRED_FIELDS) {
    if (values[field] === undefined || values[field] === "") {
      errors.push(`frontmatter 缺少 ${field}`);
    }
  }

  const title = String(values.title ?? "");
  const description = String(values.description ?? "");
  const slug = String(values.slug ?? "");
  const source = String(values.source ?? "");

  if (/[\u2018\u2019\u201c\u201d]/u.test(title + description)) {
    errors.push("title 和 description 不能包含中文弯引号");
  }
  if (description && (charLength(description) < 80 || charLength(description) > 120)) {
    errors.push(
      `description 必须为 80–120 个字符，当前 ${charLength(description)} 个`,
    );
  }
  if (wechat && title && charLength(title) > 32) {
    errors.push(`微信标题最多 32 个字符，当前 ${charLength(title)} 个`);
  }

  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    errors.push("slug 必须使用小写 kebab-case");
  }
  if (rssMode) {
    if (path.basename(resolvedArticle) !== "article.md") {
      errors.push("RSS 文章文件名必须使用 article.md");
    }
  } else {
    const filenameMatch = path.basename(resolvedArticle).match(/^\d{3,}-(.+)\.md$/u);
    if (!filenameMatch) {
      errors.push("文章文件名必须使用 {ID}-{slug}.md");
    } else if (slug && filenameMatch[1] !== slug) {
      errors.push("文件名中的 slug 与 frontmatter slug 不一致");
    }
  }

  if (values.pubDatetime) {
    const timestamp = String(values.pubDatetime);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        timestamp,
      )
    ) {
      errors.push("pubDatetime 必须是带时区的 ISO 8601 时间");
    } else if (!options.allowFuture && Date.parse(timestamp) > Date.now() + 60_000) {
      errors.push("pubDatetime 不能晚于当前时间，除非使用 --allow-future");
    }
  }

  if (values.tags) {
    try {
      const tags = JSON.parse(String(values.tags));
      if (!Array.isArray(tags) || tags.length === 0 || tags.some(tag => !tag)) {
        errors.push("tags 必须是非空字符串数组");
      }
    } catch {
      errors.push("tags 必须使用 JSON 风格的行内数组");
    }
  }

  try {
    const sourceUrl = new URL(source);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
      errors.push("source 必须是 HTTP 或 HTTPS URL");
    }
  } catch {
    if (source) {
      errors.push("source 不是有效 URL");
    }
  }

  errors.push(...findBannedPhrases({ title, description, body }));

  if (!/^##\s+参考\s*$/mu.test(body)) {
    errors.push("正文必须包含 ## 参考 小节");
  }
  if (rssMode) {
    const section = (rssImageSource(body).split(/^##\s+参考\s*$/mu)[1] ?? "").split(/^#{1,2}\s+/mu)[0];
    const urls = new Set([...section.matchAll(/https?:\/\/[^\s<>()]+/gu)].map(match => match[0]));
    if (source && !urls.has(source)) errors.push("RSS 的 ## 参考 小节必须包含原文 URL 链接");
  } else if (source && !body.includes(source)) {
    errors.push("## 参考 小节必须包含原文 URL");
  }

  const localReferences = new Set();
  const imagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/gu;
  const rssBodyImages = [];
  const rssRequiredImages = [];
  if (rssMode) {
    const imageBody = rssImageSource(body);
    const contentBody = imageBody.split(/^##\s+参考\s*$/mu)[0];
    const images = extractRssImages(body);
    const starts = new Set(images.map(image => image.index));
    // Broken, escaped and reference-style syntax cannot satisfy a required image.
    if (/<img\b/iu.test(imageBody) || [...contentBody.matchAll(/(?<!\\)!\[[^\]\n]*\]/gu)].some(match => !starts.has(match.index))) {
      errors.push("RSS 图片必须使用完整内联 Markdown 语法 ![中文说明](./assets/image.png)");
    }
    if (/(?<!\\)!\[[^\]\n]*\]/u.test(imageBody.slice(contentBody.length))) {
      errors.push("RSS 配图必须放在正文相关段落，不能放进 ## 参考 小节");
    }
    for (const { alt, reference } of images) {
      if (/[<>]/u.test(reference)) {
        errors.push("RSS 图片路径不使用尖括号，使用 ![中文说明](./assets/image.png)");
        continue;
      }
      if (!/\p{Script=Han}/u.test(alt)) errors.push(`RSS 正文图片必须有中文 alt: ${reference}`);
      const realPath = validateRssImage(resolvedArticle, reference, errors);
      if (realPath) {
        rssBodyImages.push(realPath);
        if (/^02-illustration-[A-Za-z0-9_-]+\.(?:png|jpg)$/iu.test(path.posix.basename(reference))) {
          rssRequiredImages.push(realPath);
        }
      }
    }
  } else {
    for (const match of body.matchAll(imagePattern)) {
      const reference = match[1] ?? match[2];
      if (!/^(?:https?:|data:|#)/iu.test(reference)) localReferences.add(reference);
    }
  }

  const ogImage = values.ogImage ? String(values.ogImage) : "";
  if (ogImage) {
    if (rssMode) {
      const coverPath = validateRssImage(resolvedArticle, ogImage, errors);
      if (!/^\.\/assets\/01-cover\.(?:png|jpg)$/iu.test(ogImage)) {
        errors.push("RSS 封面必须使用 ./assets/01-cover.png 或 .jpg");
      }
      if (!rssRequiredImages.some(image => image !== coverPath)) {
        errors.push("RSS 文章必须包含至少一张与封面不同的本地正文图片 assets/02-illustration-{topic}.png 或 .jpg");
      }
    } else {
      localReferences.add(ogImage);
    }
  } else {
    if (wechat) errors.push("微信发布必须提供 ogImage 封面");
    if (rssMode && rssBodyImages.length === 0) {
      errors.push("RSS 文章必须包含至少一张本地正文图片");
    }
  }

  for (const reference of localReferences) {
    let localPath;
    try {
      localPath = resolveLocalReference(resolvedArticle, reference);
    } catch {
      errors.push(`资源路径无法解析: ${reference}`);
      continue;
    }
    if (!fs.existsSync(localPath)) {
      errors.push(`资源不存在: ${reference}`);
    }
  }

  if (wechat && ogImage) {
    try {
      const coverPath = resolveLocalReference(resolvedArticle, ogImage);
      // RSS stores the brief in assets even if the cover reference is invalid;
      // never read a brief outside the task through an unchecked reference.
      const briefPath = rssMode
        ? path.join(path.dirname(resolvedArticle), "assets", "cover-brief.json")
        : path.join(path.dirname(coverPath), "cover-brief.json");
      if (rssMode && fs.existsSync(briefPath) && !isWithin(fs.realpathSync(path.dirname(resolvedArticle)), fs.realpathSync(briefPath))) {
        errors.push("RSS 封面 brief 实际路径越出任务目录");
      } else {
        validateCoverBrief(briefPath, title, errors);
      }
    } catch {
      errors.push("封面或 brief 路径无法解析");
    }
  }

  return errors;
}

function parseArguments(argv) {
  const options = { wechat: false, allowFuture: false, mode: "blog" };
  let articlePath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--wechat") options.wechat = true;
    else if (argument === "--allow-future") options.allowFuture = true;
    else if (argument === "--mode") {
      const mode = argv[++index];
      if (!["blog", "rss-article"].includes(mode)) throw new Error("--mode 必须为 blog 或 rss-article");
      options.mode = mode;
    } else if (argument.startsWith("--") || articlePath) {
      throw new Error(`无法识别的参数: ${argument}`);
    } else articlePath = argument;
  }
  return { articlePath, options };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const { articlePath, options } = parsed;
  if (!articlePath) {
    console.error(
      "用法: node validate-article.mjs <article.md> [--mode blog|rss-article] [--wechat] [--allow-future]",
    );
    process.exit(2);
  }

  const errors = validateArticle(articlePath, options);
  if (errors.length) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`文章校验通过: ${path.resolve(articlePath)}`);
}
