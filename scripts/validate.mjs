import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() && !['__pycache__', 'node_modules'].includes(entry.name) ? files(path) : entry.isFile() ? [path] : [];
  });
}
if (mode === '--python') {
  for (const skill of ['create-blog-post-from-url', 'azure-image-gen', 'wechat-draft']) {
    run(process.env.PYTHON ?? 'python', ['-m', 'unittest', 'discover', '-s', `skills/${skill}/scripts`, '-p', 'test_*.py']);
  }
} else if (mode === '--test') {
  for (const name of readdirSync(join(root, 'scripts')).filter(name => name.endsWith('.mjs') && (name.includes('-check') || name.includes('-smoke') || name === 'check.mjs')).sort()) {
    if (['package-check.mjs', 'package-smoke.mjs'].includes(name)) continue;
    run(process.execPath, [`scripts/${name}`]);
  }
  const tests = files(join(root, 'skills')).filter(path => /[\\/]test-[^\\/]+\.mjs$/.test(path));
  run(process.execPath, ['--test', ...tests]);
} else {
  for (const path of [join(root, 'index.js'), join(root, 'client.js'), ...files(join(root, 'lib')), ...files(join(root, 'scripts')), ...files(join(root, 'skills'))].filter(path => /\.(mjs|js)$/.test(path))) {
    run(process.execPath, ['--check', path]);
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if (manifest.version !== lock.version || manifest.version !== lock.packages[''].version) throw new Error('package-lock version differs from manifest');
  if (readFileSync(join(root, 'cordis.patch.yml'), 'utf8').includes('D:\\')) throw new Error('Bundle patch contains a local path');
  console.log(`Syntax and manifest checks passed (${manifest.version}).`);
}
