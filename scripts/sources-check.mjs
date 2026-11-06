import assert from "node:assert/strict";
import { fetchFeed } from "../lib/sources.js";

// Offline contract checks: every HTTP response is injected and real fetch is forbidden.
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network access in sources-check"); };
const checks = [];
function check(name, run) { checks.push({ name, run }); }
function response(url, body, contentType = "application/json") {
  return { url, status: 200, notModified: false, text: typeof body === "string" ? body : JSON.stringify(body), contentType };
}
function injected(handler) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      return handler(new URL(url), options);
    },
  };
}
const matrixRoute = "https://rsshub.app/sspai/matrix";
const readhubRoute = "https://rsshub.app/readhub/daily";
const telegramRoute = "https://rsshub.app/telegram/channel/bbczhongwen_rss";
const epochSeconds = 1704164645;
const historicalDate = "2024-01-02T03:04:05.000Z";

check("Matrix requests only its official Matrix list and preserves article identity/date", async () => {
  const http = injected((url) => {
    assert.equal(url.origin, "https://sspai.com");
    assert.equal(url.pathname, "/api/v1/articles");
    assert.equal(url.searchParams.get("is_matrix"), "1");
    assert.equal(url.searchParams.get("sort"), "matrix_at");
    return response(url.href, { list: [{ id: 118271, title: "设备属于谁？", released_at: epochSeconds,
      summary: "<p>消费者的观察 &amp; 思考</p>", author: { nickname: "作者" } }] });
  });
  const { parsed, warnings } = await fetchFeed(matrixRoute, http);
  assert.equal(http.calls.length, 1, "List must provide enough metadata without fetching article details");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, "设备属于谁？");
  assert.equal(parsed.items[0].url, "https://sspai.com/post/118271");
  assert.equal(parsed.items[0].entryKey, "https://sspai.com/post/118271");
  assert.equal(parsed.items[0].publishedAt, historicalDate);
  assert.equal(parsed.items[0].summary, "消费者的观察 & 思考");
  assert.equal(parsed.items[0].author, "作者");
  assert.deepEqual(warnings, []);
});

check("Matrix omits undated articles with a warning instead of inventing dates", async () => {
  const http = injected((url) => response(url.href, { list: [
    { id: 1, title: "有效文章", released_at: epochSeconds },
    { id: 2, title: "没有日期" },
  ] }));
  const { parsed, warnings } = await fetchFeed(matrixRoute, http);
  assert.deepEqual(parsed.items.map((item) => item.url), ["https://sspai.com/post/1"]);
  assert.ok(warnings.length > 0);
});

check("Readhub matches detail UID and keeps real publishDate despite partial detail failures", async () => {
  const http = injected((url) => {
    assert.equal(url.origin, "https://api.readhub.cn");
    if (url.pathname === "/daily") return response(url.href, { data: { items: [
      { uid: "good", title: "列表标题", summary: "列表摘要" },
      { uid: "offline", title: "详情暂时失败" },
      { uid: "mismatch", title: "详情给了其他主题" },
      { uid: "undated", title: "详情无日期" },
    ] } });
    assert.equal(url.pathname, "/topic/detail");
    const uid = url.searchParams.get("uid");
    if (uid === "offline") throw new Error("fixture HTTP 503");
    if (uid === "mismatch") return response(url.href, { data: { items: [
      { uid: "someone-else", title: "不应混入", publishDate: historicalDate },
    ] } });
    if (uid === "undated") return response(url.href, { data: { items: [{ uid, title: "没有 publishDate" }] } });
    assert.equal(uid, "good");
    return response(url.href, { data: { items: [
      { uid: "decoy", title: "诱饵标题", publishDate: "2024-02-01T00:00:00Z" },
      { uid: "good", title: "正确主题", summary: "官方摘要", publishDate: "2024-01-02T11:04:05+08:00", siteNameDisplay: "原站" },
    ] } });
  });
  const { parsed, warnings } = await fetchFeed(readhubRoute, http);
  assert.equal(http.calls.length, 5, "One daily list and one detail per candidate; no timeline requests");
  assert.equal(parsed.items.length, 1);
  const item = parsed.items[0];
  assert.equal(item.title, "正确主题");
  assert.equal(item.publishedAt, historicalDate);
  assert.equal(item.url, "https://readhub.cn/topic/good");
  assert.equal(item.guid, "readhub-good");
  assert.equal(item.summary, "官方摘要");
  assert.ok(warnings.some((warning) => warning.includes("offline")), "A failed detail must be visible as a warning");
  assert.ok(warnings.some((warning) => warning.includes("mismatch")), "Unmatched UID must not use another topic's date");
  assert.ok(warnings.some((warning) => warning.includes("undated")), "Missing dates must not become today's date");
});

