/** Real helper filesystem, simulated Host services. No external APIs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicationManager } from '../lib/publication.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-share-manager-'));
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/create-wechat-content');
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Unexpected network request'); };
let sequence = 0, checks = 0;
const fixtures = [];
function fixture(options = {}) {
  const workspace = path.join(root, String(sequence++), 'workspace');
  const dataDir = path.join(workspace, 'state');
  const skill = path.join(root, `installed-${sequence}`, 'skills/create-wechat-content');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
  for (const rel of ['SKILL.md','scripts/rss-task.mjs','references/rss-article-workflow.md','references/rss-share-workflow.md']) fs.copyFileSync(path.join(source,rel),path.join(skill,rel));
  fs.writeFileSync(path.join(workspace,'.env'),'AZURE_IMAGE_ENDPOINT=https://offline.example\nAZURE_API_KEY=offline-check-value\nWECHAT_APP_ID=offline-check-value\nWECHAT_APP_SECRET=offline-check-value\n');
  const agents = new Map();
  const calls = { create: 0, prompt: [], model: [] };
  const row = { id: 17, url: 'https://example.test/report', title: 'A trustworthy report', feed_title: 'Source' };
  const services = {
    agents,
    llm: { resolveCallConfig: async request => { calls.model.push(request); return request; } },
    workspaceRegistry: { create: async () => ({ id: 'workspace' }) },
    sessionController: {
      create: async () => {
        const id = 'session-'+(++calls.create);
        const agent = { id, status:'idle', inbox:{ nextTurn:[],nextStep:[] }, model: { select: selection => { agent.selection = selection; } } };
        agents.set(id, agent);
        return { sessionId:id };
      },
      prompt: async request => { calls.prompt.push(request); if(options.admissionError) throw new Error('private info'); agents.get(request.sessionId).status='running'; return { accepted:true }; },
      events: async () => ({ records:[{type:'event',event:{type:'turn/end'}}], hasMore:false, cursor:0 }),
    },
  };
  const args = { ctx:{get: name => services[name]}, workspaceDir:workspace,skillRoot:skill,dataDir,
    getArticle: async id => options.missing || id!==17 ? null : row,
    readCached: async () => options.body ?? { contentSource:'web',contentText:'完整原文及证据',needsExtraction:false,truncated:false },
    resolveRoute: async () => ({provider:'writing-provider',model:'writer-model',source:'custom'}),kind:'share' };
  const manager=createPublicationManager(args);
  const f={manager,args,workspace,dataDir,calls,agents,
    result(task){return path.join(workspace,'output/rss-shares',task.taskId,'result.json');},
    update(task,patch){const file=f.result(task);fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),...patch}));},
  };
  fixtures.push(f); return f;
}
async function check(name, run){await run();console.log(`ok ${++checks} - ${name}`);}
try {
  await check('share GET is lazy and missing or discarded source cannot launch',async()=>{
    const f=fixture(); assert.equal(await f.manager.read(17),null);assert.equal(f.calls.create,0);assert.equal(fs.existsSync(f.dataDir),false);
    const missing=fixture({missing:true});await assert.rejects(missing.manager.start(17),{code:'ARTICLE_NOT_FOUND'});
  });
  await check('incomplete, truncated and excerpt bodies never create a share Agent',async()=>{
    for(const body of [{contentSource:'feed-summary',contentText:'摘要'}, {contentSource:'web',contentText:'',needsExtraction:false}, {contentSource:'web',contentText:'片段',truncated:true}, {contentSource:'feed',contentText:'正文',needsExtraction:true}]){
      const f=fixture({body});await assert.rejects(f.manager.start(17),{code:'SOURCE_INCOMPLETE'});assert.equal(f.calls.create,0);assert.equal(f.calls.model.length,0);
    }
  });
  await check('share and long article use independent task IDs, directories and Agent sessions',async()=>{
    const f=fixture();const article=createPublicationManager({...f.args,kind:'article'});
    try{
      const p=f.manager.start(17);assert.strictEqual(p,f.manager.start('17'));
      const share=await p, news=await article.start(17);
      assert.notEqual(share.taskId,news.taskId);assert.notEqual(share.sessionId,news.sessionId);
      assert.match(share.taskId,/^rss-share-/);assert.equal(share.articleType,'newspic');assert.equal(share.imageCount,1);
      assert.equal(f.calls.create,2);assert.ok(fs.existsSync(path.join(f.dataDir,'shares/17.json')));assert.ok(fs.existsSync(path.join(f.dataDir,'publications/17.json')));
      const shareInput=JSON.parse(fs.readFileSync(path.join(path.dirname(f.result(share)),'input.json'),'utf8'));
      assert.equal(shareInput.mode,'rss-share');assert.equal(shareInput.poster_layout,'editorial');assert.equal(shareInput.cached_content,'完整原文及证据');
      const newsInput=JSON.parse(fs.readFileSync(path.join(f.workspace,'output/rss-articles',news.taskId,'input.json'),'utf8'));assert.equal(Object.hasOwn(newsInput,'poster_layout'),false);
      const prompt=f.calls.prompt[0].content[0].text;
      for(const text of ['references/rss-share-workflow.md','--mode rss-share','--skip-post-process','newspic','不再请求确认','key_points','新任务使用images清单','150–300字','单看图就能说出事情大概','写明发布方或作者及日期','一次策划、一轮集中生成','不加“示意”“AI插画”','图片生成后不再验收或另跑校验，直接保存草稿','不自动付费重绘','image_count须为1–3','一次直接生成含全部文字的完整海报','不生成无文字底图'])assert.ok(prompt.includes(text),text);
      assert.doesNotMatch(prompt,/无文字高清原图|本地排版脚本|render-share-poster\.py|主体集中于中部偏下|2–5个信息块|comparison|insight|steps|image_count为1。/);
      assert.match(prompt,/仅保存公众号图片消息草稿/);assert.match(prompt,/不提交发布/);assert.match(prompt,/不重启或重载插件/);assert.match(prompt,/实际非空media_id和status=succeeded/);assert.doesNotMatch(prompt,/默认提交发布|freepublish|publish_id|publish_status=submitted/);
      assert.equal((await f.manager.start(17)).sessionId,share.sessionId);assert.equal(f.calls.create,2);
      const reloaded=createPublicationManager(f.args);try{assert.equal((await reloaded.read(17)).sessionId,share.sessionId);assert.equal((await reloaded.start(17)).sessionId,share.sessionId);}finally{reloaded.dispose();}
    }finally{article.dispose();}
  });
  await check('retry preserves immutable legacy input without forcing a layout migration',async()=>{
    for(const legacyLayout of [undefined,'content']){
      const f=fixture(), task=await f.manager.start(17);
      const files=[path.join(path.dirname(f.result(task)),'input.json'),path.join(f.dataDir,'shares/17.input.json')];
      for(const file of files){const input=JSON.parse(fs.readFileSync(file,'utf8'));if(legacyLayout)input.poster_layout=legacyLayout;else delete input.poster_layout;fs.writeFileSync(file,JSON.stringify(input));}
      f.agents.get(task.sessionId).status='idle';
      const resumed=await f.manager.start(17);assert.equal(resumed.status,'running');assert.notEqual(resumed.sessionId,task.sessionId);
      for(const file of files)assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).poster_layout,legacyLayout);
      assert.match(f.calls.prompt.at(-1).content[0].text,/key_points/);
    }
  });
  await check('single-poster success exposes paths and durable success prevents duplicate uploads',async()=>{
    const f=fixture(), task=await f.manager.start(17);const dir=`output/rss-shares/${task.taskId}`;
    f.update(task,{status:'succeeded',stage:'wechat_draft',media_id:'actual-test-media',poster_path:`${dir}/assets/01-poster.png`,cover_path:`${dir}/assets/01-poster.png`});
    const saved=fs.readFileSync(f.result(task),'utf8');
    const read=await f.manager.read(17);assert.equal(read.status,'succeeded');assert.equal(read.posterPath,`${dir}/assets/01-poster.png`);assert.equal(read.captionPath,`${dir}/caption.txt`);assert.equal(read.mediaId,'actual-test-media');
    assert.equal(read.publishId,null);assert.equal(read.publishStatus,null);assert.ok(!Object.keys(JSON.parse(saved)).some(key=>key.startsWith('publish')));
    assert.equal((await f.manager.start(17)).mediaId,'actual-test-media');assert.equal(f.calls.create,1);
    assert.equal(fs.readFileSync(f.result(task),'utf8'),saved);
    f.update(task,{poster_path:'../outside.png'});await assert.rejects(f.manager.read(17),{code:'PATH_ESCAPE'});
  });
  await check('two or three images and a manifest-named first image survive reads and reloads without duplicate drafts',async()=>{
    for(const count of [2,3]){
      const f=fixture(),task=await f.manager.start(17),dir=`output/rss-shares/${task.taskId}`;
      const images=Array.from({length:count},(_,i)=>`${dir}/assets/0${i+1}-diagram.png`);
      f.update(task,{status:'succeeded',stage:'wechat_draft',media_id:'saved-multi-draft',image_count:count,image_paths:images,poster_path:images[0],cover_path:images[0]});
      const saved=fs.readFileSync(f.result(task),'utf8');
      const reloaded=createPublicationManager(f.args);
      try{
        const state=await reloaded.read(17);
        assert.equal(state.imageCount,count);assert.equal(state.posterPath,images[0]);assert.equal(state.coverPath,images[0]);
        assert.equal((await reloaded.start(17)).mediaId,'saved-multi-draft');assert.equal(f.calls.create,1);
        assert.equal(fs.readFileSync(f.result(task),'utf8'),saved);
      }finally{reloaded.dispose();}
      f.update(task,{poster_path:`${dir}/assets/02-diagram.png`});
      await assert.rejects(f.manager.read(17),{code:'PATH_ESCAPE'});
    }
  });
  await check('share history needing attention stays read-only and cannot create another draft',async()=>{
    for(const publishStatus of [undefined,'submitted','rejected','unknown']){
      const f=fixture(),task=await f.manager.start(17);
      const code=publishStatus==='rejected'?'WECHAT_PUBLISH_REJECTED':publishStatus?'WECHAT_PUBLISH_UNKNOWN':'WECHAT_SUBMISSION_UNKNOWN';
      f.update(task,{status:'needs_attention',stage:'wechat_draft',media_id:'saved-draft',publish_id:publishStatus?'historical-job':undefined,publish_status:publishStatus,error:{code,message:'private info'}});
      f.agents.get(task.sessionId).status='idle';
      const saved=fs.readFileSync(f.result(task),'utf8');
      const state=await f.manager.read(17);
      assert.equal(state.status,'needs_attention');assert.equal(state.mediaId,'saved-draft');assert.equal(state.publishStatus,publishStatus||null);assert.equal(state.publishId,publishStatus?'historical-job':null);
      assert.equal(state.error.code,code);assert.ok(!state.error.message.includes('private info'));
      assert.equal((await f.manager.start(17)).status,'needs_attention');assert.equal(f.calls.create,1);
      assert.equal(fs.readFileSync(f.result(task),'utf8'),saved);
    }
  });
  await check('share historical publication fields do not alter stored draft success',async()=>{
    for(const publishStatus of ['submitted','rejected','unknown']){
      const f=fixture(),task=await f.manager.start(17);
      f.update(task,{status:'succeeded',stage:'wechat_draft',media_id:'saved-draft',publish_id:'historical-job',publish_status:publishStatus});
      const saved=fs.readFileSync(f.result(task),'utf8');
      const state=await f.manager.read(17);
      assert.equal(state.status,'succeeded');assert.equal(state.publishStatus,publishStatus);assert.equal(state.publishId,'historical-job');
      assert.equal((await f.manager.start(17)).mediaId,'saved-draft');assert.equal(f.calls.create,1);
      assert.equal(fs.readFileSync(f.result(task),'utf8'),saved);
    }
  });
  await check('wrong type/count is rejected and submission uncertainty cannot start another Agent',async()=>{
    for(const change of [{article_type:'news'},...[0,4,1.5,'2',null].map(image_count=>({image_count}))]){const f=fixture(),task=await f.manager.start(17);f.update(task,change);await assert.rejects(f.manager.read(17),{code:'INVALID_STATE'});}
    const f=fixture({admissionError:true});const task=await f.manager.start(17);assert.equal(task.status,'needs_attention');assert.equal((await f.manager.start(17)).taskId,task.taskId);assert.equal(f.calls.create,1);assert.ok(!task.error.message.includes('private info'));
  });
  await check('updated helper replaces a legacy module cached by the running Host',async()=>{
    const f=fixture();
    const helper=path.join(f.args.skillRoot,'scripts/rss-task.mjs');
    const current=fs.readFileSync(helper,'utf8');
    fs.writeFileSync(helper,'export function createTaskRunner(){throw Object.assign(new Error("Legacy helper only supports rss-article"),{code:"INVALID_INPUT"});}\n');
    await import(pathToFileURL(helper).href);
    fs.writeFileSync(helper,current);
    const task=await f.manager.start(17);
    assert.equal(task.status,'running');assert.equal(task.articleType,'newspic');assert.equal(f.calls.create,1);
    assert.equal(JSON.parse(fs.readFileSync(f.result(task),'utf8')).mode,'rss-share');
  });
  console.log(`PASS ${checks} share manager checks; no model, image or WeChat calls.`);
}finally{for(const f of fixtures)f.manager.dispose();globalThis.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});}
