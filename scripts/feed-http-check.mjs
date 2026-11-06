/** Local HTTP regressions: retry policy, diagnostics, redirects, deadlines and cancellation. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { fetchText, HttpError } from '../lib/feed.js';
import { fetchFeed } from '../lib/sources.js';
const counts = new Map();
let accept = '';
const timers = new Set();
const xml = '<rss version="2.0"><channel><item><title>Redirected</title><link>article</link></item></channel></rss>';
const server = createServer((req, res) => {
  const count = (counts.get(req.url) ?? 0) + 1;
  counts.set(req.url, count);
  if (req.url === '/flaky' && count === 1) { res.writeHead(503); res.end('temporary'); return; }
  if (req.url === '/interrupted' && count === 1) {
    res.writeHead(200, { 'content-type': 'application/rss+xml', 'content-length': '99999' });
    res.write(xml.slice(0, 30));
    const timer = setTimeout(() => { timers.delete(timer); res.destroy(); }, 10);
    timers.add(timer); return;
  }
  if (req.url === '/bad-gzip' && count === 1) {
    const broken = gzipSync(xml);
    broken[0] = 0; // Invalid gzip header forces a decoder failure, unlike an omitted trailer.
    res.writeHead(200, { 'content-type': 'application/rss+xml', 'content-encoding': 'gzip' });
    res.end(broken); return;
  }
  if (req.url === '/rate') { res.writeHead(429, { 'retry-after': '60' }); res.end('later'); return; }
  if (req.url === '/challenge') { res.writeHead(403, { 'cf-mitigated': 'challenge' }); res.end('<title>Just a moment...</title>'); return; }
  if (req.url === '/rsshub') { res.writeHead(403); res.end('rsshub.app is intended for testing purposes only'); return; }
  if (req.url === '/redirect' || req.url === '/gone') { res.writeHead(302, { location: req.url === '/gone' ? '/missing' : '/new/feed.xml' }); res.end(); return; }
  if (req.url === '/missing') { res.writeHead(404); res.end('not found'); return; }
  if (req.url === '/cached') { assert.equal(req.headers['if-none-match'], 'version-1'); res.writeHead(304, { etag: 'version-1' }); res.end(); return; }
  if (req.url === '/slow') {
    const timer = setTimeout(() => { timers.delete(timer); res.end('late'); }, 500);
    timers.add(timer); return;
  }
  accept = req.headers.accept;
  res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(xml);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const transient = await fetchText(`${base}/flaky`, { retries: 1, retryDelayMs: 0, headers: { accept: 'application/rss+xml' } });
  assert.equal(transient.status, 200); assert.equal(counts.get('/flaky'), 2); assert.equal(accept, 'application/rss+xml');
  for (const path of ['/interrupted', '/bad-gzip']) {
    const recoveredBody = await fetchText(`${base}${path}`, { retries: 1, retryDelayMs: 0 });
    assert.equal(recoveredBody.text, xml);
    assert.equal(counts.get(path), 2, 'an interrupted response or decoder failure is fetched again');
  }
  await assert.rejects(fetchText(`${base}/challenge`, { retries: 2, retryDelayMs: 0 }), e => e instanceof HttpError && /Cloudflare/.test(e.message));
  assert.equal(counts.get('/challenge'), 1, 'access restrictions are never retried');
  await assert.rejects(fetchText(`${base}/rsshub`), /RSSHub 公共演示实例/);
  await assert.rejects(fetchText(`${base}/rate`, { retries: 2, retryDelayMs: 0 }), e => e.status === 429 && e.retryAfterMs === 60000);
  assert.equal(counts.get('/rate'), 1, 'a long Retry-After is respected, not capped into an early retry');
  await assert.rejects(fetchText(`${base}/gone`, { retries: 1, retryDelayMs: 0 }), e => e.status === 404 && e.finalUrl === `${base}/missing` && /最终地址/.test(e.message));
  assert.equal(counts.get('/gone'), 1);
  const redirected = await fetchFeed(`${base}/redirect`);
  assert.equal(redirected.parsed.items[0].url, `${base}/new/article`, 'relative article links resolve against the final feed URL');
  const atLimit = await fetchText(`${base}/exact-limit`, { maxBytes: Buffer.byteLength(xml) });
  assert.equal(atLimit.text, xml, 'a complete response exactly at the limit remains valid');
  await assert.rejects(fetchFeed(`${base}/over-limit`, { maxBytes: Buffer.byteLength(xml) - 1, retries: 1, retryDelayMs: 0 }), /大小上限/);
  assert.equal(counts.get('/over-limit'), 1, 'oversize content is never retried or returned as a cacheable partial feed');
  const cached = await fetchFeed(`${base}/cached`, { headers: { 'if-none-match': 'version-1' } });
  assert.equal(cached.response.notModified, true); assert.equal(cached.parsed, undefined);
  await assert.rejects(fetchText(`${base}/slow`, { timeoutMs: 30, retries: 1, retryDelayMs: 0 }), e => e.name === 'TimeoutError');
  assert.equal(counts.get('/slow'), 2, 'timeouts have one bounded retry');
  const controller = new AbortController();
  controller.abort(new Error('plugin disposed'));
  await assert.rejects(fetchText(`${base}/slow`, { signal: controller.signal, retries: 2 }), /plugin disposed/);
  assert.equal(counts.get('/slow'), 2, 'plugin disposal never starts another request');
  console.log('HTTP checks passed: retry, no-retry, Retry-After, restrictions, redirect base, 304, timeout, cancellation');
} finally {
  for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
