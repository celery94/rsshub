/** Offline behavior checks for the real RSS assessment UI. No server or model calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const exported = source.replace("    return {\n      inject:", "    return {\n      RssBriefPage, AnalysisSettings, AssessmentMeta, AssessmentDetails, ArticleRow, ReaderView, ZH, EN,\n      inject:");
assert.notEqual(exported, source, "test seam finds the module export");
const plain = (value) => JSON.parse(JSON.stringify(value));
const assessment = { status: "ok", score: 88, recommendation: "recommended", reason: "Useful evidence and practical examples", dimensions: { information: 22, evidence: 23, depth: 18, utility: 17, clarity: 8 }, minutes: 6, highQuality: true, provisional: false, basis: "full", stale: false, analyzedAt: "2026-11-04T00:00:00Z" };
const article = (id = 5) => ({ id, title: `needle ${id}`, feed: "Test", opmlGroup: "Blogs", publishedAt: "2026-11-04T00:00:00Z", read: false, assessment });
const latest = (ids = [5, 4], snapshot = 99) => ({ ok: true, view: "latest", report: { groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map(article) }], warnings: [] }, latest: { total: 6, unread: 6, categories: [{ key: "opml:Blogs", label: "Blogs", count: 6 }] }, pagination: { total: 6, snapshot, nextOffset: ids.length, hasMore: true } });
const settings = (extra = {}) => ({ ok: true, pinned: null, saved: null, effective: { provider: "creation", model: "writer", source: "inherited" }, default: { provider: "creation", model: "writer" }, enabled: true, perSync: 40, catalogError: null, providers: [{ id: "analysis", name: "Analysis provider", models: [{ id: "reader", name: "Reader model" }] }], ...extra });

function harness(component = "RssBriefPage", supplied = {}) {
  const slots = [], effects = [], requests = [], busy = [];
  let cursor = 0, dirty = true, tree, plugin, mounted = true;
  const h = (type, attributes, ...children) => ({ type, props: { ...attributes, children: children.flat(Infinity) } });
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) {
      slots[index] = { deps, cleanup: old?.cleanup };
      effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
    }
  };
  const React = {
    createElement: h, Fragment: Symbol("Fragment"), useEffect: effect, useLayoutEffect: effect,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { assert.ok(mounted, "no writes after unmount"); slots[i] = typeof value === "function" ? value(slots[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) slots[i] = { value: callback, deps }; return slots[i].value; },
  };
  const context = { URL, AbortController, console, document: { baseURI: "https://offline.test/", activeElement: null },
    window: { __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } }, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    setTimeout() { return 1; }, clearTimeout() {},
  };
  runInNewContext(exported, context);
  const tr = (key, args = {}) => {
    assert.equal(typeof plugin.ZH[key], "string", `Chinese translation: ${key}`);
    assert.equal(typeof plugin.EN[key], "string", `English translation: ${key}`);
    return plugin.ZH[key].replace(/\{(\w+)\}/g, (match, name) => args[name] ?? match);
  };
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 25, "render settles"); dirty = false; cursor = 0; tree = plugin[component]({ tr, onSavingChange: (value) => busy.push(value), ...supplied }); while (effects.length) effects.shift()(); } return tree; };
  const settle = async () => { for (let i = 0; i < 18; i++) { await Promise.resolve(); render(); } };
  const walk = (node) => node && typeof node === "object" ? [node, ...(node.props?.children ?? []).flatMap(walk)] : [];
  const text = (node = tree) => typeof node === "string" || typeof node === "number" ? String(node) : (node?.props?.children ?? []).map(text).join(" ");
  const nodes = () => walk(render());
  const field = (id) => { const result = nodes().find((node) => node.props.id === id); assert.ok(result, `field ${id}`); return result; };
  const change = (id, value) => { field(id).props.onChange({ target: { value } }); render(); };
  const button = (label) => { const result = nodes().find((node) => node.type === "button" && (node.props["aria-label"] === label || text(node).trim() === label)); assert.ok(result, `button ${label}`); return result; };
  const click = (label) => { button(label).props.onClick(); render(); };
  const submit = () => { const form = nodes().find((node) => node.type === "form"); form.props.onSubmit({ preventDefault() {} }); render(); };
  const respond = async (index, body, status = 200) => { assert.ok(requests[index], `request ${index}`); requests[index].resolve({ ok: status < 400, status, json: async () => body }); await settle(); };
  render();
  return { plugin, tr, nodes, text, field, change, button, click, submit, render, settle, respond, requests, busy, unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); } };
}
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("assessment labels, compact provisional score, reader reason and five weighted dimensions", () => {
  const ui = harness("AssessmentMeta", { assessment });
  assert.match(ui.text(), /评分 88\/100/); assert.match(ui.text(), /高质量/); assert.match(ui.text(), /深度阅读/); assert.match(ui.text(), /约 6 分钟/);
  for (const [recommendation, expected] of [["optional", "按需阅读"], ["skip", "可略过"]]) assert.match(ui.text(ui.plugin.AssessmentMeta({ assessment: { ...assessment, recommendation }, tr: ui.tr })), new RegExp(expected));
  const compact = ui.plugin.AssessmentMeta({ assessment: { ...assessment, provisional: true, highQuality: false }, tr: ui.tr, compact: true });
  assert.equal(ui.text(compact), "88*"); assert.match(compact.props.title, /暂定评估/);
  const pending = ui.plugin.AssessmentMeta({ assessment: { status: "pending" }, tr: ui.tr }); assert.match(ui.text(pending), /待评估/); assert.doesNotMatch(ui.text(pending), /高质量/);
  const failed = ui.plugin.AssessmentMeta({ assessment: { status: "failed" }, tr: ui.tr }); assert.match(ui.text(failed), /评估暂不可用/);
  for (const [basis, expected] of [["excerpt", "仅基于摘要"], ["sampled", "仅基于部分正文"]]) {
    const details = ui.plugin.AssessmentDetails({ assessment: { ...assessment, provisional: true, basis }, tr: ui.tr });
    const text = ui.text(details); assert.match(text, /Useful evidence/); assert.match(text, new RegExp(expected)); assert.match(text, /22 \/ 25/); assert.match(text, /23 \/ 25/); assert.match(text, /18 \/ 20/); assert.match(text, /17 \/ 20/); assert.match(text, /8 \/ 10/);
    assert.ok(details.props.children.some((node) => node?.type === "details"), "dimensions use native expandable details");
  }
});

await check("independent analysis provider/model save, defaults, inheritance, validation and duplicate guard", async () => {
  const ui = harness("AnalysisSettings");
  assert.equal(new URL(ui.requests[0].url).pathname, "/plugin/rss-brief/analysis-settings");
  await ui.respond(0, settings());
  assert.equal(ui.field("rsb-analysis-limit").props.value, "40"); assert.equal(ui.field("rsb-analysis-mode").props.value, "inherit");
  assert.match(ui.text(), /creation\/writer/);
  ui.change("rsb-analysis-mode", "custom"); ui.change("rsb-analysis-provider", "analysis");
  assert.equal(ui.field("rsb-analysis-model").props.value, "", "provider selection does not silently pick a model");
  assert.equal(ui.button("保存分析设置").props.disabled, true); ui.submit(); assert.equal(ui.requests.length, 1);
  ui.change("rsb-analysis-model", "reader"); ui.change("rsb-analysis-limit", "0"); assert.equal(ui.button("保存分析设置").props.disabled, true);
  ui.change("rsb-analysis-limit", "201"); assert.equal(ui.button("保存分析设置").props.disabled, true);
  ui.change("rsb-analysis-limit", "20.5"); assert.equal(ui.button("保存分析设置").props.disabled, true);
  ui.change("rsb-analysis-limit", "20");
  const form = ui.nodes().find((node) => node.type === "form"); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); ui.render();
  assert.equal(ui.requests.length, 2, "only one POST for synchronous double submit");
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), { provider: "analysis", model: "reader", enabled: true, perSync: 20 });
  const savedResponse = settings({ saved: { provider: "analysis", model: "reader" }, effective: { provider: "analysis", model: "reader", source: "custom" }, perSync: 20 });
  delete savedResponse.providers; // Real POST returns selection only; retain GET's catalog.
  await ui.respond(1, savedResponse);
  assert.ok(ui.field("rsb-analysis-provider").props.children.some((node) => node?.props?.value === "analysis"), "saving retains provider catalog");
  assert.ok(ui.field("rsb-analysis-model").props.children.some((node) => node?.props?.value === "reader"), "saving retains model catalog");
  assert.match(ui.text(), /分析设置已保存/); assert.deepEqual(ui.busy, [true, false]);
  ui.change("rsb-analysis-mode", "inherit"); ui.submit();
  assert.deepEqual(JSON.parse(ui.requests[2].options.body), { provider: "", model: "", enabled: true, perSync: 20 });
  await ui.respond(2, settings({ perSync: 20 }));
  assert.ok(ui.requests.every((request) => new URL(request.url).pathname === "/plugin/rss-brief/analysis-settings"), "creation settings are never written");
  ui.unmount();
});

await check("pinned route still permits toggles/limits, catalog errors preserve saved route, and save errors are visible", async () => {
  const ui = harness("AnalysisSettings");
  await ui.respond(0, settings({ pinned: { provider: "fixed", model: "pinned" }, providers: [], catalogError: "catalog offline" }));
  assert.equal(ui.field("rsb-analysis-mode").props.disabled, true); assert.equal(ui.field("rsb-analysis-provider").props.value, "fixed");
  assert.equal(ui.field("rsb-analysis-model").props.value, "pinned"); assert.equal(ui.field("rsb-analysis-limit").props.disabled, false);
  const enabled = ui.nodes().find((node) => node.type === "input" && node.props.type === "checkbox"); enabled.props.onChange({ target: { checked: false } }); ui.render();
  ui.change("rsb-analysis-limit", "1"); ui.submit();
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), { provider: "fixed", model: "pinned", enabled: false, perSync: 1 });
  await ui.respond(1, { ok: false, message: "save rejected" }, 409);
  assert.match(ui.text(), /save rejected/); assert.match(ui.text(), /catalog offline/); assert.equal(ui.button("保存分析设置").props.disabled, false);
  ui.unmount();
});

await check("high quality filter composes search/category/unread, survives pages, and scopes bulk reads", async () => {
  const ui = harness(); await ui.respond(0, latest());
  const search = ui.nodes().find((node) => node.type === "input" && node.props.type === "search"); search.props.onChange({ target: { value: " needle " } }); ui.render(); await ui.respond(1, latest());
  const category = ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem" && ui.text(node).includes("Blogs")); category.props.onClick(); ui.render(); await ui.respond(2, latest());
  assert.equal(ui.button("只看未读").props["aria-checked"], "true", "unread is enabled by default");
  assert.equal(new URL(ui.requests[0].url).searchParams.get("unread"), "1", "initial fetch requests unread articles");
  const oldBulk = ui.nodes().find((node) => node.props.className?.includes("rsb-bulkRead")).props.onClick;
  ui.click("只看高质量"); oldBulk(); assert.equal(ui.requests.length, 4, "filter reset invalidates old bulk scope synchronously");
  const filter = new URL(ui.requests[3].url);
  assert.equal(filter.searchParams.get("quality"), "high"); assert.equal(filter.searchParams.get("q"), "needle"); assert.equal(filter.searchParams.get("category"), "opml:Blogs"); assert.equal(filter.searchParams.get("unread"), "1"); assert.equal(filter.searchParams.get("offset"), "0");
  await ui.respond(3, latest()); ui.click("加载更多");
  const page = new URL(ui.requests[4].url); assert.equal(page.searchParams.get("quality"), "high"); assert.equal(page.searchParams.get("snapshot"), "99"); assert.equal(page.searchParams.get("offset"), "2");
  await ui.respond(4, latest([3, 2]));
  const bulk = ui.nodes().find((node) => node.props.className?.includes("rsb-bulkRead")); bulk.props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests[5].options.body), { view: "latest", q: "needle", category: "opml:Blogs", unread: true, quality: "high", snapshot: 99 });
  await ui.respond(5, { ok: true, changed: 4, ids: [5, 4, 3, 2] });
  assert.equal(new URL(ui.requests[6].url).searchParams.get("quality"), "high", "bulk completion refresh retains quality filter");
  await ui.respond(6, latest([])); ui.click("只看高质量"); assert.equal(new URL(ui.requests[7].url).searchParams.has("quality"), false);
  ui.unmount();
});

await check("reader and compact rows consume the same server assessment without recomputing quality", () => {
  const ui = harness("ReaderView", { reader: { id: 5, article: { ...article(), contentText: "Text", contentSource: "web" }, pending: false }, articles: [article()], onBack() {}, onNavigate() {}, onRetry() {}, onToggleRead() {}, readBusy: null, positions: { current: new Map() } });
  const details = ui.nodes().find((node) => node.type?.name === "AssessmentDetails"); assert.deepEqual(plain(details.props.assessment), assessment); assert.match(ui.text(), /约 6 分钟/);
  const row = ui.plugin.ArticleRow({ article: article(), tr: ui.tr, compactMode: true, onOpen() {}, onToggleRead() {}, readBusy: null });
  const component = row.props.children[0].props.children[0].props.children.find((node) => node?.type?.name === "AssessmentMeta");
  assert.equal(component.props.compact, true); assert.equal(component.props.assessment.highQuality, true);
  ui.unmount();
});
console.log(`Passed ${checks} offline assessment client checks.`);
