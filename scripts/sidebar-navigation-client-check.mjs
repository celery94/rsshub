/** Tag-led sidebar, using the real Client and deferred offline requests. */
import assert from "node:assert/strict";
import { harness } from "./tags-client-check.mjs";

const topic = "软件开发", emptyTopic = "AI与模型", format = "教程指南", emptyFormat = "观点评论", legacy = "旧标签", otherLegacy = "另一旧标签";
const article = (id) => ({ id, title: `needle ${id}`, feed: "Test", feedId: 7, opmlGroup: "Blogs", publishedAt: "2026-11-04T00:00:00Z", read: false, tags: [topic, format, legacy], topics: [topic], format });
function latest({ ids = [5, 4], snapshot = 99, total = 6, navigationTotal = 42 } = {}) {
  return { ok: true, view: "latest", report: { groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map(article) }], warnings: [] },
    latest: { total, unread: total, navigation: { total: navigationTotal }, categories: [{ key: "opml:Blogs", label: "Blogs", count: total }], sources: [{ id: 7, title: "Test source", category: "opml:Blogs", count: total }],
      tags: [{ name: topic, count: total }, { name: format, count: total }, { name: emptyTopic, count: 0 }, { name: legacy, count: 5 }, { name: otherLegacy, count: 2 }],
      tagGroups: { topics: [{ name: topic, count: total }, { name: emptyTopic, count: 0 }], formats: [{ name: format, count: total }, { name: emptyFormat, count: 0 }] } },
    pagination: { total, snapshot, nextOffset: ids.length, hasMore: total > ids.length } };
}
const reply = (ui, body = latest()) => ui.respond(ui.requests.length - 1, body);
const url = (ui) => new URL(ui.requests.at(-1).url);
const nav = (ui, dimension, name) => ui.nodes().find((node) => node.props["data-dimension"] === dimension && node.props["data-name"] === name);
const navRows = (ui, dimension) => ui.nodes().filter((node) => node.props["data-dimension"] === dimension);
const clickNav = (ui, dimension, name) => { const node = nav(ui, dimension, name); assert.ok(node, `${dimension}: ${name}`); node.props.onClick(); ui.render(); };
const labeledRow = (ui, label) => ui.nodes().find((node) => node.type === "button" && node.props.className === "rsb-railItem" && node.props.children.some((child) => child?.props?.className === "rsb-railLabel" && ui.text(child) === label));
const all = (ui) => labeledRow(ui, ui.tr("dashboard.all"));
const sourceAll = (ui) => labeledRow(ui, ui.tr("sources.all"));
const count = (ui, node) => ui.text(node.props.children.find((child) => child?.props?.className === "rsb-railCount"));
const dropdown = (ui, kind) => ui.nodes().find((node) => node.type === "select" && node.props["aria-label"] === ui.tr(`${kind}.filter`));
const choose = (ui, kind, value) => { dropdown(ui, kind).props.onChange({ target: { value } }); ui.render(); };
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("sidebar groups derive from API names, hide unused zeros, preserve history order and use global navigation count", async () => {
  const ui = harness(); const data = latest(); data.latest.tags.unshift({ name: emptyTopic.toLowerCase(), count: 3 }); await reply(ui, data);
  assert.equal(all(ui).props["aria-pressed"], true); assert.equal(count(ui, all(ui)), "42");
  assert.deepEqual(navRows(ui, "topics").map((node) => node.props["data-name"]), [topic]);
  assert.deepEqual(navRows(ui, "formats").map((node) => node.props["data-name"]), [format]);
  assert.deepEqual(navRows(ui, "legacy").map((node) => node.props["data-name"]), [legacy, otherLegacy]);
  assert.equal(nav(ui, "legacy", topic), undefined); assert.equal(nav(ui, "legacy", format), undefined);
  assert.ok(ui.nodes().some((node) => node.type === "details" && node.props["aria-label"] === "主题"));
  assert.ok(ui.nodes().some((node) => node.type === "details" && node.props["aria-label"] === "内容类型"));
  const old = latest(); delete old.latest.tagGroups; delete old.latest.navigation;
  ui.click("刷新"); await reply(ui, old);
  assert.equal(navRows(ui, "topics").length, 0); assert.deepEqual(navRows(ui, "legacy").map((node) => node.props["data-name"]), [topic, format, legacy, otherLegacy]);
  assert.equal(count(ui, all(ui)), "6", "old payload falls back to latest.total"); ui.unmount();
});

