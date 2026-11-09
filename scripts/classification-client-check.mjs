/** Stable topic/content-type filters against real Client hooks; no network or database. */
import assert from "node:assert/strict";
import { harness } from "./tags-client-check.mjs";

const topic = "软件开发", otherTopic = "AI与模型", format = "教程指南", otherFormat = "观点评论", legacyTag = "历史自定义标签";
const plain = (value) => JSON.parse(JSON.stringify(value));
const article = (id, extra = {}) => ({ id, title: `needle ${id}`, feed: "Test", feedId: 7, opmlGroup: "Blogs", publishedAt: "2026-11-04T00:00:00Z", read: false, tags: [topic, format], topics: [topic], format, ...extra });
function latest({ ids = [5, 4], snapshot = 99, total = 6, tagGroups } = {}) {
  return { ok: true, view: "latest", report: { groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map((id) => article(id)) }], warnings: [] },
    latest: { total, unread: total, categories: [{ key: "opml:Blogs", label: "Blogs", count: total }], sources: [{ id: 7, title: "Test source", category: "opml:Blogs", count: total }],
      tags: [{ name: legacyTag, count: 2 }], tagGroups: tagGroups ?? { topics: [{ name: topic, count: total }, { name: otherTopic, count: 0 }], formats: [{ name: format, count: total }, { name: otherFormat, count: 0 }] } },
    pagination: { total, snapshot, nextOffset: ids.length, hasMore: total > ids.length } };
}
const select = (ui, kind) => ui.nodes().find((node) => node.type === "select" && node.props["aria-label"] === ui.tr(`${kind}.filter`));
const choose = (ui, kind, value) => { select(ui, kind).props.onChange({ target: { value: value ?? "" } }); ui.render(); };
const options = (ui, kind) => select(ui, kind).props.children.filter((node) => node?.type === "option");
const count = (ui, kind, value) => ui.text(options(ui, kind).find((node) => node.props.value === value));
const reply = (ui, body = latest()) => ui.respond(ui.requests.length - 1, body);
const url = (ui) => new URL(ui.requests.at(-1).url);
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("API directories drive both controls, retain zero counts and legacy tag selection, and clear independently", async () => {
  const ui = harness(); await reply(ui);
  assert.deepEqual(options(ui, "tags").map((node) => node.props.value), ["", topic, otherTopic]);
  assert.deepEqual(options(ui, "formats").map((node) => node.props.value), ["", format, otherFormat]);
  assert.match(count(ui, "tags", otherTopic), /0/); assert.match(count(ui, "formats", otherFormat), /0/);
  choose(ui, "tags", topic); await reply(ui); choose(ui, "formats", format); await reply(ui);
  assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), format);
  ui.click(ui.tr("tags.clear")); assert.equal(url(ui).searchParams.has("tag"), false); assert.equal(url(ui).searchParams.get("format"), format); await reply(ui);
  ui.rows()[0].props.onSelectTag(legacyTag); ui.render(); await reply(ui);
  assert.equal(select(ui, "tags").props.value, legacyTag); assert.match(count(ui, "tags", legacyTag), /2/, "selected historical tag uses its actual facet count");
  assert.equal(url(ui).searchParams.get("tag"), legacyTag); assert.equal(url(ui).searchParams.get("format"), format);
  ui.click(ui.tr("formats.clear")); assert.equal(url(ui).searchParams.get("tag"), legacyTag); assert.equal(url(ui).searchParams.has("format"), false); await reply(ui);
  const old = latest(); delete old.latest.tagGroups; ui.click(ui.tr("tags.clear")); await reply(ui, old);
  assert.deepEqual(options(ui, "tags").map((node) => node.props.value), ["", legacyTag], "old responses still supply their tag directory");
  assert.equal(options(ui, "formats").length, 1); ui.unmount();
});

await check("topic, format and historical article chips route distinct actions with localized names", () => {
  const ui = harness("ArticleTags", { tags: [] });
  let selectedTag = null, selectedFormat = null;
  const row = ui.plugin.ArticleRow({ article: article(5, { tags: [topic, format, legacyTag] }), tr: ui.tr, compactMode: false,
    onSelectTag: (value) => { selectedTag = value; }, onSelectFormat: (value) => { selectedFormat = value; } });
  const chipProps = row.props.children.find((node) => node?.type?.name === "ArticleTags").props;
  const chips = ui.plugin.ArticleTags(chipProps), buttons = ui.walk(chips).filter((node) => node.type === "button");
  assert.equal(buttons[0].props["data-kind"], "topic"); assert.equal(buttons[1].props["data-kind"], "format"); assert.equal(buttons[2].props["data-kind"], "legacy");
  assert.equal(buttons[0].props["aria-label"], `筛选主题：${topic}`); assert.equal(buttons[1].props["aria-label"], `筛选内容类型：${format}`); assert.equal(buttons[2].props["aria-label"], `筛选标签：${legacyTag}`);
  buttons[1].props.onClick(); assert.equal(selectedFormat, format); assert.equal(selectedTag, null);
  buttons[0].props.onClick(); assert.equal(selectedTag, topic); buttons[2].props.onClick(); assert.equal(selectedTag, legacyTag);
  const compact = ui.plugin.ArticleTags({ ...chipProps, compact: true });
  assert.equal(ui.walk(compact).filter((node) => node.type === "button").length, 2); assert.equal(compact.props.title, [topic, format, legacyTag].join(" · "));
  const twoTopics = ui.plugin.ArticleTags({ ...chipProps, tags: [topic, otherTopic, format], topics: [topic, otherTopic], compact: true });
  assert.deepEqual(ui.walk(twoTopics).filter((node) => node.type === "button").map((node) => node.props["data-kind"]), ["topic", "format"], "compact rows keep the primary theme and form visible");
  assert.ok(ui.walk(twoTopics).find((node) => node.props.className === "rsb-tagMore").props["aria-label"].includes(otherTopic));
  for (const button of buttons) assert.equal(ui.walk(button).filter((node) => node.type === "button").length, 1);
  ui.unmount();
});

