/** Offline persisted schedule and authenticated route checks; no user data or network. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { apply } from "../index.js";
import { openDatabase, closeDatabase, getMeta, setMeta } from "../lib/db.js";

const root = mkdtempSync(join(tmpdir(), "rss-schedule-check-"));
const dataDir = join(root, "data");
const opmlPath = join(root, "feeds.opml");
writeFileSync(opmlPath, '<opml version="2.0"><body><outline text="Test"><outline text="Offline feed" xmlUrl="https://schedule.example/feed"/></outline></body></opml>');
const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://schedule.example/feed");
  fetches += 1;
  return new Response('<rss version="2.0"><channel><title>Offline feed</title></channel></rss>', { headers: { "content-type": "application/rss+xml" } });
};
let admission = { peer: { principal: { kind: "owner" } } };
let connectionAvailable = true;
let host;
let disk;
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }
function mount(config = {}) {
  const routes = new Map();
  const tools = new Map();
  const ticks = [];
  const disposers = [];
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
    get(name) {
      if (name === "skills") return undefined;
      if (name === "connection") return connectionAvailable ? { admit: () => admission } : null;
      // Status resolves a model route; the schedule route must not reach either service.
      if (name === "agentDefaultModel") return null;
      throw new Error(`Unexpected service access: ${name}`);
    },
    effect(setup, label) {
      if (label.endsWith("tick")) {
        const interval = globalThis.setInterval;
        const timeout = globalThis.setTimeout;
        globalThis.setInterval = globalThis.setTimeout = (callback) => { ticks.push(callback); return undefined; };
        try { setup(); } finally { globalThis.setInterval = interval; globalThis.setTimeout = timeout; }
        return;
      }
      const dispose = setup();
      if (typeof dispose === "function") disposers.push(dispose);
    },
  };
  apply(ctx, { dataDir, opmlPath, contentPerSync: 0, ...config });
  return { routes, tools, ticks, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}
async function request(body, { method = "GET", type = "application/json" } = {}) {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: "/plugin/rss-brief/schedule", headers: { "content-type": type } });
  const outgoing = { status: 0, headers: {}, text: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.text = text ?? ""; } };
  const pending = host.routes.get(incoming.url).handler(incoming, outgoing);
  if (method === "POST") queueMicrotask(() => {
    incoming.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    incoming.emit("end");
  });
  await pending;
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return { status: outgoing.status, body: outgoing.text ? JSON.parse(outgoing.text) : null };
}
const status = () => host.tools.get("rss_brief_status").execute({});
async function settled() {
  for (let i = 0; i < 100; i += 1) {
    if ((await status()).running === null) return;
    await nextTurn();
  }
  assert.fail("scheduled sync did not finish");
}
try {
  host = mount();
  disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
  await check("default interval is 60 minutes without model catalog", async () => {
    assert.deepEqual(await request(), { status: 200, body: {
      ok: true, fetchIntervalMinutes: 60, defaultFetchIntervalMinutes: 60,
      timeZone: "Asia/Shanghai", nextSyncAt: "尽快", lastFetchAt: null,
    } });
    assert.equal((await status()).fetchIntervalMinutes, 60);
    assert.equal((await request(undefined, { method: "HEAD" })).body, null);
  });
  const last = new Date(Date.now() - 30 * 60_000).toISOString();
  setMeta(disk, "lastFetchAt", last);
  await check("POST persists interval and GET/status use the effective next due time", async () => {
    const response = await request({ fetchIntervalMinutes: 90 }, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(getMeta(disk, "fetchIntervalMinutes"), "90");
    assert.deepEqual(response.body, (await request()).body);
    assert.equal(response.body.nextSyncAt, new Date(Date.parse(last) + 90 * 60_000).toISOString());
    const snapshot = await status();
    assert.equal(snapshot.fetchIntervalMinutes, 90);
    assert.equal(snapshot.schedule.nextSyncAt, response.body.nextSyncAt);
    assert.equal(fetches, 0);
  });
  await check("strict invalid JSON values never write metadata or start sync", async () => {
    const before = disk.prepare("SELECT * FROM meta ORDER BY key").all();
    for (const body of [null, [], {}, 5, { fetchIntervalMinutes: "60" }, { fetchIntervalMinutes: true },
      { fetchIntervalMinutes: null }, { fetchIntervalMinutes: 4 }, { fetchIntervalMinutes: 10081 },
      { fetchIntervalMinutes: 5.5 }, { fetchIntervalMinutes: 60, extra: 1 }, "bad JSON", "{", " ".repeat(9000)]) {
      assert.equal((await request(body, { method: "POST" })).status, 400, JSON.stringify(body).slice(0, 100));
      assert.deepEqual(disk.prepare("SELECT * FROM meta ORDER BY key").all(), before);
    }
    assert.equal(fetches, 0);
  });
  await check("owner admission protects reads and writes before metadata changes", async () => {
    for (const method of ["GET", "HEAD", "POST"]) {
      for (const denied of [{ rejection: 401 }, { rejection: 403 }, { peer: { principal: { kind: "guest" } } }, {}]) {
        admission = denied;
        assert.equal((await request({ fetchIntervalMinutes: 5 }, { method })).status, denied.rejection ?? 403);
      }
      connectionAvailable = false;
      assert.equal((await request({ fetchIntervalMinutes: 5 }, { method })).status, 503);
      connectionAvailable = true;
    }
    admission = { peer: { principal: { kind: "owner" } } };
    assert.equal((await request({ fetchIntervalMinutes: 5 }, { method: "POST", type: "text/plain" })).status, 415);
    assert.equal((await request(undefined, { method: "PUT" })).status, 405);
    assert.equal(getMeta(disk, "fetchIntervalMinutes"), "90");
    assert.equal(fetches, 0);
  });
  await check("saved interval survives host reload and overrides the new config default", async () => {
    host.dispose();
    host = mount({ fetchIntervalMinutes: 120 });
    const response = await request();
    assert.equal(response.body.fetchIntervalMinutes, 90);
    assert.equal(response.body.defaultFetchIntervalMinutes, 120);
    assert.equal((await status()).fetchIntervalMinutes, 90);
    host.ticks[0]();
    await settled();
    assert.equal(fetches, 0, "saved 90-minute interval is not due at 30 minutes");
  });
  await check("shortening an overdue interval triggers sync immediately and does not overlap", async () => {
    const response = await request({ fetchIntervalMinutes: 5 }, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(response.body.fetchIntervalMinutes, 5);
    assert.equal(response.body.lastFetchAt, last);
    await settled();
    assert.equal(fetches, 1);
    assert.notEqual(getMeta(disk, "lastFetchAt"), last);
    host.ticks[0](); host.ticks[1]();
    await settled();
    assert.equal(fetches, 1, "fresh sync is not due again");
  });
  await check("lengthening postpones due work and minute tick honors the exact effective boundary", async () => {
    assert.equal((await request({ fetchIntervalMinutes: 10080 }, { method: "POST" })).status, 200);
    assert.equal(getMeta(disk, "fetchIntervalMinutes"), "10080");
    const dueAt = Date.parse(getMeta(disk, "lastFetchAt")) + 10080 * 60_000;
    const originalNow = Date.now;
    try {
      Date.now = () => dueAt - 1;
      host.ticks[0](); await settled();
      assert.equal(fetches, 1);
      Date.now = () => dueAt;
      host.ticks[0](); await settled();
      assert.equal(fetches, 2);
    } finally { Date.now = originalNow; }
  });
  await check("invalid stored metadata falls back to the configured interval", async () => {
    for (const bad of ["0", "10081", "NaN", "60.5", "true", ""]) {
      setMeta(disk, "fetchIntervalMinutes", bad);
      assert.equal((await request()).body.fetchIntervalMinutes, 120);
    }
  });
  console.log(`PASS ${checks} offline schedule checks; temporary SQLite and mocked fetch only.`);
} finally {
  host?.dispose();
  if (disk) closeDatabase(disk);
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
