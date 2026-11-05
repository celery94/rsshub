import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createTaskRunner,normalizeInput,main} from './rss-task.mjs';
import {readShare,validateShare} from './validate-share.mjs';
const source = 'https://source.example/article';
const caption = '这项更新提供了可核查的技术线索，读者可以先阅读原文，再结合自己的使用场景判断是否值得尝试。实际操作前应确认版本和权限，保存现有配置，并在小范围验证效果。文章中的能力说明以原文为依据，具体表现仍需结合本地环境检查，避免直接套用未经验证的结论。';
function fixture(t, bridge) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'rss-share-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input = {version:1,mode:'rss-share',task_id:'share-1',source_url:source,cached_content:'Untrusted source'};
  const file = path.join(root,'input.json'); fs.writeFileSync(file,JSON.stringify(input));
  const dir = path.join(root,'output/rss-shares/share-1');
  const resultFile = path.join(dir,'result.json');
  const state = ()=>JSON.parse(fs.readFileSync(resultFile));
  const update = change=>fs.writeFileSync(resultFile,JSON.stringify({...state(),...change}));
  const runner = createTaskRunner({workspace:root,mode:'rss-share',runBridge:bridge || (()=>{throw Error('Unexpected network');})});
  const manifest = {title:'一次技术更新',caption:`${caption}\n\n来源：${source}`,source,headline:'值得关注的更新',subtitle:'阅读原文后结合场景验证',poster:'./assets/01-poster.png'};
  function artifacts(change={}) {
    const data = {...manifest,...change};
    fs.writeFileSync(path.join(dir,'share.json'),JSON.stringify(data));
    fs.writeFileSync(path.join(dir,'caption.txt'),data.caption);
    fs.writeFileSync(path.join(dir,'assets/01-poster.png'),'offline pixel validation belongs to Python');
  }
  return {root,file,dir,state,update,runner,manifest,artifacts};
}
test('CLI accepts explicit share mode before command and rejects other positions',async()=>{
  assert.equal((await main(['--mode','rss-share','preflight'])).mode,'rss-share');
  assert.equal((await main(['preflight'])).mode,'rss-article');
  await assert.rejects(main(['preflight','--mode','rss-share']),{code:'INVALID_ARGUMENTS'});
  await assert.rejects(main(['--mode','rss-shrae','preflight']),{code:'INVALID_MODE'});
});
test('share input normalizes explicitly and default runner rejects mismatched mode',async t=>{
  const f=fixture(t); assert.equal(normalizeInput({version:1,mode:'rss-share',task_id:'id',source_url:'https://SOURCE.example'}).source_url,'https://source.example/');
  assert.throws(()=>createTaskRunner({workspace:f.root}).init(f.file),{code:'INVALID_MODE'});
  const result = await f.runner.init(f.file);
  assert.equal(result.mode,'rss-share'); assert.equal(result.article_type,'newspic'); assert.equal(result.image_count,1);
  assert.equal(result.caption_path,result.article_path); assert.equal(result.poster_path,null);
  assert.equal(f.runner.preflight().mode,'rss-share');
});
test('share success persists exact paths, single image and idempotent result',async t=>{
  let calls=0;
  const f=fixture(t,request=>{
    calls++; assert.equal(request.article_type,'newspic'); assert.equal(request.caption,f.manifest.caption);
    assert.deepEqual(request.inline,[]); assert.equal(request.image_count,1);
    f.update({status:'succeeded',media_id:'offline-media',error:null}); return {status:0};
  });
  await f.runner.init(f.file); f.artifacts();
  const result=await f.runner.publish('share-1','offline-python');
  assert.equal(result.status,'succeeded'); assert.equal(result.poster_path,'output/rss-shares/share-1/assets/01-poster.png');
  assert.equal(result.poster_path,result.cover_path); assert.equal(result.article_path,result.caption_path); assert.deepEqual(result.inline_image_paths,[]);
  assert.deepEqual(await f.runner.publish('share-1','offline-python'),result); assert.equal(calls,1);
});
for (const [name,change] of [['long title',{title:'长'.repeat(33)}],['long headline',{headline:'长'.repeat(25)}],['long subtitle',{subtitle:'长'.repeat(41)}],['source mismatch',{source:'https://other.example/'}],['short caption',{caption:`短句\n来源：${source}`}],['long caption',{caption:`${'长'.repeat(201)}\n来源：${source}`}],['source absent',{caption}],['encoded path',{poster:'./assets/%30%31-poster.png'}],['traversal',{poster:'../outside.png'}],['remote image',{poster:'https://example.com/a.png'}]]) test(`share rejects ${name} before bridge`,async t=>{
  const f=fixture(t); await f.runner.init(f.file); f.artifacts(change);
  assert.ok(validateShare(f.dir,{source}).length);
  assert.equal((await f.runner.publish('share-1','offline-python')).error.code,'VALIDATION_FAILED');
});
test('extra or missing images and mismatched caption fail',async t=>{
  const f=fixture(t); await f.runner.init(f.file); f.artifacts();
  assert.deepEqual(validateShare(f.dir,{source}),[]);
  fs.writeFileSync(path.join(f.dir,'assets/extra.jpg'),'extra'); assert.ok(validateShare(f.dir).length);
  fs.unlinkSync(path.join(f.dir,'assets/extra.jpg')); fs.writeFileSync(path.join(f.dir,'caption.txt'),'different'); assert.ok(validateShare(f.dir).length);
  f.artifacts(); fs.unlinkSync(path.join(f.dir,'assets/01-poster.png')); assert.ok(validateShare(f.dir).length);
});
test('share rejects symlink directory even when target is inside task',async t=>{
  const f=fixture(t); await f.runner.init(f.file); f.artifacts();
  const assets=path.join(f.dir,'assets'); const target=path.join(f.dir,'actual-assets'); fs.renameSync(assets,target);
  fs.symlinkSync(target,assets,process.platform==='win32'?'junction':'dir');
  assert.ok(validateShare(f.dir).length);
});
for (const outcome of ['unknown','safe-retry','durable-success']) test(`share ${outcome} retains submission protections`,async t=>{
  let calls=0;
  const f=fixture(t,()=>{
    calls++;
    if(outcome==='unknown') throw Error('secret');
    f.update(outcome==='safe-retry' && calls===1 ? {status:'failed',error:{code:'WECHAT_PREPARATION_FAILED',message:'offline'}}:{status:'succeeded',media_id:'confirmed',error:null});
    return {status:outcome==='durable-success'?1:0};
  });
  await f.runner.init(f.file); f.artifacts();
  const first=await f.runner.publish('share-1','offline-python');
  if(outcome==='unknown') {assert.equal(first.status,'needs_attention');assert.deepEqual(await f.runner.stage('share-1','writing'),first);}
  const last=await f.runner.publish('share-1','offline-python');
  assert.equal(last.status,outcome==='unknown'?'needs_attention':'succeeded'); assert.equal(calls,outcome==='safe-retry'?2:1);
});