await check("topic and type compose all existing filters, preserve paging snapshot and scope bulk reads", async () => {
  const ui = harness(); await reply(ui);
  ui.nodes().find((node) => node.props.className === "rsb-categoryToggle").props.onClick(); ui.render();
  ui.nodes().find((node) => node.props.className === "rsb-railItem rsb-sourceItem").props.onClick(); ui.render(); await reply(ui);
  ui.nodes().find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: " needle " } }); ui.render(); await reply(ui);
  ui.click("只看高质量"); await reply(ui); choose(ui, "tags", topic); await reply(ui);
  const oldBulk = ui.bulk().props.onClick; choose(ui, "formats", format); oldBulk();
  assert.equal(ui.requests.filter((request) => request.options.method === "POST").length, 0, "type change invalidates the old bulk snapshot synchronously");
  for (const [key, expected] of Object.entries({ tag: topic, format, feed: "7", category: "opml:Blogs", q: "needle", quality: "high", unread: "1", offset: "0" })) assert.equal(url(ui).searchParams.get(key), expected);
  assert.equal(url(ui).searchParams.has("snapshot"), false); await reply(ui);
  ui.click("加载更多"); assert.equal(url(ui).searchParams.get("snapshot"), "99"); assert.equal(url(ui).searchParams.get("offset"), "2"); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), format);
  await reply(ui, latest({ ids: [3, 2] })); ui.bulk().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body), { view: "latest", q: "needle", category: "opml:Blogs", unread: true, feed: 7, tag: topic, format, quality: "high", snapshot: 99 });
  await reply(ui, { ok: true, changed: 4, ids: [5, 4, 3, 2] });
  assert.equal(url(ui).searchParams.get("format"), format); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("offset"), "0"); assert.equal(url(ui).searchParams.has("snapshot"), false);
  await reply(ui, latest({ ids: [], total: 0 })); assert.match(count(ui, "tags", topic), /0/); assert.match(count(ui, "formats", format), /0/); ui.unmount();
});

await check("late pages from another type are aborted and cannot merge or replace its facet snapshot", async () => {
  const ui = harness(); await reply(ui); choose(ui, "tags", topic); await reply(ui); choose(ui, "formats", format); await reply(ui);
  ui.click("加载更多"); const oldPage = ui.requests.length - 1;
  choose(ui, "formats", otherFormat); assert.equal(ui.requests[oldPage].options.signal.aborted, true); assert.equal(ui.rows().length, 0);
  assert.equal(url(ui).searchParams.get("offset"), "0"); assert.equal(url(ui).searchParams.has("snapshot"), false); assert.equal(url(ui).searchParams.get("tag"), topic);
  await reply(ui, latest({ ids: [9], snapshot: 200 })); await ui.respond(oldPage, latest({ ids: [3, 2], snapshot: 99 }));
  assert.deepEqual(ui.rows().map((row) => row.props.article.id), [9]); assert.equal(select(ui, "formats").props.value, otherFormat);
  ui.click("加载更多"); assert.equal(url(ui).searchParams.get("snapshot"), "200"); assert.equal(url(ui).searchParams.get("offset"), "1"); assert.equal(url(ui).searchParams.get("format"), otherFormat);
  await reply(ui, latest({ ids: [8], snapshot: 200 })); assert.deepEqual(ui.rows().map((row) => row.props.article.id), [9, 8]); ui.unmount();
});

