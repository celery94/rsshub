#!/usr/bin/env node
/** Offline only: real rss-task filesystem, simulated host services, no Agent/network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicationManager, PublicationError } from "../lib/publication.js";

// Fail immediately if this test or an accidentally imported dependency attempts fetch.
const previousFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN_IN_OFFLINE_TEST"); };
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(pluginRoot, "skills/create-blog-post-from-url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-publication-check-"));
let count = 0;
const fixtures = [];
function fixture(options = {}) {
  const workspace = path.join(root, `case-${fixtures.length}`, "workspace");
  const dataDir = path.join(root, `case-${fixtures.length}`, "data");
  const skill = path.join(root, `case-${fixtures.length}`, "installed-skills/create-blog-post-from-url");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(skill, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(skill, "references"), { recursive: true });
  for (const relative of ["scripts/rss-task.mjs", "SKILL.md", "references/rss-article-workflow.md"]) fs.copyFileSync(path.join(source, relative), path.join(skill, relative));
  if (options.configuration !== false) fs.writeFileSync(path.join(workspace, ".env"), "AZURE_IMAGE_ENDPOINT=https://offline.invalid\nAZURE_API_KEY=offline-check-value\nWECHAT_APP_ID=offline-check-value\nWECHAT_APP_SECRET=offline-check-value\n");
  const agents = new Map();
  const listeners = new Set();
  const events = new Map();
  const calls = { create: [], prompt: [], select: [], resolve: [], inspect: 0, defaults: 0, body: 0, rows: 0 };
  const row = { id: 17, url: "https://example.com/article", title: "Original title", feed_title: "Feed", published_at: "2026-11-04T00:00:00Z" };
  let route = { provider: "rss-provider", model: "rss-model", source: "rss-settings" };
  const body = options.body || { contentSource: "web", contentText: "完整的缓存正文", truncated: false, needsExtraction: false };
  const services = {
    agents,
    llm: { async resolveCallConfig(request) { calls.resolve.push(request); if (options.modelFailure) throw new Error("https://token.example/?secret=DO_NOT_LEAK"); return { provider: "resolved-provider", model: "resolved-model", reasoningEffort: "high" }; } },
    workspaceRegistry: { async create(directory) { assert.equal(directory, workspace); return { id: "workspace-1" }; } },
    sessionController: {
      async create(request) {
        calls.create.push(request);
        const sessionId = `session-${calls.create.length}`;
        const agent = { id: sessionId, status: "idle", inbox: { nextTurn: [], nextStep: [] }, model: { select(selection) { calls.select.push({ agent, selection }); } } };
        agents.set(sessionId, agent);
        return { sessionId };
      },
      async selectModel() { calls.defaults++; throw new Error("Must never save global defaults"); },
      async prompt(request, signal) {
        assert(signal instanceof AbortSignal); calls.prompt.push(request);
        if (options.admissionError) throw new Error("TOKEN_OR_MODEL_ERROR_DO_NOT_LEAK");
        if (options.beforeAdmission) await options.beforeAdmission();
        agents.get(request.sessionId).status = "running";
        return { accepted: true };
      },
      async events(request, signal) {
        calls.inspect++; assert(signal instanceof AbortSignal);
        assert.deepEqual(request.address, { kind: "session", sessionId: request.address.sessionId });
        assert.equal(request.maxMessages, 1);
        return { records: (events.get(request.address.sessionId) || []).map(event => ({ type: "event", event })), hasMore: false, cursor: 0 };
      },
    },
  };
  const ctx = { get: name => services[name], on(name, handler) { assert.equal(name, "session/event"); listeners.add(handler); return () => listeners.delete(handler); } };
  const args = { ctx, workspaceDir: workspace, skillRoot: skill, dataDir, getArticle: async id => { calls.rows++; return id === row.id ? row : null; }, readCached: async () => { calls.body++; return body; }, resolveRoute: async () => route };
  const manager = createPublicationManager(args);
  const f = { workspace, dataDir, skill, agents, events, listeners, calls, row, services, args, manager, route(value) { route = value; },
    paths(task) { const dir = path.join(workspace, "output/rss-articles", task.taskId); return { dir, result: path.join(dir, "result.json"), input: path.join(dir, "input.json"), meta: path.join(dataDir, "publications/17.json"), lock: path.join(dataDir, "publications/17.lock") }; },
    update(task, changes) { const p = f.paths(task); const result = JSON.parse(fs.readFileSync(p.result, "utf8")); fs.writeFileSync(p.result, JSON.stringify({ ...result, ...changes })); },
    finish(task, reason = "completed") { const agent = agents.get(task.sessionId); if (agent) agent.status = "idle"; const event = { type: "turn/end", reason: { kind: reason } }; events.set(task.sessionId, [event]); for (const listener of listeners) listener({ id: task.sessionId }, event); },
    async runner() { return (await import(pathToFileURL(path.join(skill, "scripts/rss-task.mjs")).href)).createTaskRunner({ workspace }); },
  };
  fixtures.push(f);
  return f;
}
async function check(name, run) { await run(); count++; console.log(`ok ${count} - ${name}`); }
async function rejects(promise, code, statusCode) {
  await assert.rejects(promise, error => error instanceof PublicationError && error.code === code && (!statusCode || error.statusCode === statusCode) && !/DO_NOT_LEAK|token\.example/.test(error.message));
}
try {
  await check("empty GET is lazy and article existence is server checked", async () => {
    const f = fixture();
    f.services.sessionController = undefined; f.services.llm = undefined;
    assert.equal(await f.manager.read(17), null);
    assert.equal(f.calls.body, 0); assert.equal(f.calls.resolve.length, 0);
    await rejects(f.manager.read(18), "ARTICLE_NOT_FOUND", 404);
    await rejects(f.manager.start(18), "ARTICLE_NOT_FOUND", 404);
    assert.throws(() => f.manager.start("../17"), { code: "INVALID_ARTICLE_ID" });
    assert(!fs.existsSync(f.dataDir));
  });
  await check("missing skill and host services fail safely", async () => {
    const f = fixture(); fs.unlinkSync(path.join(f.skill, "scripts/rss-task.mjs"));
    assert.equal(await f.manager.read(17), null);
    await rejects(f.manager.start(17), "SKILL_UNAVAILABLE", 503);
    const g = fixture(); g.services.sessionController = undefined;
    await rejects(g.manager.start(17), "AGENT_UNAVAILABLE", 503);
    assert.equal(g.calls.create.length, 0);
  });
  await check("current controller without legacy agents/inspect APIs selects the task model before prompt", async () => {
    const f = fixture();
    assert.equal(f.services.sessionController.agents, undefined);
    assert.equal(f.services.sessionController.inspect, undefined);
    const prompt = f.services.sessionController.prompt;
    f.services.sessionController.prompt = async (...args) => {
      assert.equal(f.calls.select.length, 1);
      assert.equal(f.calls.defaults, 0);
      return prompt(...args);
    };
    const task = await f.manager.start(17);
    assert.equal(task.status, "running");
    assert.equal(f.calls.select[0].agent.id, task.sessionId);
    assert.equal(f.calls.prompt.length, 1);
  });
  await check("missing Agent model capability fails before prompt admission", async () => {
    const f = fixture();
    const create = f.services.sessionController.create;
    f.services.sessionController.create = async request => {
      const created = await create(request);
      delete f.agents.get(created.sessionId).model;
      return created;
    };
    await rejects(f.manager.start(17), "AGENT_UNAVAILABLE", 503);
    assert.equal(f.calls.prompt.length, 0);
    assert.equal(f.calls.defaults, 0);
  });
  await check("configuration preflight runs before any model or session", async () => {
    const f = fixture({ configuration: false });
    // createTaskRunner uses the process environment; clear only relevant config for this test.
    const keys = ["AZURE_IMAGE_ENDPOINT", "AZURE_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "WECHAT_APP_ID", "WECHAT_APP_SECRET"];
    const saved = keys.map(key => [key, process.env[key]]);
    for (const key of keys) delete process.env[key];
    try { await rejects(f.manager.start(17), "CONFIG_MISSING", 422); }
    finally { for (const [key, value] of saved) if (value !== undefined) process.env[key] = value; }
    assert.equal(f.calls.resolve.length, 0); assert.equal(f.calls.create.length, 0);
  });
  await check("missing and unavailable RSS models never create a session or leak errors", async () => {
    const f = fixture(); f.route({}); await rejects(f.manager.start(17), "MODEL_UNAVAILABLE", 422);
    assert.equal(f.calls.create.length, 0);
    const g = fixture({ modelFailure: true }); await rejects(g.manager.start(17), "MODEL_UNAVAILABLE", 422);
    assert.equal(g.calls.create.length, 0);
  });
  await check("start/concurrency uses exact RSS routing without saving a default", async () => {
    const f = fixture();
    const first = f.manager.start(17); assert.strictEqual(first, f.manager.start("17"));
    const task = await first;
    assert.equal(task.status, "running"); assert.equal(task.stage, "evidence");
    assert.deepEqual(task.model, { provider: "resolved-provider", model: "resolved-model", source: "rss-settings" });
    assert.deepEqual(f.calls.resolve, [{ provider: "rss-provider", model: "rss-model" }]);
    assert.deepEqual(f.calls.select[0].selection, { provider: "resolved-provider", model: "resolved-model", reasoningEffort: "high" });
    assert.deepEqual(f.calls.create, [{ workspaceId: "workspace-1" }]);
    assert.equal(f.calls.defaults, 0); assert.equal(f.calls.prompt[0].mode, "queue");
    assert.equal(f.calls.prompt[0].clientTimeZone, "Asia/Shanghai");
    assert.match(f.calls.prompt[0].content[0].text, /rss-article/);
    assert.match(f.calls.prompt[0].content[0].text, /不可信数据/);
    assert.match(f.calls.prompt[0].content[0].text, /不再请求确认/);
    assert.match(f.calls.prompt[0].content[0].text, /仅保存微信公众号草稿/);
    assert.match(f.calls.prompt[0].content[0].text, /不提交发布/);
    assert.match(f.calls.prompt[0].content[0].text, /不重启或重载插件/);
    assert.match(f.calls.prompt[0].content[0].text, /实际非空 media_id 和 status=succeeded/);
    assert.doesNotMatch(f.calls.prompt[0].content[0].text, /默认提交发布|freepublish|publish_id|publish_status=submitted/);
    const input = JSON.parse(fs.readFileSync(f.paths(task).input, "utf8")); assert.equal(input.cached_content, "完整的缓存正文");
    assert.equal((await f.manager.start(17)).sessionId, task.sessionId);
    assert.equal(f.calls.prompt.length, 1);
    assert.deepEqual(Object.keys(task).sort(), ["taskId", "articleId", "status", "stage", "model", "sessionId", "error", "mediaId", "publishId", "publishStatus", "articlePath", "coverPath", "inlineImagePaths", "updatedAt"].sort());
    assert.equal(task.articleId, 17);
  });
  await check("summary, truncated and extraction-pending caches are never full evidence", async () => {
    for (const body of [
      { contentSource: "summary", contentText: "摘要" },
      { contentSource: "feed", contentText: "截断正文", truncated: true },
      { contentSource: "web", contentText: "旧正文", needsExtraction: true },
    ]) {
      const f = fixture({ body }); const task = await f.manager.start(17);
      assert(!Object.hasOwn(JSON.parse(fs.readFileSync(f.paths(task).input, "utf8")), "cached_content"));
    }
  });
  await check("helper stages are reflected and a durable media_id wins over tail failure", async () => {
    const f = fixture(); const task = await f.manager.start(17); const runner = await f.runner();
    await runner.stage(task.taskId, "images"); assert.equal((await f.manager.read(17)).stage, "images");
    const prefix = `output/rss-articles/${task.taskId}`;
    f.update(task, { status: "succeeded", stage: "wechat_draft", media_id: "offline-media-id", cover_path: `${prefix}/assets/01-cover.png`, inline_image_paths: [`${prefix}/assets/02-illustration-flow.png`] });
    f.finish(task, "error");
    const saved = fs.readFileSync(f.paths(task).result, "utf8");
    const final = await f.manager.read(17);
    assert.equal(final.status, "succeeded"); assert.equal(final.error, null); assert.equal(final.mediaId, "offline-media-id"); assert.equal(final.inlineImagePaths.length, 1);
    assert.equal(final.publishId, null); assert.equal(final.publishStatus, null);
    assert(!Object.keys(JSON.parse(saved)).some(key => key.startsWith("publish")));
    f.services.llm = undefined; assert.equal((await f.manager.start(17)).mediaId, "offline-media-id");
    assert.equal(f.calls.prompt.length, 1);
    assert.equal(fs.readFileSync(f.paths(task).result, "utf8"), saved);
  });
  await check("historical publication fields remain read-only and do not alter stored draft success", async () => {
    for (const publishStatus of ["submitted", "rejected", "unknown"]) {
      const f = fixture(); const task = await f.manager.start(17);
      f.update(task, { status: "succeeded", stage: "wechat_draft", media_id: "draft", publish_id: "historical-job", publish_status: publishStatus });
      f.finish(task, "error");
      const saved = fs.readFileSync(f.paths(task).result, "utf8");
      const state = await f.manager.read(17);
      assert.equal(state.status, "succeeded"); assert.equal(state.publishId, "historical-job"); assert.equal(state.publishStatus, publishStatus);
      await f.manager.start(17); assert.equal(f.calls.prompt.length, 1);
      assert.equal(fs.readFileSync(f.paths(task).result, "utf8"), saved);
    }
  });
  await check("saved drafts needing attention stay read-only with or without historical publication fields", async () => {
    for (const publishStatus of [undefined, "submitted", "rejected", "unknown"]) {
      const f = fixture(); const task = await f.manager.start(17);
      const code = publishStatus === "rejected" ? "WECHAT_PUBLISH_REJECTED" : publishStatus ? "WECHAT_PUBLISH_UNKNOWN" : "WECHAT_SUBMISSION_UNKNOWN";
      f.update(task, { status: "needs_attention", stage: "wechat_draft", media_id: "draft", publish_id: publishStatus ? "historical-job" : undefined, publish_status: publishStatus, error: { code, message: "DO_NOT_LEAK" } });
      f.finish(task);
      const saved = fs.readFileSync(f.paths(task).result, "utf8");
      const state = await f.manager.read(17);
      assert.equal(state.status, "needs_attention"); assert.equal(state.mediaId, "draft");
      assert.equal(state.publishId, publishStatus ? "historical-job" : null); assert.equal(state.publishStatus, publishStatus || null);
      assert.equal(state.error.code, code); assert(!state.error.message.includes("DO_NOT_LEAK"));
      assert.equal((await f.manager.start(17)).status, "needs_attention"); assert.equal(f.calls.prompt.length, 1);
      assert.equal(fs.readFileSync(f.paths(task).result, "utf8"), saved);
    }
  });
  await check("publication checkpoint remains running only while its Agent is active", async () => {
    const f = fixture(); const task = await f.manager.start(17);
    f.update(task, { status: "running", stage: "wechat_draft", media_id: "draft", publish_status: "unknown" });
    assert.equal((await f.manager.read(17)).status, "running");
    f.finish(task, "aborted");
    assert.equal((await f.manager.read(17)).status, "needs_attention");
    await f.manager.start(17); assert.equal(f.calls.prompt.length, 1);
  });
  await check("ended Agent without result fails and explicit POST retries with immutable input", async () => {
    const f = fixture(); const task = await f.manager.start(17); const original = fs.readFileSync(f.paths(task).input, "utf8");
    f.finish(task); const failed = await f.manager.read(17);
    assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "AGENT_INCOMPLETE");
    const before = f.calls.prompt.length; await f.manager.read(17); assert.equal(f.calls.prompt.length, before);
    f.row.title = "Changed RSS title"; f.row.url = "https://changed.invalid/";
    const retry = await f.manager.start(17); assert.equal(retry.taskId, task.taskId); assert.notEqual(retry.sessionId, task.sessionId);
    assert.equal(fs.readFileSync(f.paths(task).input, "utf8"), original); assert.equal(f.calls.body, 1);
  });
  await check("raw helper error messages are never returned", async () => {
    const f = fixture(); const task = await f.manager.start(17); await (await f.runner()).fail(task.taskId, "SOURCE_INCOMPLETE", "https://token.example/?secret=DO_NOT_LEAK");
    const state = await f.manager.read(17); assert.equal(state.status, "failed"); assert.equal(state.error.code, "SOURCE_INCOMPLETE"); assert(!state.error.message.includes("token"));
    assert.equal((await f.manager.start(17)).sessionId, task.sessionId); assert.equal(f.calls.prompt.length, 1);
  });
  await check("terminal helper failures retain a safe stable code", async () => {
    const f = fixture(); const task = await f.manager.start(17);
    await (await f.runner()).fail(task.taskId, "SOURCE_INCOMPLETE", "DO_NOT_LEAK"); f.finish(task, "error");
    const state = await f.manager.read(17); assert.equal(state.error.code, "SOURCE_INCOMPLETE"); assert(!state.error.message.includes("DO_NOT_LEAK"));
  });
  await check("two managers cannot overlap admission or overwrite the owner's metadata", async () => {
    let release, reached;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { reached = resolve; });
    const f = fixture({ beforeAdmission: async () => { reached(); await gate; } });
    const first = f.manager.start(17); await ready;
    const manager = createPublicationManager(f.args);
    try {
      assert.equal((await manager.read(17)).status, "running");
      await rejects(manager.start(17), "TASK_LOCKED", 409);
      const meta = JSON.parse(fs.readFileSync(path.join(f.dataDir, "publications/17.json"), "utf8"));
      assert.equal(meta.phase, "admitting"); assert.equal(meta.status, "running"); assert.equal(f.calls.create.length, 1);
    } finally { release(); await first; manager.dispose(); }
  });
  await check("orphaned running helper without metadata requires manual attention", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.manager.dispose(); fs.unlinkSync(f.paths(task).meta);
    const manager = createPublicationManager(f.args);
    assert.equal((await manager.read(17)).status, "needs_attention");
    await manager.start(17); assert.equal(f.calls.prompt.length, 1); manager.dispose();
  });
  await check("admission errors become needs_attention and cannot resubmit", async () => {
    const f = fixture({ admissionError: true }); const task = await f.manager.start(17);
    assert.equal(task.status, "needs_attention"); assert.equal(task.error.code, "SUBMISSION_UNKNOWN");
    assert.equal((await f.manager.start(17)).status, "needs_attention"); assert.equal(f.calls.prompt.length, 1);
  });
  await check("hot reload reuses live Agent without changing its model", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.manager.dispose(); assert.equal(f.listeners.size, 0);
    const manager = createPublicationManager(f.args); f.route({ provider: "other", model: "other" });
    assert.equal((await manager.read(17)).sessionId, task.sessionId);
    assert.equal((await manager.start(17)).sessionId, task.sessionId);
    assert.equal(f.calls.prompt.length, 1); assert.equal(f.calls.resolve.length, 1);
    assert.equal(f.agents.get(task.sessionId).status, "running"); manager.dispose();
  });
  await check("queued inbox remains running even before Agent status changes", async () => {
    const f = fixture(); const task = await f.manager.start(17);
    const agent = f.agents.get(task.sessionId); agent.status = "idle"; agent.inbox.nextTurn = [{ type: "text" }];
    assert.equal((await f.manager.read(17)).status, "running");
    assert.equal((await f.manager.start(17)).sessionId, task.sessionId); assert.equal(f.calls.inspect, 0);
    agent.inbox.nextTurn = []; f.finish(task); assert.equal((await f.manager.read(17)).status, "failed");
  });
  await check("whenIdle reconciles completion without an event service", async () => {
    let settle;
    const idle = new Promise(resolve => { settle = resolve; });
    const f = fixture(); f.args.ctx.on = undefined;
    const originalCreate = f.services.sessionController.create;
    f.services.sessionController.create = async request => {
      const created = await originalCreate(request);
      f.agents.get(created.sessionId).whenIdle = () => idle;
      return created;
    };
    const task = await f.manager.start(17); f.agents.get(task.sessionId).status = "idle"; settle();
    // Let the registered whenIdle continuation record completion; no timer or polling.
    await idle; await Promise.resolve();
    const state = await f.manager.read(17);
    assert.equal(state.status, "failed"); assert.equal(state.error.code, "AGENT_INCOMPLETE"); assert.equal(f.calls.create.length, 1);
  });
  await check("cold recovery reads terminal events without resuming an Agent", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.manager.dispose(); f.agents.clear();
    f.events.set(task.sessionId, [{ type: "turn/end", reason: { kind: "blocked" } }]);
    const manager = createPublicationManager(f.args); const state = await manager.read(17);
    assert.equal(state.status, "failed"); assert.equal(state.error.code, "AGENT_INCOMPLETE"); assert(f.calls.inspect > 0);
    assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 1); manager.dispose();
  });
  await check("missing durable completion is unknown and never auto-retried", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.manager.dispose(); f.agents.clear();
    const manager = createPublicationManager(f.args); const state = await manager.read(17);
    assert.equal(state.status, "needs_attention"); assert.equal(state.error.code, "SUBMISSION_UNKNOWN");
    await manager.start(17); assert.equal(f.calls.prompt.length, 1); manager.dispose();
  });
  await check("interrupted WeChat submission requires attention even with terminal event", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.update(task, { stage: "wechat_draft" }); f.finish(task, "aborted");
    const state = await f.manager.read(17); assert.equal(state.status, "needs_attention"); assert.equal(state.error.code, "WECHAT_SUBMISSION_UNKNOWN");
    await f.manager.start(17); assert.equal(f.calls.prompt.length, 1);
  });
  await check("same workspace helper success survives missing plugin metadata", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.update(task, { status: "succeeded", stage: "wechat_draft", media_id: "saved-media" }); f.manager.dispose(); fs.unlinkSync(f.paths(task).meta);
    f.services.sessionController = undefined; f.services.llm = undefined;
    const manager = createPublicationManager(f.args); assert.equal((await manager.start(17)).mediaId, "saved-media"); assert.equal(f.calls.prompt.length, 1); manager.dispose();
  });
  await check("changed workspace defaults retain old task workspace, identifiers and results", async () => {
    const f = fixture(); const task = await f.manager.start(17);
    f.update(task, { status: "succeeded", stage: "wechat_draft", media_id: "historical-draft", publish_id: "old-publish", publish_status: "submitted" });
    const bytes = fs.readFileSync(f.paths(task).result, "utf8");
    const replacement = path.join(root, "new-default-workspace"); fs.mkdirSync(replacement);
    const manager = createPublicationManager({ ...f.args, workspaceDir: replacement });
    try {
      const read = await manager.read(17); assert.equal(read.taskId, task.taskId); assert.equal(read.mediaId, "historical-draft");
      assert.equal((await manager.start(17)).taskId, task.taskId); assert.equal(f.calls.create.length, 1);
      assert.equal(fs.readFileSync(f.paths(task).result, "utf8"), bytes);
      assert.equal(fs.readdirSync(replacement).length, 0);
    } finally { manager.dispose(); }
  });
  await check("failed historical task retries in its original workspace with the packaged helper", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.finish(task);
    await f.manager.read(17);
    const replacement = path.join(root, "retry-default-workspace"); fs.mkdirSync(replacement);
    const manager = createPublicationManager({ ...f.args, workspaceDir: replacement });
    try {
      const retried = await manager.start(17); assert.equal(retried.taskId, task.taskId); assert.equal(retried.status, "running");
      assert.equal(JSON.parse(fs.readFileSync(f.paths(task).meta)).workspaceDir, f.workspace);
      assert.match(f.calls.prompt.at(-1).content[0].text, /--workspace/);
      assert.ok(!fs.existsSync(path.join(f.workspace, ".agents")));
      assert.equal(fs.readdirSync(replacement).length, 0);
    } finally { manager.dispose(); }
  });
  await check("unsafe result paths are rejected", async () => {
    const f = fixture(); const task = await f.manager.start(17); f.update(task, { cover_path: "../secret.png" });
    await rejects(f.manager.read(17), "PATH_ESCAPE", 409);
  });
  await check("stale startup lock is conservative and never removed automatically", async () => {
    const f = fixture(); fs.mkdirSync(path.join(f.dataDir, "publications"), { recursive: true }); const lock = path.join(f.dataDir, "publications/17.lock"); fs.writeFileSync(lock, JSON.stringify({ token: "stale" }));
    await rejects(f.manager.start(17), "TASK_LOCKED", 409); assert(fs.existsSync(lock)); assert.equal(f.calls.prompt.length, 0);
  });
  console.log(`PASS ${count} offline publication checks; no model, image, WeChat or Agent calls.`);
} finally {
  for (const f of fixtures) f.manager.dispose();
  globalThis.fetch = previousFetch;
  // root is the exact directory returned by mkdtempSync above, never a computed user path.
  fs.rmSync(root, { recursive: true, force: true });
}
