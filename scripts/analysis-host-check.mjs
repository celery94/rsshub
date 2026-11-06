/** Offline integration checks for independent analysis routes and bounded sync. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { openDatabase, closeDatabase, getMeta, setContentSuccess } from '../lib/db.js';
const root = mkdtempSync(join(tmpdir(), 'rss-analysis-host-'));
const opmlPath = join(root, 'feeds.opml');
const dataDir = join(root, 'data');
writeFileSync(opmlPath, '<opml><body><outline text="Engineering"><outline text="Offline" xmlUrl="https://offline.example/feed"/></outline></body></opml>');
const originalFetch = globalThis.fetch;
const calls = [];
let providers = [{ id: 'fake', name: 'Fake' }];
let admission = { peer: { principal: { kind: 'owner' } } };
let forceError = false;
let advertorialId = null;
let onCall = null;
let catalogCalls = 0;
let disk, host;
const dimensions = { information: 23, evidence: 23, depth: 17, utility: 17, clarity: 9 };
const bodyText = 'A complete technical report with experimental results, constraints and practical implementation. '.repeat(25);
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/feed')) return new Response(`<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Offline</title>${[1,2].map(id => `<item><guid>article-${id}</guid><title>Article ${id}</title><link>https://offline.example/article/${id}</link><pubDate>${new Date(Date.now()-60000).toUTCString()}</pubDate><description>Short excerpt ${id}</description><content:encoded><![CDATA[<article><p>${bodyText}</p></article>]]></content:encoded></item>`).join('')}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
  return new Response(`<html><body><article><p>${bodyText}</p></article></body></html>`, { headers: { 'content-type': 'text/html' } });
};
function mount(config = {}) {
  const routes = new Map(), tools = new Map(), disposers = [];
  const llm = {
    listProviders: () => providers,
    async listModels() { catalogCalls++; return ['create','analysis','other'].map(id => ({ id, name: id })); },
    async prepareCall(config) {
      calls.push({ ...config });
      if (onCall) { const callback = onCall; onCall = null; await callback(); }
      if (forceError) { const error = new Error('Quota exhausted'); error.code = 'ACCOUNT_QUOTA'; throw error; }
      return { config, async *stream(options) {
        const payload = JSON.parse(options.messages[0].content[0].text.split('\n')[1]);
        yield { type: 'text-delta', text: JSON.stringify(payload.map(item => item.id === advertorialId
          ? { id: item.id, contentType: 'advertorial', discardReason: '以品牌推广及购买转化为目的，无独立论证。' }
          : { id: item.id, contentType: 'editorial', dimensions, score: 89, category: 'engineering', relevance: 90, summary: '提供实验结果、约束条件及实现步骤。', reason: '包含具体实验和工程细节，值得阅读并核对适用条件。' })) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } };
    },
  };
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
    get(name) {
      if (name === 'connection') return { admit: () => admission };
      if (name === 'llm') return llm;
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'create' }) };
      return null;
    },
    effect(setup, label) { if (label.endsWith('tick')) return; const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); },
  };
  apply(ctx, { dataDir, opmlPath, contentPerSync: 10, aiBatchSize: 1, ...config });
  return { tools, routes, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}
async function request(endpoint = 'analysis-settings', body, method = body === undefined ? 'GET' : 'POST', type = 'application/json') {
  const incoming = new EventEmitter();
  Object.assign(incoming, { method, url: `/plugin/rss-brief/${endpoint}`, headers: { 'content-type': type } });
  const response = { status: 0, text: '', writeHead(status) { this.status = status; }, end(text) { this.text = text || ''; } };
  const pending = host.routes.get(incoming.url.split('?')[0]).handler(incoming, response);
  if (method === 'POST') queueMicrotask(() => { incoming.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); incoming.emit('end'); });
  await pending;
  return { status: response.status, body: response.text ? JSON.parse(response.text) : null };
}
const save = (patch = {}) => request('analysis-settings', { provider: 'fake', model: 'analysis', enabled: true, perSync: 2, ...patch });
const sync = () => host.tools.get('rss_brief_sync').execute({ limit: 1, wait: true });
try {
  host = mount();
  disk = openDatabase(join(dataDir, 'rss-brief.sqlite'));
  let response = await request();
  assert.equal(response.body.effective.model, 'create');
  assert.equal(response.body.effective.source, 'inherited');
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.perSync, 40);
  assert.equal((await save()).status, 200);
  assert.equal(calls.length, 0, 'reading/saving settings must not invoke a model');
  assert.equal((await request('settings')).body.effective.model, 'create');
  assert.equal((await request()).body.effective.model, 'analysis');
  assert.equal(getMeta(disk, 'analysisModel'), 'analysis');
  for (const body of [{}, [], { provider: 'fake', model: '', enabled: true, perSync: 2 }, { provider: '', model: '', enabled: 'yes', perSync: 2 }, { provider: '', model: '', enabled: true, perSync: 201 }, { provider: '', model: '', enabled: true, perSync: 2, extra: true }, '{']) {
    assert.equal((await request('analysis-settings', body)).status, 400);
  }
  assert.equal((await request('analysis-settings', { provider: '', model: '', enabled: true, perSync: 2 }, 'POST', 'text/plain')).status, 415);
  admission = { rejection: 401 };
  assert.equal((await save()).status, 401);
  assert.equal((await request()).status, 401);
  admission = { peer: { principal: { kind: 'owner' } } };
  assert.equal((await save({ model: 'unknown' })).status, 400);
  assert.equal(getMeta(disk, 'analysisModel'), 'analysis');
  onCall = async () => { assert.equal((await save({ model: 'other' })).status, 200); };
  const first = await sync();
  assert.equal(first.completed, true);
  assert.equal(first.result.analysis.succeeded, 2);
  assert.deepEqual(calls.map(call => call.model), ['analysis','analysis'], 'one cycle uses one route snapshot');
  assert.equal((await request()).body.effective.model, 'other');
  const listed = (await request('latest?quality=high')).body;
  assert.equal(listed.pagination.total, 2);
  const article = listed.report.groups[0].items[0];
  assert.equal(article.assessment.score, 89);
  assert.equal(article.assessment.highQuality, true);
  assert.equal(article.assessment.model, 'fake/analysis');
  assert.equal((await request(`article?id=${article.id}&cacheOnly=1`)).body.article.assessment.score, 89);
  await sync();
  assert.equal(calls.length, 2, 'unchanged successful articles are cached across model changes');
  const callsBefore = calls.length;
  setContentSuccess(disk, article.id, { status: 'ok', text: 'Changed content. '.repeat(60), source: 'web', at: new Date().toISOString(), version: 1 });
  assert.equal((await request('latest?quality=high')).body.pagination.total, 1, 'stale score excluded');
  assert.equal((await save({ enabled: false })).status, 200);
  await sync();
  assert.equal(calls.length, callsBefore, 'disabled analysis does no model work');
  await save({ model: 'other' });
  forceError = true;
  const failed = await sync();
  assert.equal(failed.result.analysis.failed, 1);
  assert.equal(failed.result.inserted, 0, 'model failure leaves feed sync completed');
  const old = (await request(`article?id=${article.id}&cacheOnly=1`)).body.article.assessment;
  assert.equal(old.score, 89, 'failed reassessment preserves previous result');
  assert.equal(old.stale, true);
  const afterFailure = calls.length;
  await sync();
  assert.equal(calls.length, afterFailure, 'retry backoff prevents next sync model work');
  providers = [];
  response = await request();
  assert.equal(response.body.effective, null);
  assert.match(response.body.error, /不可用/);
  const noRoute = await sync();
  assert.ok(noRoute.result.analysis.error);
  assert.equal(calls.length, afterFailure, 'unavailable explicit route never falls back');
  providers = [{ id: 'fake', name: 'Fake' }];
  forceError = false;
  await save({ model: 'analysis', enabled: true });
  setContentSuccess(disk, article.id, { status: 'ok', text: 'Buy this sponsored product today. '.repeat(40), source: 'web', at: new Date().toISOString(), version: 1 });
  advertorialId = article.id;
  const discarded = await sync();
  assert.equal(discarded.result.analysis.discarded, 1);
  assert.equal(discarded.result.analysis.succeeded, 0);
  assert.equal((await request(`article?id=${article.id}&cacheOnly=1`)).status, 404);
  assert.equal((await request(`article?id=${article.id}&refresh=1`)).status, 404);
  assert.equal((await request(`publication?id=${article.id}`)).status, 404);
  assert.equal((await request('publication', { id: article.id })).status, 404, 'discarded article cannot create a writing task');
  assert.equal((await request(`latest?q=${encodeURIComponent(article.title)}`)).body.pagination.total, 0);
  const discardedRow = disk.prepare('SELECT discarded_at, discard_reason FROM articles WHERE id = ?').get(article.id);
  assert.ok(discardedRow.discarded_at);
  assert.match(discardedRow.discard_reason, /品牌推广/);
  const afterDiscard = calls.length;
  await sync();
  assert.equal(calls.length, afterDiscard, 'duplicate feed entries never resurrect discarded articles or repeat analysis');
  assert.equal((await request('latest')).body.analysis.counts.discarded, 1);
  await save({ provider: '', model: '', enabled: false });
  assert.equal((await request()).body.effective.model, 'create');
  host.dispose();
  host = mount({ analysisProvider: 'fake', analysisModel: 'analysis' });
  assert.equal((await request()).body.effective.model, 'analysis');
  assert.equal((await save({ model: 'other' })).status, 409);
  assert.equal((await save({ model: 'analysis', enabled: false, perSync: 7 })).status, 200);
  response = await request();
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.perSync, 7);
  assert.equal((await request('settings')).body.effective.model, 'create');
  assert.ok(catalogCalls > 0);
  console.log('PASS: independent models, strict authenticated settings, fixed cycle route, scoring cache, quality filter, disable, failure preservation/backoff, no fallback, pinned controls, persistence.');
} finally {
  host?.dispose();
  if (disk) closeDatabase(disk);
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
