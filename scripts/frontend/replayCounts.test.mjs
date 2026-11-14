import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source=(await readFile(new URL('../../src/data/remote/replayService.ts',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
const compiled=ts.transpileModule(`
const actorAuthorization=async user=>{globalThis.countsTest.actors.push(user);return 'Bearer caller'};
const getSupabase=()=>({from:table=>{const h=globalThis.countsTest;h.tables.push(table);const q={select:(fields,options)=>{h.fields=fields;h.options=options;return q},in:(field,ids)=>{h.scope={field,ids};return q},range:(start,end)=>{h.ranges.push([start,end]);return q},setHeader:(key,value)=>{h.header={key,value};return q},retry:value=>{h.retry=value;return q},abortSignal:async()=>h.pages.shift()};return q}});
`+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {countPublishedReplays}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const row=(session,frame)=>({session_id:session,frame_id:frame,storage_path:`${session}/${frame}.mp4`})
const setup=pages=>globalThis.countsTest={pages,actors:[],tables:[],ranges:[]}
test('visible matches share one caller-bound batch; zero/one/several only count published paths',async()=>{
 setup([{data:[row('one','a'),row('many','b'),row('many','c'),row('other','d'),{...row('many','e'),storage_path:'unrelated.mp4'}],count:5,error:null}])
 assert.deepEqual(await countPublishedReplays('user',['zero','one','many','one']),{zero:0,one:1,many:2})
 assert.equal(countsTest.tables.length,1);assert.deepEqual(countsTest.scope,{field:'session_id',ids:['zero','one','many']});assert.deepEqual(countsTest.actors,['user','user']);assert.equal(countsTest.header.value,'Bearer caller');assert.equal(countsTest.retry,false)
})
test('API page limits cannot silently undercount; unavailable metadata is an error, not zero',async()=>{
 setup([{data:[row('a','1')],count:2,error:null},{data:[row('a','2')],count:2,error:null}]);assert.deepEqual(await countPublishedReplays('user',['a']),{a:2});assert.deepEqual(countsTest.ranges,[[0,499],[1,500]])
 for(const page of [{data:null,count:null,error:{message:'denied'}},{data:[],count:null,error:null},{data:[],count:1,error:null}]){setup([page]);await assert.rejects(countPublishedReplays('user',['a']),/could not be checked/)}
 setup([]);assert.deepEqual(await countPublishedReplays('user',[]),{});assert.equal(countsTest.tables.length,0)
})
