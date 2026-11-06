/** Cache-first article bodies and a shared, bounded extraction queue. */
import { getArticle, setContentSuccess, recordContentAttempt } from "./db.js";
import { fetchText } from "./feed.js";
import { buildContentDocument, contentDocumentText, extractReadable, isHtmlContentType, EXTRACTOR_VERSION } from "./readable.js";

const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const hasImage = (nodes) => Array.isArray(nodes) && nodes.some((node) => node.type === "img" || node.type === "video" || hasImage(node.children));

/** Share one extractor between scheduled work and on-demand readers. */
export function createArticleContent({ getDb, signal, timeoutMs = 20000 }) {
  const tasks = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (!signal.aborted && active < 3 && queue.length > 0) {
      const { run, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(run).then(resolve, reject).finally(() => { active -= 1; pump(); });
    }
  }
  signal.addEventListener("abort", () => {
    for (const item of queue.splice(0)) item.reject(signal.reason ?? new Error("插件已卸载"));
  }, { once: true });

  function documentOf(row) {
    try {
      const document = JSON.parse(row.content_document_json || "null");
      return document?.version === 1 && Array.isArray(document.children) ? document : null;
    } catch { return null; }
  }

  function canFetch(row) {
    try {
      const url = new URL(row.url);
      return /^https?:$/.test(url.protocol) && !(/^\/?$/.test(url.pathname) && !url.search);
    } catch { return false; }
  }

  /** Prepare stored feed HTML locally. This never fetches a resource. */
  function prepareLocal(row) {
    if (documentOf(row)) return row;
    if (row.content_status === "ok" && row.content_text) return row;
    if (row.feed_content_html) {
      const document = buildContentDocument(row.feed_content_html, { url: row.feed_content_base_url || row.url || row.feed_html_url || row.feed_url });
      const text = contentDocumentText(document);
      if (text.trim() || hasImage(document.children)) {
        document.truncated ||= Boolean(row.feed_content_truncated);
        const full = row.feed_content_kind === "full" && !document.truncated;
        setContentSuccess(getDb(), row.id, {
          status: full ? "ok" : "fallback", text, document, source: full ? "feed" : "feed-summary",
          version: EXTRACTOR_VERSION, at: new Date().toISOString(),
        });
        return getArticle(getDb(), row.id) ?? row;
      }
    }
    return row;
  }

  function needsExtraction(row) {
    if (!canFetch(row)) return false;
    const failedAt = Date.parse(row.content_attempt_at || "");
    if (row.content_attempt_error && Number.isFinite(failedAt) && Date.now() - failedAt < RETRY_COOLDOWN_MS) return false;
    return !(row.content_status === "ok" && documentOf(row) && Number(row.extraction_version) >= EXTRACTOR_VERSION);
  }

  function readCached(input) {
    const row = prepareLocal(input);
    const document = documentOf(row);
    return {
      contentText: row.content_text || row.feed_summary || "",
      contentDocument: document,
      contentSource: row.content_source || (row.content_status === "ok" && row.content_text ? "legacy" : "feed-summary"),
      contentStatus: row.content_status,
      contentError: row.content_error || null,
      extractedAt: row.extracted_at || null,
      needsExtraction: needsExtraction(row),
      refreshError: row.content_attempt_error || null,
      truncated: Boolean(document?.truncated),
      extracting: tasks.has(row.id),
    };
  }

  async function run(id, force) {
    signal.throwIfAborted();
    const row = prepareLocal(getArticle(getDb(), id));
    if (!force && !needsExtraction(row) && canFetch(row)) return { ...readCached(row), extracting: false };
    const at = new Date().toISOString();
    try {
      if (!canFetch(row)) throw new Error(row.url ? "原文链接不是文章页面，使用已有订阅内容" : "没有原文链接");
      const response = await fetchText(row.url, {
        timeoutMs, signal, maxBytes: 4 * 1024 * 1024,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
      });
      if (!isHtmlContentType(response.contentType)) throw new Error(`不支持的内容类型：${response.contentType || "未知"}`);
      const body = extractReadable(response.text, { url: response.url || row.url });
      if (!body.text?.trim() && !hasImage(body.document?.children)) {
        throw new Error("未能提取有效正文，可能是登录、验证页面或正文尚未加载");
      }
      setContentSuccess(getDb(), id, {
        status: "ok", text: body.text, document: body.document, source: "web",
        version: EXTRACTOR_VERSION, at,
      });
      return { ...readCached(getArticle(getDb(), id)), extracting: false };
    } catch (error) {
      if (signal.aborted) throw error;
      const latest = getArticle(getDb(), id);
      const reason = error?.name === "TimeoutError" ? "获取正文超时，请稍后重试或打开原文"
        : error instanceof Error ? error.message : String(error);
      // Keep every previously readable body, including a complete feed body.
      if (!latest.content_text && !documentOf(latest) && latest.feed_summary) {
        setContentSuccess(getDb(), id, {
          status: "fallback", text: latest.feed_summary,
          document: null, source: "feed-summary", version: EXTRACTOR_VERSION, at,
          error: reason,
        });
      }
      recordContentAttempt(getDb(), id, { at, error: reason });
      return { ...readCached(getArticle(getDb(), id)), extracting: false };
    }
  }

  function extract(row, { force = false } = {}) {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error("插件已卸载"));
    if (tasks.has(row.id)) return tasks.get(row.id);
    const task = new Promise((resolve, reject) => queue.push({ run: () => run(row.id, force), resolve, reject }));
    tasks.set(row.id, task);
    task.finally(() => tasks.delete(row.id)).catch(() => {});
    pump();
    return task;
  }

  return { readCached, needsExtraction, extract };
}
