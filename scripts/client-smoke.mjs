/** Client registration and latest-only panel contract smoke test. */
import assert from "node:assert/strict";

let hooks = [];
let cursor = 0;
let effects = [];
const fakeReact = {
  Fragment: Symbol("Fragment"),
  createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
    const state = hooks;
    return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
  useRef(initial) {
    const index = cursor++;
    return hooks[index] ??= { current: initial };
  },
  useLayoutEffect(callback, dependencies) { return this.useEffect(callback, dependencies); },
  useEffect(callback, dependencies) {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      effects.push(() => {
        previous?.cleanup?.();
        hooks[index] = { dependencies, cleanup: callback() };
      });
    }
  },
  useCallback(callback, dependencies) {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      hooks[index] = { callback, dependencies };
    }
    return hooks[index].callback;
  },
};

globalThis.window = {
  localStorage: { getItem: () => null, setItem() {} },
  addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); },
  __ModuleLoader__: { load(definition) { globalThis.__rssClientDefinition = definition; } },
};
globalThis.document = {
  baseURI: "http://localhost/", activeElement: null,
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} },
};

await import(`../client.js?client-smoke=${Date.now()}`);
const definition = globalThis.__rssClientDefinition;
assert.equal(definition?.id, "@local/dsh-rss-brief");
const plugin = definition.factory((name) => {
  assert.equal(name, "react", `Unexpected client dependency: ${name}`);
  return fakeReact;
});
assert.ok(plugin.inject.includes("slots"));
assert.ok(plugin.inject.includes("locale"));
let Panel;
let dictionaries;
plugin.apply({
  effect(callback) { callback(); },
  locale: { register(_namespace, values) { dictionaries = values; }, bind: () => (key) => dictionaries.en[key] ?? key },
  slots: {
    inject(_slot, callback) { callback(); },
    register(options, component) { if (options.name === "main") Panel = component; },
  },
});
assert.equal(typeof Panel, "function");
assert.equal(dictionaries.en["view.daily"], undefined);
assert.equal(dictionaries.zh["action.report"], undefined);

