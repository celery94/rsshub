import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} failed (${result.status})`);
}
export function npm(args, cwd = root) {
  const cli = process.env.npm_execpath ?? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
  if (!cli) throw new Error('Run this command through npm run.');
  run(process.execPath, [cli, ...args], cwd);
}
function archiveFiles(archive) {
  const data = gunzipSync(readFileSync(archive));
  const files = new Map();
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    const size = parseInt(field(124, 136).trim(), 8) || 0;
    const type = field(156, 157);
    if (type === '0' || type === '') files.set(name, data.subarray(offset + 512, offset + 512 + size));
    else assert.ok(['5', 'x', 'g'].includes(type), `Unsupported archive entry: ${name} (${type})`);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
export function verifyArchive(archive) {
  const files = archiveFiles(archive);
  for (const name of files.keys()) {
    assert.ok(name.startsWith('package/') && !name.split('/').includes('..'), `Invalid packed path: ${name}`);
    assert.ok(!/(^|\/)(\.env(?:\.[^/]*)?|node_modules|output|\.cache|__pycache__|\.agents|\.git)(\/|$)|\.(sqlite(?:-wal|-shm)?|pyc|bak)$|\/test[_-]/.test(name), `Private or development file packed: ${name}`);
    assert.ok(!/^package\/(folo\.opml|订阅分类目录\.md|config\.json)$/.test(name), `Personal configuration packed: ${name}`);
    assert.ok(/^package\/(package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|requirements\.txt|index\.js|client\.js|icon\.svg|cordis\.patch\.yml|lib\/.+\.js|locale\/[^/]+\.json|docs\/[^/]+\.md|examples\/[^/]+|skills\/.+)$/.test(name), `Unexpected packed file: ${name}`);
  }
  for (const name of ['index.js', 'client.js', 'lib/publication.js', 'cordis.patch.yml', 'locale/zh.json', 'icon.svg', 'requirements.txt', 'skills/create-blog-post-from-url/references/rss-article-workflow.md', 'skills/create-blog-post-from-url/references/rss-share-workflow.md', 'skills/create-blog-post-from-url/references/source-and-writing.md', 'skills/create-blog-post-from-url/references/chinese-style-and-deai.md', 'skills/create-blog-post-from-url/references/cover-prompt-template.md', 'skills/create-blog-post-from-url/references/hd-2d-style.md', 'skills/create-blog-post-from-url/scripts/validate-article.mjs', 'skills/create-blog-post-from-url/scripts/validate-share.mjs', 'skills/create-blog-post-from-url/scripts/check-references.py', 'skills/create-blog-post-from-url/scripts/share_images.py', 'skills/create-blog-post-from-url/scripts/share_editorial.py', 'skills/wechat-draft/scripts/style_manager.py', 'skills/wechat-draft/scripts/design_manager.py', ...['code', 'essay', 'guide'].map(name => `skills/wechat-draft/scripts/styles/${name}.css`), ...['apple', 'linear', 'mintlify', 'notion', 'pinterest', 'spotify'].map(name => `skills/wechat-draft/design/${name}.md`), 'skills/create-blog-post-from-url/scripts/rss-task.mjs', 'skills/create-blog-post-from-url/scripts/publish-rss-draft.py', 'skills/wechat-draft/scripts/publish_draft.py', 'skills/wechat-draft/scripts/styles/base.css', 'skills/azure-image-gen/scripts/azure_generate_image.py', ...['create-blog-post-from-url', 'azure-image-gen', 'wechat-draft'].map(name => `skills/${name}/SKILL.md`)]) {
    assert.ok(files.has(`package/${name}`), `Missing runtime file: ${name}`);
  }
  const patch = files.get('package/cordis.patch.yml').toString('utf8');
  assert.ok(!/[A-Z]:\\|\/Users\/|\/home\//.test(patch), 'Bundle patch contains a machine path');
  console.log(`Package allowlist passed: ${files.size} files.`);
  return files;
}
export function packAndCheck(destination) {
  mkdirSync(destination, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
  npm(['pack', '--ignore-scripts', '--pack-destination', destination]);
  const archive = join(destination, filename);
  assert.ok(existsSync(archive), 'npm pack did not produce the expected archive');
  verifyArchive(archive);
  const installDir = mkdtempSync(join(tmpdir(), 'rss-brief-package-install-'));
  try {
    writeFileSync(join(installDir, 'package.json'), '{"private":true,"type":"module"}\n');
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], installDir);
    run(process.execPath, [join(root, 'scripts/package-smoke.mjs'), join(installDir, 'node_modules', ...manifest.name.split('/'))], installDir);
  } finally {
    assert.ok(installDir.startsWith(join(tmpdir(), 'rss-brief-package-install-')));
    rmSync(installDir, { recursive: true, force: true });
  }
  return archive;
}