check("Readhub rejects a daily list whose details are all unavailable", async () => {
  const http = injected((url) => {
    if (url.pathname === "/daily") return response(url.href, { data: { items: [{ uid: "lost", title: "失效主题" }] } });
    throw new Error("fixture unavailable");
  });
  await assert.rejects(fetchFeed(readhubRoute, http), /lost|详情|失败/);
});

function message(post, headline, { original = "https://www.bbc.com/zhongwen/articles/example?at_medium=RSS&amp;amp;at_campaign=rss", date = historicalDate, prefix = "BBC Chinese" } = {}) {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${post}">
    <div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text" dir="auto"><b>${prefix}</b><br/>${headline}<br/><a href="${original}">原文链接</a></div>
    <a class="tgme_widget_message_link_preview"><div class="link_preview_title">${headline}</div><div class="link_preview_description"><div>嵌套说明</div></div></a>
    <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/${post}"><time datetime="${date}">03:04</time></a></div></div></div></div>`;
}

check("Telegram parses twenty public messages with dates, decoded original URLs and stable GUIDs", async () => {
  const html = `<html><body><section class="tgme_channel_history">${Array.from({ length: 20 }, (_, index) => message(
    `bbczhongwen_rss/${100 + index}`, `新闻 ${index}`, { prefix: index % 2 ? "BBC" : "BBC Chinese", date: `2024-01-02T03:04:${String(index).padStart(2, "0")}+00:00` },
  )).join("")}</section></body></html>`;
  const http = injected((url) => {
    assert.equal(url.href, "https://t.me/s/bbczhongwen_rss");
    return response(url.href, html, "text/html");
  });
  const { parsed } = await fetchFeed(telegramRoute, http);
  assert.equal(http.calls.length, 1);
  assert.equal(parsed.items.length, 20);
  const item = parsed.items.find((entry) => entry.guid === "https://t.me/bbczhongwen_rss/105");
  assert.ok(item);
  assert.equal(item.title, "新闻 5", "BBC prefix must not replace the article headline");
  assert.equal(item.entryKey, item.guid);
  assert.equal(item.url, "https://www.bbc.com/zhongwen/articles/example?at_medium=RSS&at_campaign=rss");
  assert.equal(item.publishedAt, historicalDate);
  assert.equal(parsed.items[0].title, "新闻 19", "Newest message should sort first");
});

