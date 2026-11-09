/** Offline behavioral checks of the real publication component and request helper.
 * No server, network, model, image generation, or publishing is used.
 * Run: node scripts/publication-client-check.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
function functionSource(name, async = false) {
  const start = source.indexOf(`    ${async ? "async " : ""}function ${name}(`);
  const end = source.indexOf("\n    }", start) + 6;
  assert.ok(start >= 0 && end > start, `real ${name} function is available`);
  return source.slice(start, end).trim();
}
const dictionaries = {};
for (const language of ["zh", "en"]) {
  const identifier = language.toUpperCase();
  const start = source.indexOf(`    const ${identifier} = `) + `    const ${identifier} = `.length;
  const end = source.indexOf("\n    };", start) + 6;
  dictionaries[language] = runInNewContext(`(${source.slice(start, end)})`);
  const locale = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), "utf8"));
  for (const [key, value] of Object.entries(locale)) {
    if (key !== "meta") assert.equal(dictionaries[language][key], value, `${language} locale matches the registered dictionary: ${key}`);
  }
  assert.deepEqual(Object.keys(locale).sort(), Object.keys(JSON.parse(readFileSync(new URL("../locale/zh.json", import.meta.url), "utf8"))).sort());
}
const tr = (key, params = {}) => {
  assert.equal(typeof dictionaries.zh[key], "string", `translation exists: ${key}`);
  return dictionaries.zh[key].replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
};
const task = (id, status = "running", stage = "evidence", extra = {}) => ({
  taskId: `task-${id}`, articleId: id, status, stage,
  model: { provider: "configured-provider", model: "configured-model", source: "custom" },
  sessionId: `session-${id}`, error: null, mediaId: null, articlePath: null,
  coverPath: null, inlineImagePaths: [], updatedAt: "2026-11-04T06:00:00Z", ...extra,
});

function harness(id = 1) {
  const slots = [], effects = [], requests = [], timers = new Map();
  let cursor = 0, dirty = true, mounted = true, props = { id, tr, url: "https://example.test/article" }, tree, nextTimer = 1, writesAfterUnmount = 0;
  const h = (type, attributes, ...children) => ({ type, props: { ...attributes, children: children.flat(Infinity) } });
  const React = {
    Fragment: Symbol("Fragment"), createElement: h,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        if (!mounted) { writesAfterUnmount++; return; }
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
        dirty = true;
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const context = {
    React, h, Icon: () => null, URL, AbortController, Error,
    document: { baseURI: "https://harness.test/workspace/" },
    PUBLICATION_ENDPOINT: "plugin/rss-brief/publication", POLL_RUNNING_MS: 3000,
    setTimeout(callback, delay) { const key = nextTimer++; timers.set(key, { callback, delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    fetch(url, options) {
      // Deliberately ignore aborts: late completion must also be rejected by lifecycle guards.
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  };
  context.requestPublication = runInNewContext(`(${functionSource("requestPublication", true)})`, context);
  const Component = runInNewContext(`(${functionSource("PublicationControl")})`, context);
  const render = () => {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 20, "component settles without a render loop");
      dirty = false; cursor = 0; tree = Component(props);
      while (effects.length) effects.shift()();
    }
    return tree;
  };
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } };
  const walk = (node) => !node || typeof node !== "object" ? [] : [node, ...(node.props?.children ?? []).flatMap(walk)];
  const text = (node = tree) => typeof node === "string" ? node : typeof node === "number" ? String(node) : (node?.props?.children ?? []).map((child) => child == null ? "" : text(child)).join(" ");
  const buttons = () => walk(render()).filter((node) => node.type === "button");
  const primary = () => buttons().find((node) => node.props.className.includes("rsb-publicationButton"));
  const queryRetry = () => buttons().find((node) => text(node).includes(tr("publication.queryRetry")));
  const respond = async (index, body, status = 200) => {
    assert.ok(requests[index], `request ${index} exists`);
    requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
    await settle();
  };
  render();
  return {
    requests, timers, render, settle, text, primary, queryRetry, respond,
    nodes: () => walk(render()),
    async reject(index, message = "Offline connection interrupted") { requests[index].reject(new Error(message)); await settle(); },
    tick() {
      assert.equal(timers.size, 1, "exactly one poll is scheduled");
      const [key, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 3000, "running task polls every three seconds");
      timers.delete(key); timer.callback(); render();
    },
    change(id) { props = { ...props, id }; dirty = true; render(); },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
}
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("queries on open, starts only on click, blocks double starts, polls stages and retains state on errors", async () => {
  const ui = harness();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.primary().props.disabled, true);
  assert.equal(ui.requests[0].options.method, "GET");
  assert.equal(new URL(ui.requests[0].url).searchParams.get("id"), "1");
  assert.equal(ui.requests[0].options.credentials, "same-origin");
  assert.equal(ui.requests[0].options.body, undefined);
  await ui.respond(0, { ok: true, task: null });
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.primary().props.disabled, false);
  const start = ui.primary().props.onClick;
  start(); start(); ui.render();
  assert.equal(ui.requests.length, 2, "synchronous click guard prevents duplicate POSTs");
  assert.equal(ui.requests[1].options.method, "POST");
  assert.equal(ui.requests[1].options.credentials, "same-origin");
  assert.equal(ui.requests[1].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), { id: 1 }, "model is resolved by the backend from settings");
  await ui.respond(1, { ok: true, task: task(1) });
  assert.ok(ui.text().includes(tr("publication.stage.evidence")));
  assert.ok(ui.text().includes("configured-provider/configured-model"));
  assert.ok(ui.text().includes("session-1"));
  assert.equal(ui.primary().props.disabled, true);
  ui.tick();
  await ui.respond(2, { ok: true, task: task(1, "running", "writing") });
  ui.tick();
  await ui.respond(3, { ok: false, code: "UNAVAILABLE", message: "Try again later" }, 503);
  assert.ok(ui.text().includes("UNAVAILABLE: Try again later"));
  assert.ok(ui.text().includes(tr("publication.stage.writing")), "failed query retains the known stage");
  assert.equal(ui.primary().props.disabled, true);
  ui.queryRetry().props.onClick(); ui.render();
  assert.equal(ui.timers.size, 0, "manual query cancels scheduled poll");
  await ui.respond(4, { ok: true, task: task(1, "succeeded", "wechat_draft", { mediaId: "final-media-id", articlePath: "D:\\generated\\article.md" }) });
  assert.ok(ui.text().includes(tr("publication.succeeded")));
  assert.ok(ui.text().includes("final-media-id"));
  assert.ok(ui.text().includes("D:\\generated\\article.md"));
  assert.equal(ui.timers.size, 0, "completion stops polling");
  assert.equal(ui.primary().props.disabled, true);
  ui.primary().props.onClick();
  assert.equal(ui.requests.length, 5, "even a forced disabled handler cannot restart success");
  assert.equal(ui.nodes().filter((node) => node.type === "a").length, 1, "no invented session or file navigation");
  ui.unmount();
});

await check("reopening restores success and needs_attention without POST or polling", async () => {
  for (const status of ["succeeded", "needs_attention"]) {
    const ui = harness(2);
    await ui.respond(0, { ok: true, task: task(2, status, "wechat_draft", { error: status === "needs_attention" ? "Verify the draft save result" : null }) });
    assert.equal(ui.primary().props.disabled, true);
    assert.equal(ui.timers.size, 0);
    ui.primary().props.onClick();
    assert.equal(ui.requests.length, 1);
    if (status === "needs_attention") assert.ok(ui.text().includes(tr("publication.attentionHint")));
    ui.unmount();
  }
});

await check("failed tasks allow explicit retry, POST failure requires query before retrying again", async () => {
  const ui = harness(3);
  await ui.respond(0, { ok: true, task: task(3, "failed", "images", { error: { message: "Image step failed" } }) });
  assert.ok(ui.text().includes("Image step failed"));
  assert.ok(ui.text(ui.primary()).includes(tr("publication.retry")));
  assert.equal(ui.primary().props.disabled, false);
  assert.equal(ui.timers.size, 0);
  ui.primary().props.onClick(); ui.render();
  await ui.respond(1, { ok: false, code: "MODEL_UNAVAILABLE", message: "No model available" }, 400);
  assert.equal(ui.primary().props.disabled, true);
  assert.ok(ui.text().includes(tr("publication.uncertain")));
  assert.ok(ui.text().includes("Image step failed"));
  ui.queryRetry().props.onClick(); ui.render();
  await ui.respond(2, { ok: true, task: task(3, "failed", "images") });
  assert.equal(ui.primary().props.disabled, false);
  ui.primary().props.onClick(); ui.render();
  assert.deepEqual(JSON.parse(ui.requests[3].options.body), { id: 3 });
  await ui.respond(3, { ok: true, task: task(3, "running", "images") });
  assert.equal(ui.primary().props.disabled, true);
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

await check("lost POST response cannot create again until a GET confirms its result", async () => {
  const ui = harness(4);
  await ui.respond(0, { ok: true, task: null });
  ui.primary().props.onClick(); ui.render();
  await ui.reject(1);
  assert.equal(ui.primary().props.disabled, true);
  assert.ok(ui.text().includes(tr("publication.uncertain")));
  assert.equal(ui.timers.size, 0);
  ui.primary().props.onClick();
  assert.equal(ui.requests.length, 2);
  ui.queryRetry().props.onClick(); ui.render();
  assert.equal(ui.requests[2].options.method, "GET");
  await ui.respond(2, { ok: true, task: task(4, "running", "validation") });
  assert.ok(ui.text().includes(tr("publication.stage.validation")));
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

await check("initial HTTP failure and invalid responses keep start locked and offer query retry", async () => {
  const ui = harness(5);
  await ui.respond(0, { ok: false, code: "NOT_FOUND", message: "Article missing" }, 404);
  assert.ok(ui.text().includes("NOT_FOUND: Article missing"));
  assert.equal(ui.primary().props.disabled, true);
  assert.equal(ui.timers.size, 0);
  ui.queryRetry().props.onClick(); ui.render();
  await ui.respond(1, { ok: true, task: task(999) });
  assert.equal(ui.primary().props.disabled, true);
  assert.ok(ui.text().includes(tr("publication.invalid")));
  ui.queryRetry().props.onClick(); ui.render();
  await ui.respond(2, { ok: true, task: null });
  assert.equal(ui.primary().props.disabled, false);
  ui.unmount();
});

await check("missing task during running query preserves known task and keeps polling", async () => {
  const ui = harness(6);
  await ui.respond(0, { ok: true, task: task(6, "running", "images") });
  ui.tick();
  await ui.respond(1, { ok: true, task: null });
  assert.ok(ui.text().includes(tr("publication.missing")));
  assert.ok(ui.text().includes(tr("publication.stage.images")));
  assert.equal(ui.primary().props.disabled, true);
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

await check("article switches abort pending GETs and reject late responses", async () => {
  const ui = harness(7);
  const old = ui.requests[0];
  ui.change(8);
  assert.equal(old.options.signal.aborted, true);
  assert.equal(new URL(ui.requests[1].url).searchParams.get("id"), "8");
  await ui.respond(1, { ok: true, task: task(8, "succeeded", "wechat_draft", { mediaId: "article-eight" }) });
  await ui.respond(0, { ok: true, task: task(7) });
  assert.ok(ui.text().includes("article-eight"));
  assert.ok(!ui.text().includes("session-7"));
  assert.equal(ui.timers.size, 0);
  ui.unmount();
});

await check("switching during POST or polling aborts fetch and clears timers; close ignores late results", async () => {
  const ui = harness(9);
  await ui.respond(0, { ok: true, task: null });
  ui.primary().props.onClick(); ui.render();
  ui.change(10);
  assert.equal(ui.requests[1].options.signal.aborted, true);
  await ui.respond(1, { ok: true, task: task(9) });
  await ui.respond(2, { ok: true, task: task(10) });
  assert.equal(ui.timers.size, 1);
  ui.change(11);
  assert.equal(ui.timers.size, 0);
  await ui.respond(3, { ok: true, task: task(11) });
  ui.tick();
  const polling = ui.requests[4];
  ui.unmount();
  assert.equal(polling.options.signal.aborted, true);
  assert.equal(ui.timers.size, 0);
  await ui.respond(4, { ok: true, task: task(11, "succeeded", "wechat_draft") });
  assert.equal(ui.writesAfterUnmount, 0);
  assert.equal(ui.timers.size, 0);
});

await check("queued tasks show their position, stay locked and keep polling until they run", async () => {
  const ui = harness(12);
  await ui.respond(0, { ok: true, task: null });
  ui.primary().props.onClick(); ui.render();
  await ui.respond(1, { ok: true, task: task(12, "queued", "evidence", { sessionId: null, queuePosition: 2 }) });
  assert.ok(ui.text().includes("微信草稿排队中：第 2 位"));
  assert.equal(ui.primary().props.disabled, true, "a queued task cannot be started again");
  ui.tick();
  await ui.respond(2, { ok: true, task: task(12, "running", "writing") });
  assert.ok(ui.text().includes("创建微信草稿：撰写文章"));
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

console.log(`Passed ${checks} offline publication client checks and locale parity checks.`);
