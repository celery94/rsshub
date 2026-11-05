import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {normalizeInput} from './rss-task.mjs';
import {validateEditorial,validateShare} from './validate-share.mjs';
const source='https://source.example/article';
const sections=[{heading:'增长来源',body:'数据中心需求支持业务增长，实际表现仍需结合后续订单核对。'},{heading:'比较边界',body:'不同公司的预测与已披露数据存在差异，应核对时间区间和统计口径。'}];
const comparison={label:'2026年第四季度营收指引',left:{name:'AMD',value:'约170',unit:'亿美元'},right:{name:'Intel',value:'150–160',unit:'亿美元'}};
const editorial=layout=>({layout,sections:structuredClone(sections),...(layout==='comparison'?{comparison:structuredClone(comparison)}:{})});
function fixture(t,mode='editorial'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'editorial-share-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'assets'));
 const input={version:1,mode:'rss-share',task_id:path.basename(dir),source_url:source,...(mode?{poster_layout:mode}:{})};fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify(input));
 const caption=`${'原文数据需要结合具体使用条件以及后续变化进行核对。'.repeat(5)}\n来源：${source}`;
 const manifest={title:'比较业务增长来源',headline:'AMD 单季营收有望首超 Intel',subtitle:'数据中心支持增长，预测仍需继续核对',source,caption,poster:'./assets/01-poster.png'};
 fs.writeFileSync(path.join(dir,'caption.txt'),caption);fs.writeFileSync(path.join(dir,'assets/01-poster.png'),'Python decodes actual pixels');
 const save=change=>fs.writeFileSync(path.join(dir,'share.json'),JSON.stringify({...manifest,...change}));save({});return{dir,save};
}
test('editorial input allowed only in share and old inputs unchanged',()=>{
 const input={version:1,mode:'rss-share',task_id:'editorial',source_url:source,poster_layout:'editorial'};assert.deepEqual(normalizeInput(input),input);
 assert.throws(()=>normalizeInput({...input,mode:'rss-article'}),{code:'INVALID_INPUT'});
});
for(const layout of ['comparison','insight','steps'])test(`strict valid ${layout} requires no duplicate key_points`,t=>{
 const f=fixture(t);f.save({editorial:editorial(layout)});assert.deepEqual(validateShare(f.dir),[]);assert.doesNotThrow(()=>validateEditorial(editorial(layout)));
});
test('modern editorial required; legacy editorial optional and validated; content points still required',t=>{
 const modern=fixture(t);assert.ok(validateShare(modern.dir).length);
 const legacy=fixture(t,null);assert.deepEqual(validateShare(legacy.dir),[]);legacy.save({editorial:editorial('insight')});assert.deepEqual(validateShare(legacy.dir),[]);
 const content=fixture(t,'content');content.save({editorial:editorial('steps')});assert.ok(validateShare(content.dir).length);
 modern.save({editorial:editorial('comparison'),key_points:['短','句']});assert.ok(validateShare(modern.dir).length);
});
test('editorial rejects missing, unknown, wrong-type and cross-layout fields',()=>{
 const invalid=[null,[],{},'comparison',{...editorial('insight'),layout:'unknown'},{...editorial('insight'),extra:true},{...editorial('insight'),sections:null},{...editorial('insight'),sections:[sections[0]]},{...editorial('insight'),sections:[...sections,...sections]},{...editorial('comparison'),comparison:null},{...editorial('comparison'),comparison:{...comparison,extra:true}},{...editorial('insight'),comparison},{...editorial('steps'),comparison}];
 for(const value of invalid)assert.throws(()=>validateEditorial(value));
 for(const bad of [{heading:'',body:sections[0].body},{heading:'长'.repeat(13),body:sections[0].body},{heading:'Heading',body:sections[0].body},{heading:'增长',body:'短句'},{heading:'增长',body:'文'.repeat(51)},{heading:'增长',body:'a'.repeat(20)},{heading:'增长',body:'**需要检查时间区间和预测口径**'},{...sections[0],extra:1},null])assert.throws(()=>validateEditorial({...editorial('insight'),sections:[bad,sections[1]]}));
});
test('comparison keeps same units and bounded plain-text data fields',()=>{
 for(const [key,max] of [['name',12],['value',16],['unit',12]])for(const value of ['',null,{},'x'.repeat(max+1),'<b>bad</b>']){
  const bad=editorial('comparison');bad.comparison.left[key]=value;assert.throws(()=>validateEditorial(bad));
 }
 for(const mutate of [pair=>pair.left.unit='亿元',pair=>pair.label='长'.repeat(25),pair=>pair.label='',pair=>pair.left.extra=true,pair=>delete pair.right.name]){const bad=editorial('comparison');mutate(bad.comparison);assert.throws(()=>validateEditorial(bad));}
});
test('maximum legal fields and Unicode codepoints accepted',()=>{
 const value=editorial('comparison');value.sections=Array.from({length:3},()=>({heading:'标'.repeat(12),body:'文'.repeat(49)+'𠮷'}));value.comparison.label='期'.repeat(24);for(const side of ['left','right'])value.comparison[side]={name:'名'.repeat(12),value:'1'.repeat(16),unit:'单'.repeat(12)};
 assert.doesNotThrow(()=>validateEditorial(value));value.sections[0].body+='𠮷';assert.throws(()=>validateEditorial(value));
});
