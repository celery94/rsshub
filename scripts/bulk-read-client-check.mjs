/** Real page with fake hooks and deferred fetch; entirely offline, no user storage. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("../client.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const article = (id, read = false) => ({ id, title: `needle ${id}`, feed: "Test", opmlGroup: "Blogs", read, publishedAt: `2026-11-04T00:00:00Z` });
function fixture({ ids = [5, 4], total = 6, snapshot = 99, daily = false } = {}) {
  return { ok: true, view: daily ? "daily" : "latest", date: daily ? "2026-11-03" : null, dates: ["2026-11-03", "2026-11-02"],
    report: { stats: {}, groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map((id) => article(id)) }], warnings: [] },
    latest: daily ? undefined : { total, unread: total, available: total, categories: [{ key: "opml:Blogs", label: "Blogs", count: total }], sources: [{ id: 7, title: "Test source", category: "opml:Blogs", count: total }, { id: 8, title: "Empty source", category: "opml:Blogs", count: 0 }] },
    pagination: daily ? undefined : { total, snapshot, nextOffset: ids.length, hasMore: total > ids.length },
  };
}
function harness() {
  const slots = [], effects = [], requests = [], timers = new Map();
  let cursor = 0, dirty = true, mounted = true, tree, writesAfterUnmount = 0, timerId = 0, plugin;
  const h = (type, attributes, ...children) => ({ type, props: { ...attributes, children: children.flat(Infinity) } });
  const React = {
    createElement: h, Fragment: Symbol("Fragment"),
    useLayoutEffect(callback, deps) { return this.useEffect(callback, deps); },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value) => { if (!mounted) { writesAfterUnmount++; return; } slots[i] = typeof value === "function" ? value(slots[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) slots[i] = { value: callback, deps }; return slots[i].value; },
    useEffect(callback, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) {
      slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); });
    } },
  };
  const context = { URL, AbortController, console, window: { __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } },
    localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); } },
    document: { baseURI: "https://offline.test/", activeElement: null },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  runInNewContext(source.replace("    return {\n      inject:", "    return {\n      TestPage: RssBriefPage,\n      inject:"), context);
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 25, "render settles"); dirty = false; cursor = 0; tree = plugin.TestPage({}); while (effects.length) effects.shift()(); } return tree; };
  const settle = async () => { for (let i = 0; i < 18; i++) { await Promise.resolve(); render(); } };
  const walk = (node) => node && typeof node === "object" ? [node, ...(node.props?.children ?? []).flatMap(walk)] : [];
  const nodes = () => walk(render());
  const text = (node = tree) => typeof node === "string" || typeof node === "number" ? String(node) : (node?.props?.children ?? []).map((child) => text(child)).join(" ");
  const button = (label) => nodes().find((node) => node.type === "button" && text(node).trim() === label);
  const bulk = () => nodes().find((node) => node.props?.className?.includes("rsb-bulkRead"));
  const rows = () => nodes().filter((node) => node.type?.name === "ArticleRow");
  const click = (label) => { const node = button(label); assert.ok(node, `button ${label}`); node.props.onClick(); render(); };
  const search = (value) => { nodes().find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value } }); render(); };
  const respond = async (index, body, status = 200) => { assert.ok(requests[index], `request ${index}`); requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); await settle(); };
  render();
  return { slots, nodes, rows, bulk, button, click, search, render, settle, respond, requests, text,
    tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); render(); },
    async reject(index) { requests[index].reject(new Error("offline failure")); await settle(); },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); }, get writesAfterUnmount() { return writesAfterUnmount; } };
}
let checks = 0;
async function check(label, test) { await test(); console.log(`ok ${++checks} - ${label}`); }
const getLast = (ui) => ui.requests.at(-1);
async function showAll(ui) {
  const toggle = ui.nodes().find((node) => node.props?.["aria-label"] === "只看未读");
  assert.equal(toggle.props["aria-checked"], "true", "all-article tests begin from the real unread default");
  toggle.props.onClick(); ui.render();
  assert.equal(new URL(getLast(ui).url).searchParams.has("unread"), false, "explicitly switching off unread requests all articles");
  await ui.respond(ui.requests.length - 1, fixture());
}
const postCount = (ui) => ui.requests.filter((request) => request.options.method === "POST").length;
await check("latest complete filter/snapshot payload, synchronous double-click lock, unread clearing and first-page refresh", async () => {
  const ui = harness(); await ui.respond(0, fixture());
  assert.equal(new URL(ui.requests[0].url).searchParams.get("unread"), "1", "first fetch defaults to unread only");
  assert.equal(ui.nodes().find((node) => node.props?.["aria-label"] === "只看未读").props["aria-checked"], "true");
  ui.search(" needle "); assert.equal(ui.bulk().props.disabled, true);
  await ui.respond(1, fixture());
  const category = ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem" && ui.text(node).includes("Blogs"));
  category.props.onClick(); ui.render(); await ui.respond(2, fixture());
  assert.equal(new URL(ui.requests[2].url).searchParams.get("unread"), "1", "search and category retain the default unread filter");
  const onClick = ui.bulk().props.onClick; const row = ui.rows()[0]; onClick(); onClick(); row.props.onToggleRead(row.props.article); ui.render();
  assert.equal(postCount(ui), 1); assert.equal(ui.text(ui.bulk()), "正在标记…"); assert.equal(ui.bulk().props.disabled, true);
  assert.deepEqual(JSON.parse(ui.requests[3].options.body), { view: "latest", q: "needle", category: "opml:Blogs", unread: true, snapshot: 99 });
  assert.equal(ui.requests[3].options.credentials, "same-origin");
  await ui.respond(3, { ok: true, changed: 6, ids: [5, 4, 3, 2, 1, 6] });
  assert.equal(ui.rows().length, 0); assert.ok(ui.text().includes("已将 6 篇文章标为已读"));
  const url = new URL(getLast(ui).url); assert.equal(url.searchParams.get("offset"), "0"); assert.equal(url.searchParams.get("q"), "needle"); assert.equal(url.searchParams.get("category"), "opml:Blogs"); assert.equal(url.searchParams.get("unread"), "1"); assert.equal(url.searchParams.has("snapshot"), false);
  assert.equal(ui.requests[2].options.signal.aborted, true);
  await ui.respond(4, fixture({ ids: [], total: 0, snapshot: 100 })); assert.equal(ui.bulk().props.disabled, true); ui.unmount();
});
await check("all loaded pages, unseen cached/reader IDs and late article GETs stay read", async () => {
  const ui = harness(); await ui.respond(0, fixture()); await showAll(ui);
  ui.click("加载更多"); await ui.respond(2, fixture({ ids: [3, 2] })); assert.equal(ui.rows().length, 4);
  const oldBulk = ui.bulk().props.onClick;
  ui.rows()[0].props.onOpen(1); ui.render();
  await ui.respond(3, { ok: true, article: { ...article(1), contentText: "", needsExtraction: true } });
  // Article 1 was never in a loaded list page; it is now cached with an extraction GET in flight.
  oldBulk(); ui.render(); const bulkIndex = ui.requests.length - 1;
  await ui.respond(bulkIndex, { ok: true, changed: 5, ids: [5, 4, 3, 2, 1] });
  let reader = ui.nodes().find((node) => node.type?.name === "ReaderView"); assert.equal(reader.props.reader.article.read, true);
  assert.ok(reader.props.articles.every((item) => item.read));
  await ui.respond(4, { ok: true, article: { ...article(1), contentText: "Late body", needsExtraction: false } });
  reader = ui.nodes().find((node) => node.type?.name === "ReaderView"); assert.equal(reader.props.reader.article.read, true); assert.equal(postCount(ui), 1, "late body never auto-marks a second time");
  reader.props.onBack(); ui.render(); assert.equal(ui.rows().length, 4); assert.ok(ui.rows().every((row) => row.props.article.read));
  // The visible list refreshes immediately after bulk read, including while the reader is open.
  assert.equal(new URL(getLast(ui).url).searchParams.get("offset"), "0");
  await ui.respond(ui.requests.length - 1, fixture({ ids: [1], snapshot: 101 })); assert.equal(ui.rows()[0].props.article.read, true, "GET overlay also covers previously unseen IDs"); ui.unmount();
});
await check("switching query during POST patches IDs only and refreshes current filter, ignoring old GET", async () => {
  const ui = harness(); await ui.respond(0, fixture()); await showAll(ui); ui.bulk().props.onClick(); ui.render();
  ui.search("other"); await ui.respond(3, fixture({ ids: [4, 8], total: 20, snapshot: 200 }));
  await ui.respond(2, { ok: true, changed: 2, ids: [5, 4] });
  assert.equal(new URL(getLast(ui).url).searchParams.get("q"), "other");
  assert.deepEqual(ui.rows().map((row) => [row.props.article.id, row.props.article.read]), [[8, false], [4, true]]);
  assert.ok(ui.text().includes("20"), "old response changed count does not replace new-filter statistics");
  await ui.respond(4, fixture({ ids: [8, 4], total: 19, snapshot: 201 })); assert.equal(ui.rows().find((row) => row.props.article.id === 4).props.article.read, true); ui.unmount();
});
await check("query resets invalidate old snapshot before a new latest bulk scope is loaded", async () => {
  const ui = harness(); await ui.respond(0, fixture());
  const oldClick = ui.bulk().props.onClick; ui.search("updated"); oldClick(); assert.equal(postCount(ui), 0, "reset invalidates the loaded snapshot synchronously");
  await ui.respond(1, fixture({ snapshot: 300 })); ui.bulk().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests[2].options.body), { view: "latest", q: "updated", category: null, unread: true, snapshot: 300 });
  await ui.respond(2, { ok: true, changed: 1, ids: [5] });
  assert.equal(new URL(getLast(ui).url).pathname, "/plugin/rss-brief/latest");
  assert.equal(new URL(getLast(ui).url).searchParams.get("q"), "updated"); ui.unmount();
});
await check("HTTP failures and network errors retain lists and expose action errors without retrying POST", async () => {
  for (const status of [400, 401, 403, 404, 503, 0]) {
    const ui = harness(); await ui.respond(0, fixture()); ui.bulk().props.onClick(); ui.render();
    if (status) await ui.respond(1, { ok: false, message: `failure ${status}` }, status); else await ui.reject(1);
    assert.equal(ui.rows().length, 2); assert.ok(ui.rows().every((row) => !row.props.article.read)); assert.ok(ui.text().includes(status ? `failure ${status}` : "offline failure")); assert.equal(ui.bulk().props.disabled, false); assert.equal(postCount(ui), 1); ui.unmount();
  }
});
await check("single read locks bulk immediately; invalid responses retain data; unmount aborts without writes or POST replay", async () => {
  const ui = harness(); await ui.respond(0, fixture()); const click = ui.bulk().props.onClick;
  const row = ui.rows()[0]; row.props.onToggleRead(row.props.article); click(); ui.render(); assert.equal(postCount(ui), 1);
  await ui.respond(1, { ok: true }); ui.bulk().props.onClick(); ui.render();
  await ui.respond(2, { ok: true, changed: 2, ids: [4, 4] }); assert.ok(ui.text().includes("批量已读响应无效")); assert.equal(ui.rows().find((row) => row.props.article.id === 4).props.article.read, false); assert.ok(!ui.rows().some((row) => row.props.article.id === 5), "successfully read row remains hidden by unread filter");
  ui.bulk().props.onClick(); ui.render(); const request = getLast(ui); ui.unmount(); assert.equal(request.options.signal.aborted, true);
  await ui.respond(ui.requests.length - 1, { ok: true, changed: 1, ids: [4] }); assert.equal(ui.writesAfterUnmount, 0); assert.equal(postCount(ui), 3);
});
await check("server unread count enables bulk when all loaded rows are read; no matches disables it", async () => {
  const ui = harness(); const data = fixture(); data.report.groups[0].items.forEach((item) => { item.read = true; });
  await ui.respond(0, data); assert.equal(ui.bulk().props.disabled, false, "unread articles can exist only on unloaded pages");
  ui.bulk().props.onClick(); ui.render(); await ui.respond(1, { ok: true, changed: 4, ids: [3, 2, 1, 6] });
  const complete = fixture(); complete.latest.unread = 0; complete.report.groups[0].items.forEach((item) => { item.read = true; });
  await ui.respond(2, complete); assert.equal(ui.bulk().props.disabled, true); ui.unmount();
});
await check("late polling GET for a loaded later page cannot overwrite successful read flags or merge old offsets", async () => {
  const ui = harness(); await ui.respond(0, fixture()); await showAll(ui); ui.click("加载更多"); await ui.respond(2, fixture({ ids: [3, 2] }));
  ui.tick(); assert.equal(new URL(ui.requests[3].url).searchParams.get("offset"), "2");
  ui.bulk().props.onClick(); ui.render(); await ui.respond(4, { ok: true, changed: 4, ids: [5, 4, 3, 2] });
  assert.equal(ui.requests[3].options.signal.aborted, true); assert.equal(new URL(ui.requests[5].url).searchParams.get("offset"), "0");
  await ui.respond(5, fixture({ ids: [5], total: 6, snapshot: 102 }));
  await ui.respond(3, fixture({ ids: [3, 2], total: 99, snapshot: 99 }));
  assert.deepEqual(ui.rows().map((row) => row.props.article.id), [5]); assert.equal(ui.rows()[0].props.article.read, true); ui.unmount();
});
await check("latest category bulk scope preserves server category and snapshot", async () => {
  const ui = harness(); await ui.respond(0, fixture());
  const category = ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem" && ui.text(node).includes("Blogs"));
  category.props.onClick(); ui.render();
  assert.equal(new URL(getLast(ui).url).searchParams.get("category"), "opml:Blogs");
  await ui.respond(1, fixture({ snapshot: 300 })); ui.bulk().props.onClick(); ui.render();
  assert.equal(JSON.parse(ui.requests[2].options.body).category, "opml:Blogs");
  assert.equal(JSON.parse(ui.requests[2].options.body).snapshot, 300);
  await ui.respond(2, { ok: true, changed: 0, ids: [] });
  assert.equal(new URL(getLast(ui).url).searchParams.get("category"), "opml:Blogs"); ui.unmount();
});
await check("category expansion is local; source filters compose, survive paging and scope bulk reads", async () => {
  const ui = harness(); await ui.respond(0, fixture());
  const toggle = () => ui.nodes().find((node) => node.props?.className === "rsb-categoryToggle");
  const sourceButton = (name) => ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem rsb-sourceItem" && ui.text(node).includes(name));
  assert.equal(toggle().props["aria-expanded"], false);
  toggle().props.onClick(); ui.render();
  assert.equal(ui.requests.length, 1, "expanding does not fetch");
  assert.equal(toggle().props["aria-expanded"], true);
  assert.equal(sourceButton("Empty source"), undefined, "zero-count subscriptions are hidden from navigation");
  sourceButton("Test source").props.onClick(); ui.render();
  let url = new URL(getLast(ui).url);
  assert.equal(url.searchParams.get("feed"), "7"); assert.equal(url.searchParams.get("category"), "opml:Blogs");
  assert.equal(url.searchParams.get("unread"), "1"); assert.equal(ui.bulk().props.disabled, true);
  await ui.respond(1, fixture());
  ui.search("needle"); await ui.respond(2, fixture());
  ui.nodes().find((node) => node.props?.["aria-label"] === "只看高质量").props.onClick(); ui.render(); await ui.respond(3, fixture());
  ui.click("加载更多"); url = new URL(getLast(ui).url);
  assert.equal(url.searchParams.get("feed"), "7"); assert.equal(url.searchParams.get("snapshot"), "99");
  assert.equal(url.searchParams.get("q"), "needle"); assert.equal(url.searchParams.get("quality"), "high");
  await ui.respond(4, fixture({ ids: [3, 2] }));
  ui.bulk().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(getLast(ui).options.body), { view: "latest", q: "needle", category: "opml:Blogs", unread: true, feed: 7, quality: "high", snapshot: 99 });
  await ui.respond(5, { ok: true, changed: 0, ids: [] }); await ui.respond(6, fixture());
  toggle().props.onClick(); ui.render(); assert.equal(toggle().props["aria-expanded"], false);
  assert.equal(ui.requests.length, 7, "collapsing preserves the source selection without a fetch");
  const category = ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem" && ui.text(node).includes("Blogs"));
  category.props.onClick(); ui.render();
  assert.equal(new URL(getLast(ui).url).searchParams.has("feed"), false, "selecting parent clears the source");
  assert.equal(toggle().props["aria-expanded"], true);
  ui.unmount();
});
await check("empty sources and categories disappear with filters and return with matches", async () => {
  const ui = harness();
  const initial = fixture();
  initial.latest.categories.push({ key: "opml:Empty", label: "Empty category", count: 0 });
  initial.latest.sources.push({ id: 9, title: "Other empty source", category: "opml:Empty", count: 0 });
  await ui.respond(0, initial);
  assert.equal(ui.nodes().some((node) => node.type === "button" && ui.text(node).includes("Empty category")), false);
  ui.nodes().find((node) => node.props?.className === "rsb-categoryToggle").props.onClick(); ui.render();
  assert.equal(ui.nodes().filter((node) => node.props?.className === "rsb-railItem rsb-sourceItem").length, 1);
  ui.search("no-match"); await ui.respond(1, fixture({ ids: [], total: 0 }));
  assert.equal(ui.nodes().filter((node) => node.props?.className === "rsb-categoryToggle").length, 0);
  assert.equal(ui.nodes().filter((node) => node.props?.className === "rsb-railItem rsb-sourceItem").length, 0);
  assert.ok(ui.nodes().some((node) => node.type === "button" && ui.text(node).includes("全部文章")), "All articles remains available");
  ui.search(""); await ui.respond(2, fixture());
  assert.equal(ui.nodes().filter((node) => node.props?.className === "rsb-railItem rsb-sourceItem").length, 1, "restored counts retain expansion state");
  ui.unmount();
});
console.log(`Passed ${checks} offline bulk client checks.`);