await check("sidebar topic/type selection syncs controls, heading, pages, filter keys and bulk scope", async () => {
  const ui = harness(); await reply(ui); clickNav(ui, "topics", topic); await reply(ui); clickNav(ui, "formats", format); await reply(ui);
  assert.equal(dropdown(ui, "tags").props.value, topic); assert.equal(dropdown(ui, "formats").props.value, format);
  assert.equal(nav(ui, "topics", topic).props["aria-pressed"], true); assert.equal(nav(ui, "formats", format).props["aria-pressed"], true); assert.equal(all(ui).props["aria-pressed"], false);
  assert.equal(ui.text(ui.nodes().find((node) => node.props.className === "rsb-listTitle")), `${topic} · ${format}`);
  ui.click("加载更多"); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), format); assert.equal(url(ui).searchParams.get("snapshot"), "99");
  await reply(ui, latest({ ids: [3, 2] })); ui.bulk().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body), { view: "latest", q: "", category: null, unread: true, tag: topic, format, snapshot: 99 });
  await reply(ui, { ok: true, changed: 0, ids: [] }); await reply(ui); ui.unmount();
});

await check("selected zero rows and missing historical tags remain reachable and clearable", async () => {
  const ui = harness(); await reply(ui); clickNav(ui, "legacy", legacy); await reply(ui);
  const historicalOption = dropdown(ui, "tags").props.children.find((node) => node?.type === "option" && node.props.value === legacy);
  assert.match(ui.text(historicalOption), /5/, "legacy sidebar and top filter show the same actual count");
  choose(ui, "tags", emptyTopic); await reply(ui);
  assert.equal(nav(ui, "topics", emptyTopic).props["aria-pressed"], true); assert.equal(count(ui, nav(ui, "topics", emptyTopic)), "0");
  choose(ui, "formats", emptyFormat); await reply(ui);
  assert.equal(nav(ui, "formats", emptyFormat).props["aria-pressed"], true); assert.equal(count(ui, nav(ui, "formats", emptyFormat)), "0");
  ui.rows()[0].props.onSelectTag("已消失的旧标签"); ui.render(); await reply(ui);
  assert.equal(nav(ui, "legacy", "已消失的旧标签").props["aria-pressed"], true); assert.equal(count(ui, nav(ui, "legacy", "已消失的旧标签")), "0");
  ui.click(ui.tr("tags.clear")); await reply(ui); assert.equal(nav(ui, "legacy", "已消失的旧标签"), undefined); assert.equal(nav(ui, "topics", emptyTopic), undefined);
  ui.click(ui.tr("formats.clear")); await reply(ui); assert.equal(nav(ui, "formats", emptyFormat), undefined); ui.unmount();
});

await check("subscription tree stays in a closed native disclosure and all sources preserves topic/type", async () => {
  const ui = harness(); await reply(ui);
  const details = ui.nodes().find((node) => node.type === "details" && node.props.className === "rsb-sourcesNavigation");
  assert.ok(details); assert.ok(!details.props.open); assert.equal(ui.text(details.props.children[0]), "订阅来源"); assert.equal(details.props.children[0].type, "summary");
  const before = ui.requests.length;
  ui.nodes().find((node) => node.props.className === "rsb-categoryToggle").props.onClick(); ui.render(); assert.equal(ui.requests.length, before);
  const source = ui.nodes().find((node) => node.props.className === "rsb-railItem rsb-sourceItem"); source.props.onClick(); ui.render(); await reply(ui);
  clickNav(ui, "topics", topic); await reply(ui); clickNav(ui, "formats", format); await reply(ui);
  assert.match(ui.text(ui.nodes().find((node) => node.props.className === "rsb-listTitle")), /Test source/);
  sourceAll(ui).props.onClick(); ui.render();
  assert.equal(url(ui).searchParams.has("category"), false); assert.equal(url(ui).searchParams.has("feed"), false); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), format);
  await reply(ui); assert.equal(all(ui).props["aria-pressed"], false); ui.unmount();
});

