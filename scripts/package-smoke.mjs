import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = resolve(process.argv[2]);
const { apply } = await import(pathToFileURL(join(packageRoot, 'index.js')));
const workspace = mkdtempSync(join(tmpdir(), 'rss-brief-packed-smoke-'));
const tools = new Map(), skills = new Map(), routes = new Map(), cleanup = [];
const skillsService = { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name); } };
const ctx = {
  get(name) { return name === 'skills' ? skillsService : undefined; },
  skills: skillsService,
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  effect(effect, label) { if (label?.includes('tick')) return; const dispose = effect(); if (typeof dispose === 'function') cleanup.push(dispose); },
  on() { return () => {}; },
};
try {
  apply(ctx, { dataDir: join(workspace, 'data'), articleWorkspace: workspace, analysisEnabled: false });
  const status = await tools.get('rss_brief_status').execute({});
  assert.equal(status.ok, true);
  assert.equal(status.feeds.enabled, 0);
  assert.ok(existsSync(status.opmlPath));
  assert.ok(routes.has('/plugin/rss-brief/latest'));
  for (const name of ['create-blog-post-from-url', 'azure-image-gen', 'wechat-draft']) {
    const skill = skills.get(name);
    assert.ok(skill, `Missing bundled skill: ${name}`);
    assert.ok(resolve(skill.resourceBase.path).startsWith(packageRoot));
    assert.ok(existsSync(join(skill.resourceBase.path, 'SKILL.md')));
  }
  const added = await tools.get('rss_brief_subscriptions').execute({ action: 'list' });
  assert.equal(added.ok, true);
  const { createTaskRunner } = await import(pathToFileURL(join(packageRoot, 'skills/create-blog-post-from-url/scripts/rss-task.mjs')));
  let bridgeCalls = 0;
  for (const mode of ['rss-article', 'rss-share']) {
    const id = `packed-${mode}`;
    const input = join(workspace, `${id}.json`);
    writeFileSync(input, JSON.stringify({ version: 1, mode, task_id: id, source_url: 'https://example.invalid/article' }));
    const runner = createTaskRunner({ workspace, mode, environment: {}, runBridge() { bridgeCalls++; throw new Error('BRIDGE_FORBIDDEN'); } });
    const initialized = await runner.init(input);
    assert.equal(initialized.task_id, id);
    const checked = await runner.publish(id, process.execPath);
    assert.equal(checked.error.code, 'VALIDATION_FAILED');
    assert.equal(checked.media_id, null);
  }
  assert.equal(bridgeCalls, 0);
  console.log('Clean package install passed: Host, routes, empty subscriptions, bundled skills and both packaged task validators.');
} finally {
  for (const dispose of cleanup.reverse()) dispose();
  assert.ok(workspace.startsWith(join(tmpdir(), 'rss-brief-packed-smoke-')));
  rmSync(workspace, { recursive: true, force: true });
}
