/** Pure helpers from the real client; no React/DOM emulation or browser state. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
function helper(name) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf("\n    }", start) + "\n    }".length;
  assert.ok(start >= 0 && end > start, `find ${name} helper`);
  return runInNewContext(`(${source.slice(start, end).trim()})`);
}
const patchReadState = helper("patchReadState");
const safeUrl = helper("safeUrl");
const buildArticleList = helper("buildArticleList");
const plain = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(label, run) {
  run();
  console.log(`ok ${++checks} - ${label}`);
}
function fixture({ unread = false, nextOffset = 4 } = {}) {
  return {
    view: "latest", filterKey: "stable-filter",
    report: { date: "2026-11-04", groups: [
      { id: "opml:Blogs", label: "Blogs", items: [
        { id: 4, title: "First page A", opmlGroup: "Blogs", publishedAt: "2026-11-04T04:00:00Z", read: false },
        { id: 3, title: "First page B", opmlGroup: "Blogs", publishedAt: "2026-11-04T03:00:00Z", read: !unread },
      ] },
      { id: "opml:News", label: "News", items: [
        { id: 2, title: "Second page C", opmlGroup: "News", publishedAt: "2026-11-04T02:00:00Z", read: false },
        { id: 1, title: "Second page D", opmlGroup: "News", publishedAt: "2026-11-04T01:00:00Z", read: false },
      ] },
    ] },
    latest: { total: 12, unread: 9, available: 15, categories: [
      { key: "opml:Blogs", label: "Blogs", count: 7 },
      { key: "opml:News", label: "News", count: 5 },
    ] },
    pagination: { total: 12, offset: 2, limit: 2, nextOffset, hasMore: nextOffset !== null, snapshot: 99 },
  };
}
check("source unread counts update by feed identity without changing siblings", () => {
  const data = fixture({ unread: true });
  data.report.groups[0].items[0].feedId = 7;
  data.latest.sources = [{ id: 7, count: 4 }, { id: 8, count: 3 }];
  const after = patchReadState(data, 4, true, true);
  assert.deepEqual(plain(after.latest.sources), [{ id: 7, count: 3 }, { id: 8, count: 3 }]);
  assert.deepEqual(plain(patchReadState(after, 4, false, true).latest.sources), data.latest.sources);
  assert.deepEqual(plain(patchReadState(data, 4, true, false).latest.sources), data.latest.sources);
});
const ids = (data) => data.report.groups.flatMap((group) => group.items.map((item) => item.id));

check("read patches keep all loaded pages, order, pagination and input objects", () => {
  const before = fixture();
  const saved = JSON.stringify(before);
  const after = patchReadState(before, 2, true, false);
  assert.deepEqual(ids(after), [4, 3, 2, 1]);
  assert.equal(after.report.groups[1].items[0].read, true);
  assert.equal(after.latest.unread, 8);
  assert.equal(after.latest.total, 12);
  assert.equal(after.latest.available, 15);
  assert.equal(after.pagination, before.pagination);
  assert.deepEqual(plain(after.latest.categories), before.latest.categories);
  assert.equal(after.filterKey, before.filterKey);
  assert.equal(JSON.stringify(before), saved, "source cache is immutable");
  assert.equal(after.report.groups[0].items[0], before.report.groups[0].items[0], "unchanged article objects are retained");
});

check("unread-only patches adjust counts and offset while retaining reader navigation", () => {
  const before = fixture({ unread: true });
  const after = patchReadState(before, 2, true, true);
  assert.deepEqual(ids(after), [4, 3, 2, 1], "read item remains cached alongside every loaded page");
  assert.equal(after.latest.unread, 8);
  assert.equal(after.latest.total, 11);
  assert.deepEqual(plain(after.latest.categories.map((category) => category.count)), [7, 4]);
  assert.equal(after.pagination.total, 11);
  assert.equal(after.pagination.nextOffset, 3, "skip only remaining unread rows on next request");
  assert.equal(after.pagination.snapshot, 99);
  assert.equal(after.pagination.offset, before.pagination.offset);
  const selected = buildArticleList(after.report.groups, { unreadOnly: true });
  assert.deepEqual(Array.from(selected.articles, (article) => article.id), [4, 3, 1]);
  assert.deepEqual(Array.from(selected.readerArticles, (article) => article.id), [4, 3, 2, 1]);
});

check("manual unread reverses read counts without dropping loaded pages", () => {
  const before = fixture({ unread: true });
  const read = patchReadState(before, 4, true, true);
  const unread = patchReadState(read, 4, false, true);
  assert.deepEqual(plain(unread), before);
  assert.equal(unread.report.groups[0].items[0].read, false);
});

check("duplicate acknowledgments and unknown IDs do not change counts", () => {
  const before = fixture();
  assert.equal(patchReadState(before, 404, true, false), before);
  assert.equal(patchReadState(before, 3, true, false), before);
  assert.equal(patchReadState(null, 1, true, true), null);
  const once = patchReadState(before, 2, true, false);
  assert.equal(patchReadState(once, 2, true, false), once);
});

check("daily read patches preserve report metadata without requiring latest fields", () => {
  const before = { view: "daily", date: "2026-11-03", report: fixture().report };
  const after = patchReadState(before, 1, true, false);
  assert.equal(after.view, "daily");
  assert.equal(after.date, before.date);
  assert.deepEqual(ids(after), [4, 3, 2, 1]);
  assert.equal(after.report.groups[1].items[1].read, true);
  assert.equal(after.latest, undefined);
});

check("last-page cursor remains null and counters stay nonnegative", () => {
  const before = fixture({ unread: true, nextOffset: null });
  before.latest.unread = 0;
  before.latest.total = 0;
  before.latest.categories[1].count = 0;
  before.pagination.total = 0;
  const after = patchReadState(before, 1, true, true);
  assert.equal(after.pagination.nextOffset, null);
  assert.equal(after.pagination.hasMore, false);
  assert.equal(after.latest.unread, 0);
  assert.equal(after.latest.total, 0);
  assert.equal(after.latest.categories[1].count, 0);
  assert.equal(after.pagination.total, 0);
});

check("safe URL helper rejects executable and unsupported schemes", () => {
  for (const value of [undefined, null, 7, {}, "", "/relative", "//example.test/image.png", "javascript:alert(1)", "data:text/html,test", "file:///secret", "blob:some-id", "mailto:person@example.test"]) assert.equal(safeUrl(value), null);
  for (const value of ["https://example.test/article", "http://example.test/image.png", "HTTPS://example.test/path?q=a#heading"]) assert.equal(safeUrl(value), value);
});

console.log(`Passed ${checks} reader state checks (real pure helpers; no React/DOM emulation).`);
