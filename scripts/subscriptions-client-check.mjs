/** Offline checks for the real subscription editor; no listeners, files or network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const exported = source.replace('    return {\n      inject:', '    return {\n      SubscriptionSettings, ModelSettings, RssBriefPage, ZH, EN,\n      inject:');
assert.notEqual(exported, source);
const alpha = { title: 'Alpha', xmlUrl: 'https://example.test/alpha.xml', htmlUrl: 'https://example.test/', group: 'Engineering' };
const zero = { title: 'Zero articles', xmlUrl: 'https://other.test/feed.xml', htmlUrl: '', group: 'Other' };
const snapshot = (revision = 'r1', feeds = [alpha, zero]) => ({ ok: true, revision, feeds, categories: [...new Set(feeds.map(f => f.group))] });
function harness(component = 'SubscriptionSettings') {
  const slots = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, dirty = true, tree, plugin, mounted = true, saved = 0, closed = 0;
  const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } });
  const effect = (run, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v,n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = run(); }); } };
  const React = {
    createElement: h, Fragment: Symbol('Fragment'), useEffect: effect, useLayoutEffect: effect,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { assert.ok(mounted, 'no writes after unmount'); slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(value, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v,n) => v !== old.deps[n])) slots[i] = { value, deps }; return slots[i].value; },
  };
  const context = { URL, AbortController, console,
    document: { baseURI: 'https://offline.test/', activeElement: null, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
    window: { __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } }, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(fn) { fn(); } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    setTimeout() { return 1; }, clearTimeout() {},
  };
  runInNewContext(exported, context);
  const tr = (key, args = {}) => { assert.equal(typeof plugin.ZH[key], 'string', key); assert.equal(typeof plugin.EN[key], 'string', key); return plugin.ZH[key].replace(/\{(\w+)\}/g, (m,n) => args[n] ?? m); };
  const props = { tr, onClose: () => closed++, onSaved: () => saved++, onManageSubscriptions() {} };
  const render = () => { let n = 0; while (dirty) { assert.ok(++n < 25); dirty = false; cursor = 0; tree = plugin[component](props); while (effects.length) effects.shift()(); } return tree; };
  const settle = async () => { for (let i=0;i<20;i++) { await Promise.resolve(); render(); } };
  const walk = node => node && typeof node === 'object' ? [node, ...(node.props?.children ?? []).flatMap(walk)] : [];
  const nodes = () => walk(render());
  const text = (node = tree) => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.props?.children ?? []).map(text).join(' ');
  const button = label => { const node = nodes().find(n => n.type === 'button' && (n.props['aria-label'] === label || text(n).trim() === label)); assert.ok(node, `button ${label}`); return node; };
  const click = label => { const node = button(label); assert.notEqual(node.props.disabled, true); node.props.onClick(); render(); };
  const field = id => { const node = nodes().find(n => n.props.id === id); assert.ok(node, id); return node; };
  const change = (key, value) => { field(`rsb-subscription-${key}`).props.onChange({ target: { value } }); render(); };
  const search = value => { nodes().find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value } }); render(); };
  const submit = () => { const form = nodes().find(n => n.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); render(); };
  const respond = async (i, body, status = 200) => { assert.ok(requests[i], `request ${i}`); requests[i].resolve({ ok: status < 400, status, json: async () => body }); await settle(); };
  render();
  return { plugin, nodes, text, button, click, field, change, search, submit, render, settle, respond, requests, get saved() { return saved; }, get closed() { return closed; }, key(key) { listeners.get('keydown')?.({ key, stopPropagation() {}, preventDefault() {} }); render(); }, unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); } };
}
let count = 0;
async function check(label, run) { await run(); console.log(`ok ${++count} - ${label}`); }
await check('loads all subscriptions, searches independently, and provides a settings entry without waiting for models', async () => {
  const ui = harness(); assert.equal(new URL(ui.requests[0].url).pathname, '/plugin/rss-brief/subscriptions');
  await ui.respond(0, snapshot()); assert.match(ui.text(), /Alpha/); assert.match(ui.text(), /Zero articles/);
  ui.search('Other'); assert.doesNotMatch(ui.text(), /Alpha/); assert.match(ui.text(), /Zero articles/);
  ui.search('missing'); assert.match(ui.text(), /没有找到/); assert.equal(ui.requests.length, 1);
  for (const key of Object.keys(ui.plugin.ZH).filter(k => k.startsWith('subscriptions.'))) assert.equal(typeof ui.plugin.EN[key], 'string', key);
  ui.unmount();
  const settings = harness('ModelSettings'); assert.ok(settings.button('管理订阅')); settings.unmount();
  const page = harness('RssBriefPage'); page.click('设置');
  const modal = page.nodes().find(n => n.type?.name === 'ModelSettings'); assert.ok(modal);
  modal.props.onManageSubscriptions(); page.render(); assert.ok(page.nodes().some(n => n.type?.name === 'SubscriptionSettings'));
  assert.equal(page.nodes().some(n => n.type?.name === 'ModelSettings'), false); page.unmount();
});
await check('add validates URLs and duplicates, blocks double submit and uses the current revision', async () => {
  const ui = harness(); await ui.respond(0, snapshot()); ui.click('添加订阅');
  ui.submit(); assert.equal(ui.requests.length, 1); assert.match(ui.text(), /请填写/);
  ui.change('title', ' New '); ui.change('xmlUrl', 'https://'); ui.submit(); assert.equal(ui.requests.length, 1);
  ui.change('xmlUrl', alpha.xmlUrl); ui.submit(); assert.match(ui.text(), /已存在/); assert.equal(ui.requests.length, 1);
  ui.change('xmlUrl', 'javascript:alert(1)'); ui.submit(); assert.equal(ui.requests.length, 1);
  ui.change('xmlUrl', 'https://new.test/feed'); ui.change('htmlUrl', 'https://bad user:secret@new.test'); ui.submit(); assert.equal(ui.requests.length, 1);
  ui.change('htmlUrl', 'https://new.test'); ui.change('group', ' New category ');
  const form = ui.nodes().find(n => n.type === 'form'); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); ui.render();
  assert.equal(ui.requests.length, 2); assert.equal(ui.button('正在保存…').props.disabled, true);
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), { action: 'add', revision: 'r1', feed: { title: 'New', xmlUrl: 'https://new.test/feed', htmlUrl: 'https://new.test/', group: 'New category' } });
  await ui.respond(1, snapshot('r2', [alpha, zero, { title: 'New', xmlUrl: 'https://new.test/feed', htmlUrl: 'https://new.test/', group: 'New category' }]));
  assert.equal(ui.saved, 1); assert.match(ui.text(), /订阅已保存/); assert.equal(ui.nodes().some(n => n.type === 'form'), false); ui.unmount();
});
await check('edit retains the original URL and allows changing address and category', async () => {
  const ui = harness(); await ui.respond(0, snapshot()); ui.click('编辑 Alpha');
  assert.equal(ui.field('rsb-subscription-xmlUrl').props.value, alpha.xmlUrl);
  ui.change('title', 'Renamed'); ui.change('xmlUrl', 'https://example.test/new.xml'); ui.change('group', 'Other'); ui.submit();
  const payload = JSON.parse(ui.requests[1].options.body); assert.equal(payload.action, 'update'); assert.equal(payload.originalUrl, alpha.xmlUrl); assert.equal(payload.feed.group, 'Other');
  await ui.respond(1, snapshot('r2', [{ ...alpha, ...payload.feed }, zero])); assert.match(ui.text(), /Renamed/); assert.equal(ui.saved, 1); ui.unmount();
});
await check('remove requires confirmation, can cancel, and sends only the selected source', async () => {
  const ui = harness(); await ui.respond(0, snapshot()); ui.click('移除订阅 Alpha'); assert.equal(ui.requests.length, 1); assert.match(ui.text(), /已有文章和阅读记录会保留/);
  ui.click('取消'); assert.equal(ui.requests.length, 1); ui.click('移除订阅 Alpha'); ui.click('确认移除');
  assert.deepEqual(JSON.parse(ui.requests[1].options.body), { action: 'delete', revision: 'r1', originalUrl: alpha.xmlUrl });
  await ui.respond(1, snapshot('r2', [zero])); assert.doesNotMatch(ui.text(), /Alpha/); assert.equal(ui.saved, 1); ui.unmount();
});
await check('conflict preserves input, reload obtains a new revision, and failures do not retry writes', async () => {
  const ui = harness(); await ui.respond(0, snapshot()); ui.click('编辑 Alpha'); ui.change('title', 'My draft'); ui.submit();
  await ui.respond(1, { ok: false, message: 'stale' }, 409); assert.match(ui.text(), /当前填写内容已保留/); assert.equal(ui.field('rsb-subscription-title').props.value, 'My draft');
  assert.equal(ui.saved, 0); ui.click('重新加载订阅'); await ui.respond(2, snapshot('r2')); assert.equal(ui.field('rsb-subscription-title').props.value, 'My draft');
  ui.submit(); assert.equal(JSON.parse(ui.requests[3].options.body).revision, 'r2');
  ui.requests[3].reject(new Error('Network unavailable')); await ui.settle(); assert.match(ui.text(), /Network unavailable/); assert.equal(ui.requests.length, 4); assert.equal(ui.saved, 0); ui.unmount();
});
await check('empty state, malformed response, reload failure and unmount cleanup remain usable', async () => {
  const ui = harness(); await ui.respond(0, snapshot('r1', [])); assert.match(ui.text(), /还没有订阅/); ui.click('添加订阅'); assert.equal(ui.field('rsb-subscription-group').props.value, '未分组');
  ui.key('Escape'); assert.equal(ui.closed, 0); ui.key('Escape'); assert.equal(ui.closed, 1); ui.unmount();
  const invalid = harness(); await invalid.respond(0, { ok: true, revision: 'r1', feeds: null }); assert.match(invalid.text(), /无法读取订阅/);
  invalid.click('重新加载订阅'); await invalid.respond(1, { ok: false, message: 'Owner required' }, 403); assert.match(invalid.text(), /Owner required/); invalid.unmount();
  const pending = harness(); const signal = pending.requests[0].options.signal; pending.unmount(); assert.equal(signal.aborted, true); await pending.respond(0, snapshot());
});
console.log(`Passed ${count} offline subscription client checks.`);
