/**
 * Host half of the RSS brief bundle.
 *
 * Reads the configured OPML on a schedule, fetches each feed into SQLite,
 * extracts article bodies, and exposes the latest articles in the sidebar.
 * Existing AI summaries and model settings remain available for article tasks.
 * @module @local/dsh-rss-brief
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { articleSkillRoot, registerSkills } from "./lib/skills.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createPublicationManager } from "./lib/publication.js";
import { assessArticles } from "./lib/ai.js";
import { parseBulkReadRequest } from "./lib/bulk-read.js";
import { CATEGORY_LABELS } from "./lib/categories.js";
import {
  articleCounts,
  assessmentCounts,
  pendingAssessments,
  saveAssessment,
  closeDatabase,
  countEnabledFeeds,
  enabledFeeds,
  feedErrors,
  getArticle,
  getMeta,
  insertArticles,
  isRead,
  latestArticles,
  markFeedResult,
  markLatestRead,
  openDatabase,
  pendingContent,
  setMeta,
  setRead,
  upsertFeeds,
} from "./lib/db.js";
import { fetchFeed } from "./lib/sources.js";
import { DEFAULT_USER_AGENT, readLimited } from "./lib/feed.js";
import { parseOpml } from "./lib/opml.js";
import { createSubscriptions } from "./lib/subscriptions.js";
import { createArticleContent } from "./lib/article-content.js";
import { toReportArticle } from "./lib/report.js";
import { truncate } from "./lib/text.js";
import {
  formatLocalDateTime,
  isoDaysAgo,
  isValidTimeZone,
  localDate,
} from "./lib/time.js";

/** Stable Cordis plugin name. */
export const name = "rss-brief";

/** Services required before the plugin can mount its tools and routes. */
export const inject = ["tools", "webServer"];

/** Base path of the panel's read and action routes. */
const ROUTE_BASE = "/plugin/rss-brief";
/** Upper bound for a tool that waits for a sync. */
const SYNC_WAIT_MS = 90_000;
/** JSON request body cap for the action routes. */
const BODY_LIMIT_BYTES = 8192;
/** Meta keys holding the model route saved from the panel. */
const AI_PROVIDER_KEY = "aiProvider";
const AI_MODEL_KEY = "aiModel";
/** Deadline for one provider's model catalog, so the panel never hangs. */
const CATALOG_TIMEOUT_MS = 4_000;

/** Configuration defaults, overridable through the bundle patch. */
const DEFAULTS = {
  opmlPath: "",
  dataDir: join(homedir(), ".dsh", "rss-brief"),
  timeZone: "Asia/Shanghai",
  fetchIntervalMinutes: 60,
  syncConcurrency: 6,
  requestTimeoutMs: 20_000,
  itemsPerFeed: 20,
  contentWindowDays: 3,
  contentPerSync: 40,
  aiBatchSize: 4,
  aiMaxTokens: 4000,
  analysisEnabled: true,
  analysisPerSync: 40,
  analysisProvider: "",
  analysisModel: "",
  highQualityThreshold: 60,
  focus:
    "AI、软件工程、系统与基础设施、科技产品与互联网行业；过滤营销软文、促销、招聘、低信息量转载",
  provider: "",
  model: "",
  articleWorkspace: "",
};

