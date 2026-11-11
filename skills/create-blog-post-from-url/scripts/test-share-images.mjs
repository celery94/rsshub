import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createTaskRunner} from './rss-task.mjs';
import {readShare,validateShare} from './validate-share.mjs';

const source = 'https://source.example/article';
const cached = '评测者花了约30小时通关，之后又重玩了一遍。游戏在主机与掌机模式下几乎全程保持60帧。';
const caption = '这项更新提供了可核查的技术线索，读者可以先阅读原文，再结合自己的使用场景判断是否值得尝试。实际操作前应确认版本和权限，保存现有配置，并在小范围验证效果。文章中的能力说明以原文为依据，具体表现仍需结合本地环境检查，避免直接套用未经验证的结论。';

function manifest() {
  return {
    title: '一次技术更新',
    source,
    caption: `${caption}\n来源：${source}`,
    images: [
      {
        file: './assets/01-overview.png',
        kicker: '技术观察',
        headline: '值得关注的更新',
        subtitle: '阅读原文后结合场景验证',
        blocks: [
          {type: 'metrics', items: [{value: '96', label: '综合评分'}]},
          {type: 'quote', text: '评测者花了约30小时通关', from: '原文评测'},
          {type: 'cards', items: [{heading: '实际影响', body: '原文给出的数据需要结合具体使用条件核对，不能直接套用。'}]}
        ]
      },
      {
        file: './assets/02-detail.jpg',
        headline: '第二张图聚焦限制',
        width: 1536,
        height: 1536,
        theme: {accent: '#AA5500', radius: 8},
        blocks: [
          {type: 'material', path: './materials/01-source.png', caption: '原文配图'},
          {type: 'text', body: '这里是一段自由排版的说明文字，用来验证 text 块的规则。'}
        ]
      }
    ]
  };
}

function fixture(t, bridge) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-share-images-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const dir = path.join(root, 'output/rss-shares/share-2');
  const input = {version: 1, mode: 'rss-share', task_id: 'share-2', source_url: source, poster_layout: 'editorial', cached_content: cached};
  const file = path.join(root, 'request.json');
  fs.writeFileSync(file, JSON.stringify(input));
  const resultFile = path.join(dir, 'result.json');
  const state = () => JSON.parse(fs.readFileSync(resultFile));
  const update = change => fs.writeFileSync(resultFile, JSON.stringify({...state(), ...change}));
  function artifacts(change = {}) {
    const data = {...manifest(), ...change};
    for (const name of ['assets', 'scenes', 'materials']) fs.mkdirSync(path.join(dir, name), {recursive: true});
    fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(input));
    fs.writeFileSync(path.join(dir, 'share.json'), JSON.stringify(data));
    fs.writeFileSync(path.join(dir, 'caption.txt'), data.caption);
    fs.writeFileSync(path.join(dir, 'assets/01-overview.png'), 'offline image bytes');
    fs.writeFileSync(path.join(dir, 'assets/02-detail.jpg'), 'offline image bytes');
    fs.writeFileSync(path.join(dir, 'scenes/01.png'), 'offline image bytes');
    fs.writeFileSync(path.join(dir, 'materials/01-source.png'), 'offline image bytes');
  }
  const runner = createTaskRunner({workspace: root, mode: 'rss-share', runBridge: bridge || (() => { throw Error('Unexpected network'); })});
  return {root, dir, file, state, update, runner, manifest, artifacts};
}

test('multi-image manifest validates and resolves ordered images', t => {
  const f = fixture(t);
  f.artifacts();
  assert.deepEqual(validateShare(f.dir, {source}), []);
  const read = readShare(f.dir, {source});
  assert.equal(read.image_count, 2);
  assert.deepEqual(read.images.map(file => path.basename(file)), ['01-overview.png', '02-detail.jpg']);
  assert.deepEqual(read.image_paths, ['./assets/01-overview.png', './assets/02-detail.jpg']);
  assert.equal(path.basename(read.cover), '01-overview.png');
});

test('multi-image manifest rejects structural and content violations', t => {
  const cases = [
    ['four images', data => { data.images = [...data.images, {...data.images[0]}, {...data.images[0]}]; return data; }],
    ['out-of-order name', data => { data.images[1].file = './assets/03-detail.jpg'; return data; }],
    ['legacy poster mixed', data => { data.poster = './assets/01-overview.png'; return data; }],
    ['missing quote and material', data => { data.images[0].blocks = [{type: 'text', body: '这里是一段没有引用原文的说明文字，不符合分享图要求。'}]; return data; }],
    ['quote not in source', data => { data.images[0].blocks[1].text = '这句话并不存在于原文中，用来验证引语核对。'; return data; }],
    ['too many scene blocks', data => { data.images[1].blocks.push({type: 'scene', path: './scenes/01.png'}, {type: 'scene', path: './scenes/01.png'}); return data; }],
    ['bad theme color', data => { data.images[1].theme = {accent: 'orange'}; return data; }],
    ['bad canvas width', data => { data.images[1].width = 500; return data; }],
    ['unknown block type', data => { data.images[1].blocks.push({type: 'video', path: './materials/01-source.png'}); return data; }],
    ['overlong headline', data => { data.images[0].headline = '长'.repeat(25) + '字'; return data; }]
  ];
  for (const [name, change] of cases) {
    const f = fixture(t);
    f.artifacts(change(manifest()));
    assert.ok(validateShare(f.dir, {source}).length, name);
  }
});

test('caption body accepts 100–300 characters', t => {
  for (const [length, valid] of [[99, false], [100, true], [300, true], [301, false]]) {
    const f = fixture(t);
    f.artifacts({...manifest(), caption: `${'文'.repeat(length)}\n来源：${source}`});
    assert.equal(validateShare(f.dir, {source}).length === 0, valid, `${length} characters`);
  }
});

test('multi-image manifest requires listed assets and source images', t => {
  const f = fixture(t);
  f.artifacts();
  fs.writeFileSync(path.join(f.dir, 'assets/extra.png'), 'extra');
  assert.ok(validateShare(f.dir).length);
  fs.unlinkSync(path.join(f.dir, 'assets/extra.png'));
  fs.unlinkSync(path.join(f.dir, 'materials/01-source.png'));
  assert.ok(validateShare(f.dir).length);
});

test('multi-image publish persists every image path and rejects tampering', async t => {
  let calls = 0;
  const f = fixture(t, request => {
    calls++;
    assert.equal(request.image_count, 2);
    assert.equal(request.image_paths.length, 2);
    assert.equal(request.article_type, 'newspic');
    f.update({status: 'succeeded', media_id: 'offline-media', error: null});
    return {status: 0};
  });
  await f.runner.init(f.file);
  f.artifacts();
  const result = await f.runner.publish('share-2', 'offline-python');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.image_count, 2);
  assert.deepEqual(result.image_paths, ['output/rss-shares/share-2/assets/01-overview.png', 'output/rss-shares/share-2/assets/02-detail.jpg']);
  assert.equal(result.poster_path, result.image_paths[0]);
  assert.equal(result.cover_path, result.image_paths[0]);
  assert.deepEqual(await f.runner.publish('share-2', 'offline-python'), result);
  assert.equal(calls, 1);
  f.update({image_paths: [result.image_paths[0]]});
  await assert.rejects(f.runner.stage('share-2', 'validation'), {code: 'INVALID_STATE'});
});