const requests = [];
const timers = new Set();
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback) => { timers.add(callback); return callback; };
globalThis.clearTimeout = (callback) => timers.delete(callback);
globalThis.fetch = async (url) => {
  requests.push(new URL(url));
  return { ok: true, json: async () => ({
    ok: true, view: "latest",
    report: { groups: [{ id: "engineering", label: "Engineering", items: [{ id: 1, title: "Latest article", read: false }] }] },
    latest: { categories: [{ key: "engineering", label: "Engineering", count: 1 }], total: 1, unread: 1 },
    pagination: { snapshot: 42, total: 1, hasMore: true, nextOffset: 100 },
    schedule: { nextSyncAt: "2026-11-05T00:00:00Z", nextReportAt: "obsolete daily schedule" },
  }) };
};
async function render() {
  cursor = 0;
  effects = [];
  const tree = Panel({ t: (key) => dictionaries.en[key] ?? key });
  for (const effect of effects) effect();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return tree;
}
const componentStates = [];
async function renderComponent(Component, props, state) {
  const pageHooks = hooks;
  hooks = state;
  cursor = 0;
  effects = [];
  try {
    const tree = Component(props);
    for (const effect of effects) effect();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    return tree;
  } finally {
    hooks = pageHooks;
  }
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return tree && typeof tree === "object" ? text(tree.children) : String(tree ?? "");
}
try {
  await render();
  let tree = await render();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/plugin/rss-brief/latest");
  assert.equal(requests[0].searchParams.get("offset"), "0");
  assert.equal(requests[0].searchParams.get("unread"), "1", "Initial list fetch defaults to unread articles");
  assert.equal(nodes(tree).find((node) => node.props["aria-label"] === "Unread only").props["aria-checked"], "true");
  assert.ok(nodes(tree).some((node) => node.props.article?.title === "Latest article"), "Consumes report.groups compatibility payload");
  assert.ok(!text(tree).includes("obsolete daily schedule"));
  assert.ok(!text(tree).includes("Daily briefs"));
  assert.ok(!nodes(tree).some((node) => node.props.className === "rsb-details" || node.props.className === "rsb-segmented"));
  const more = nodes(tree).find((node) => node.type === "button" && text(node).includes("Load more"));
  assert.ok(more, "Latest pagination remains available");
  more.props.onClick();
  await render();
  assert.equal(requests.at(-1).searchParams.get("offset"), "100");
  assert.equal(requests.at(-1).searchParams.get("snapshot"), "42");
  assert.equal(requests.at(-1).searchParams.get("unread"), "1", "Pagination retains the unread filter");
  tree = await render();
  const search = nodes(tree).find((node) => node.type === "input" && node.props.type === "search");
  search.props.onChange({ target: { value: "article" } });
  await render();
  assert.equal(requests.at(-1).searchParams.get("q"), "article");
  assert.equal(requests.at(-1).searchParams.get("unread"), "1", "Search retains the unread filter");
  assert.equal(requests.at(-1).searchParams.get("offset"), "0");
  assert.equal(requests.at(-1).searchParams.has("snapshot"), false);
  assert.ok(requests.every((url) => url.pathname === "/plugin/rss-brief/latest"), "Panel only loads /latest");

  const latestFetch = globalThis.fetch;
  const scheduleRequests = [];
  const modelRequest = deferred();
  let scheduleGetFailure = true;
  let schedulePost = null;
  const schedule = {
    ok: true, fetchIntervalMinutes: 120, defaultFetchIntervalMinutes: 60,
    timeZone: "Asia/Shanghai", nextSyncAt: "2026-11-05T00:00:00Z", lastFetchAt: null,
  };
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/plugin/rss-brief/settings") return modelRequest.promise;
    if (path === "/plugin/rss-brief/schedule") {
      scheduleRequests.push({ url: new URL(url), ...options });
      if (options.method === "POST") return schedulePost.promise;
      return scheduleGetFailure ? response({ ok: false, message: "schedule offline" }, 503) : response(schedule);
    }
    return latestFetch(url, options);
  };
  tree = await render();
  nodes(tree).find((node) => node.props["aria-label"] === "Settings").props.onClick();
  tree = await render();
  const settingsNode = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "ModelSettings");
  assert.ok(settingsNode, "The existing gear opens reading settings");
  const settingsState = [];
  const fetchState = [];
  componentStates.push(settingsState, fetchState);
  let dialog = await renderComponent(settingsNode.type, settingsNode.props, settingsState);
  assert.ok(text(dialog).includes("Loading available models"));
  const fetchNode = nodes(dialog).find((node) => typeof node.type === "function" && node.type.name === "FetchSettings");
  assert.ok(fetchNode, "Fetch preferences render while the model request remains pending");
  let fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.ok(text(fetchTree).includes("Loading fetch settings"));
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.ok(text(fetchTree).includes("schedule offline"));
  scheduleGetFailure = false;
  nodes(fetchTree).find((node) => node.type === "button" && text(node) === "Retry").props.onClick();
  await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  const input = () => nodes(fetchTree).find((node) => node.props.id === "rsb-fetch-minutes");
  const save = () => nodes(fetchTree).find((node) => node.type === "button" && node.props.type === "submit");
  const submit = () => fetchTree.props.onSubmit({ preventDefault() {} });
  assert.equal(input().props.value, "120", "Uses the effective GET interval");
  assert.equal(input().props.type, "number");
  assert.equal(input().props.min, 5);
  assert.equal(input().props.max, 10080);
  assert.equal(input().props.step, 1);
  assert.ok(text(fetchTree).includes("1 hour (60 minutes)"));
  assert.equal(save().props.disabled, true, "Does not save an unchanged interval");
  assert.deepEqual(scheduleRequests.map((request) => request.method ?? "GET"), ["GET", "GET"]);

  modelRequest.resolve(response({ ok: false, message: "catalog offline" }, 503));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  dialog = await renderComponent(settingsNode.type, settingsNode.props, settingsState);
  assert.ok(text(dialog).includes("catalog offline"));
  assert.ok(nodes(dialog).some((node) => node.type === fetchNode.type), "Catalog failure retains fetch preferences");
  for (const invalid of ["", "4", "10081", "5.5", "abc"]) {
    input().props.onChange({ target: { value: invalid } });
    fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
    assert.equal(save().props.disabled, true, `Rejects invalid interval ${JSON.stringify(invalid)}`);
    const count = scheduleRequests.length;
    await submit();
    assert.equal(scheduleRequests.length, count, "Invalid submit never reaches the endpoint");
    assert.ok(text(fetchTree).includes("whole number"));
  }
  input().props.onChange({ target: { value: "5" } });
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.equal(save().props.disabled, false, "Accepts the lower boundary");
  schedulePost = deferred();
  const failedSave = submit();
  await submit();
  assert.equal(scheduleRequests.filter((request) => request.method === "POST").length, 1, "Guards duplicate submits before rendering");
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.equal(input().props.disabled, true);
  assert.ok(text(save()).includes("Saving"));
  const beforeFailure = requests.length;
  schedulePost.resolve(response({ ok: false, message: "cannot persist" }, 500));
  await failedSave;
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.ok(text(fetchTree).includes("cannot persist"));
  assert.equal(input().props.value, "5", "Retains the user's input after save failure");
  assert.equal(requests.length, beforeFailure, "Failed save does not reload the parent");

  input().props.onChange({ target: { value: "10080" } });
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.equal(save().props.disabled, false, "Accepts the upper boundary");
  schedulePost = deferred();
  const successfulSave = submit();
  const posted = scheduleRequests.at(-1);
  assert.equal(posted.method, "POST");
  assert.equal(posted.headers["content-type"], "application/json");
  assert.equal(posted.credentials, "same-origin");
  assert.deepEqual(JSON.parse(posted.body), { fetchIntervalMinutes: 10080 });
  schedulePost.resolve(response({ ...schedule, fetchIntervalMinutes: 10080 }));
  await successfulSave;
  fetchTree = await renderComponent(fetchNode.type, fetchNode.props, fetchState);
  assert.ok(text(fetchTree).includes("saved and effective immediately"));
  assert.equal(save().props.disabled, true);
  const beforeReload = requests.length;
  tree = await render();
  assert.equal(requests.length, beforeReload + 1, "Successful save reloads the parent /latest data");
  assert.equal(requests.at(-1).searchParams.get("q"), "article", "Reload preserves search");
  assert.equal(requests.at(-1).searchParams.get("unread"), "1", "Reload preserves the unread filter");
  assert.ok(nodes(tree).some((node) => node.type === settingsNode.type), "Successful save keeps settings open");

  const pinnedState = [];
  componentStates.push(pinnedState);
  globalThis.fetch = async () => response({
    ok: true, pinned: { provider: "fixed", model: "fixed-model" }, saved: null,
    providers: [{ id: "fixed", name: "Fixed", models: [{ id: "fixed-model", name: "Fixed model" }] }],
  });
  await renderComponent(settingsNode.type, settingsNode.props, pinnedState);
  dialog = await renderComponent(settingsNode.type, settingsNode.props, pinnedState);
  assert.ok(text(dialog).includes("pinned by the plugin configuration"));
  assert.ok(nodes(dialog).some((node) => node.type === fetchNode.type), "Pinned models retain independent fetch settings");
  for (const language of ["zh", "en"]) {
    assert.ok(dictionaries[language]["schedule.title"]);
    assert.ok(dictionaries[language]["schedule.invalid"]);
  }
} finally {
  for (const state of [hooks, ...componentStates]) for (const hook of state) hook?.cleanup?.();
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log("client smoke passed");
