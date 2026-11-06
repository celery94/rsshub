/** Exercise only the real client's pure data selector; no React or DOM renderer. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const start=source.indexOf('    function buildArticleList(');
const end=source.indexOf('\n    }',start)+6;
assert.ok(start>=0 && end>start);
const select=runInNewContext(`(${source.slice(start,end).trim()})`);
const groups=[
 {id:'ai',label:'AI',items:[
  {id:1,title:'Older',publishedAt:'2026-11-03T00:00:00Z',read:false,feed:'Source A'},
  {id:3,title:'Read article',publishedAt:'2026-11-03T03:00:00+08:00',read:true,summary:'needle'},
  {id:5,title:'Undated',publishedAt:'invalid',read:false},
 ]},
 {id:'engineering',label:'Engineering',items:[
  {id:2,title:'Newest',publishedAt:'2026-11-04T00:00:00Z',read:false,summary:'needle'},
  {id:4,title:'Middle',publishedAt:'2026-11-03T08:00:00Z',read:false,feed:'Source B'},
  {id:6,title:'Same time',publishedAt:'2026-11-03T08:00:00Z',read:false},
 ]},
];
const original=JSON.stringify(groups);
const ids=list=>Array.from(list,item=>item.id);
let view=select(groups);
assert.deepEqual(ids(view.articles),[2,6,4,1,3,5],'global time order crosses category boundaries and honors ISO offsets');
assert.equal(view.articles[0].categoryLabel,'Engineering');
view=select(groups,{category:'ai'});
assert.deepEqual(ids(view.articles),[1,3,5]);
assert.equal(view.categoryLabel,'AI');
assert.equal(view.categories.length,2,'other category navigation remains available');
view=select(groups,{category:'ai',query:' NEEDLE ',unreadOnly:true});
assert.deepEqual(ids(view.articles),[]);
assert.deepEqual(ids(view.readerArticles),[3],'marking the current article read does not remove reader navigation');
assert.equal(view.category,'ai','an empty filtered category remains selected');
assert.equal(view.categories.find(c=>c.key==='engineering').count,1);
view=select(groups,{category:'engineering',query:'source b',unreadOnly:true});
assert.deepEqual(ids(view.articles),[4],'category, feed search and unread compose');
view=select(groups,{category:null,unreadOnly:true});
assert.deepEqual(ids(view.articles),[2,6,4,1,5],'All articles removes only the category restriction');
assert.equal(view.totalCount,5);
view=select(groups,{category:'removed-category'});
assert.equal(view.category,null);
assert.equal(view.articles.length,6);
assert.equal(JSON.stringify(groups),original,'selection does not mutate the cached report');
const fallback=select([{id:'opml:Blogs',label:'Blogs',items:[groups[0].items[0]]}],{category:'opml:Blogs'});
assert.deepEqual(ids(fallback.articles),[1]);
assert.equal(select([]).articles.length,0);
const tie='2026-11-04T00:00:00Z';
assert.deepEqual(ids(select([{id:'opml:A',items:[{id:3,publishedAt:tie},{id:1,publishedAt:tie}]},{id:'opml:B',items:[{id:2,publishedAt:tie}]}]).articles),[3,2,1],'same-time rows retain server ID order across regrouped categories');
const mergeStart=source.indexOf('    function mergeLatestPages(');
const mergeEnd=source.indexOf('\n    }',mergeStart)+6;
assert.ok(mergeStart>=0 && mergeEnd>mergeStart);
const merge=runInNewContext(`(${source.slice(mergeStart,mergeEnd).trim()})`);
const first={view:'latest',report:{groups:[{id:'opml:Blogs',label:'Blogs',items:[{id:2,title:'Newer',publishedAt:'2026-11-04T01:00:00Z',read:false}]}]},pagination:{nextOffset:1}};
const page={view:'latest',report:{groups:[{id:'opml:Blogs',label:'Blogs',items:[{id:2,title:'Newer',publishedAt:'2026-11-04T01:00:00Z',read:true}]},{id:'opml:News',label:'News',items:[{id:1,title:'Older',publishedAt:'2026-11-03T01:00:00Z',read:false}]}]},pagination:{nextOffset:2}};
const savedFirst=JSON.stringify(first);
const merged=merge(first,page);
assert.deepEqual(ids(select(merged.report.groups).articles),[2,1]);
assert.equal(merged.report.groups[0].items[0].read,true,'new page metadata replaces duplicate IDs');
assert.equal(merged.pagination.nextOffset,2);
assert.equal(JSON.stringify(first),savedFirst,'page merge does not mutate earlier state');
assert.equal(select(merge(merged,page).report.groups).articles.length,2,'polling a page does not add duplicate rows');
console.log('Article selection checks passed: global time order, category, search/unread, reader navigation, empty category, immutable page merge and deduplication');