await check("all articles clears topic/type/category/feed, retains query/unread/quality and resets snapshot, scroll and bulk scope", async () => {
  const ui = harness(); await reply(ui);
  ui.nodes().find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: " needle " } }); ui.render(); await reply(ui); ui.click("只看高质量"); await reply(ui);
  ui.nodes().find((node) => node.props.className === "rsb-categoryToggle").props.onClick(); ui.render();
  ui.nodes().find((node) => node.props.className === "rsb-railItem rsb-sourceItem").props.onClick(); ui.render(); await reply(ui);
  clickNav(ui, "topics", topic); await reply(ui); clickNav(ui, "formats", format); await reply(ui); ui.click("加载更多"); await reply(ui, latest({ ids: [3, 2] }));
  const element = { scrollTop: 500 }; ui.nodes().find((node) => node.props.className === "rsb-body").props.ref(element); element.scrollTop = 500;
  const oldBulk = ui.bulk().props.onClick; all(ui).props.onClick(); oldBulk(); ui.render();
  for (const key of ["tag", "format", "category", "feed", "snapshot"]) assert.equal(url(ui).searchParams.has(key), false, key);
  assert.equal(url(ui).searchParams.get("offset"), "0"); assert.equal(url(ui).searchParams.get("q"), "needle"); assert.equal(url(ui).searchParams.get("unread"), "1"); assert.equal(url(ui).searchParams.get("quality"), "high"); assert.equal(element.scrollTop, 0);
  assert.equal(ui.requests.filter((request) => request.options.method === "POST").length, 0); assert.equal(ui.rows().length, 0, "old filter rows are hidden until matching response");
  await reply(ui); assert.equal(all(ui).props["aria-pressed"], true); assert.equal(dropdown(ui, "tags").props.value, ""); assert.equal(dropdown(ui, "formats").props.value, ""); ui.unmount();
});

await check("all articles from a pending reader closes it, rejects late content and restores the new list at top", async () => {
  const ui = harness(); await reply(ui); clickNav(ui, "topics", topic); await reply(ui);
  const element = { scrollTop: 350, getBoundingClientRect: () => ({ top: 0, bottom: 600 }), querySelectorAll: () => [] };
  const attach = () => ui.nodes().find((node) => node.props.className === "rsb-body").props.ref(element);
  attach(); element.scrollTop = 350; ui.rows()[0].props.onOpen(5); ui.render(); const oldReader = ui.requests.length - 1;
  all(ui).props.onClick(); ui.render(); attach(); assert.equal(ui.reader(), undefined); assert.equal(element.scrollTop, 0); assert.equal(ui.requests[oldReader].options.signal.aborted, true);
  await reply(ui, latest({ ids: [8], snapshot: 200 })); await ui.respond(oldReader, { ok: true, article: { ...article(5), contentText: "late", needsExtraction: false } });
  assert.equal(ui.reader(), undefined); assert.deepEqual(ui.rows().map((row) => row.props.article.id), [8]); assert.equal(ui.requests.filter((request) => request.options.method === "POST").length, 0); ui.unmount();
});

await check("read patches navigation and matching rows once, preserves old shape, and empty navigation always exposes all", async () => {
  const ui = harness(); const data = latest(); await reply(ui, data);
  ui.rows()[0].props.onToggleRead(ui.rows()[0].props.article); ui.render(); await reply(ui, { ok: true });
  assert.equal(count(ui, all(ui)), "41"); assert.equal(count(ui, nav(ui, "topics", topic)), "5"); assert.equal(count(ui, nav(ui, "formats", format)), "5"); assert.equal(count(ui, nav(ui, "legacy", legacy)), "4");
  const read = ui.plugin.patchReadState(data, 5, true, true);
  assert.equal(ui.plugin.patchReadState(read, 5, true, true), read); assert.equal(ui.plugin.patchReadState(read, 5, false, true).latest.navigation.total, 42); assert.equal(data.latest.navigation.total, 42);
  assert.equal(ui.plugin.patchReadState(data, 5, true, false).latest.navigation.total, 42);
  const old = latest(); delete old.latest.navigation; assert.equal(Object.hasOwn(ui.plugin.patchReadState(old, 5, true, true).latest, "navigation"), false);
  const empty = latest({ ids: [], total: 0, navigationTotal: 0 }); empty.latest.tags = []; empty.latest.tagGroups.topics.forEach((entry) => { entry.count = 0; }); empty.latest.tagGroups.formats.forEach((entry) => { entry.count = 0; });
  ui.click("刷新"); await reply(ui, empty); assert.equal(navRows(ui, "topics").length, 0); assert.equal(navRows(ui, "formats").length, 0); assert.equal(navRows(ui, "legacy").length, 0);
  assert.ok(ui.text().includes("暂无标签")); assert.equal(count(ui, all(ui)), "0"); assert.equal(all(ui).props["aria-pressed"], true); ui.unmount();
});
console.log(`Passed ${checks} offline sidebar navigation client checks.`);