check("Telegram excludes cross-channel messages and never emits non-HTTP article links", async () => {
  const html = [
    message("other_channel/1", "跨频道污染"),
    message("bbczhongwen_rss_extra/2", "相似频道污染"),
    message("bbczhongwen_rss/not-a-number", "非法消息编号"),
    message("bbczhongwen_rss/1", "有效消息", { original: "javascript:alert(1)" }),
    message("bbczhongwen_rss/2", "FTP链接", { original: "ftp://example.com/file" }),
    message("bbczhongwen_rss/3", "HTTP链接", { original: "http://example.com/news?a=1&amp;b=2" }),
    message("bbczhongwen_rss/4", "缺少日期", { date: "" }),
    message("bbczhongwen_rss/1", "重复消息"),
  ].join("");
  const http = injected((url) => response(url.href, html, "text/html"));
  const { parsed, warnings } = await fetchFeed(telegramRoute, http);
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(new Set(parsed.items.map((item) => item.guid)), new Set([
    "https://t.me/bbczhongwen_rss/1", "https://t.me/bbczhongwen_rss/2", "https://t.me/bbczhongwen_rss/3",
  ]));
  assert.equal(parsed.items.find((item) => item.title === "有效消息").url, "https://t.me/bbczhongwen_rss/1");
  assert.equal(parsed.items.find((item) => item.title === "FTP链接").url, "https://t.me/bbczhongwen_rss/2");
  assert.equal(parsed.items.find((item) => item.title === "HTTP链接").url, "http://example.com/news?a=1&b=2");
  assert.ok(parsed.items.every((item) => /^https?:/.test(item.url)));
  assert.ok(warnings.some((warning) => warning.includes("bbczhongwen_rss/4")));
});

check("Baoyu official RSS preserves blog scope and excludes translations or foreign sites", async () => {
  const entries = [
    ["博客", "https://baoyu.io/blog/real-post"],
    ["翻译", "https://baoyu.io/translations/translated-post"],
    ["外站", "https://other.example/blog/foreign-post"],
    ["相似路径", "https://baoyu.io/blogger/not-a-blog-post"],
  ];
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>宝玉的分享</title>${entries.map(([title, url], index) =>
    `<item><guid>item-${index}</guid><title>${title}</title><link>${url}</link><pubDate>Tue, 02 Jan 2024 03:04:05 GMT</pubDate></item>`,
  ).join("")}</channel></rss>`;
  for (const route of ["https://rsshub.app/baoyu/blog", "https://baoyu.io/feed.xml", "https://s.baoyu.io/feed.xml"]) {
    const http = injected((url) => {
      assert.equal(url.href, "https://baoyu.io/feed.xml");
      return response("https://s.baoyu.io/feed.xml", xml, "application/xml");
    });
    const { parsed } = await fetchFeed(route, http);
    assert.deepEqual(parsed.items.map((item) => item.url), ["https://baoyu.io/blog/real-post"]);
    assert.equal(parsed.items[0].publishedAt, historicalDate);
  }
});

check("304 responses bypass body access and parsing on every adapter", async () => {
  for (const route of [matrixRoute, readhubRoute, telegramRoute, "https://rsshub.app/baoyu/blog", "https://example.com/feed.xml"]) {
    const cached = { status: 304, notModified: true, get text() { throw new Error("304 body must never be read"); } };
    const http = injected(() => cached);
    const output = await fetchFeed(route, http);
    assert.equal(output.response, cached);
    assert.equal(output.parsed, undefined);
    assert.equal(http.calls.length, 1);
  }
});

check("An unknown HTTP 200 HTML page is an error, not a successful empty feed", async () => {
  const http = injected((url) => response(url.href, "<!doctype html><html><title>Login required</title><body>No feed</body></html>", "text/html"));
  await assert.rejects(fetchFeed("https://example.com/not-a-feed", http), /RSS|Atom|订阅/);
});

check("Changed official response formats fail explicitly rather than reporting empty success", async () => {
  await assert.rejects(fetchFeed(matrixRoute, injected((url) => response(url.href, { items: [] }))), /Matrix.*list/);
  await assert.rejects(fetchFeed(readhubRoute, injected((url) => response(url.href, { data: { list: [] } }))), /Readhub.*items/);
  await assert.rejects(fetchFeed(telegramRoute, injected((url) => response(url.href, "<html><body>Join Telegram</body></html>", "text/html"))), /Telegram|消息|格式/);
});

let failures = 0;
try {
  for (const { name, run } of checks) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}\n${error.stack ?? error}`); }
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`\nSource adapter checks: ${checks.length - failures}/${checks.length} passed; offline only.`);
if (failures > 0) process.exitCode = 1;
