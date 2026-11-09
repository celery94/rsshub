import { normalizeTag, normalizeFormat } from "./tags.js";

/** Validate an explicit latest-list scope; never expand malformed requests to all articles. */
export function parseBulkReadRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.view !== "latest") {
    throw new Error("必须指定最新文章列表。");
  }
  const allowed = new Set(["view", "q", "category", "feed", "unread", "snapshot", "quality", "tag", "format"]);
  if (Object.hasOwn(body, "feed") && (!Number.isSafeInteger(body.feed) || body.feed <= 0)) {
    throw new Error("feed 必须是正整数，请刷新列表后重试。");
  }
  if (body.quality !== undefined && body.quality !== "all" && body.quality !== "high") {
    throw new Error("文章质量筛选无效，请刷新列表后重试。");
  }
  if (Object.keys(body).some((key) => !allowed.has(key)) || typeof body.q !== "string" || typeof body.unread !== "boolean" || !(body.category === null || typeof body.category === "string" && body.category.length > 0)) {
    throw new Error("筛选条件无效，请刷新列表后重试。");
  }
  const scope = { view: "latest", q: body.q.trim(), category: body.category ?? undefined, unread: body.unread };
  if (!Number.isSafeInteger(body.snapshot) || body.snapshot < 0 || scope.category !== undefined && !/^opml:.+/u.test(scope.category)) {
    throw new Error("最新文章快照或分类无效，请刷新列表后重试。");
  }
  if (Object.hasOwn(body, "tag")) scope.tag = normalizeTag(body.tag);
  if (Object.hasOwn(body, "format")) scope.format = normalizeFormat(body.format);
  if (body.feed !== undefined) scope.feed = body.feed;
  if (body.quality !== undefined) scope.quality = body.quality;
  scope.snapshot = body.snapshot;
  return scope;
}
