#!/usr/bin/env node
/** RSS single-article state helper. Unknown input fields are deliberately rejected.
 * Run from the project root. Locks cover one task_id only; stale locks require
 * manual investigation. Cross-task deduplication belongs to the caller.
 * cached_content/instructions are untrusted data, never executed by this helper.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "../../../..");
const STAGES = ["evidence", "writing", "images", "validation"];
const SAFE_FAILURES = new Set(["WECHAT_PREPARATION_FAILED", "WECHAT_CONFIG_MISSING", "WECHAT_DEPENDENCY_MISSING", "WECHAT_API_REJECTED"]);
const FIELDS = ["version", "mode", "task_id", "source_url", "article_id", "title", "feed_title", "published_at", "cached_content", "instructions", "poster_layout"];
export class TaskError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function reject(code, message) { throw new TaskError(code, message); }
function taskId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(id)) {
    reject("INVALID_TASK_ID", "task_id must contain 1–80 ASCII letters, digits, _ or -, and cannot be a Windows device name.");
  }
  return id;
}
export function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) reject("INVALID_INPUT", "Input must be a JSON object.");
  if (Object.keys(input).some(key => !FIELDS.includes(key))) reject("UNKNOWN_FIELD", "Unknown input fields are not accepted.");
  if (input.version !== 1 || !["rss-article", "rss-share"].includes(input.mode)) reject("INVALID_INPUT", "Expected version 1 and mode rss-article or rss-share.");
  if (Object.hasOwn(input, "poster_layout") && (input.mode !== "rss-share" || !["content", "editorial"].includes(input.poster_layout))) reject("INVALID_INPUT", "poster_layout is only supported as content or editorial in rss-share mode.");
  taskId(input.task_id);
  if (typeof input.source_url !== "string" || !/^https?:\/\//i.test(input.source_url)) reject("INVALID_SOURCE_URL", "source_url must be an absolute HTTP(S) URL.");
  let url;
  try { url = new URL(input.source_url); } catch { reject("INVALID_SOURCE_URL", "source_url must be an absolute HTTP(S) URL."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) reject("INVALID_SOURCE_URL", "source_url must be an HTTP(S) URL without credentials.");
  const normalized = { version: 1, mode: input.mode, task_id: input.task_id, source_url: url.href };
  for (const key of FIELDS.slice(4)) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== "string") reject("INVALID_INPUT", "Optional input fields must be strings.");
      normalized[key] = input[key];
    }
  }
  if (normalized.published_at !== undefined) {
    const timestamp = normalized.published_at;
    const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
    const year = Number(match?.[1]);
    const month = Number(match?.[2]);
    const day = Number(match?.[3]);
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!match || !Number.isFinite(Date.parse(timestamp)) || day < 1 || day > (days[month - 1] ?? 0)) reject("INVALID_PUBLISHED_AT", "published_at must be a valid ISO timestamp with a time zone.");
  }
  return normalized;
}
function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { reject("INVALID_STATE", "A required JSON file is missing or invalid."); }
}
export function usableConfiguration(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = value.trim();
  return !(/[<>]|^(?:\$\{|%[A-Za-z_]+%$)|^(?:your(?:[_ -]|$)|replace(?:[_ -]|$)|change[-_ ]?me|placeholder|todo|dummy|example(?:[_ -]|$)|xxx+$|none$|null$)/i.test(text));
}
function ancestorDirs(root) {
  const dirs = [];
  for (let current = root;; current = path.dirname(current)) {
    dirs.push(current);
    if (path.dirname(current) === current) return dirs;
  }
}
export function configurationReport(root, environment = process.env) {
  const dirs = ancestorDirs(root);
  let azure = {};
  for (const directory of dirs) {
    const file = path.join(directory, ".env");
    if (!fs.existsSync(file)) continue;
    try {
      for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const at = line.indexOf("=");
        azure[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']+|["']+$/g, "");
      }
    } catch { reject("CONFIG_READ_FAILED", "Could not read an Azure configuration file."); }
    break;
  }
  const wechat = {};
  for (const directory of [...dirs].reverse()) {
    const file = path.join(directory, ".env");
    if (!fs.existsSync(file)) continue;
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const raw of content.split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.slice(7).trimStart();
      const at = line.indexOf("=");
      if (at < 0) continue;
      const key = line.slice(0, at).trim();
      if (!["WECHAT_APP_ID", "WECHAT_APP_SECRET"].includes(key)) continue;
      let value = line.slice(at + 1).trim();
      if (value.length >= 2 && value[0] === value.at(-1) && ["\"", "'"].includes(value[0])) value = value.slice(1, -1);
      else if (value.includes(" #")) value = value.split(" #", 1)[0].trimEnd();
      if (value) wechat[key] = value;
    }
  }
  const names = ["AZURE_IMAGE_ENDPOINT", "AZURE_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "WECHAT_APP_ID", "WECHAT_APP_SECRET"];
  const resolved = Object.fromEntries(names.map(name => [name, name.startsWith("AZURE_") ? (environment[name] || azure[name]) : (Object.hasOwn(environment, name) ? environment[name] : wechat[name])]));
  const variables = Object.fromEntries(names.map(name => [name, usableConfiguration(resolved[name])]));
  // Match Azure's endpoint selection, including its preference for IMAGE_ENDPOINT.
  const azureReady = resolved.AZURE_IMAGE_ENDPOINT ? (variables.AZURE_IMAGE_ENDPOINT && variables.AZURE_API_KEY) : (variables.AZURE_OPENAI_ENDPOINT && variables.AZURE_OPENAI_API_KEY);
  const wechatReady = variables.WECHAT_APP_ID && variables.WECHAT_APP_SECRET;
  return { version: 1, mode: "rss-article", ok: Boolean(azureReady && wechatReady), azure_ready: Boolean(azureReady), wechat_ready: wechatReady, variables, error: azureReady && wechatReady ? null : { code: "CONFIG_MISSING", message: "Required Azure image or WeChat configuration is missing, empty or a placeholder." } };
}

/** Injection points are module APIs for offline tests, never CLI switches. */
export function createTaskRunner({ workspace = PROJECT_ROOT, environment = process.env, mode = "rss-article", validator, runBridge } = {}) {
  if (!["rss-article", "rss-share"].includes(mode)) reject("INVALID_MODE", "Expected rss-article or rss-share mode.");
  const root = fs.realpathSync(workspace);
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  function safe(file, boundary = root) {
    const absolute = path.resolve(file);
    if (!inside(boundary, absolute)) reject("PATH_ESCAPE", "Task paths must remain inside the task workspace.");
    let current = absolute;
    while (!fs.existsSync(current)) {
      // A broken symlink must not be treated as a missing, safe path.
      try { if (fs.lstatSync(current).isSymbolicLink()) reject("PATH_ESCAPE", "Symbolic links cannot escape the task workspace."); }
      catch (error) { if (error instanceof TaskError) throw error; if (error.code !== "ENOENT") throw error; }
      const parent = path.dirname(current);
      if (parent === current) reject("PATH_ESCAPE", "Cannot resolve task path.");
      current = parent;
    }
    if (!inside(boundary, fs.realpathSync(current))) reject("PATH_ESCAPE", "A symbolic link or junction escapes the task workspace.");
    // Check each component, including links that leave and re-enter the boundary.
    let component = boundary;
    for (const part of path.relative(boundary, absolute).split(path.sep).filter(Boolean)) {
      component = path.join(component, part);
      if (fs.existsSync(component) && !inside(boundary, fs.realpathSync(component))) reject("PATH_ESCAPE", "A symbolic link or junction escapes the task workspace.");
    }
    return absolute;
  }
  function directory(file) {
    safe(file);
    if (!fs.existsSync(file)) {
      directory(path.dirname(file));
      try { fs.mkdirSync(file); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    safe(file);
    if (!fs.statSync(file).isDirectory()) reject("INVALID_STATE", "Expected a task directory.");
  }
  function taskPaths(id, create = false) {
    taskId(id);
    const dir = path.join(root, "output", mode === "rss-share" ? "rss-shares" : "rss-articles", id);
    safe(dir);
    if (create) directory(dir);
    const get = name => safe(path.join(dir, name), dir);
    return { dir, input: get("input.json"), result: get("result.json"), article: get(mode === "rss-share" ? "caption.txt" : "article.md"), share: get("share.json"), assets: get("assets"), notes: get("source-notes.md"), lock: get(".lock") };
  }
  function atomic(file, value) {
    safe(file);
    const temp = safe(path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`));
    let fd;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      safe(file);
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  async function locked(id, create, fn) {
    const files = taskPaths(id, create);
    if (!fs.existsSync(files.dir)) reject("TASK_NOT_FOUND", "Task has not been initialized.");
    const token = randomUUID();
    let fd;
    try { fd = fs.openSync(files.lock, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") reject("TASK_LOCKED", "This task is locked; inspect an existing or stale lock manually. Locks are never automatically removed."); throw error; }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }));
      fs.closeSync(fd); fd = undefined;
      return await fn(files, token);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      safe(files.lock, files.dir);
      // Never remove a lock another owner replaced.
      if (fs.existsSync(files.lock) && readJson(files.lock).token === token) fs.unlinkSync(files.lock);
    }
  }
  function load(files) {
    const input = normalizeInput(readJson(files.input));
    const result = readJson(files.result);
    if (input.task_id !== path.basename(files.dir) || result.version !== 1 || result.mode !== mode || input.mode !== mode || result.task_id !== input.task_id || result.source_url !== input.source_url || result.article_path !== relative(files.article) || !["running", "succeeded", "failed", "needs_attention"].includes(result.status) || ![...STAGES, "wechat_draft"].includes(result.stage) || (result.status === "succeeded" && (typeof result.media_id !== "string" || !result.media_id.trim()))) {
      reject("INVALID_STATE", "Stored task state does not match its input or fixed paths.");
    }
    if (mode === "rss-share") {
      const taskRel = relative(files.dir);
      const imageRel = value => {
        if (typeof value !== "string") return false;
        const prefix = `${taskRel}/assets/`;
        return value.startsWith(prefix) && /^(\d{2})-([a-z0-9][a-z0-9-]{0,23})\.(png|jpg)$/.test(value.slice(prefix.length));
      };
      const imagePaths = Array.isArray(result.image_paths) ? result.image_paths : null;
      if (result.article_type !== "newspic" || !Number.isInteger(result.image_count) || result.image_count < 1 || result.image_count > 3 || result.caption_path !== relative(files.article) || !Array.isArray(result.inline_image_paths) || result.inline_image_paths.length || result.poster_path !== result.cover_path || (result.poster_path !== null && !imageRel(result.poster_path))) reject("INVALID_STATE", "Stored share result does not match its image paths.");
      if (imagePaths && (imagePaths.length !== result.image_count || !imagePaths.every(imageRel) || imagePaths[0] !== result.poster_path)) reject("INVALID_STATE", "Stored share result image list is inconsistent.");
    }
    return { input, result };
  }
  function save(files, result, changes) {
    const next = { ...result, ...changes, updated_at: new Date().toISOString() };
    atomic(files.result, next);
    return next;
  }
  function unknown(files, result) {
    const hasDraft = typeof result.media_id === "string" && Boolean(result.media_id.trim());
    return save(files, result, { status: "needs_attention", stage: "wechat_draft", error: { code: "WECHAT_SUBMISSION_UNKNOWN", message: hasDraft ? "A draft already exists. Inspect the saved draft manually before taking any further action." : "Draft submission may have reached WeChat. Check the draft box manually before taking any further action." } });
  }
  function protectedState(files, result) {
    // Keep historical successes and attention states intact; never recreate a saved draft.
    if (["succeeded", "needs_attention"].includes(result.status)) return result;
    if (typeof result.media_id === "string" && result.media_id.trim()) return unknown(files, result);
    if (result.stage === "wechat_draft" && !(result.status === "failed" && SAFE_FAILURES.has(result.error?.code))) return unknown(files, result);
    return null;
  }
  function asset(files, reference, cover = false) {
    if (typeof reference !== "string" || !reference || /[?#\\]/.test(reference) || path.isAbsolute(reference) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) reject("INVALID_ASSET", "Images must use local paths inside this task's assets directory.");
    let decoded;
    try { decoded = decodeURIComponent(reference); } catch { reject("INVALID_ASSET", "An image path is invalid."); }
    const file = safe(path.resolve(files.dir, decoded), files.dir);
    safe(file, files.assets);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !/\.(?:png|jpg)$/i.test(file)) reject("INVALID_ASSET", "Images must be existing PNG or JPG files inside this task's assets directory.");
    if (cover && !/^01-cover\.(?:png|jpg)$/i.test(path.basename(file))) reject("INVALID_COVER", "The cover must be assets/01-cover.png or assets/01-cover.jpg.");
    return file;
  }
  async function inspectArticle(files, input) {
    safe(files.article, files.dir);
    if (mode === "rss-share") {
      const api = validator || await import("./validate-share.mjs");
      try { return api.readShare(files.dir, {source:input.source_url}); }
      catch { reject("VALIDATION_FAILED", "Share validation failed; run validate-share.mjs for details."); }
    }
    let api = validator;
    if (!api) api = await import("./validate-article.mjs");
    if (typeof api.validateArticle !== "function" || typeof api.parseFrontmatter !== "function") reject("VALIDATOR_UNAVAILABLE", "The validator must export validateArticle and parseFrontmatter with RSS mode support.");
    const errors = await api.validateArticle(files.article, { mode: "rss-article" });
    if (!Array.isArray(errors) || errors.length) reject("VALIDATION_FAILED", "Article validation failed; run the article validator for details.");
    const parsed = api.parseFrontmatter(fs.readFileSync(files.article, "utf8"));
    if (parsed.error || !parsed.values || ["title", "description", "ogImage", "source"].some(key => typeof parsed.values[key] !== "string" || !parsed.values[key].trim())) reject("VALIDATION_FAILED", "Article frontmatter is incomplete.");
    const values = parsed.values;
    if (values.source !== input.source_url) reject("SOURCE_MISMATCH", "Article source must exactly match normalized input source_url.");
    const cover = asset(files, values.ogImage, true);
    const body = typeof api.rssImageSource === "function" ? api.rssImageSource(parsed.body) : parsed.body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
      .replace(/(`+)[^\n]*?\1/g, "");
    // Reuse the validator's image parser so examples, comments and reference
    // sections cannot become publisher inputs. The fallback serves test doubles.
    const references = typeof api.extractRssImages === "function"
      ? api.extractRssImages(parsed.body).map(image => image.reference)
      : [...body.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)].map(match => match[1] ?? match[2]);
    const inline = [...new Set(references.map(ref => asset(files, ref)))];
    if (!inline.some(file => /^02-illustration-[A-Za-z0-9_-]+\.(?:png|jpg)$/i.test(path.basename(file)))) reject("INLINE_IMAGE_REQUIRED", "At least one local assets/02-illustration-topic.png or .jpg body image is required.");
    return { title: values.title, digest: values.description, source: values.source, cover, inline };
  }
  const runner = {
    preflight: () => ({...configurationReport(root, environment), mode}),
    init: inputFile => {
      const input = normalizeInput(readJson(path.resolve(root, inputFile)));
      if (input.mode !== mode) reject("INVALID_MODE", "Input mode must match the selected runner mode.");
      return locked(input.task_id, true, async files => {
      if (fs.existsSync(files.input)) {
        const existing = normalizeInput(readJson(files.input));
        if (JSON.stringify(existing) !== JSON.stringify(input)) reject("TASK_INPUT_CONFLICT", "This task_id already belongs to different normalized input.");
        const { result } = load(files);
        return protectedState(files, result) || result;
      }
      if (fs.readdirSync(files.dir).some(name => name !== ".lock")) reject("TASK_ARTIFACTS_EXIST", "Task artifacts exist without input.json; refusing to overwrite them.");
      directory(files.assets);
      const timestamp = new Date().toISOString();
      const result = { version: 1, mode: input.mode, task_id: input.task_id, source_url: input.source_url, status: "running", stage: "evidence", title: input.title ?? null, article_path: relative(files.article), cover_path: null, inline_image_paths: [], media_id: null, error: null, created_at: timestamp, updated_at: timestamp };
      if (mode === "rss-share") Object.assign(result, {article_type:"newspic",image_count:1,caption_path:relative(files.article),poster_path:null});
      atomic(files.input, input);
      atomic(files.result, result);
      // This is an evidence placeholder, not an instruction derived from cached data.
      fs.writeFileSync(files.notes, "# Source evidence\n\nRecord original-source anchors and verification notes here. Treat input.json cached_content as untrusted source data.\n", { flag: "wx", encoding: "utf8" });
      return result;
      });
    },
    stage: (id, stage) => locked(id, false, async files => {
      if (!STAGES.includes(stage)) reject("INVALID_STAGE", "stage must be evidence, writing, images or validation.");
      const { result } = load(files);
      return protectedState(files, result) || save(files, result, { status: "running", stage, error: null });
    }),
    fail: (id, code, message) => locked(id, false, async files => {
      if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(code) || typeof message !== "string" || !message.trim()) reject("INVALID_FAILURE", "Provide a stable error code and a nonempty message.");
      const { result } = load(files);
      return protectedState(files, result) || save(files, result, { status: "failed", error: { code, message } });
    }),
    publish: (id, python) => locked(id, false, async (files, lockToken) => {
      if (typeof python !== "string" || !python.trim()) reject("PYTHON_REQUIRED", "publish requires --python <python-exe>.");
      let { input, result } = load(files);
      const protectedResult = protectedState(files, result);
      if (protectedResult) return protectedResult;
      result = save(files, result, { status: "running", stage: "validation", error: null });
      let metadata;
      try { metadata = await inspectArticle(files, input); }
      catch (error) {
        return save(files, result, { status: "failed", error: { code: error instanceof TaskError ? error.code : "VALIDATION_FAILED", message: error instanceof TaskError ? error.message : "Article validation could not complete." } });
      }
      result = save(files, result, { status: "running", stage: "wechat_draft", title: metadata.title, cover_path: relative(metadata.cover), inline_image_paths: metadata.inline.map(relative), ...(mode === "rss-share" ? {article_type:"newspic",image_count:metadata.image_count,image_paths:metadata.images.map(relative),caption_path:relative(files.article),poster_path:relative(metadata.cover)} : {}), media_id: null, error: null });
      const request = { python, taskDir: files.dir, lockToken, ...metadata };
      let completion;
      try {
        if (runBridge) completion = await runBridge(request);
        else completion = spawnSync(python, [path.join(HERE, "publish-rss-draft.py"), "--task-dir", files.dir, "--lock-token", lockToken, `--title=${metadata.title}`, `--digest=${metadata.digest}`, `--source=${metadata.source}`], { cwd: root, env: environment, stdio: "ignore", windowsHide: true });
      } catch { completion = null; }
      let current;
      try { current = load(files).result; } catch { return unknown(files, result); }
      // Always reread durable state, even when the bridge threw after saving a draft.
      // The media_id is sufficient to confirm a successful draft save.
      if (current.status === "succeeded" && typeof current.media_id === "string" && current.media_id.trim()) return current;
      const currentProtected = protectedState(files, current);
      if (currentProtected) return currentProtected;
      if (!completion || completion.error || completion.signal || completion.status !== 0) return unknown(files, current);
      if (current.status === "failed" && SAFE_FAILURES.has(current.error?.code)) return current;
      return unknown(files, current);
    }),
  };
  return runner;
}

