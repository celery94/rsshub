/** Classification labels evolve independently of score validity and content identity. */
export const TAGGING_VERSION = 3;

/** Stable themes for grouping articles; models may select, never invent, names. */
export const TOPIC_TAGS = Object.freeze([
  "AI与模型", "AI编程", "Agent应用", "软件开发", "数据与数据库", "系统与基础设施",
  "安全与隐私", "硬件与半导体", "产品与设计", "商业与产业", "科学与数学",
  "游戏与文化", "社会与时事", "生活与随笔",
]);

/** The form of an article is separate from its subject and reading score. */
export const FORMAT_TAGS = Object.freeze([
  "新闻动态", "教程指南", "技术解析", "实践案例", "研究报告", "观点评论", "资源推荐", "内容合集",
]);
const TOPICS_BY_KEY = new Map(TOPIC_TAGS.map((tag) => [tag.toLowerCase(), tag]));
const FORMATS_BY_KEY = new Map(FORMAT_TAGS.map((tag) => [tag.toLowerCase(), tag]));

/** Generic boundaries also serve old free-form tags, which remain filterable. */
export function normalizeTag(value) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) throw new TypeError("标签必须是没有控制字符的字符串");
  const tag = value.normalize("NFKC").trim().replace(/^#+\s*/u, "").replace(/\s+/gu, " ").trim();
  if (!tag || [...tag].length > 24) throw new TypeError("标签长度必须为1–24个字符");
  return tag;
}

/** JavaScript lowercasing handles Unicode; SQLite NOCASE only handles ASCII. */
export function normalizeTagKey(value) {
  return normalizeTag(value).toLowerCase();
}

export function normalizeTags(values) {
  if (!Array.isArray(values) || values.length < 1) throw new TypeError("正常文章必须提供1–5个标签");
  const tags = new Map();
  for (const value of values) {
    const tag = normalizeTag(value);
    const key = tag.toLowerCase();
    if (!tags.has(key)) tags.set(key, tag);
  }
  if (tags.size > 5) throw new TypeError("正常文章去重后必须提供1–5个标签");
  return [...tags.values()];
}

/** A format filter cannot silently become a free-form topic or unrestricted scope. */
export function normalizeFormat(value) {
  const format = FORMATS_BY_KEY.get(normalizeTagKey(value));
  if (!format) throw new TypeError("内容类型必须从固定类型中选择");
  return format;
}

/** Model/persistence output is exactly one or two themes followed by one format. */
export function normalizeClassificationTags(values) {
  const topics = [], formats = [];
  for (const tag of normalizeTags(values)) {
    const key = tag.toLowerCase();
    if (TOPICS_BY_KEY.has(key)) topics.push(TOPICS_BY_KEY.get(key));
    else if (FORMATS_BY_KEY.has(key)) formats.push(FORMATS_BY_KEY.get(key));
    else throw new TypeError(`标签必须使用固定主题或内容类型：${tag}`);
  }
  if (topics.length < 1 || topics.length > 2 || formats.length !== 1) throw new TypeError("文章必须包含1–2个主题和1个内容类型");
  return [...topics, formats[0]];
}