/**
 * Mount the scheduler, tools, and panel routes.
 * @param ctx - Cordis host context.
 * @param rawConfig - untrusted row config from the bundle patch.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  registerSkills(ctx);
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.articleWorkspace, { recursive: true });
  const state = {
    db: null,
    initError: null,
    opmlError: null,
    opmlLoadedAt: null,
    running: null,
    lastRun: null,
    disposed: false,
  };
  const controller = new AbortController();
  const articleContent = createArticleContent({ getDb: requireDb, signal: controller.signal, timeoutMs: config.requestTimeoutMs });
  const publicationOptions = {
    ctx,
    workspaceDir: config.articleWorkspace,
    skillRoot: articleSkillRoot,
    dataDir: config.dataDir,
    getArticle: (id) => getArticle(requireDb(), id),
    readCached: (row) => articleContent.readCached(row),
    resolveRoute,
  };
  const publications = createPublicationManager(publicationOptions);
  const shares = createPublicationManager({ ...publicationOptions, kind: "share" });

  /**
   * Open storage if it is not open yet.
   * @returns the database handle.
   */
  function initStorage() {
    if (state.db !== null) return state.db;
    mkdirSync(config.dataDir, { recursive: true });
    state.db = openDatabase(join(config.dataDir, "rss-brief.sqlite"));
    if (config.opmlPath === join(config.dataDir, "subscriptions.opml") && !existsSync(config.opmlPath)) {
      // Preserve subscriptions from an existing database when adopting defaults.
      const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
      const outlines = enabledFeeds(state.db).map(feed => `<outline text="${escape(feed.opml_group || "未分组")}"><outline text="${escape(feed.title)}" xmlUrl="${escape(feed.xml_url)}" htmlUrl="${escape(feed.html_url)}"/></outline>`).join("\n");
      try { writeFileSync(config.opmlPath, `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>RSS subscriptions</title></head><body>${outlines}</body></opml>\n`, { flag: "wx" }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    state.initError = null;
    return state.db;
  }

  /** @returns the open database, throwing a clear error when storage failed. */
  function requireDb() {
    if (state.db !== null) return state.db;
    if (state.initError !== null) throw new Error(state.initError);
    return initStorage();
  }

  /**
   * Read the OPML and reconcile the feed table.
   * @returns upsert counts.
   */
  function loadFeeds() {
    if (config.opmlPath === "") throw new Error("opmlPath 未配置");
    if (!existsSync(config.opmlPath)) throw new Error(`OPML 文件不存在：${config.opmlPath}`);
    const feeds = parseOpml(readFileSync(config.opmlPath, "utf8"));
    const result = upsertFeeds(requireDb(), feeds);
    state.opmlError = null;
    state.opmlLoadedAt = nowIso();
    setMeta(requireDb(), "opmlLoadedAt", state.opmlLoadedAt);
    return result;
  }

  const subscriptions = createSubscriptions({
    opmlPath: config.opmlPath,
    reconcile(feeds) {
      if (state.disposed) throw Object.assign(new Error("插件暂不可用。"), { statusCode: 503 });
      upsertFeeds(requireDb(), feeds);
      state.opmlError = null;
      state.opmlLoadedAt = nowIso();
    },
  });

  /** @returns the saved interval, falling back to the bundle configuration. */
  function effectiveFetchIntervalMinutes() {
    const saved = state.db === null ? undefined : getMeta(state.db, "fetchIntervalMinutes");
    const value = typeof saved === "string" && /^\d+$/.test(saved) ? Number(saved) : NaN;
    return Number.isInteger(value) && value >= 5 && value <= 10_080
      ? value : config.fetchIntervalMinutes;
  }

  /** @returns schedule settings without consulting any model services. */
  function buildScheduleSettings() {
    const lastFetchAt = state.db === null ? null : getMeta(state.db, "lastFetchAt") ?? null;
    return {
      ok: true,
      fetchIntervalMinutes: effectiveFetchIntervalMinutes(),
      defaultFetchIntervalMinutes: config.fetchIntervalMinutes,
      timeZone: config.timeZone,
      nextSyncAt: nextFetchAt(lastFetchAt),
      lastFetchAt,
    };
  }

  /** @returns whether a fetch is due. */
  function fetchDue() {
    const db = state.db;
    if (db === null) return true;
    const last = getMeta(db, "lastFetchAt");
    if (last === undefined) return true;
    const time = Date.parse(last);
    if (!Number.isFinite(time)) return true;
    return Date.now() - time >= effectiveFetchIntervalMinutes() * 60_000;
  }

  /**
   * Display value for the next fetch.
   * @param lastFetchAt - ISO timestamp of the last full sync.
   * @returns the next fetch ISO timestamp, or "尽快".
   */
  function nextFetchAt(lastFetchAt) {
    if (typeof lastFetchAt !== "string" || lastFetchAt === "") return "尽快";
    const time = Date.parse(lastFetchAt);
    if (!Number.isFinite(time)) return "尽快";
    return new Date(time + effectiveFetchIntervalMinutes() * 60_000).toISOString();
  }

  /** @returns a small, serializable snapshot of the running job. */
  function snapshotRunning() {
    const job = state.running;
    if (job === null) return null;
    return {
      kind: job.kind,
      phase: job.phase,
      startedAt: job.startedAt,
      done: job.done,
      total: job.total,
    };
  }

  /**
   * Start one job, refusing overlap.
   * @param kind - `sync`.
   * @param work - job body.
   * @returns whether the job started and the job handle.
   */
  function startJob(kind, work) {
    if (state.disposed) return { started: false, reason: "插件已卸载" };
    if (state.running !== null) return { started: false, busy: true, running: snapshotRunning() };
    const job = {
      kind,
      phase: "start",
      startedAt: nowIso(),
      done: 0,
      total: 0,
      promise: null,
    };
    state.running = job;
    job.promise = (async () => {
      try {
        const value = await work(job);
        state.lastRun = {
          kind,
          ok: true,
          at: nowIso(),
          summary: summarizeRun(value),
        };
        return value;
      } catch (error) {
        if (!state.disposed) console.error(`[rss-brief] ${kind} failed:`, messageOf(error));
        state.lastRun = { kind, ok: false, at: nowIso(), error: messageOf(error) };
        throw error;
      } finally {
        if (state.running === job) state.running = null;
      }
    })();
    job.promise.catch(() => {
      /* the caller owns the error; the background run must not be unhandled */
    });
    return { started: true, job };
  }

  /**
   * Wait for a job with a deadline.
   * @param job - started job.
   * @param timeoutMs - maximum wait.
   * @returns `{ value }` or `{ timedOut: true }`.
   */
  async function waitForJob(job, timeoutMs) {
    let timer;
    const timeout = new Promise((settle) => {
      timer = setTimeout(() => settle({ timedOut: true }), Math.max(0, timeoutMs));
    });
    try {
      return await Promise.race([job.promise.then((value) => ({ value })), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether one model selection has the provider/model pair a route needs. */
  function isRoute(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      typeof value.provider === "string" &&
      value.provider !== "" &&
      typeof value.model === "string" &&
      value.model !== ""
    );
  }

  /** @returns the model route saved from the panel, or null. */
  function savedRoute() {
    const db = state.db;
    if (db === null) return null;
    const provider = String(getMeta(db, AI_PROVIDER_KEY) ?? "").trim();
    const model = String(getMeta(db, AI_MODEL_KEY) ?? "").trim();
    return provider === "" || model === "" ? null : { provider, model };
  }

  /**
   * Check that one saved provider still has a registered adapter.
   * A stale key would otherwise fail article tasks with NO_ADAPTER.
   * @param provider - provider route id.
   * @returns whether the route can still be dispatched.
   */
  function providerRegistered(provider) {
    const llm = ctx.get("llm");
    if (typeof llm?.listProviders !== "function") return false;
    try {
      return llm.listProviders().some((entry) => entry?.id === provider);
    } catch {
      return true;
    }
  }

  /** @returns the Harness default model selection, or null. */
  function defaultSelection() {
    const service = ctx.get("agentDefaultModel");
    if (service === null || typeof service?.currentSelection !== "function") return null;
    try {
      const selection = service.currentSelection();
      return isRoute(selection) ? { provider: selection.provider, model: selection.model } : null;
    } catch {
      /* an unavailable default model leaves article tasks unconfigured */
      return null;
    }
  }

  /** @returns the configured, saved, or default model route. */
  function resolveRoute() {
    if (config.provider !== "" && config.model !== "") {
      return { provider: config.provider, model: config.model, source: "config" };
    }
    const saved = savedRoute();
    if (saved !== null && providerRegistered(saved.provider)) {
      return { ...saved, source: "custom" };
    }
    const fallback = defaultSelection();
    return fallback === null ? null : { ...fallback, source: "default" };
  }

  /** Analysis settings are independent from article creation settings. */
  function analysisOptions() {
    const db = state.db;
    const enabled = db === null ? undefined : getMeta(db, "analysisEnabled");
    const perSync = db === null ? undefined : getMeta(db, "analysisPerSync");
    return {
      enabled: enabled === undefined ? config.analysisEnabled : enabled === "true",
      perSync: perSync !== undefined && /^\d+$/.test(perSync) && Number(perSync) >= 1 && Number(perSync) <= 200
        ? Number(perSync) : config.analysisPerSync,
    };
  }

  function analysisSelection() {
    const pinned = config.analysisProvider && config.analysisModel
      ? { provider: config.analysisProvider, model: config.analysisModel } : null;
    const provider = state.db === null ? "" : String(getMeta(state.db, "analysisProvider") ?? "").trim();
    const model = state.db === null ? "" : String(getMeta(state.db, "analysisModel") ?? "").trim();
    const saved = provider && model ? { provider, model } : null;
    const selected = pinned ?? saved;
    const source = pinned ? "config" : saved ? "custom" : "inherited";
    if (selected && !providerRegistered(selected.provider)) {
      return { pinned, saved, effective: null, error: `分析服务商不可用：${selected.provider}，请重新选择文章分析模型。` };
    }
    const inherited = selected ?? resolveRoute();
    return {
      pinned, saved,
      effective: inherited ? { provider: inherited.provider, model: inherited.model, source } : null,
      error: inherited ? null : "没有可用的文章分析模型，请在设置中选择。",
    };
  }

  /** One bounded call, cancelled on plugin unload and after 90 seconds. */
  async function callAnalysisModel(route, { system, user, signal }) {
    const llm = ctx.get("llm");
    if (typeof llm?.prepareCall !== "function") throw new Error("LLM 服务不可用");
    const timeout = AbortSignal.timeout(90_000);
    const callSignal = AbortSignal.any([signal ?? controller.signal, timeout]);
    const work = async () => {
      const prepared = await llm.prepareCall({
        provider: route.provider, model: route.model, maxTokens: config.aiMaxTokens,
      }, callSignal, (controls, info) => {
        const off = info.reasoning?.efforts?.find((entry) => entry.id === "off");
        return off ? { ...controls, reasoningEffort: off.id } : controls;
      });
      let text = "";
      let stopped = false;
      for await (const chunk of prepared.stream({
        ...prepared.config, system,
        messages: [{ role: "user", content: [{ type: "text", text: user }] }],
        signal: callSignal,
      })) {
        callSignal.throwIfAborted();
        if (chunk.type === "text-delta") text += chunk.text;
        if (text.length > 100_000) throw new Error("分析响应超出长度限制");
        if (chunk.type === "finish") {
          if (chunk.reason.kind !== "stop") {
            const error = new Error(chunk.reason.failure?.message ?? `分析未完成：${chunk.reason.kind}`);
            error.code = chunk.reason.failure?.code ?? chunk.reason.kind;
            throw error;
          }
          stopped = true;
        }
      }
      if (!stopped) throw new Error("分析响应意外中断");
      return text;
    };
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(callSignal.reason ?? new Error("分析已取消"));
      if (callSignal.aborted) onAbort();
      else callSignal.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([work(), aborted]); }
    finally { callSignal.removeEventListener("abort", onAbort); }
  }

  /** Analyze a bounded recent queue after extraction, preserving successful fetches. */
  async function analyzeRecent(job, newIds) {
    const options = analysisOptions();
    if (!options.enabled) return { enabled: false, processed: 0 };
    const selection = analysisSelection();
    const route = selection.effective;
    if (!route) {
      setMeta(requireDb(), "analysisLastError", selection.error);
      return { enabled: true, processed: 0, error: selection.error };
    }
    const candidates = pendingAssessments(requireDb(), {
      newIds, sinceIso: isoDaysAgo(config.contentWindowDays), limit: options.perSync,
    });
    job.phase = "analysis";
    job.done = 0;
    job.total = candidates.length;
    if (!candidates.length) return { enabled: true, processed: 0, model: `${route.provider}/${route.model}` };
    try {
      const outcome = await assessArticles({
        articles: candidates, batchSize: config.aiBatchSize, focus: config.focus,
        signal: controller.signal, model: `${route.provider}/${route.model}`,
        callModel: (request) => callAnalysisModel(route, request),
        onProgress: (done) => { job.done = done; },
      });
      if (state.disposed) throw new Error("插件已卸载");
      for (const result of outcome.results) saveAssessment(requireDb(), result.id, result);
      for (const [id, error] of outcome.failures) saveAssessment(requireDb(), id, { status: "failed", error });
      const error = outcome.modelError || outcome.failures[0]?.[1] || "";
      setMeta(requireDb(), "analysisLastError", error);
      return { enabled: true, processed: candidates.length,
        succeeded: outcome.results.filter((item) => item.status !== "discarded").length,
        discarded: outcome.results.filter((item) => item.status === "discarded").length,
        provisional: outcome.results.filter((item) => item.status !== "discarded" && item.provisional).length,
        failed: outcome.failures.length, model: `${route.provider}/${route.model}`, error: error || null };
    } catch (error) {
      if (state.disposed || controller.signal.aborted) throw error;
      const reason = messageOf(error);
      setMeta(requireDb(), "analysisLastError", reason);
      for (const article of candidates) saveAssessment(requireDb(), article.id, { status: "failed", error: reason });
      return { enabled: true, processed: candidates.length, failed: candidates.length, error: reason };
    }
  }

  /**
   * List registered providers with the models each advertises.
   * One slow or failing provider must not block the settings panel.
   * @returns provider groups plus a service-level error.
   */
  async function modelCatalog() {
    const llm = ctx.get("llm");
    if (llm === null || typeof llm.listProviders !== "function") {
      return { providers: [], error: "LLM 服务不可用" };
    }
    let listed;
    try {
      listed = llm.listProviders();
    } catch (error) {
      return { providers: [], error: messageOf(error) };
    }
    const providers = [];
    for (const entry of Array.isArray(listed) ? listed : []) {
      const id = String(entry?.id ?? "").trim();
      if (id === "") continue;
      const provider = { id, name: String(entry?.name ?? id), models: [] };
      try {
        const models = typeof llm.listModels === "function"
          ? await withDeadline(llm.listModels(id), CATALOG_TIMEOUT_MS)
          : [];
        provider.models = (Array.isArray(models) ? models : [])
          .map((model) => ({
            id: String(model?.id ?? "").trim(),
            name: String(model?.name ?? model?.id ?? ""),
          }))
          .filter((model) => model.id !== "");
      } catch (error) {
        provider.error = messageOf(error);
      }
      providers.push(provider);
    }
    return { providers, error: null };
  }

  /**
   * Fetch one feed, store its newest entries, and record the outcome.
   * @param feed - feed row.
   * @param signal - plugin lifetime signal.
   * @returns inserted count and cache status.
   */
  async function fetchOneFeed(feed, signal) {
    const db = requireDb();
    const headers = { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8, text/html;q=0.7" };
    if (typeof feed.etag === "string" && feed.etag !== "") headers["if-none-match"] = feed.etag;
    if (typeof feed.last_modified === "string" && feed.last_modified !== "") {
      headers["if-modified-since"] = feed.last_modified;
    }
    const loaded = await fetchFeed(feed.xml_url, {
      headers,
      timeoutMs: config.requestTimeoutMs,
      signal,
      retries: 1,
      limit: config.itemsPerFeed,
    });
    const response = loaded.response;
    const at = nowIso();
    if (response.notModified) {
      markFeedResult(db, feed.id, {
        at,
        etag: response.etag || feed.etag || null,
        lastModified: response.lastModified || feed.last_modified || null,
      });
      return { inserted: 0, notModified: true };
    }
    const parsed = loaded.parsed;
    const warning = loaded.warnings?.length > 0
      ? `部分条目抓取失败（${loaded.warnings.length}）：${loaded.warnings[0]}` : null;
    const newest = parsed.items.slice(0, config.itemsPerFeed);
    const inserted = insertArticles(
      db,
      feed.id,
      newest,
      (iso) => localDate(new Date(iso), config.timeZone),
      at,
    );
    markFeedResult(db, feed.id, {
      at,
      etag: response.etag || null,
      lastModified: response.lastModified || null,
      error: warning,
    });
    return { inserted: inserted.length, ids: inserted.map((item) => item.id), format: parsed.format, source: loaded.source, ...(warning ? { error: warning } : {}) };
  }

  /**
   * Extract and store one article body. A missing URL, a bare site root, or a
   * failed page fetch degrades to the feed's own summary so the reader always
   * has text when the feed provided some.
   * @param article - article row with `id`, `url`, and `feed_summary`.
   * @returns the stored status and text.
   */
  async function extractOneArticle(article) {
    const body = await articleContent.extract(article);
    return { status: body.contentStatus, text: body.contentText, error: body.refreshError || body.contentError };
  }

  /**
   * Extract bodies for a bounded list of articles.
   * @param articles - article rows with `url`, `id`, and `feed_summary`.
   * @param job - job whose progress is reported.
   */
  async function extractContents(articles, job) {
    if (articles.length === 0) return;
    job.phase = "content";
    job.total = articles.length;
    job.done = 0;
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(5, articles.length));
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (!state.disposed) {
          const index = cursor;
          cursor += 1;
          if (index >= articles.length) return;
          try {
            await extractOneArticle(articles[index]);
          } catch (error) {
            if (controller.signal.aborted) return;
            console.error("[rss-brief] content extraction failed:", messageOf(error));
          }
          job.done += 1;
        }
      }),
    );
    job.done = articles.length;
  }

  /**
   * One full fetch cycle: OPML, feeds, then recent bodies.
   * @param job - job whose progress is reported.
   * @param options.limit - test-only feed cap; 0 means every feed.
   * @returns sync statistics.
   */
  async function syncWork(job, options) {
    const db = requireDb();
    job.phase = "opml";
    job.done = 0;
    job.total = 0;
    try {
      loadFeeds();
    } catch (error) {
      state.opmlError = messageOf(error);
      if (countEnabledFeeds(db) === 0) throw error;
    }
    const feeds = enabledFeeds(db);
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 0;
    const selected = limit > 0 ? feeds.slice(0, limit) : feeds;
    job.phase = "feeds";
    job.total = selected.length;
    job.done = 0;
    let cursor = 0;
    let inserted = 0;
    const newIds = [];
    let failures = 0;
    await Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(config.syncConcurrency, selected.length)) },
        async () => {
          while (!state.disposed) {
            const index = cursor;
            cursor += 1;
            if (index >= selected.length) return;
            const feed = selected[index];
            try {
              const result = await fetchOneFeed(feed, controller.signal);
              inserted += result.inserted;
              newIds.push(...(result.ids ?? []));
            } catch (error) {
              if (controller.signal.aborted) return;
              failures += 1;
              try {
                markFeedResult(db, feed.id, { at: nowIso(), error: messageOf(error) });
              } catch {
                /* a storage failure is reported by the job itself */
              }
            }
            job.done += 1;
          }
        },
      ),
    );
    if (state.disposed) throw new Error("插件已卸载");
    job.done = selected.length;
    const finishedAt = nowIso();
    if (limit === 0) setMeta(db, "lastFetchAt", finishedAt);

    const pending = pendingContent(db, {
      sinceIso: isoDaysAgo(config.contentWindowDays),
      limit: config.contentPerSync,
    });
    await extractContents(pending, job);
    const analysis = await analyzeRecent(job, newIds);
    return {
      feeds: selected.length,
      inserted,
      failures,
      contentProcessed: pending.length,
      analysis,
      at: finishedAt,
      limited: limit > 0,
    };
  }

  /** Run the due scheduled work, if any. */
  async function tick() {
    if (state.disposed) return;
    if (state.db === null) {
      try {
        initStorage();
        loadFeeds();
      } catch (error) {
        state.initError = state.db === null ? messageOf(error) : state.initError;
        state.opmlError = messageOf(error);
        return;
      }
    }
    if (state.running !== null) return;
    if (!fetchDue()) return;
    startJob("sync", (job) => syncWork(job, { limit: 0 }));
  }

  /** @returns the status payload for the tool and the routes. */
  function buildStatus() {
    const db = state.db;
    const base = {
      ok: db !== null && state.initError === null,
      dataDir: config.dataDir,
      opmlPath: config.opmlPath,
      timeZone: config.timeZone,
      fetchIntervalMinutes: effectiveFetchIntervalMinutes(),
      initError: state.initError,
      opmlError: state.opmlError,
      running: snapshotRunning(),
      lastRun: state.lastRun,
    };
    if (db === null) {
      return {
        ...base,
        feeds: { enabled: 0, errors: [] },
        articles: { total: 0, pendingContent: 0, pendingAi: 0, dates: [] },
        schedule: {
          lastFetchAt: null,
          nextSyncAt: null,
        },
        ai: null,
      };
    }
    const lastFetchAt = getMeta(db, "lastFetchAt") ?? null;
    const route = resolveRoute();
    const errors = feedErrors(db, 20);
    return {
      ...base,
      feeds: {
        enabled: countEnabledFeeds(db),
        errors: errors.map((row) => ({
          title: row.title,
          url: row.html_url || row.xml_url,
          error: row.last_error,
        })),
      },
      articles: articleCounts(db),
      analysis: { ...analysisOptions(), ...analysisSelection(), counts: assessmentCounts(db),
        lastError: getMeta(db, "analysisLastError") || null },
      schedule: {
        lastFetchAt,
        nextSyncAt: nextFetchAt(lastFetchAt),
      },
      ai: route === null ? null : { provider: route.provider, model: route.model, source: route.source },
    };
  }

  /** Register model-facing RSS operations. */
  function registerTools() {
    ctx.tools.register({
      name: "rss_brief_subscriptions",
      description: "List or manually add, update, or delete RSS subscriptions and their groups. Returns the full subscription snapshot; changes preserve article history and do not fetch feeds.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"], description: "Operation to perform." },
          revision: { type: "string", description: "Latest list revision; required for changes. Refresh after a conflict." },
          originalUrl: { type: "string", description: "Existing RSS URL; required for update/delete." },
          feed: {
            type: "object", description: "Complete subscription for add/update.",
            properties: {
              title: { type: "string", description: "Nonempty title, up to 300 characters." },
              xmlUrl: { type: "string", description: "Unique absolute HTTP(S) RSS URL." },
              htmlUrl: { type: "string", description: "HTTP(S) website URL, or empty." },
              group: { type: "string", description: "Nonempty category, up to 120 characters; 未分组 for ungrouped." },
            }, required: ["title", "xmlUrl", "htmlUrl", "group"], additionalProperties: false,
          },
        }, required: ["action"], additionalProperties: false,
      },
      output: { schema: {}, render: (_args, value) => [textBlock(renderValueText(value))] },
      async execute(args) {
        try { return subscriptions(args); }
        catch (error) { return { ok: false, code: error.code ?? "subscriptions-unavailable", status: error.statusCode ?? 503, message: messageOf(error) }; }
      },
    });
    ctx.tools.register({
      name: "rss_brief_status",
      description:
        "Report RSS feed synchronization: feed and article counts, last and next runs, AI route, and failing feeds.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: {
        schema: {},
        render: (_args, value) => [{ type: "text", text: renderStatus(value) }],
      },
      async execute() {
        return buildStatus();
      },
    });

    ctx.tools.register({
      name: "rss_brief_sync",
      description:
        "Fetch the enabled RSS feeds now, store new entries in SQLite, and extract recent article bodies. Starts a background run unless wait is true.",
      parameters: {
        type: "object",
        properties: {
          wait: {
            type: "boolean",
            description: "Wait for the run to finish, up to 90 seconds, instead of returning immediately.",
          },
          limit: {
            type: "integer",
            description: "Test-only cap on the number of feeds. Omit to fetch every enabled feed.",
          },
        },
        additionalProperties: false,
      },
      output: { schema: {}, render: (_args, value) => [textBlock(renderValueText(value))] },
      async execute(args) {
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 0;
        const outcome = startJob("sync", (job) => syncWork(job, { limit }));
        if (!outcome.started) {
          return {
            ok: false,
            code: outcome.busy ? "busy" : "unavailable",
            message: outcome.busy ? "已有任务在运行" : outcome.reason,
            running: snapshotRunning(),
          };
        }
        if (args.wait === true) {
          try {
            const settled = await waitForJob(outcome.job, SYNC_WAIT_MS);
            if (settled.timedOut) {
              return {
                ok: true,
                started: true,
                completed: false,
                message: "仍在后台运行",
                running: snapshotRunning(),
              };
            }
            return { ok: true, started: true, completed: true, result: settled.value, running: null };
          } catch (error) {
            return { ok: false, code: "failed", message: messageOf(error), running: snapshotRunning() };
          }
        }
        return {
          ok: true,
          started: true,
          completed: false,
          message: "后台抓取已开始，可用 rss_brief_status 查看进度",
          running: snapshotRunning(),
        };
      },
    });


  }

  /** Register the panel's read and action routes. */
  function registerRoutes() {
    const subscriptionsHandler = async (request, response) => {
      const method = request.method ?? "GET";
      if (!["GET", "POST"].includes(method)) {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" }); return;
      }
      const connection = ctx.get("connection");
      if (typeof connection?.admit !== "function") {
        writeJson(response, 503, { ok: false, code: "connection-unavailable", message: "应用认证服务暂不可用。" }); return;
      }
      const admission = connection.admit(request);
      if (admission.rejection || admission.peer?.principal?.kind !== "owner") {
        const status = admission.rejection ?? 403;
        writeJson(response, status, { ok: false, code: status === 401 ? "unauthorized" : "forbidden", message: "请从已登录的应用页面操作。" }); return;
      }
      if (method === "POST" && String(request.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        writeJson(response, 415, { ok: false, code: "invalid-content-type", message: "请以 JSON 提交订阅。" }); return;
      }
      try {
        if (state.disposed) throw Object.assign(new Error("插件暂不可用。"), { statusCode: 503 });
        const args = method === "GET" ? { action: "list" } : await readJsonBody(request);
        if (method === "POST" && args?.action === "list") throw Object.assign(new Error("POST 仅接受 add/update/delete。"), { statusCode: 400 });
        writeJson(response, 200, subscriptions(args));
      } catch (error) {
        writeJson(response, error.statusCode ?? 503, { ok: false, code: error.code ?? "subscriptions-unavailable", message: messageOf(error) });
      }
    };
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/subscriptions`, handler: subscriptionsHandler }),
      "rss-brief: subscriptions route",
    );
    const latestHandler = async (request, response) => {
      const method = request.method ?? "GET";
      const headOnly = method === "HEAD";
      if (method !== "GET" && !headOnly) {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      let options;
      try {
        const url = new URL(request.url ?? ROUTE_BASE, "http://rss-brief.invalid");
        options = { ...parseLatestParams(url.searchParams), highQualityThreshold: config.highQualityThreshold };
      } catch (error) {
        writeJson(response, 400, { ok: false, code: "invalid-parameters", error: messageOf(error) }, headOnly);
        return;
      }
      if (state.db === null) {
        writeJson(response, 503, {
          ok: false, code: "storage-unavailable", error: state.initError ?? "数据库未初始化",
        }, headOnly);
        return;
      }
      try {
        const { rows, pagination, latest } = latestArticles(state.db, options);
        const groups = new Map();
        for (const row of rows) {
          const label = row.opml_group;
          const id = `opml:${label}`;
          if (!groups.has(id)) groups.set(id, { id, label, items: [] });
          const article = toReportArticle(row, { highQualityThreshold: config.highQualityThreshold });
          groups.get(id).items.push({
            ...article,
            relevance: article.relevance,
            read: Boolean(row.is_read),
          });
        }
        const status = buildStatus();
        writeJson(response, 200, {
          ok: true, view: "latest", date: null, dates: [],
          report: {
            groups: [...groups.values()],
            stats: { feeds: status.feeds.enabled, included: pagination.total, candidates: pagination.total },
            generatedAt: null, fallback: false,
            warnings: status.analysis?.enabled && (status.analysis.error || status.analysis.lastError)
              ? [`文章分析：${status.analysis.error || status.analysis.lastError}`] : [],
          },
          pagination, latest, feeds: status.feeds, analysis: status.analysis,
          schedule: { ...status.schedule, timeZone: config.timeZone },
          running: snapshotRunning(), lastRun: state.lastRun,
        }, headOnly);
      } catch (error) {
        writeJson(response, 503, { ok: false, code: "storage-unavailable", error: messageOf(error) }, headOnly);
      }
    };

    const articleHandler = async (request, response) => {
      const method = request.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const url = new URL(request.url ?? ROUTE_BASE, "http://rss-brief.invalid");
      const rawId = url.searchParams.get("id") ?? "";
      const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) {
        writeJson(response, 400, { ok: false, code: "invalid-id", message: "id 必须是正整数" });
        return;
      }
      const db = state.db;
      if (db === null) {
        writeJson(response, 503, {
          ok: false,
          code: "storage-unavailable",
          error: state.initError ?? "数据库未初始化",
        });
        return;
      }
      let row = getArticle(db, id);
      if (row === undefined) {
        writeJson(response, 404, { ok: false, code: "article-not-found" });
        return;
      }
      const refresh = url.searchParams.get("refresh") === "1";
      const cacheOnly = url.searchParams.get("cacheOnly") === "1" || method === "HEAD";
      let body = articleContent.readCached(row);
      if (!cacheOnly && (refresh || body.needsExtraction)) {
        try {
          body = await articleContent.extract(row, { force: refresh });
        } catch (error) {
          if (!controller.signal.aborted) console.error("[rss-brief] on-demand extraction failed:", messageOf(error));
        }
      }
      if (state.disposed || response.destroyed) return;
      row = getArticle(db, id);
      if (row === undefined) {
        writeJson(response, 404, { ok: false, code: "article-not-found" }, method === "HEAD");
        return;
      }
      const text = body.contentText;
      writeJson(
        response,
        200,
        {
          ok: true,
          article: {
            id: row.id,
            title: row.title,
            url: row.url,
            feed: row.feed_title || row.feed_url,
            feedUrl: row.feed_html_url || row.feed_url,
            publishedAt: row.published_at,
            publishedDate: row.published_date,
            author: row.author,
            summary: row.assessment_summary || row.summary_zh || null,
            category: row.assessment_category || row.category,
            categoryLabel: CATEGORY_LABELS[row.assessment_category || row.category] ?? null,
            opmlGroup: row.opml_group ?? null,
            relevance: row.assessment_relevance ?? (row.relevance !== null && Number.isFinite(Number(row.relevance)) ? Number(row.relevance) : null),
            assessment: toReportArticle(row, { highQualityThreshold: config.highQualityThreshold }).assessment,
            ...body,
            contentText: text,
            chars: text.replace(/\s+/g, "").length,
            read: isRead(db, row.id),
          },
        },
        method === "HEAD",
      );
    };

    // Hotlink-protected images (403 without the article site's Referer) load
    // through here. Only images already present in that article's stored
    // document may be fetched, so this never acts as an open proxy.
    const imageHandler = async (request, response) => {
      if ((request.method ?? "GET") !== "GET") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const url = new URL(request.url ?? ROUTE_BASE, "http://rss-brief.invalid");
      const id = Number(url.searchParams.get("id"));
      const src = url.searchParams.get("src") ?? "";
      const row = Number.isSafeInteger(id) && id > 0 && state.db !== null ? getArticle(state.db, id) : undefined;
      if (row === undefined) {
        writeJson(response, 404, { ok: false, code: "article-not-found" });
        return;
      }
      const sources = new Set();
      (function collect(nodes) {
        for (const node of Array.isArray(nodes) ? nodes : []) {
          if (node?.type === "img" && typeof node.src === "string") sources.add(node.src);
          if (node?.type === "video" && typeof node.poster === "string") sources.add(node.poster);
          collect(node?.children);
        }
      })(articleContent.readCached(row).contentDocument?.children);
      if (!sources.has(src)) {
        writeJson(response, 404, { ok: false, code: "image-not-in-article" });
        return;
      }
      let referer;
      try { referer = `${new URL(row.url).origin}/`; } catch { referer = undefined; }
      try {
        const upstream = await fetch(src, {
          redirect: "follow",
          signal: AbortSignal.any([AbortSignal.timeout(15000), controller.signal]),
          headers: { "user-agent": DEFAULT_USER_AGENT, accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(referer ? { referer } : {}) },
        });
        const type = upstream.headers.get("content-type") ?? "";
        if (!upstream.ok || !/^image\//i.test(type)) {
          await upstream.body?.cancel().catch(() => {});
          writeJson(response, 502, { ok: false, code: "image-unavailable", status: upstream.status });
          return;
        }
        const body = await readLimited(upstream, 15 * 1024 * 1024);
        if (response.destroyed) return;
        response.writeHead(200, {
          "content-type": type,
          "content-length": body.length,
          "cache-control": "private, max-age=86400",
          "x-content-type-options": "nosniff",
          // An SVG opened directly must not run script on the app origin.
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        });
        response.end(body);
      } catch (error) {
        if (!response.headersSent && !response.destroyed) writeJson(response, 502, { ok: false, code: "image-unavailable", message: messageOf(error) });
      }
    };

    const readHandler = async (request, response) => {
      if ((request.method ?? "GET") !== "POST") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const id = Number(body?.id);
      const read = body?.read;
      if (!Number.isInteger(id) || id <= 0 || typeof read !== "boolean") {
        writeJson(response, 400, {
          ok: false,
          code: "invalid-read-request",
          message: "id 必须是正整数，read 必须是布尔值",
        });
        return;
      }
      const db = state.db;
      if (db === null) {
        writeJson(response, 503, {
          ok: false,
          code: "storage-unavailable",
          error: state.initError ?? "数据库未初始化",
        });
        return;
      }
      if (getArticle(db, id) === undefined) {
        writeJson(response, 404, { ok: false, code: "article-not-found" });
        return;
      }
      setRead(db, id, read);
      writeJson(response, 200, { ok: true, id, read });
    };

    const readAllHandler = async (request, response) => {
      if ((request.method ?? "GET") !== "POST") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const connection = ctx.get("connection");
      if (typeof connection?.admit !== "function") {
        writeJson(response, 503, { ok: false, code: "connection-unavailable", message: "应用认证服务暂不可用，请重新连接。" });
        return;
      }
      const admission = connection.admit(request);
      if (admission.rejection || admission.peer?.principal?.kind !== "owner") {
        writeJson(response, admission.rejection ?? 403, { ok: false, code: "unauthorized", message: "请从已登录的应用页面操作。" });
        return;
      }
      if (String(request.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        writeJson(response, 415, { ok: false, code: "invalid-content-type", message: "请以 JSON 提交当前列表筛选条件。" });
        return;
      }
      let scope;
      try {
        scope = parseBulkReadRequest(await readJsonBody(request));
      } catch (error) {
        writeJson(response, 400, { ok: false, code: "invalid-filter", message: error.message });
        return;
      }
      const db = state.db;
      if (db === null || state.disposed) {
        writeJson(response, 503, { ok: false, code: "storage-unavailable", message: "数据库暂不可用，请稍后重试。" });
        return;
      }
      try {
        const result = markLatestRead(db, { ...scope, highQualityThreshold: config.highQualityThreshold });
        writeJson(response, 200, { ok: true, ...result });
      } catch {
        writeJson(response, 503, { ok: false, code: "bulk-read-failed", message: "批量标记失败，请刷新列表后重试。" });
      }
    };

    const syncHandler = async (request, response) => {
      if ((request.method ?? "GET") !== "POST") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const limit = Number.isInteger(body?.limit) && body.limit > 0 ? body.limit : 0;
      const outcome = startJob("sync", (job) => syncWork(job, { limit }));
      if (!outcome.started) {
        writeJson(response, 200, {
          ok: false,
          code: outcome.busy ? "busy" : "unavailable",
          message: outcome.busy ? "已有任务在运行" : outcome.reason,
          running: snapshotRunning(),
        });
        return;
      }
      writeJson(response, 200, { ok: true, started: true, running: snapshotRunning() });
    };

    // Creating a draft starts a tool-enabled Agent. Use the Host's normal
    // owner admission rather than the legacy unauthenticated read routes.
    const createPublicationHandler = (manager) => async (request, response) => {
      const method = request.method ?? "GET";
      const headOnly = method === "HEAD";
      if (!["GET", "HEAD", "POST"].includes(method)) {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const connection = ctx.get("connection");
      if (typeof connection?.admit !== "function") {
        writeJson(response, 503, { ok: false, code: "connection-unavailable", message: "应用认证服务暂不可用，请重新连接。" }, headOnly);
        return;
      }
      const admission = connection.admit(request);
      if (admission.rejection || admission.peer?.principal?.kind !== "owner") {
        const status = admission.rejection ?? 403;
        writeJson(response, status, { ok: false, code: status === 401 ? "unauthorized" : "forbidden", message: "请从已登录的应用页面操作。" }, headOnly);
        return;
      }
      let id;
      if (method === "POST") {
        if (String(request.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          writeJson(response, 415, { ok: false, code: "invalid-content-type", message: "请以 JSON 提交文章 ID。" });
          return;
        }
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "id") || typeof body.id !== "number") {
          writeJson(response, 400, { ok: false, code: "invalid-body", message: "请求只能包含数字文章 ID。" });
          return;
        }
        id = body.id;
      } else {
        const url = new URL(request.url ?? ROUTE_BASE, "http://rss-brief.invalid");
        const ids = url.searchParams.getAll("id");
        id = ids.length === 1 && /^\d+$/.test(ids[0]) ? Number(ids[0]) : NaN;
      }
      if (!Number.isSafeInteger(id) || id <= 0) {
        writeJson(response, 400, { ok: false, code: "invalid-id", message: "id 必须是正整数。" }, headOnly);
        return;
      }
      try {
        if (state.disposed) {
          writeJson(response, 503, { ok: false, code: "unavailable", message: "插件正在重新加载，请稍后重试。" }, headOnly);
          return;
        }
        const task = method === "POST" ? await manager.start(id) : await manager.read(id);
        writeJson(response, 200, { ok: true, task }, headOnly);
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 503;
        writeJson(response, status, { ok: false, code: typeof error?.code === "string" ? error.code : "publication-unavailable", message: error?.statusCode ? error.message : "文章创作服务暂不可用，请稍后重试。" }, headOnly);
      }
    };

    const publicationHandler = createPublicationHandler(publications);
    const shareHandler = createPublicationHandler(shares);

    const scheduleHandler = async (request, response) => {
      const method = request.method ?? "GET";
      const headOnly = method === "HEAD";
      if (!["GET", "HEAD", "POST"].includes(method)) {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      const connection = ctx.get("connection");
      if (typeof connection?.admit !== "function") {
        writeJson(response, 503, { ok: false, code: "connection-unavailable", message: "应用认证服务暂不可用，请重新连接。" }, headOnly);
        return;
      }
      const admission = connection.admit(request);
      if (admission.rejection || admission.peer?.principal?.kind !== "owner") {
        const status = admission.rejection ?? 403;
        writeJson(response, status, { ok: false, code: status === 401 ? "unauthorized" : "forbidden", message: "请从已登录的应用页面操作。" }, headOnly);
        return;
      }
      let interval;
      if (method === "POST") {
        if (String(request.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          writeJson(response, 415, { ok: false, code: "invalid-content-type", message: "请以 JSON 提交抓取间隔。" });
          return;
        }
        const body = await readJsonBody(request);
        interval = body?.fetchIntervalMinutes;
        if (body === null || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).some((key) => key !== "fetchIntervalMinutes") ||
            !Number.isInteger(interval) || interval < 5 || interval > 10_080) {
          writeJson(response, 400, { ok: false, code: "invalid-body", message: "fetchIntervalMinutes 必须是 5..10080 范围内的整数。" });
          return;
        }
      }
      if (state.db === null || state.disposed) {
        writeJson(response, 503, { ok: false, code: "storage-unavailable", message: "数据库暂不可用，请稍后重试。" }, headOnly);
        return;
      }
      try {
        if (method === "POST") setMeta(state.db, "fetchIntervalMinutes", String(interval));
        writeJson(response, 200, buildScheduleSettings(), headOnly);
        if (method === "POST") void tick();
      } catch (error) {
        writeJson(response, 503, { ok: false, code: "schedule-unavailable", error: messageOf(error) }, headOnly);
      }
    };

    const settingsHandler = async (request, response) => {
      const method = request.method ?? "GET";
      const headOnly = method === "HEAD";
      if (method === "GET" || headOnly) {
        try {
          const catalog = await modelCatalog();
          writeJson(response, 200, {
            ok: true,
            timeZone: config.timeZone,
            pinned:
              config.provider !== "" && config.model !== ""
                ? { provider: config.provider, model: config.model }
                : null,
            saved: savedRoute(),
            effective: resolveRoute(),
            default: defaultSelection(),
            providers: catalog.providers,
            catalogError: catalog.error,
          }, headOnly);
        } catch (error) {
          writeJson(response, 500, { ok: false, code: "settings-failed", error: messageOf(error) }, headOnly);
        }
        return;
      }
      if (method !== "POST") {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" });
        return;
      }
      if (config.provider !== "" && config.model !== "") {
        writeJson(response, 409, {
          ok: false,
          code: "model-pinned",
          message: `模型已由插件配置固定为 ${config.provider}/${config.model}`,
        });
        return;
      }
      const db = state.db;
      if (db === null) {
        writeJson(response, 503, {
          ok: false,
          code: "storage-unavailable",
          error: state.initError ?? "数据库未初始化",
        });
        return;
      }
      const body = await readJsonBody(request);
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        writeJson(response, 400, { ok: false, code: "invalid-body", message: "请求体必须是 JSON 对象" });
        return;
      }
      if (typeof body.provider !== "string" || typeof body.model !== "string") {
        writeJson(response, 400, {
          ok: false,
          code: "invalid-body",
          message: "provider 和 model 必须是字符串",
        });
        return;
      }
      const provider = body.provider.trim();
      const model = body.model.trim();
      if (provider.length > 200 || model.length > 200) {
        writeJson(response, 400, { ok: false, code: "invalid-body", message: "provider 或 model 过长" });
        return;
      }
      if (provider === "" && model === "") {
        setMeta(db, AI_PROVIDER_KEY, "");
        setMeta(db, AI_MODEL_KEY, "");
        writeJson(response, 200, { ok: true, saved: null, effective: resolveRoute() });
        return;
      }
      if (provider === "" || model === "") {
        writeJson(response, 400, {
          ok: false,
          code: "invalid-body",
          message: "provider 和 model 必须同时提供，或同时留空恢复默认",
        });
        return;
      }
      let catalog;
      try {
        catalog = await modelCatalog();
      } catch (error) {
        writeJson(response, 503, { ok: false, code: "catalog-unavailable", message: messageOf(error) });
        return;
      }
      if (catalog.error !== null) {
        writeJson(response, 503, { ok: false, code: "catalog-unavailable", message: catalog.error });
        return;
      }
      const group = catalog.providers.find((entry) => entry.id === provider);
      if (group === undefined) {
        writeJson(response, 400, {
          ok: false,
          code: "unknown-provider",
          message: `未注册的模型服务商：${provider}`,
        });
        return;
      }
      if (group.error !== undefined) {
        writeJson(response, 503, { ok: false, code: "catalog-unavailable", message: group.error });
        return;
      }
      if (!group.models.some((entry) => entry.id === model)) {
        writeJson(response, 400, {
          ok: false,
          code: "unknown-model",
          message: `${provider} 未提供模型：${model}`,
        });
        return;
      }
      setMeta(db, AI_PROVIDER_KEY, provider);
      setMeta(db, AI_MODEL_KEY, model);
      writeJson(response, 200, { ok: true, saved: { provider, model }, effective: resolveRoute() });
    };

    const analysisSettingsHandler = async (request, response) => {
      const method = request.method ?? "GET";
      const headOnly = method === "HEAD";
      if (!["GET", "HEAD", "POST"].includes(method)) {
        writeJson(response, 405, { ok: false, code: "method-not-allowed" }); return;
      }
      const connection = ctx.get("connection");
      if (typeof connection?.admit !== "function") {
        writeJson(response, 503, { ok: false, code: "connection-unavailable", message: "应用认证服务暂不可用。" }, headOnly); return;
      }
      const admission = connection.admit(request);
      if (admission.rejection || admission.peer?.principal?.kind !== "owner") {
        const status = admission.rejection ?? 403;
        writeJson(response, status, { ok: false, code: status === 401 ? "unauthorized" : "forbidden", message: "请从已登录的应用页面操作。" }, headOnly); return;
      }
      if (state.db === null || state.disposed) {
        writeJson(response, 503, { ok: false, code: "storage-unavailable", message: "数据库暂不可用。" }, headOnly); return;
      }
      try {
        if (method === "POST") {
          if (String(request.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
            writeJson(response, 415, { ok: false, code: "invalid-content-type", message: "请以 JSON 提交分析设置。" }); return;
          }
          const body = await readJsonBody(request);
          if (!body || typeof body !== "object" || Array.isArray(body) ||
              Object.keys(body).some((key) => !["provider", "model", "enabled", "perSync"].includes(key)) ||
              typeof body.provider !== "string" || typeof body.model !== "string" || typeof body.enabled !== "boolean" ||
              !Number.isInteger(body.perSync) || body.perSync < 1 || body.perSync > 200) {
            writeJson(response, 400, { ok: false, code: "invalid-body", message: "请提供 provider、model 字符串、enabled 布尔值及 1..200 的整数 perSync。" }); return;
          }
          const provider = body.provider.trim(), model = body.model.trim();
          if (provider.length > 200 || model.length > 200 || Boolean(provider) !== Boolean(model)) {
            writeJson(response, 400, { ok: false, code: "invalid-body", message: "服务商和模型须成对指定，或同时留空。" }); return;
          }
          const pinned = analysisSelection().pinned;
          if (pinned && provider && (provider !== pinned.provider || model !== pinned.model)) {
            writeJson(response, 409, { ok: false, code: "model-pinned", message: "分析模型已由插件配置固定。" }); return;
          }
          if (!pinned && provider) {
            const catalog = await modelCatalog();
            const group = catalog.providers.find((entry) => entry.id === provider);
            if (catalog.error || group?.error) {
              writeJson(response, 503, { ok: false, code: "catalog-unavailable", message: catalog.error || group.error }); return;
            }
            if (!group || !group.models.some((entry) => entry.id === model)) {
              writeJson(response, 400, { ok: false, code: "unknown-model", message: "请选择已注册服务商提供的模型。" }); return;
            }
          }
          if (state.disposed || state.db === null) {
            writeJson(response, 503, { ok: false, code: "unavailable", message: "插件正在重新加载。" }); return;
          }
          const db = requireDb();
          db.exec("BEGIN IMMEDIATE");
          try {
            if (!pinned) {
              setMeta(db, "analysisProvider", provider);
              setMeta(db, "analysisModel", model);
            }
            setMeta(db, "analysisEnabled", String(body.enabled));
            setMeta(db, "analysisPerSync", String(body.perSync));
            db.exec("COMMIT");
          } catch (error) { db.exec("ROLLBACK"); throw error; }
          writeJson(response, 200, { ok: true, ...analysisOptions(), ...analysisSelection(), default: resolveRoute() });
          return;
        }
        const catalog = await modelCatalog();
        writeJson(response, 200, { ok: true, ...analysisOptions(), ...analysisSelection(),
          default: resolveRoute(), providers: catalog.providers, catalogError: catalog.error }, headOnly);
      } catch (error) {
        writeJson(response, 503, { ok: false, code: "analysis-settings-unavailable", message: messageOf(error) }, headOnly);
      }
    };

    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/analysis-settings`, handler: analysisSettingsHandler }),
      "rss-brief: analysis settings route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/state`, handler: latestHandler }),
      "rss-brief: state route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/latest`, handler: latestHandler }),
      "rss-brief: latest route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/article`, handler: articleHandler }),
      "rss-brief: article route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/image`, handler: imageHandler }),
      "rss-brief: article image route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/read`, handler: readHandler }),
      "rss-brief: read route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/read-all`, handler: readAllHandler }),
      "rss-brief: bulk read route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/sync`, handler: syncHandler }),
      "rss-brief: sync route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/schedule`, handler: scheduleHandler }),
      "rss-brief: schedule route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/settings`, handler: settingsHandler }),
      "rss-brief: settings route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/publication`, handler: publicationHandler }),
      "rss-brief: publication route",
    );
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: `${ROUTE_BASE}/share`, handler: shareHandler }),
      "rss-brief: share route",
    );
  }

  /** Open storage and load the OPML before the plugin starts scheduling. */
  try {
    initStorage();
    try {
      const loaded = loadFeeds();
      console.log(`[rss-brief] loaded ${loaded.total} feeds from ${config.opmlPath}`);
    } catch (error) {
      state.opmlError = messageOf(error);
      console.error("[rss-brief] initial OPML load failed:", state.opmlError);
    }
  } catch (error) {
    state.initError = messageOf(error);
    console.error("[rss-brief] storage initialization failed:", state.initError);
  }

  registerTools();
  registerRoutes();
  ctx.effect(
    () => {
      const timer = setInterval(() => {
        void tick();
      }, 60_000);
      return () => clearInterval(timer);
    },
    "rss-brief: minute tick",
  );
  ctx.effect(
    () => {
      const timer = setTimeout(() => {
        void tick();
      }, 5_000);
      return () => clearTimeout(timer);
    },
    "rss-brief: initial tick",
  );
  ctx.effect(
    () => () => {
      state.disposed = true;
      publications.dispose();
      shares.dispose();
      controller.abort();
      if (state.db !== null) {
        closeDatabase(state.db);
        state.db = null;
      }
    },
    "rss-brief: shutdown",
  );
}