export async function main(argv = process.argv.slice(2)) {
  if (fs.realpathSync(process.cwd()) !== fs.realpathSync(PROJECT_ROOT)) reject("WORKSPACE_REQUIRED", "Run rss-task.mjs from the project root.");
  let mode = "rss-article";
  if (argv[0] === "--mode") { mode = argv[1]; argv = argv.slice(2); }
  const runner = createTaskRunner({mode});
  const [command, ...args] = argv;
  if (command === "preflight" && !args.length) return runner.preflight();
  if (command === "init" && args.length === 1) return runner.init(args[0]);
  if (command === "stage" && args.length === 2) return runner.stage(...args);
  if (command === "fail" && args.length === 3) return runner.fail(...args);
  if (command === "publish" && args.length === 3 && args[1] === "--python") return runner.publish(args[0], args[2]);
  reject("INVALID_ARGUMENTS", "Usage: rss-task.mjs [--mode rss-article|rss-share] init <input.json> | preflight | stage <task_id> <stage> | fail <task_id> <code> <message> | publish <task_id> --python <python-exe>");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    process.stdout.write(JSON.stringify(result) + "\n");
    if (result.error || ["failed", "needs_attention"].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: { code: error instanceof TaskError ? error.code : "TASK_OPERATION_FAILED", message: error instanceof TaskError ? error.message : "Task operation failed. Inspect local files and permissions." } }) + "\n");
    process.exitCode = 1;
  }
}
