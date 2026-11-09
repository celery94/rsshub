/** Real Client interaction checks for the compact list and adjacent reader; all requests are offline. */
import assert from "node:assert/strict";
import { harness } from "./tags-client-check.mjs";

const article = (id) => ({ id, title: `Article ${id}`, feed: "Test", publishedAt: "2026-11-04T00:00:00Z", read: false, tags: [] });
const latest = (ids = [5, 4], total = 6) => ({ ok: true, view: "latest",
  report: { groups: [{ id: "opml:Blogs", label: "Blogs", items: ids.map(article) }], warnings: [] },
  latest: { total, unread: total, categories: [], sources: [], tags: [] },
  pagination: { total, snapshot: 99, nextOffset: ids.length, hasMore: total > ids.length } });
const last = (ui) => ui.requests.length - 1;
const ids = (ui) => ui.rows().map((row) => row.props.article.id);
const node = (ui, className) => ui.nodes().find((entry) => entry.props.className === className);
const open = (ui, id) => { ui.rows().find((row) => row.props.article.id === id).props.onOpen(id); ui.render(); };
async function finishRead(ui, id) {
  await ui.respond(last(ui), { ok: true, article: { ...article(id), contentText: "Full body", needsExtraction: false } });
  assert.equal(ui.requests.at(-1).options.method, "POST");
  await ui.respond(last(ui), { ok: true });
}
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("compact is fixed, the empty right pane is present, and opening retains both list and controls", async () => {
  const ui = harness(); await ui.respond(0, latest());
  assert.equal(node(ui, "rsb-root").props["data-compact"], "true");
  assert.ok(!ui.nodes().some((entry) => entry.props["aria-label"] === ui.tr("view.compact")));
  assert.ok(node(ui, "rsb-readerPlaceholder")); assert.ok(ui.rows().every((row) => row.props.compactMode));
  open(ui, 5); assert.ok(node(ui, "rsb-readingPane")); assert.ok(node(ui, "rsb-listPane")); assert.ok(node(ui, "rsb-body"));
  assert.ok(node(ui, "rsb-header")); assert.ok(ui.select()); assert.ok(ui.bulk()); assert.deepEqual(ids(ui), [5, 4]);
  assert.equal(ui.rows()[0].props.selected, true);
  await finishRead(ui, 5);
  assert.deepEqual(ids(ui), [5, 4], "automatic read keeps the selected row in place");
  assert.equal(ui.rows()[0].props.article.read, true);
  const row = ui.plugin.ArticleRow(ui.rows()[0].props);
  assert.equal(row.props["data-selected"], "true");
  assert.equal(ui.walk(row).find((entry) => entry.props.className === "rsb-itemTitleButton").props["aria-current"], "true");
  ui.reader().props.onBack(); ui.render(); assert.deepEqual(ids(ui), [4]); assert.ok(node(ui, "rsb-readerPlaceholder")); ui.unmount();
});

await check("reading permits pagination, new rows join navigation, and refresh retains read rows", async () => {
  const ui = harness(); await ui.respond(0, latest()); open(ui, 5); await finishRead(ui, 5);
  ui.click("加载更多"); assert.equal(new URL(ui.requests.at(-1).url).searchParams.get("offset"), "1");
  await ui.respond(last(ui), latest([3, 2])); assert.deepEqual(ids(ui), [5, 4, 3, 2]);
  open(ui, 3); await finishRead(ui, 3);
  assert.deepEqual(ids(ui), [5, 4, 3, 2]); assert.equal(ui.rows().find((row) => row.props.selected).props.article.id, 3);
  assert.deepEqual(Array.from(ui.reader().props.articles, (entry) => entry.id), [5, 4, 3, 2]);
  ui.click("刷新"); assert.equal(new URL(ui.requests.at(-1).url).searchParams.get("offset"), "0");
  await ui.respond(last(ui), latest([4, 2])); assert.deepEqual(ids(ui), [5, 4, 3, 2]);
  assert.equal(ui.reader().props.reader.id, 3); assert.ok(!ui.button("刷新").props.disabled); ui.unmount();
});

