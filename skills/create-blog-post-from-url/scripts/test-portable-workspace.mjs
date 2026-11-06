import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const skills = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.RSS_TEST_PYTHON || process.env.PYTHON || 'python';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-portable-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const packaged = path.join(root, 'installed package', 'skills');
  fs.cpSync(skills, packaged, {recursive:true, filter:file => !file.includes('__pycache__')});
  const workspace = path.join(root, 'article workspace');
  const cwd = path.join(root, 'unrelated cwd');
  fs.mkdirSync(workspace); fs.mkdirSync(cwd);
  const skillRoot = path.join(packaged, 'create-blog-post-from-url');
  const helper = path.join(skillRoot, 'scripts/rss-task.mjs');
  const input = {version:1, mode:'rss-article', task_id:'portable-1', source_url:'https://source.example/article'};
  fs.writeFileSync(path.join(workspace, 'request.json'), JSON.stringify(input));
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [helper, '--workspace', workspace, ...args], {cwd, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  return {root, packaged, workspace, cwd, skillRoot, helper, input, cli};
}

test('installed CLI uses explicit workspace for article/share output and env from another cwd', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workspace, '.env'), 'AZURE_IMAGE_ENDPOINT=https://configured.test/images/generations\nAZURE_API_KEY=offline-key\nWECHAT_APP_ID=offline-app\nWECHAT_APP_SECRET=offline-secret\n');
  const init = f.cli('init', 'request.json');
  assert.equal(init.article_path, 'output/rss-articles/portable-1/article.md');
  assert.equal(f.cli('stage', 'portable-1', 'writing').stage, 'writing');
  assert.equal(f.cli('preflight').ok, true);
  fs.writeFileSync(path.join(f.workspace, 'share.json'), JSON.stringify({...f.input, mode:'rss-share', task_id:'portable-share'}));
  assert.equal(f.cli('--mode', 'rss-share', 'init', 'share.json').caption_path, 'output/rss-shares/portable-share/caption.txt');
  assert.equal(fs.existsSync(path.join(f.cwd, 'output')), false);
  assert.equal(fs.existsSync(path.join(f.workspace, '.agents')), false);
  assert.equal(fs.existsSync(path.join(f.packaged, 'output')), false);
});

test('packaged helper imports and Node/Python CLIs work without legacy workspace entries', async t => {
  const f = fixture(t);
  const helper = f.helper;
  const command = spawnSync(process.execPath, [helper, '--workspace', f.workspace, 'init', 'request.json'], {cwd:f.cwd, encoding:'utf8'});
  assert.equal(command.status, 0, command.stderr + command.stdout);
  assert.equal(JSON.parse(command.stdout).task_id, 'portable-1');
  const api = await import(pathToFileURL(helper).href);
  assert.equal(typeof api.createTaskRunner, 'function');
  for (const skill of ['azure-image-gen', 'wechat-draft']) {
    const script = skill === 'azure-image-gen' ? 'azure_generate_image.py' : 'publish_draft.py';
    const help = spawnSync(python, [path.join(f.packaged, skill, 'scripts', script), '--help'], {cwd:f.cwd, encoding:'utf8'});
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /usage:/);
  }
  for (const script of ['validate-article.mjs','validate-share.mjs']) {
    const check = spawnSync(process.execPath, [path.join(f.skillRoot, 'scripts', script)], {cwd:f.cwd, encoding:'utf8'});
    assert.ok([1,2].includes(check.status), check.stderr + check.stdout);
    assert.match(check.stdout + check.stderr, /用法|Usage/);
  }
});

for (const shortWorkspace of [false, true]) {
test(`real Python bridge loads sibling publisher in supplied skillRoot and workspace env${shortWorkspace ? ' with Windows short paths' : ''}`, {skip:shortWorkspace && process.platform !== 'win32'}, async t => {
  const f = fixture(t);
  if (shortWorkspace) {
    const alias = spawnSync(python, ['-c', "import ctypes, sys; buffer = ctypes.create_unicode_buffer(32768); length = ctypes.windll.kernel32.GetShortPathNameW(ctypes.c_wchar_p(sys.argv[1]), buffer, len(buffer)); assert length; print(buffer.value)", f.workspace], {encoding:'utf8'});
    assert.equal(alias.status, 0, alias.stderr);
    f.workspace = alias.stdout.trim();
    if (!f.workspace.includes('~')) return t.skip('Windows short names are unavailable on this volume');
  }
  f.cli('init', 'request.json');
  const dir = path.join(f.workspace, 'output/rss-articles/portable-1');
  const description = '离线验证说明。'.repeat(12);
  fs.writeFileSync(path.join(dir, 'article.md'), `---\npubDatetime: 2020-01-01T00:00:00Z\ntitle: 跨工作区验证\ndescription: ${description}\ntags: ["AI"]\nslug: portable-task\nsource: ${f.input.source_url}\nogImage: ./assets/01-cover.png\n---\n\n正文包含可验证的步骤。\n\n![示意图](./assets/02-illustration-topic.png)\n\n## 参考\n\n${f.input.source_url}\n`);
  for (const name of ['01-cover.png','02-illustration-topic.png']) fs.writeFileSync(path.join(dir, 'assets', name), PNG);
  fs.writeFileSync(path.join(dir, 'assets/cover-brief.json'), JSON.stringify({article_title:'跨工作区验证', cover_type:'scene', core_theme:'offline', reader_takeaway:'safe', summary_angle:'offline', narrative_flow:'linear', information_blocks:[{source_anchor:'one'},{source_anchor:'two'}], selected_style:'HD-2D', selected_style_prompt_descriptor:'2D pixels in 3D', final_prompt:'Offline fixture, never generate.'}));
  fs.writeFileSync(path.join(f.workspace, '.env'), 'WECHAT_APP_ID=portable-app\nWECHAT_APP_SECRET=portable-secret\n');
  // This fixture replaces only the copied API module. The real bridge and Node
  // validator run in real processes, and no installed network client is called.
  fs.writeFileSync(path.join(f.packaged, 'wechat-draft/scripts/publish_draft.py'), `from pathlib import Path\nimport os\ndef load_env_from_dotenv(workspace):\n    assert Path(workspace).resolve() == Path.cwd().resolve()\n    for line in (Path(workspace) / '.env').read_text().splitlines():\n        key, value = line.split('=', 1)\n        os.environ.setdefault(key, value)\ndef validate_args(parser, args):\n    assert args.article_type == 'news'\ndef get_access_token(appid, secret):\n    assert (appid, secret) == ('portable-app', 'portable-secret')\n    return 'offline-token'\ndef build_news_article(args, token):\n    return {'thumb_media_id': 'offline-thumb'}\ndef add_draft(token, article):\n    return 'offline-portable-media'\n`);
  const {createTaskRunner} = await import(pathToFileURL(path.join(f.skillRoot, 'scripts/rss-task.mjs')).href);
  const runner = createTaskRunner({workspace:f.workspace, skillRoot:f.skillRoot, environment:{...process.env, WECHAT_APP_ID:'', WECHAT_APP_SECRET:''}});
  const environment = {...process.env};
  delete environment.WECHAT_APP_ID; delete environment.WECHAT_APP_SECRET;
  const portable = createTaskRunner({workspace:f.workspace, skillRoot:f.skillRoot, environment});
  assert.equal(runner.preflight().wechat_ready, false);
  const result = await portable.publish('portable-1', python);
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.media_id, 'offline-portable-media');
  assert.equal((await portable.publish('portable-1', python)).media_id, result.media_id);
  assert.equal(fs.existsSync(path.join(f.workspace, '.agents')), false);
});
}
