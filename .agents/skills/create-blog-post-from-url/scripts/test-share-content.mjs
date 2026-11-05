import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {normalizeInput,createTaskRunner} from './rss-task.mjs';
import {validateShare,validateKeyPoints} from './validate-share.mjs';
const source='https://source.example/article';
const points=['数据中心需求持续增长，实际影响仍需结合后续订单与利润率变化核对。','企业采用新技术之前，应先验证版本条件、部署成本与本地工作负载表现。'];
const input={version:1,mode:'rss-share',task_id:'content-task',source_url:source,poster_layout:'content'};
function fixture(t, modern=true){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'share-content-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'output/rss-shares/content-task');
  fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
  const data={...input}; if(!modern) delete data.poster_layout;
  fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify(data));
  const caption=`${'原文信息需要结合具体使用条件与后续变化进行核对。'.repeat(5)}\n来源：${source}`;
  const manifest={title:'技术更新的主要内容',caption,source,headline:'技术更新的实际影响',subtitle:'先核对条件，再判断投入价值',poster:'./assets/01-poster.png'};
  const save=change=>fs.writeFileSync(path.join(dir,'share.json'),JSON.stringify({...manifest,...change}));
  fs.writeFileSync(path.join(dir,'caption.txt'),caption);
  fs.writeFileSync(path.join(dir,'assets/01-poster.png'),'Python owns actual decode');
  save({}); return {root,dir,data,save};
}
test('poster_layout content is persisted only for explicit rss-share input',()=>{
  assert.deepEqual(normalizeInput(input),input);
  const legacy={...input}; delete legacy.poster_layout;
  assert.deepEqual(normalizeInput(legacy),legacy);
  for(const change of [{mode:'rss-article'},{poster_layout:'legacy'},{poster_layout:null},{poster_layout:['content']},{poster_layout:''}]) assert.throws(()=>normalizeInput({...input,...change}),{code:'INVALID_INPUT'});
});
test('modern points required; legacy missing remains valid and may opt into valid points',t=>{
  const modern=fixture(t); assert.ok(validateShare(modern.dir).length);
  modern.save({key_points:points}); assert.deepEqual(validateShare(modern.dir),[]);
  const legacy=fixture(t,false); assert.deepEqual(validateShare(legacy.dir),[]);
  legacy.save({key_points:points}); assert.deepEqual(validateShare(legacy.dir),[]);
});
for(const [name,value] of [['null',null],['string','主要内容'],['object',{}],['empty',[]],['one',[points[0]]],['four',[...points,...points]],['nonstring',[points[0],42]],['short',[points[0],'过短']],['long',[points[0],'中'.repeat(51)]],['nonChinese',[points[0],'a'.repeat(20)]],['HTML',[points[0],'<b>需要核对部署成本与权限条件</b>']],['markdown',[points[0],'**需要核对部署成本与权限条件**']],['newline',[points[0],'需要核对部署成本\n以及权限配置条件']],['whitespace',[points[0],` ${points[1]}`]]]) test(`key_points rejects ${name} for modern and optional legacy`,t=>{
  assert.throws(()=>validateKeyPoints(value));
  for(const modern of [true,false]){const f=fixture(t,modern);f.save({key_points:value});assert.ok(validateShare(f.dir).length);}
});
test('key_points count uses Unicode codepoints rather than UTF16 units',()=>{
  assert.doesNotThrow(()=>validateKeyPoints(['中'.repeat(49)+'𠮷','中'.repeat(12)]));
  assert.throws(()=>validateKeyPoints(['中'.repeat(50)+'𠮷','中'.repeat(12)]));
});
test('manifest rejects extra fields',t=>{const f=fixture(t);f.save({key_points:points,unexpected:true});assert.ok(validateShare(f.dir).length);});
test('init stores layout input without changing standard result contract',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'content-init-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'request.json');fs.writeFileSync(file,JSON.stringify(input));
  const runner=createTaskRunner({workspace:root,mode:'rss-share'});
  const result=await runner.init(file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'output/rss-shares/content-task/input.json'))).poster_layout,'content');
  assert.equal(result.article_type,'newspic');assert.equal(result.image_count,1);assert.equal(result.poster_layout,undefined);
});