await check("closing captures the current desktop list position and preserves the saved mobile position", async () => {
  for (const mobile of [false, true]) {
    const ui = harness(); await ui.respond(0, latest());
    const element = { scrollTop: 320, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, bottom: 600 }), querySelectorAll: () => [] };
    node(ui, "rsb-body").props.ref(element); element.scrollTop = 320;
    open(ui, 5);
    element.scrollTop = mobile ? 0 : 520; element.clientHeight = mobile ? 0 : 600;
    ui.reader().props.onBack(); ui.render();
    assert.equal(element.scrollTop, mobile ? 320 : 520, mobile ? "hidden mobile list preserves its original offset" : "desktop list preserves scrolling performed during reading");
    ui.unmount();
  }
});

await check("changing visible filters cancels the reader and ignores late article bodies", async () => {
  for (const action of ["search", "只看未读", "只看高质量"]) {
    const ui = harness(); await ui.respond(0, latest()); open(ui, 5); const request = last(ui);
    if (action === "search") {
      ui.nodes().find((entry) => entry.type === "input" && entry.props.type === "search").props.onChange({ target: { value: "new query" } }); ui.render();
    } else ui.click(action);
    assert.equal(ui.reader(), undefined); assert.equal(ui.requests[request].options.signal.aborted, true);
    await ui.respond(request, { ok: true, article: { ...article(5), contentText: "late", needsExtraction: false } });
    assert.equal(ui.reader(), undefined); assert.equal(ui.requests.filter((entry) => entry.options.method === "POST").length, 0);
    ui.unmount();
  }
});
await check("both column widths persist across page mounts and invalid storage falls back or clamps", async () => {
  const key = "dsh-rss-brief:columns:v1", storage = new Map();
  let ui = harness("RssBriefPage", {}, storage);
  const divider = (name) => ui.nodes().find((entry) => entry.type?.name === "ColumnDivider" && entry.props.label === ui.tr(name));
  divider("layout.navigationWidth").props.onChange(264); ui.render();
  divider("layout.readerWidth").props.onChange(53); ui.render();
  assert.deepEqual(JSON.parse(storage.get(key)), { navigation: 264, list: 53 }); ui.unmount();
  ui = harness("RssBriefPage", {}, storage);
  assert.equal(node(ui, "rsb-root").props.style["--rsb-rail-width"], "264px");
  assert.equal(node(ui, "rsb-root").props.style["--rsb-list-width"], "53%"); ui.unmount();
  storage.set(key, "broken JSON"); ui = harness("RssBriefPage", {}, storage);
  assert.deepEqual(JSON.parse(storage.get(key)), { navigation: 208, list: 44 }); ui.unmount();
  storage.set(key, JSON.stringify({ navigation: -10, list: 99 })); ui = harness("RssBriefPage", {}, storage);
  assert.deepEqual(JSON.parse(storage.get(key)), { navigation: 132, list: 70 }); ui.unmount();
});

await check("dividers support captured pointer drag, cancellation, keyboard bounds and double-click reset", async () => {
  const values = [], captured = new Set();
  const ui = harness("ColumnDivider", { label: "Columns", hint: "Resize", value: 44, minimum: 25, maximum: 70,
    defaultValue: 44, percent: true, onChange: (value) => values.push(value) });
  const handle = node(ui, "rsb-columnDivider");
  const target = { parentElement: { clientWidth: 1000 }, focus() {}, setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id), releasePointerCapture: (id) => captured.delete(id) };
  const pointer = (x) => ({ button: 0, pointerId: 1, clientX: x, currentTarget: target, preventDefault() {} });
  handle.props.onPointerDown(pointer(100)); handle.props.onPointerMove(pointer(200)); assert.equal(values.at(-1), 54);
  handle.props.onPointerMove(pointer(2000)); assert.equal(values.at(-1), 70);
  handle.props.onPointerUp(pointer(2000)); assert.equal(captured.size, 0);
  const count = values.length; handle.props.onPointerMove(pointer(300)); assert.equal(values.length, count);
  handle.props.onPointerDown(pointer(100)); handle.props.onPointerCancel(); handle.props.onPointerMove(pointer(300)); assert.equal(values.length, count);
  for (const [key, expected] of [["ArrowLeft", 43], ["ArrowRight", 45], ["Home", 25], ["End", 70]]) {
    handle.props.onKeyDown({ key, preventDefault() {} }); assert.equal(values.at(-1), expected);
  }
  handle.props.onDoubleClick(); assert.equal(values.at(-1), 44);
  assert.equal(handle.props.role, "separator"); assert.equal(handle.props["aria-orientation"], "vertical"); ui.unmount();
});
console.log(`Passed ${checks} compact split reader checks.`);