await check("reader type action returns to first-page top, retains topic and supports the same type", async () => {
  const ui = harness(); await reply(ui); choose(ui, "tags", topic); await reply(ui);
  const element = { scrollTop: 350, getBoundingClientRect: () => ({ top: 0, bottom: 600 }), querySelectorAll: () => [] };
  const attach = () => ui.nodes().find((node) => node.props.className === "rsb-body").props.ref(element);
  attach(); element.scrollTop = 350; ui.rows()[0].props.onOpen(5); ui.render();
  await reply(ui, { ok: true, article: article(5, { contentText: "", needsExtraction: false }) });
  const readerProps = ui.reader().props, readerUi = harness("ReaderView", readerProps);
  const chipProps = readerUi.nodes().find((node) => node.type?.name === "ArticleTags").props;
  assert.equal(chipProps.format, format); assert.deepEqual(plain(chipProps.topics), [topic]);
  const typeButton = readerUi.walk(readerUi.plugin.ArticleTags(chipProps)).find((node) => node.props["data-kind"] === "format");
  typeButton.props.onClick(); ui.render(); attach();
  assert.equal(ui.reader(), undefined); assert.equal(element.scrollTop, 0); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), format); assert.equal(url(ui).searchParams.get("unread"), "1"); await reply(ui);
  ui.rows()[0].props.onOpen(5); ui.render(); ui.reader().props.onSelectFormat(format); ui.render(); attach();
  assert.equal(element.scrollTop, 0); assert.equal(ui.reader(), undefined); assert.equal(url(ui).searchParams.get("offset"), "0"); await reply(ui);
  readerUi.unmount(); ui.unmount();
});

await check("read patches each classified membership once, preserve stable zeros, and retain legacy payload shape", async () => {
  const ui = harness(); const data = latest(); data.report.groups[0].items[0].topics = [topic, topic];
  const original = JSON.stringify(data); await reply(ui, data); choose(ui, "tags", topic); await reply(ui, data); choose(ui, "formats", format); await reply(ui, data);
  ui.rows()[0].props.onToggleRead(ui.rows()[0].props.article); ui.render(); await reply(ui, { ok: true });
  assert.match(count(ui, "tags", topic), /5/); assert.match(count(ui, "formats", format), /5/); assert.match(count(ui, "tags", otherTopic), /0/); assert.match(count(ui, "formats", otherFormat), /0/);
  assert.equal(JSON.stringify(data), original, "source data is immutable");
  const read = ui.plugin.patchReadState(data, 5, true, true), unread = ui.plugin.patchReadState(read, 5, false, true);
  assert.deepEqual(plain(unread.latest.tagGroups), data.latest.tagGroups);
  assert.equal(ui.plugin.patchReadState(read, 5, true, true), read, "duplicate acknowledgments cannot change facets twice");
  assert.deepEqual(plain(ui.plugin.patchReadState(data, 5, true, false).latest.tagGroups), data.latest.tagGroups, "all-read facet counts are unchanged");
  const legacy = latest(); delete legacy.latest.tagGroups; delete legacy.report.groups[0].items[0].topics; delete legacy.report.groups[0].items[0].format;
  assert.equal(Object.hasOwn(ui.plugin.patchReadState(legacy, 5, true, true).latest, "tagGroups"), false);
  const partial = latest({ tagGroups: { topics: [{ name: topic, count: 1 }] } });
  const patched = ui.plugin.patchReadState(partial, 5, true, true); assert.equal(patched.latest.tagGroups.topics[0].count, 0); assert.equal(Object.hasOwn(patched.latest.tagGroups, "formats"), false);
  const legacyReader = harness("ReaderView", { reader: { id: 5, article: { id: 5, title: "old", tags: [legacyTag] }, pending: false }, articles: [], onBack() {}, onNavigate() {}, onToggleRead() {}, readBusy: null, positions: { current: new Map() } });
  const legacyChips = legacyReader.nodes().find((node) => node.type?.name === "ArticleTags"); assert.equal(legacyReader.plugin.ArticleTags(legacyChips.props).props.children[0].props["data-kind"], "legacy");
  legacyReader.unmount(); ui.unmount();
});
await check("switching type from a pending reader ignores its late body and retains the new facets", async () => {
  const ui = harness(); await reply(ui); choose(ui, "tags", topic); await reply(ui); choose(ui, "formats", format); await reply(ui);
  ui.rows()[0].props.onOpen(5); ui.render(); const oldArticle = ui.requests.length - 1;
  ui.reader().props.onSelectFormat(otherFormat); ui.render();
  assert.equal(ui.requests[oldArticle].options.signal.aborted, true); assert.equal(url(ui).searchParams.get("tag"), topic); assert.equal(url(ui).searchParams.get("format"), otherFormat);
  const current = latest({ ids: [8], snapshot: 200, total: 1 }); current.report.groups[0].items[0] = article(8, { tags: [topic, otherFormat], format: otherFormat });
  current.latest.tagGroups.formats = [{ name: format, count: 4 }, { name: otherFormat, count: 1 }];
  await reply(ui, current);
  await ui.respond(oldArticle, { ok: true, article: article(5, { contentText: "Late readable body", needsExtraction: false }) });
  assert.equal(ui.reader(), undefined); assert.deepEqual(ui.rows().map((row) => row.props.article.id), [8]);
  assert.equal(ui.requests.filter((request) => request.options.method === "POST").length, 0, "aborted reader cannot auto-mark its old article");
  assert.match(count(ui, "tags", topic), /1/); assert.match(count(ui, "formats", format), /4/); assert.match(count(ui, "formats", otherFormat), /1/); ui.unmount();
});
console.log(`Passed ${checks} offline classification client checks.`);