/**
 * Normalize and validate the bundle row config.
 * @param raw - untrusted config.
 * @returns complete configuration.
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  // dataDir selects the local settings file; the file cannot redirect itself.
  const dataDir = resolve(String(source.dataDir ?? DEFAULTS.dataDir));
  const localPath = join(dataDir, "config.json");
  let local = {};
  try { local = JSON.parse(readFileSync(localPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error(`RSS 本机配置无法读取：${localPath}`); }
  if (local === null || typeof local !== "object" || Array.isArray(local)) throw new Error(`RSS 本机配置必须是对象：${localPath}`);
  const saved = Object.fromEntries(Object.entries(local).filter(([key]) => key !== "dataDir" && Object.hasOwn(DEFAULTS, key)));
  const config = { ...DEFAULTS, ...saved, ...source, dataDir };
  const opml = String(config.opmlPath ?? "").trim();
  config.opmlPath = opml ? resolve(opml) : join(dataDir, "subscriptions.opml");
  config.articleWorkspace = resolve(String(config.articleWorkspace ?? "").trim() || (opml ? dirname(config.opmlPath) : join(dataDir, "workspace")));
  config.timeZone = isValidTimeZone(config.timeZone) ? String(config.timeZone) : DEFAULTS.timeZone;
  config.focus = String(config.focus ?? DEFAULTS.focus).slice(0, 300);
  config.provider = String(config.provider ?? "").trim();
  config.model = String(config.model ?? "").trim();
  if (config.provider === "" || config.model === "") {
    config.provider = "";
    config.model = "";
  }
  config.analysisProvider = String(config.analysisProvider ?? "").trim();
  config.analysisModel = String(config.analysisModel ?? "").trim();
  if (Boolean(config.analysisProvider) !== Boolean(config.analysisModel)) throw new Error("analysisProvider 和 analysisModel 必须成对配置");
  config.analysisEnabled = typeof config.analysisEnabled === "boolean" ? config.analysisEnabled : DEFAULTS.analysisEnabled;
  config.analysisPerSync = integerOf(config.analysisPerSync, DEFAULTS.analysisPerSync, 1, 200);
  config.highQualityThreshold = integerOf(config.highQualityThreshold, DEFAULTS.highQualityThreshold, 60, 100);
  config.fetchIntervalMinutes = integerOf(config.fetchIntervalMinutes, DEFAULTS.fetchIntervalMinutes, 5, 10_080);
  config.syncConcurrency = integerOf(config.syncConcurrency, DEFAULTS.syncConcurrency, 1, 16);
  config.requestTimeoutMs = integerOf(config.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 5_000, 60_000);
  config.itemsPerFeed = integerOf(config.itemsPerFeed, DEFAULTS.itemsPerFeed, 1, 100);
  config.contentWindowDays = integerOf(config.contentWindowDays, DEFAULTS.contentWindowDays, 1, 30);
  config.contentPerSync = integerOf(config.contentPerSync, DEFAULTS.contentPerSync, 0, 500);
  config.aiBatchSize = integerOf(config.aiBatchSize, DEFAULTS.aiBatchSize, 1, 20);
  config.aiMaxTokens = integerOf(config.aiMaxTokens, DEFAULTS.aiMaxTokens, 256, 8192);
  return config;
}

/**
 * Clamp an integer config value.
 * @param value - candidate.
 * @param fallback - value used when the candidate is not finite.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns clamped integer.
 */
