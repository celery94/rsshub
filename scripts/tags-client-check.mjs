/** Offline checks of the real Client components and requests; no database or model calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const exported = source.replace("    return {\n      inject:", "    return {\n      RssBriefPage, ArticleRow, ArticleTags, ReaderView, ColumnDivider, patchReadState, ZH, EN,\n      inject:");
assert.notEqual(exported, source);
const plain = (value) => JSON.parse(JSON.stringify(value));
const names = ["人工智能", "开源", "工程实践", "中文标签", "abcdefghijklmnopqrstuvwx"];
const article = (id, tags = names) => ({ id, title: `needle ${id}`, feed: "Test", feedId: 7, opmlGroup: "Blogs", publishedAt: "2026-11-04T00:00:00Z", read: false, tags });
function latest({ ids = [5, 4], tags = names.map((name) => ({ name, count: 6 })), snapshot = 99, total = 6 } = {}) {
  return { ok: true, view: "latest", report: { groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map((id) => article(id)) }], warnings: [] },
    latest: { total, unread: total, categories: [{ key: "opml:Blogs", label: "Blogs", count: total }], sources: [{ id: 7, title: "Test source", category: "opml:Blogs", count: total }], tags },
    pagination: { total, snapshot, nextOffset: ids.length, hasMore: total > ids.length } };
}
export function harness(component = "RssBriefPage", supplied = {}, storage = new Map()) {
  const slots = [], effects = [], requests = [], timers = new Map();
  let cursor = 0, dirty = true, tree, plugin, mounted = true, timerId = 0;
  const h = (type, attributes, ...children) => ({ type, props: { ...attributes, children: children.flat(Infinity) } });
  const effect = (callback, deps) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((value, n) => value !== old.deps[n])) {
      slots[i] = { deps, cleanup: old?.cleanup };
      effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); });
    }
  };
  const React = {
    createElement: h, Fragment: Symbol("Fragment"), useEffect: effect, useLayoutEffect: effect,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value) => { assert.ok(mounted, "no writes after unmount"); slots[i] = typeof value === "function" ? value(slots[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) slots[i] = { value: callback, deps }; return slots[i].value; },
  };
  runInNewContext(exported, { URL, AbortController, console,
    document: { baseURI: "https://offline.test/", activeElement: null },
    window: { __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } }, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const tr = (key, args = {}) => {
    assert.equal(typeof plugin.ZH[key], "string", `Chinese: ${key}`); assert.equal(typeof plugin.EN[key], "string", `English: ${key}`);
    return plugin.ZH[key].replace(/\{(\w+)\}/g, (match, name) => args[name] ?? match);
  };
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 25); dirty = false; cursor = 0; tree = plugin[component]({ t: tr, tr, ...supplied }); while (effects.length) effects.shift()(); } return tree; };
  const walk = (node) => node && typeof node === "object" ? [node, ...(node.props?.children ?? []).flatMap(walk)] : [];
  const nodes = () => walk(render());
  const text = (node = tree) => typeof node === "string" || typeof node === "number" ? String(node) : (node?.props?.children ?? []).map(text).join(" ");
  const rows = () => nodes().filter((node) => node.type?.name === "ArticleRow");
  const reader = () => nodes().find((node) => node.type?.name === "ReaderView");
  const select = () => nodes().find((node) => node.type === "select" && node.props["aria-label"] === tr("tags.filter"));
  const button = (label) => { const node = nodes().find((entry) => entry.type === "button" && (entry.props["aria-label"] === label || text(entry).trim() === label)); assert.ok(node, label); return node; };
  const click = (label) => { button(label).props.onClick(); render(); };
  const choose = (tag) => { select().props.onChange({ target: { value: tag ?? "" } }); render(); };
  const bulk = () => nodes().find((node) => node.props.className?.includes("rsb-bulkRead"));
  const settle = async () => { for (let i = 0; i < 18; i++) { await Promise.resolve(); render(); } };
  const respond = async (index, body) => { assert.ok(requests[index], `request ${index}`); requests[index].resolve({ ok: true, status: 200, json: async () => body }); await settle(); };
  render();
  return { plugin, tr, render, walk, nodes, text, rows, reader, select, click, choose, button, bulk, requests, respond,
    tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); render(); },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }
const lastUrl = (ui) => new URL(ui.requests.at(-1).url);
const reply = (ui, body = latest()) => ui.respond(ui.requests.length - 1, body);
const facet = (ui) => ui.select().props.children.filter((node) => node?.type === "option");

await check("full and compact tags, accessible overflow, legacy data and no nested title buttons", () => {
  const ui = harness("ArticleTags", { tags: names, onSelectTag() {} });
  assert.equal(ui.nodes().filter((node) => node.type === "button").length, 5);
  let selected;
  const row = ui.plugin.ArticleRow({ article: article(5), tr: ui.tr, compactMode: true, onSelectTag: (tag) => { selected = tag; }, onOpen() {}, onToggleRead() {}, readBusy: null });
  const tagComponent = row.props.children.find((node) => node?.type?.name === "ArticleTags");
  const tags = ui.plugin.ArticleTags(tagComponent.props);
  assert.equal(tags.props.title, names.join(" · "));
  const buttons = ui.walk(tags).filter((node) => node.type === "button");
  assert.equal(buttons.length, 2); buttons[1].props.onClick(); assert.equal(selected, names[1]);
  const overflow = ui.walk(tags).find((node) => node.props.className === "rsb-tagMore");
  assert.equal(ui.text(overflow), "+3"); assert.equal(overflow.props.title, names.join(" · ")); assert.ok(overflow.props["aria-label"].includes(names[4]));
  const expanded = { ...row, props: { ...row.props, children: row.props.children.map((node) => node === tagComponent ? tags : node) } };
  for (const button of ui.walk(expanded).filter((node) => node.type === "button")) assert.equal(ui.walk(button).filter((node) => node.type === "button").length, 1);
  const legacy = article(1); delete legacy.tags;
  const oldRow = ui.plugin.ArticleRow({ article: legacy, tr: ui.tr, compactMode: false });
  assert.equal(ui.plugin.ArticleTags(oldRow.props.children.find((node) => node?.type?.name === "ArticleTags").props), null);
  ui.unmount();
});

await check("tag dropdown retains all server facets, empty selection and explicit clear", async () => {
  const ui = harness(); await reply(ui);
  assert.equal(facet(ui).length, 6); assert.equal(facet(ui)[1].props.value, names[0]); assert.match(ui.text(facet(ui)[1]), /6/);
  ui.choose(names[0]); assert.equal(lastUrl(ui).searchParams.get("tag"), names[0]);
  await reply(ui, latest({ tags: [{ name: names[1], count: 12 }], ids: [], total: 0 }));
  assert.equal(ui.select().props.value, names[0]); assert.equal(facet(ui).length, 3); assert.match(ui.text(facet(ui)[1]), /0/); assert.match(ui.text(facet(ui)[2]), /12/);
  ui.click(ui.tr("tags.clear")); assert.equal(lastUrl(ui).searchParams.has("tag"), false); assert.equal(ui.select().props.value, "");
  await reply(ui); ui.unmount();
});

await check("tag composes source/category/search/quality/unread, pages and bulk scope", async () => {
  const ui = harness(); await reply(ui);
  ui.nodes().find((node) => node.props.className === "rsb-categoryToggle").props.onClick(); ui.render();
  ui.nodes().find((node) => node.props.className === "rsb-railItem rsb-sourceItem").props.onClick(); ui.render(); await reply(ui);
  ui.nodes().find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: " needle " } }); ui.render(); await reply(ui);
  ui.click("只看高质量"); await reply(ui);
  const staleBulk = ui.bulk().props.onClick;
  ui.choose(names[0]); staleBulk();
  assert.equal(ui.requests.filter((request) => request.options.method === "POST").length, 0, "reset invalidates old scope synchronously");
  let url = lastUrl(ui);
  for (const [key, value] of Object.entries({ tag: names[0], feed: "7", category: "opml:Blogs", q: "needle", quality: "high", unread: "1", offset: "0" })) assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has("snapshot"), false); await reply(ui);
  ui.click("加载更多"); url = lastUrl(ui); assert.equal(url.searchParams.get("tag"), names[0]); assert.equal(url.searchParams.get("offset"), "2"); assert.equal(url.searchParams.get("snapshot"), "99");
  await reply(ui, latest({ ids: [3, 2] })); assert.equal(ui.rows().length, 4);
  ui.bulk().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body), { view: "latest", q: "needle", category: "opml:Blogs", unread: true, feed: 7, tag: names[0], quality: "high", snapshot: 99 });
  await reply(ui, { ok: true, changed: 4, ids: [5, 4, 3, 2] });
  assert.equal(lastUrl(ui).searchParams.get("tag"), names[0]); assert.equal(lastUrl(ui).searchParams.get("offset"), "0"); assert.equal(lastUrl(ui).searchParams.has("snapshot"), false);
  await reply(ui, latest({ ids: [], tags: [], total: 0 })); assert.match(ui.text(facet(ui)[1]), /0/); ui.unmount();
});

await check("tag change aborts old page, resets snapshot/offset and ignores late response", async () => {
  const ui = harness(); await reply(ui); ui.choose(names[0]); await reply(ui);
  ui.click("加载更多"); const old = ui.requests.length - 1;
  ui.choose(names[1]); assert.equal(ui.requests[old].options.signal.aborted, true); assert.equal(ui.rows().length, 0);
  assert.equal(lastUrl(ui).searchParams.get("offset"), "0"); assert.equal(lastUrl(ui).searchParams.has("snapshot"), false);
  await reply(ui, latest({ ids: [9], snapshot: 200 })); await ui.respond(old, latest({ ids: [3, 2], snapshot: 99 }));
  assert.deepEqual(ui.rows().map((row) => row.props.article.id), [9]);
  ui.click("加载更多"); assert.equal(lastUrl(ui).searchParams.get("snapshot"), "200"); assert.equal(lastUrl(ui).searchParams.get("offset"), "1");
  await reply(ui, latest({ ids: [8], snapshot: 200 })); assert.deepEqual(ui.rows().map((row) => row.props.article.id), [9, 8]); ui.unmount();
});

await check("reader tags return to filter, retain conditions and reset scroll after closeReader", async () => {
  const ui = harness(); await reply(ui); ui.choose(names[0]); await reply(ui);
  const element = { scrollTop: 350, getBoundingClientRect: () => ({ top: 0, bottom: 600 }), querySelectorAll: () => [] };
  const attach = () => ui.nodes().find((node) => node.props.className === "rsb-body").props.ref(element);
  attach(); element.scrollTop = 350;
  ui.rows()[0].props.onOpen(5); ui.render();
  await reply(ui, { ok: true, article: { ...article(5), contentText: "", needsExtraction: false } });
  const readerProps = ui.reader().props;
  const readerUi = harness("ReaderView", readerProps);
  const tags = readerUi.nodes().find((node) => node.type?.name === "ArticleTags"); assert.deepEqual(plain(tags.props.tags), names);
  readerProps.onSelectTag(names[1]); ui.render(); attach();
  assert.equal(ui.reader(), undefined); assert.equal(element.scrollTop, 0, "new tag does not restore previous article anchor");
  assert.equal(lastUrl(ui).searchParams.get("tag"), names[1]); assert.equal(lastUrl(ui).searchParams.get("unread"), "1"); await reply(ui);
  // Selecting the already active tag from the reader still returns to a fresh first page.
  ui.rows()[0].props.onOpen(5); ui.render(); const same = ui.reader().props.onSelectTag;
  same(names[1]); ui.render(); attach(); assert.equal(element.scrollTop, 0); assert.equal(lastUrl(ui).searchParams.get("offset"), "0"); await reply(ui);
  readerUi.unmount(); ui.unmount();
});

await check("read updates every article tag facet exactly once, preserves unrelated/all-read facets and legacy data", async () => {
  const ui = harness(); const data = latest(); data.report.groups[0].items[0].tags = [names[0], names[1], names[0]];
  await reply(ui, data); ui.choose(names[0]); await reply(ui, data);
  const row = ui.rows().find((node) => node.props.article.id === 5); row.props.onToggleRead(row.props.article); ui.render(); await reply(ui, { ok: true });
  assert.match(ui.text(facet(ui).find((node) => node.props.value === names[0])), /5/);
  assert.match(ui.text(facet(ui).find((node) => node.props.value === names[1])), /5/);
  assert.match(ui.text(facet(ui).find((node) => node.props.value === names[2])), /6/);
  assert.equal(ui.rows().some((node) => node.props.article.id === 5), false);
  const unchanged = ui.plugin.patchReadState(data, 5, true, false);
  assert.deepEqual(plain(unchanged.latest.tags), data.latest.tags, "all-read facets do not depend on read state");
  const restored = ui.plugin.patchReadState(ui.plugin.patchReadState(data, 5, true, true), 5, false, true);
  assert.deepEqual(plain(restored.latest.tags), data.latest.tags);
  const legacy = latest(); delete legacy.latest.tags; delete legacy.report.groups[0].items[0].tags;
  assert.equal(Object.hasOwn(ui.plugin.patchReadState(legacy, 5, true, true).latest, "tags"), false, "read updates preserve the legacy payload shape");
  ui.unmount();
});
console.log(`Passed ${checks} offline tags client checks.`);
}
