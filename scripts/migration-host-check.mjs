/** Portable installation and local config, with no network or live Harness. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, resolveConfig } from '../index.js';
import { openDatabase, closeDatabase, upsertFeeds, enabledFeeds } from '../lib/db.js';
import { parseOpml } from '../lib/opml.js';
import { skillsRoot } from '../lib/skills.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-migration-host-'));
const oldFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
let checks = 0;
const mounts = [];
function check(name, run) { run(); console.log(`ok ${++checks} - ${name}`); }
function mount(config) {
  const skills = [], disposers = [];
  apply({
    get(name) { return name === 'skills' ? { register(skill) { skills.push(skill); return () => skills.splice(skills.indexOf(skill), 1); } } : undefined; },
    tools: { register() {} }, webServer: { register() {} },
    effect(setup, label) { if (label.endsWith('tick')) return; const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); },
  }, config);
  const mounted = { skills, dispose() { while (disposers.length) disposers.pop()(); } };
  mounts.push(mounted); return mounted;
}
try {
  check('selected data directory supplies portable subscription and workspace defaults', () => {
    const config = resolveConfig({ dataDir: path.join(root, 'defaults') });
    assert.equal(config.dataDir, path.join(root, 'defaults'));
    assert.equal(config.opmlPath, path.join(config.dataDir, 'subscriptions.opml'));
    assert.equal(config.articleWorkspace, path.join(config.dataDir, 'workspace'));
  });
  check('local config is below explicit config and cannot redirect the data directory', () => {
    const dataDir = path.join(root, 'configured'); fs.mkdirSync(dataDir);
    const opmlPath = path.join(root, 'saved.opml'), workspace = path.join(root, 'saved-workspace');
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ opmlPath, articleWorkspace: workspace, fetchIntervalMinutes: 80, dataDir: 'ignored', secret: 'ignored' }));
    const saved = resolveConfig({ dataDir }); assert.equal(saved.opmlPath, opmlPath); assert.equal(saved.articleWorkspace, workspace); assert.equal(saved.fetchIntervalMinutes, 80); assert.equal(saved.secret, undefined); assert.equal(saved.dataDir, dataDir);
    assert.equal(resolveConfig({ dataDir, fetchIntervalMinutes: 30 }).fetchIntervalMinutes, 30);
    const legacy = resolveConfig({ dataDir: path.join(root, 'legacy'), opmlPath }); assert.equal(legacy.articleWorkspace, path.dirname(opmlPath));
    fs.writeFileSync(path.join(dataDir, 'config.json'), '[]'); assert.throws(() => resolveConfig({ dataDir }), /必须是对象/);
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{'); assert.throws(() => resolveConfig({ dataDir }), /无法读取/);
  });
  check('fresh installation creates empty OPML and registers all bundled skills with resource roots', () => {
    const dataDir = path.join(root, 'fresh'), mounted = mount({ dataDir });
    assert.deepEqual(parseOpml(fs.readFileSync(path.join(dataDir, 'subscriptions.opml'), 'utf8')), []);
    assert.ok(fs.statSync(path.join(dataDir, 'workspace')).isDirectory());
    assert.equal(mounted.skills.length, 3);
    for (const skill of mounted.skills) {
      assert.equal(skill.source, 'runtime'); assert.equal(skill.provider, 'rss-brief');
      assert.equal(skill.resourceBase.path, path.join(skillsRoot, skill.name));
      assert.ok(skill.content.length > 100); assert.ok(skill.description.length > 10);
      assert.ok(fs.existsSync(skill.path)); assert.doesNotMatch(skill.resourceBase.path, /\.agents/);
    }
    mounted.dispose(); assert.equal(mounted.skills.length, 0);
  });
  check('missing default OPML preserves enabled subscriptions from an existing database', () => {
    const dataDir = path.join(root, 'existing'); fs.mkdirSync(dataDir);
    const db = openDatabase(path.join(dataDir, 'rss-brief.sqlite'));
    const feeds = [{ title: 'A & B', xmlUrl: 'https://example.invalid/feed?a=1&b=2', htmlUrl: 'https://example.invalid/', group: 'Tech & Science' }];
    upsertFeeds(db, feeds); closeDatabase(db);
    const mounted = mount({ dataDir });
    const file = path.join(dataDir, 'subscriptions.opml'); assert.deepEqual(parseOpml(fs.readFileSync(file, 'utf8')), feeds);
    const bytes = fs.readFileSync(file, 'utf8'); mounted.dispose();
    const reopened = openDatabase(path.join(dataDir, 'rss-brief.sqlite')); assert.equal(enabledFeeds(reopened).length, 1); closeDatabase(reopened);
    mount({ dataDir }).dispose(); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  });
  check('explicit OPML is never created or overwritten and existing local settings remain unchanged', () => {
    const dataDir = path.join(root, 'explicit'); fs.mkdirSync(dataDir);
    const opmlPath = path.join(root, 'personal.opml'); const text = '<opml version="2.0"><body></body></opml>'; fs.writeFileSync(opmlPath, text);
    const settings = JSON.stringify({ opmlPath, articleWorkspace: path.join(root, 'personal-workspace') }); fs.writeFileSync(path.join(dataDir, 'config.json'), settings);
    mount({ dataDir }).dispose(); assert.equal(fs.readFileSync(opmlPath, 'utf8'), text); assert.equal(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'), settings); assert.equal(fs.existsSync(path.join(dataDir, 'subscriptions.opml')), false);
  });
  console.log(`PASS ${checks} portable Host checks; no network, personal files or profile writes.`);
} finally {
  for (const mounted of mounts) mounted.dispose();
  globalThis.fetch = oldFetch;
  // Exact temporary root returned above.
  fs.rmSync(root, { recursive: true, force: true });
}