function integerOf(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** @returns an ISO timestamp. */
function nowIso() {
  return new Date().toISOString();
}

/** @returns one error message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * Bound one asynchronous lookup without accepting a caller signal.
 * @param promise - lookup to race.
 * @param timeoutMs - deadline in milliseconds.
 * @returns the lookup result.
 */
function withDeadline(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("查询模型列表超时")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** @returns the summary of a completed job without large fields. */
function summarizeRun(value) {
  if (value === null || typeof value !== "object") return null;
  const summary = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "markdown" || key === "payload") continue;
    summary[key] =
      typeof item === "string" && item.length > 500 ? `${item.slice(0, 500)}…` : item;
  }
  return summary;
}

/** Local timestamp label for status output. */
function localStamp(iso, timeZone) {
  if (typeof iso !== "string" || iso === "") return "";
  const text = formatLocalDateTime(iso, timeZone);
  return text === "" ? iso : text;
}

/** Render the status tool as a short human-readable report. */
function renderStatus(value) {
  const lines = [`RSS 最新文章：${value.ok === false ? "不可用" : "运行中"}`];
  if (value.initError) lines.push(`存储错误：${value.initError}`);
  if (value.opmlError) lines.push(`OPML 错误：${value.opmlError}`);
  lines.push(`数据目录：${value.dataDir}`);
  lines.push(`OPML：${value.opmlPath || "未配置"}`);
  if (value.feeds) lines.push(`订阅源：启用 ${value.feeds.enabled}，失败 ${value.feeds.errors.length}`);
  if (value.articles) {
    lines.push(
      `文章：共 ${value.articles.total}，待正文 ${value.articles.pendingContent}，待 AI ${value.articles.pendingAi}`,
    );
  }
  if (value.schedule) {
    lines.push(
      `上次抓取：${localStamp(value.schedule.lastFetchAt, value.timeZone) || "从未"}`,
    );
    lines.push(
      `下次抓取：${value.schedule.nextSyncAt === "尽快" ? "尽快" : localStamp(value.schedule.nextSyncAt, value.timeZone) || "尽快"}`,
    );

  }
  if (value.running) {
    lines.push(
      `进行中：${value.running.kind}/${value.running.phase} ${value.running.done}/${value.running.total}`,
    );
  }
  if (value.lastRun && value.lastRun.ok === false) {
    lines.push(`上次任务失败：${value.lastRun.error}`);
  }
  if (value.analysis) {
    const analysis = value.analysis;
    const route = analysis.effective;
    lines.push(`文章分析：${analysis.enabled ? "启用" : "关闭"}，每轮最多 ${analysis.perSync} 篇`);
    if (route) lines.push(`分析模型：${route.provider}/${route.model}`);
    if (analysis.counts) lines.push(`评分：已评 ${analysis.counts.assessed}，待评 ${analysis.counts.pending}，失败 ${analysis.counts.failed}，过期 ${analysis.counts.stale}，已丢弃 ${analysis.counts.discarded ?? 0}`);
    if (analysis.error || analysis.lastError) lines.push(`分析错误：${analysis.error || analysis.lastError}`);
  }
  if (value.ai) {
    const source = { config: "配置固定", custom: "自定义", default: "跟随默认" }[value.ai.source];
    lines.push(`AI：${value.ai.provider}/${value.ai.model}${source ? `（${source}）` : ""}`);
  }
  return lines.join("\n");
}

