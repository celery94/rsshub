/** Exercise the real authenticated publication route without running a model. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import { openDatabase, closeDatabase, upsertFeeds, insertArticles } from "../lib/db.js";

const root = mkdtempSync(join(tmpdir(), "rss-publication-route-"));
const dataDir = join(root, "data");
const opmlPath = join(root, "feeds.opml");
const routes = new Map();
const disposers = [];
let admission = { peer: { principal: { kind: "owner" } } };
let agentLookups = 0;
let checks = 0;
let endpoint = "publication";
mkdirSync(dataDir);
writeFileSync(opmlPath, '<opml version="2.0"><body><outline text="Source" xmlUrl="https://source.example/feed"/></body></opml>');
const disk = openDatabase(join(dataDir, "rss-brief.sqlite"));
upsertFeeds(disk, [{ title: "Source", xmlUrl: "https://source.example/feed", htmlUrl: "https://source.example/", group: "Test" }]);
const feedId = disk.prepare("SELECT id FROM feeds").get().id;
const articleId = insertArticles(disk, feedId, [{
  entryKey: "publication-route", guid: "publication-route", url: "https://source.example/article",
  title: "Publication route fixture", author: "Source", publishedAt: "2020-01-01T00:00:00Z", summary: "Excerpt only",
}], (iso) => iso.slice(0, 10), "2020-01-01T00:00:00Z")[0].id;
const ctx = {
  tools: { register() { return () => {}; } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  get(name) {
    if (name === "connection") return { admit: () => admission };
    if (["sessionController", "agents", "llm", "workspaceRegistry"].includes(name)) agentLookups += 1;
    return undefined;
  },
  effect(setup, label) {
    if (label?.endsWith("tick")) return;
    const dispose = setup();
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose;
  },
};
async function request({ method = "GET", query = `?id=${articleId}`, body, type = "application/json" } = {}) {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: `/plugin/rss-brief/${endpoint}${query}`, headers: { "content-type": type } });
  const outgoing = {
    status: 0, headers: {}, text: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(text) { this.text = text ?? ""; },
  };
  const pending = routes.get(`/plugin/rss-brief/${endpoint}`).handler(incoming, outgoing);
  if (method === "POST") queueMicrotask(() => {
    if (body !== undefined) incoming.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    incoming.emit("end");
  });
  await pending;
  assert.equal(outgoing.headers["cache-control"], "no-store");
  return { ...outgoing, body: outgoing.text ? JSON.parse(outgoing.text) : null };
}
async function check(name, run) { await run(); console.log(`ok ${++checks} - ${name}`); }
try {
  apply(ctx, { opmlPath, dataDir, articleWorkspace: root });
  for (endpoint of ["publication", "share"]) {
  await check(`${endpoint}: only supported methods are admitted`, async () => {
    assert.equal((await request({ method: "DELETE" })).status, 405);
  });
  await check("unauthenticated and non-owner callers cannot read or launch jobs", async () => {
    admission = { rejection: 401 };
    assert.equal((await request()).status, 401);
    assert.equal((await request({ method: "POST", body: { id: articleId } })).status, 401);
    admission = { rejection: 403 };
    assert.equal((await request()).status, 403);
    admission = { peer: { principal: { kind: "guest" } } };
    assert.equal((await request()).status, 403);
    assert.equal(agentLookups, 0);
    admission = { peer: { principal: { kind: "owner" } } };
  });
  await check("GET and HEAD do not start a session or fetch source content", async () => {
    assert.deepEqual((await request()).body, { ok: true, task: null });
    const head = await request({ method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(head.text, "");
    assert.equal(agentLookups, 0);
  });
  await check("query IDs are strict and duplicate IDs are rejected", async () => {
    for (const query of ["", "?id=0", "?id=1junk", "?id=1&id=1", "?id=9007199254740992"]) {
      assert.equal((await request({ query })).status, 400, query);
    }
    assert.equal((await request({ query: "?id=9999999" })).status, 404);
  });
  await check("POST requires JSON with only a numeric article ID", async () => {
    assert.equal((await request({ method: "POST", type: "text/plain", body: { id: articleId } })).status, 415);
    for (const body of ["not json", {}, { id: "1" }, { id: 0 }, { id: articleId, model: "override" }, [articleId]]) {
      assert.equal((await request({ method: "POST", body })).status, 400);
    }
    assert.equal(agentLookups, 0);
  });
  await check("missing task prerequisites fail without starting a model", async () => {
    const result = await request({ method: "POST", body: { id: articleId } });
    assert.equal(result.status, 422);
    assert.equal(result.body.ok, false);
    assert.equal(typeof result.body.message, "string");
    assert.ok(!result.body.message.includes("access_token"));
  });
  }
  console.log(`${checks} publication/share route checks passed`);
} finally {
  for (const dispose of disposers.reverse()) await dispose();
  closeDatabase(disk);
  rmSync(root, { recursive: true, force: true });
}
