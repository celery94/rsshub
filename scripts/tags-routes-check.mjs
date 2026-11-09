/** Exercise the actual Host tag routes with a disposable database and no model/network. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../index.js";
import { openDatabase, upsertFeeds, insertArticles, saveAssessment, setContentSuccess, isRead, setRead } from "../lib/db.js";

const root = mkdtempSync(join(tmpdir(), "rss-tags-routes-"));
const dataDir = join(root, "data"), opmlPath = join(root, "feeds.opml");
const routes = new Map(), disposers = [];
let db;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in tag route checks"); };
const ctx = {
  tools: { register() {} },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  get(name) {
    if (name === "connection") return { admit: () => ({ peer: { principal: { kind: "owner" } } }) };
    if (["skills", "agentDefaultModel"].includes(name)) return undefined;
    throw new Error(`Unexpected service access: ${name}`);
  },
  effect(setup, label) { if (label.endsWith("tick")) return; const dispose = setup(); if (typeof dispose === "function") disposers.push(dispose); },
};
async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: `/plugin/rss-brief/${path}`, headers: { "content-type": "application/json" } });
  const response = { status: 0, text: "", writeHead(status) { this.status = status; }, end(text) { this.text = text ?? ""; } };
  const pending = routes.get(incoming.url.split("?")[0]).handler(incoming, response);
  if (body !== undefined) queueMicrotask(() => { incoming.emit("data", Buffer.from(JSON.stringify(body))); incoming.emit("end"); });
  await pending;
  return { status: response.status, body: response.text ? JSON.parse(response.text) : null, text: response.text };
}
try {
  mkdirSync(dataDir);
  writeFileSync(opmlPath, '<opml><body><outline text="Dev"><outline text="Dev feed" xmlUrl="https://offline.example/feed"/></outline></body></opml>');
  db = openDatabase(join(dataDir, "rss-brief.sqlite"));
  upsertFeeds(db, [{ title: "Dev feed", group: "Dev", xmlUrl: "https://offline.example/feed", htmlUrl: "" }]);
  const at = new Date(Date.now() - 60_000).toISOString();
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const id = insertArticles(db, 1, [{ entryKey: `tag-${i}`, title: `Example ${i}`, url: `https://offline.example/${i}`, publishedAt: at, summary: "A cached excerpt" }], iso => iso.slice(0, 10), at)[0].id;
    ids.push(id);
    if (i === 3 || i === 5) continue; // legacy untagged or free-form tags
    setContentSuccess(db, id, { text: "Complete technical content and supporting evidence.", source: "web", version: 1 });
    saveAssessment(db, id, {
      contentType: "editorial", score: 80, dimensions: { information: 20, evidence: 20, depth: 16, utility: 16, clarity: 8 },
      category: "engineering", relevance: 90, summary: "说明实现方法和验证结果。", reason: "提供了实验和步骤。", tags: i < 2 ? ["软件开发", "技术解析"] : i === 2 ? ["软件开发", "教程指南"] : ["数据与数据库", "技术解析"],
    });
  }
  db.prepare("INSERT INTO article_tags(article_id, tag_key, tag, position) VALUES (?, 'rust', 'Rust', 0)").run(ids[5]);
  setRead(db, ids[0], true, at);
  apply(ctx, { dataDir, opmlPath });
  const page = await request("latest?tag=软件开发&format=技术解析&limit=1&unread=1&quality=high");
  assert.equal(page.status, 200);
  assert.equal(page.body.pagination.total, 1);
  assert.deepEqual(page.body.report.groups.flatMap(g => g.items).map(a => a.id), [ids[1]]);
  assert.deepEqual(page.body.report.groups[0].items[0].tags, ["软件开发", "技术解析"]);
  assert.deepEqual(page.body.report.groups[0].items[0].topics, ["软件开发"]);
  assert.equal(page.body.report.groups[0].items[0].format, "技术解析");
  assert.equal(page.body.latest.unread, 1);
  assert.equal(page.body.latest.navigation.total, 3, "All articles ignores selected topic and form but retains quality/unread");
  assert.equal(page.body.latest.tags.find(t => t.name === "数据与数据库").count, 1, "topic facet ignores topic and retains form");
  assert.equal(page.body.latest.tagGroups.topics.length, 14);
  assert.equal(page.body.latest.tagGroups.formats.length, 8);
  assert.equal(page.body.latest.tagGroups.formats.find(t => t.name === "教程指南").count, 1, "form facet ignores form and retains topic");
  assert.equal(page.body.latest.tagGroups.formats.find(t => t.name === "技术解析").count, 1);
  const detail = (await request(`article?id=${ids[1]}&cacheOnly=1`)).body.article;
  assert.deepEqual(detail.topics, ["软件开发"]); assert.equal(detail.format, "技术解析");
  assert.deepEqual((await request(`article?id=${ids[3]}&cacheOnly=1`)).body.article.tags, []);
  assert.equal((await request("state?tag=%23%EF%BC%B2%EF%BD%95%EF%BD%93%EF%BD%94")).body.pagination.total, 1, "state normalizes legacy fullwidth tag and leading hash");
  assert.equal((await request("latest?tag=unknown")).body.pagination.total, 0);
  assert.equal((await request("latest?tag=Rust", undefined, "HEAD")).text, "");
  for (const query of ["tag=", "tag=%20", "tag=%23", "tag=a&tag=b", "tag=%00", `tag=${"a".repeat(25)}`]) {
    assert.equal((await request(`latest?${query}`)).status, 400, query);
  }
  for (const query of ["format=", "format=软件开发", "format=unknown", "format=技术解析&format=教程指南", "format=%00"]) {
    assert.equal((await request(`latest?${query}`)).status, 400, query);
  }
  const scope = { view: "latest", q: "", category: null, unread: true, quality: "high", snapshot: page.body.pagination.snapshot, tag: "软件开发", format: "技术解析" };
  for (const format of [null, [], true, 1, "", "软件开发", "unknown", "\n技术解析"]) {
    assert.equal((await request("read-all", { ...scope, format })).status, 400, JSON.stringify(format));
    assert.equal(isRead(db, ids[1]), false);
  }
  for (const tag of [null, [], 1, true, "", "a".repeat(25), "\nRust"]) {
    assert.equal((await request("read-all", { ...scope, tag })).status, 400, JSON.stringify(tag));
    assert.equal(isRead(db, ids[1]), false, "invalid tag never broadens mutation scope");
  }
  const changed = await request("read-all", scope);
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.ids, [ids[1]]);
  assert.equal(isRead(db, ids[2]), false);
  assert.equal(isRead(db, ids[3]), false);
  assert.equal(isRead(db, ids[4]), false, "another topic with the same form stays unread");
  assert.equal((await request("latest?tag=软件开发&format=技术解析&unread=1")).body.pagination.total, 0);
  assert.equal((await request("latest?tag=软件开发&format=教程指南&unread=1")).body.pagination.total, 1);
  const legacy = (await request(`article?id=${ids[5]}&cacheOnly=1`)).body.article;
  assert.deepEqual(legacy.tags, ["Rust"]); assert.deepEqual(legacy.topics, []); assert.equal(legacy.format, null);
  console.log("PASS: Host theme + form responses, strict format validation, legacy tags, independent facets and scoped bulk read (offline).");
} finally {
  for (const dispose of disposers.reverse()) dispose();
  db?.close();
  globalThis.fetch = originalFetch;
  assert.ok(root.startsWith(join(tmpdir(), "rss-tags-routes-")));
  rmSync(root, { recursive: true, force: true });
}