/** Render a tool value: Markdown when present, otherwise compact JSON. */
function renderValueText(value) {  if (value !== null && typeof value === "object" && typeof value.markdown === "string" && value.markdown !== "") {
    return truncate(value.markdown, 60_000);
  }
  return truncate(JSON.stringify(value, null, 2), 20_000);
}

/** Build one text content block. */
function textBlock(text) {
  return { type: "text", text: String(text) };
}

/** Read a small JSON request body. */
function readJsonBody(request) {
  return new Promise((settle) => {
    let size = 0;
    let oversized = false;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) {
        settle(null);
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        settle(null);
        return;
      }
      try {
        settle(JSON.parse(text));
      } catch {
        settle(null);
      }
    });
    request.on("error", () => settle(null));
  });
}

/** Parse latest-view query values without permissive numeric coercion. */
function parseLatestParams(params) {
  const integer = (name, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
    const values = params.getAll(name);
    if (values.length === 0) return fallback;
    const text = values[0];
    const value = Number(text);
    if (values.length !== 1 || !/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} 必须是 ${min}..${max} 范围内的整数`);
    }
    return value;
  };
  for (const name of ["q", "category", "unread", "quality"]) {
    if (params.getAll(name).length > 1) throw new Error(`${name} 不可重复`);
  }
  const category = params.get("category") ?? undefined;
  if (category !== undefined && (!category.startsWith("opml:") || category.length <= 5)) {
    throw new Error("category 必须是 opml: 分类键");
  }
  const quality = params.get("quality") ?? "all";
  if (!["all", "high"].includes(quality)) throw new Error("quality 必须是 all 或 high");
  const unread = params.get("unread");
  if (unread !== null && unread !== "0" && unread !== "1") throw new Error("unread 必须是 0 或 1");
  return {
    limit: integer("limit", 100, 1, 200),
    offset: integer("offset", 0, 0),
    snapshot: integer("snapshot", undefined, 0),
    feed: integer("feed", undefined, 1),
    q: params.get("q") ?? "", category, unread: unread === "1", quality,
  };
}

/** Write one JSON response. */
function writeJson(response, status, body, headOnly = false) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(headOnly ? undefined : text);
}
