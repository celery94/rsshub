/**
 * The single category vocabulary shared by the AI prompt, the database, the
 * Markdown report, and the panel.
 * @module rss-brief/categories
 */

/** Stable category ids with their Chinese report labels. */
export const CATEGORIES = [
  { id: "ai", label: "AI 与大模型" },
  { id: "engineering", label: "软件工程" },
  { id: "systems", label: "系统与基础设施" },
  { id: "product", label: "产品与设计" },
  { id: "business", label: "科技行业与商业" },
  { id: "science", label: "科学与研究" },
  { id: "culture", label: "游戏与娱乐" },
  { id: "other", label: "其他" },
];

/** Category ids in report order. */
export const CATEGORY_IDS = CATEGORIES.map((category) => category.id);

/** id -> label lookup. */
export const CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.label]),
);

/**
 * Clamp an arbitrary model value to the known vocabulary.
 * @param value - candidate category id.
 * @returns a known id, falling back to `other`.
 */
export function normalizeCategory(value) {
  return typeof value === "string" && Object.hasOwn(CATEGORY_LABELS, value) ? value : "other";
}
