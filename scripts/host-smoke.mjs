/**
 * End-to-end Host smoke test without a running Harness.
 *
 * It mounts the Host half on a stub Cordis context, serves one feed and one
 * article from a loopback HTTP server, runs sync through
 * the registered tool, and checks deduplication, latest state, article reading,
 * timer scheduling, and model settings without automatic model calls. Everything lives in one temporary directory.
 *
 *   node scripts/host-smoke.mjs
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";

const workDir = mkdtempSync(join(tmpdir(), "rss-brief-host-smoke-"));
const opmlPath = join(workDir, "feeds.opml");
const dataDir = join(workDir, "data");
const publishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const server = createServer((request, response) => {
  if (request.url === "/feed.xml") {
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>Smoke Feed</title>
        <item>
          <title>Smoke article</title>
          <link>http://127.0.0.1:${server.address().port}/article</link>
          <guid isPermaLink="false">smoke-1</guid>
          <pubDate>${new Date(publishedAt).toUTCString()}</pubDate>
          <description>Feed-level summary.</description>
        </item>
      </channel></rss>`);
    return;
  }
  if (request.url === "/article") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<html><head><title>Smoke article</title></head><body>
      <article><h1>Smoke article</h1><p>${"Readable body text. ".repeat(30)}</p></article>
      </body></html>`);
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

writeFileSync(opmlPath, `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="Articles"><outline text="Test">
    <outline text="Smoke Feed" title="Smoke Feed" xmlUrl="http://127.0.0.1:${port}/feed.xml"></outline>
  </outline></outline>
</body></opml>`);

const tools = new Map();
const routes = new Map();
const disposers = [];
const effects = [];
const ticks = [];
let modelCalls = 0;
const fakeLlm = {
  listProviders() {
    return [{ id: "fake", name: "Fake Provider" }];
  },
  async listModels(provider) {
    return provider === "fake"
      ? [
          { provider, id: "fake-model", name: "Fake Model" },
          { provider, id: "fake-alt", name: "Fake Alt" },
        ]
      : [];
  },
  async prepareCall(config, _signal, configure) {
    modelCalls += 1;
    const modelInfo = {
      provider: config.provider,
      id: config.model,
      name: config.model,
      reasoning: { efforts: [{ id: "off", name: "Off" }] },
    };
    const controls = configure
      ? configure({ maxTokens: config.maxTokens, temperature: config.temperature }, modelInfo)
      : {};
    return {
      config: { ...config, ...controls },
      retryPolicy: { mode: "normal", maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      async *stream() {
        yield { type: "text-delta", index: 0, text: JSON.stringify([
          { id: 1, category: "ai", relevance: 92, summary: "这是一条测试摘要。" },
        ]) };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
  },
};

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: {
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  },
  effect(setup, label) {
    effects.push(label);
    let disposer;
    if (label.endsWith("tick")) {
      const interval = globalThis.setInterval;
      const timeout = globalThis.setTimeout;
      globalThis.setInterval = globalThis.setTimeout = (callback) => { ticks.push(callback); return undefined; };
      try { disposer = setup(); } finally { globalThis.setInterval = interval; globalThis.setTimeout = timeout; }
    } else { disposer = setup(); }
    if (typeof disposer === "function") disposers.push(disposer);
    return disposer;
  },
  interval() {
    return () => {};
  },
  timeout() {
    return () => {};
  },
  get(name) {
    if (name === "llm") return fakeLlm;
    if (name === "agentDefaultModel") {
      return { currentSelection: () => ({ provider: "fake", model: "fake-model" }) };
    }
    return undefined;
  },
};

try {
  apply(ctx, {
    opmlPath,
    dataDir,
    timeZone: "Asia/Shanghai",
    // Legacy config: yesterday's report is overdue at every time of day.
    reportAt: "00:00",
    fetchIntervalMinutes: 120,
    contentPerSync: 10,
    analysisEnabled: false,
  });

  assert.equal(tools.size, 3, "status, sync and subscriptions tools registered");
  assert.ok(tools.has("rss_brief_subscriptions"));
  assert.equal(tools.has("rss_brief_report"), false);
  assert.ok(routes.has("/plugin/rss-brief/state"), "state route registered");
  assert.ok(routes.has("/plugin/rss-brief/article"), "article route registered");
  assert.ok(routes.has("/plugin/rss-brief/read"), "read route registered");
  assert.ok(routes.has("/plugin/rss-brief/sync"), "sync route registered");
  assert.equal(routes.has("/plugin/rss-brief/report"), false, "report route removed");
  assert.ok(effects.includes("rss-brief: minute tick"), "minute tick registered");
  assert.ok(effects.includes("rss-brief: initial tick"), "initial tick registered");

  const statusTool = tools.get("rss_brief_status");
  const status = await statusTool.execute({});
  assert.equal(status.ok, true);
  assert.equal(status.feeds.enabled, 1);

  const syncTool = tools.get("rss_brief_sync");
  const firstSync = await syncTool.execute({ limit: 1, wait: true });
  assert.equal(firstSync.completed, true, `sync completed: ${JSON.stringify(firstSync)}`);
  assert.equal(firstSync.result.inserted, 1, "one article inserted");

  const secondSync = await syncTool.execute({ limit: 1, wait: true });
  assert.equal(secondSync.result.inserted, 0, "second sync deduplicated");

  // Exercise the real timer callback with no lastFetchAt (limited syncs do not set it).
  assert.equal(ticks.length, 2);
  await ticks[0]();
  for (let attempt = 0; attempt < 1000 && (await statusTool.execute({})).running; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const scheduled = await statusTool.execute({});
  assert.equal(scheduled.running, null, "scheduled sync completed");
  assert.equal(scheduled.lastRun.kind, "sync");
  assert.equal(scheduled.lastRun.ok, true);
  assert.ok(scheduled.schedule.lastFetchAt);
  const scheduledAt = scheduled.lastRun.at;
  await ticks[1]();
  assert.equal((await statusTool.execute({})).lastRun.at, scheduledAt, "no extra job when sync is not due");
  assert.equal(modelCalls, 0, "sync and scheduling do not invoke AI");
  assert.equal(existsSync(join(dataDir, "reports")), false, "no report directory is created");
  assert.equal("reportAt" in scheduled, false);
  assert.equal("reports" in scheduled, false);
  assert.deepEqual(Object.keys(scheduled.schedule).sort(), ["lastFetchAt", "nextSyncAt"]);
  assert.ok(!statusTool.output.render({}, scheduled)[0].text.includes("日报"));

  const after = await statusTool.execute({});
  assert.equal(after.articles.total, 1);
  assert.equal(after.articles.pendingAi, 1, "sync leaves AI work unchanged");

  const route = routes.get("/plugin/rss-brief/state");
  const response = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  await route.handler({ method: "GET", url: "/plugin/rss-brief/state" }, response);
  const panel = JSON.parse(response.body);
  assert.equal(panel.ok, true);
  assert.equal(panel.report.stats.included, 1);
  assert.equal(panel.view, "latest");
  assert.deepEqual(panel.dates, []);

  const articleRoute = routes.get("/plugin/rss-brief/article");
  const articleResponse = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  await articleRoute.handler(
    { method: "GET", url: "/plugin/rss-brief/article?id=1" },
    articleResponse,
  );
  const articleBody = JSON.parse(articleResponse.body);
  assert.equal(articleBody.ok, true);
  assert.equal(articleBody.article.title, "Smoke article");
  assert.equal(articleBody.article.contentStatus, "ok");
  assert.equal(articleBody.article.opmlGroup, "Test");
  assert.equal(articleBody.article.read, false);
  assert.ok(articleBody.article.contentText.includes("Readable body text"), "article body returned");
  assert.ok(articleBody.article.contentText.length > 200, "article body is substantial");

  const readRoute = routes.get("/plugin/rss-brief/read");
  const readRequest = new EventEmitter();
  readRequest.method = "POST";
  readRequest.url = "/plugin/rss-brief/read";
  const readResponse = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  const readHandler = readRoute.handler(readRequest, readResponse);
  readRequest.emit("data", Buffer.from(JSON.stringify({ id: 1, read: true })));
  readRequest.emit("end");
  await readHandler;
  const readResult = JSON.parse(readResponse.body);
  assert.equal(readResult.ok, true);
  assert.equal(readResult.read, true);

  const readStateResponse = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  await route.handler(
    { method: "GET", url: "/plugin/rss-brief/state" },
    readStateResponse,
  );
  const readPanel = JSON.parse(readStateResponse.body);
  const readItem = readPanel.report.groups
    .flatMap((group) => group.items ?? [])
    .find((item) => item.id === 1);
  assert.ok(readItem !== undefined, "read article is in the panel payload");
  assert.equal(readItem.read, true);

  const readArticleResponse = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  await articleRoute.handler(
    { method: "GET", url: "/plugin/rss-brief/article?id=1" },
    readArticleResponse,
  );
  assert.equal(JSON.parse(readArticleResponse.body).article.read, true);

  const unreadRequest = new EventEmitter();
  unreadRequest.method = "POST";
  unreadRequest.url = "/plugin/rss-brief/read";
  const unreadResponse = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  const unreadHandler = readRoute.handler(unreadRequest, unreadResponse);
  unreadRequest.emit("data", Buffer.from(JSON.stringify({ id: 1, read: false })));
  unreadRequest.emit("end");
  await unreadHandler;
  assert.equal(JSON.parse(unreadResponse.body).read, false);

  // Model settings: read the catalog, save a route, reject an unknown model,
  // and fall back to the default when the saved pair is cleared.
  assert.ok(routes.has("/plugin/rss-brief/settings"), "settings route registered");
  const settingsRoute = routes.get("/plugin/rss-brief/settings");
  const readJson = async (method, body) => {
    const request = new EventEmitter();
    request.method = method;
    request.url = "/plugin/rss-brief/settings";
    const response = {
      status: 0,
      body: "",
      writeHead(status) { this.status = status; },
      end(text) { this.body = text ?? ""; },
    };
    const pending = settingsRoute.handler(request, response);
    if (body !== undefined) request.emit("data", Buffer.from(JSON.stringify(body)));
    request.emit("end");
    await pending;
    return { status: response.status, body: JSON.parse(response.body) };
  };

  const initialSettings = await readJson("GET");
  assert.equal(initialSettings.status, 200);
  assert.equal(initialSettings.body.effective.provider, "fake");
  assert.equal(initialSettings.body.effective.source, "default");
  assert.equal(initialSettings.body.pinned, null);
  assert.deepEqual(
    initialSettings.body.providers.map((provider) => provider.models.map((model) => model.id)),
    [["fake-model", "fake-alt"]],
  );

  const savedSettings = await readJson("POST", { provider: "fake", model: "fake-alt" });
  assert.equal(savedSettings.status, 200);
  assert.deepEqual(savedSettings.body.saved, { provider: "fake", model: "fake-alt" });
  assert.equal(savedSettings.body.effective.source, "custom");
  const savedStatus = await statusTool.execute({});
  assert.equal(savedStatus.ai.model, "fake-alt");
  assert.equal(savedStatus.ai.source, "custom");

  const rejectedSettings = await readJson("POST", { provider: "fake", model: "missing" });
  assert.equal(rejectedSettings.status, 400);
  assert.equal(rejectedSettings.body.code, "unknown-model");

  const resetSettings = await readJson("POST", { provider: "", model: "" });
  assert.equal(resetSettings.status, 200);
  assert.equal(resetSettings.body.saved, null);
  assert.equal(resetSettings.body.effective.source, "default");

  console.log("host smoke passed");
  console.log(`  panel groups: ${panel.report.groups.map((group) => `${group.label}:${group.items.length}`).join(", ")}`);
  console.log(`  article chars: ${articleBody.article.chars}`);
} finally {
  for (const dispose of disposers.reverse()) {
    try {
      await dispose();
    } catch {
      /* cleanup is best-effort */
    }
  }
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
}
