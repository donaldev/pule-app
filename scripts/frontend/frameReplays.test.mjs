import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
let service = await readFile(new URL('../../src/data/remote/replayService.ts', import.meta.url), 'utf8')
service = service.replace(/^import .*$/gm, '')
const {listFrameReplays,signFrameReplay} = await import(compile(`
const actorAuthorization=async uid=>{if(uid!==globalThis.s.actor)throw Error('Wrong actor');return 'Bearer caller'};
const getSupabase=()=>({from:table=>{globalThis.s.table=table;const q={select:columns=>{globalThis.s.columns=columns;return q},eq:(key,value)=>{globalThis.s.filter={key,value};return q},setHeader:(key,value)=>{globalThis.s.header={key,value};return q},retry:value=>{globalThis.s.retry=value;return q},abortSignal:async()=>({data:globalThis.s.rows,error:globalThis.s.error})};return q},storage:{from:bucket=>({createSignedUrl:async(path,seconds)=>{globalThis.s.signs.push({bucket,path,seconds});if(globalThis.s.switchActor)globalThis.s.actor='other';return {data:globalThis.s.signed,error:globalThis.s.error}}})}});
` + service))
const replay={frame_id:'frame',group_id:'group',session_id:'night',storage_path:'night/frame.mp4',created_at:'now'}
function resetService(){globalThis.s={actor:'user',rows:[replay],signed:{signedUrl:'https://storage.test/signed?token=secret'},signs:[]}}
test('metadata uses caller authorization, session filter, and no RPC or retry',async()=>{
 resetService();assert.deepEqual(await listFrameReplays('user','night'),[replay]);assert.equal(s.table,'frame_replays');assert.deepEqual(s.filter,{key:'session_id',value:'night'});assert.deepEqual(s.header,{key:'Authorization',value:'Bearer caller'});assert.equal(s.retry,false);assert.deepEqual(s.signs,[])
})
test('empty RLS results hide availability; malformed context is excluded; errors fail closed',async()=>{
 resetService();s.rows=[];assert.deepEqual(await listFrameReplays('user','night'),[])
 s.rows=[{...replay,session_id:'other'},{...replay,storage_path:'https://public/file'}];assert.deepEqual(await listFrameReplays('user','night'),[])
 s.error={message:'diagnostic'};await assert.rejects(listFrameReplays('user','night'),/availability/)
})
test('authorized signing uses exact private path and 60 seconds',async()=>{
 resetService();assert.equal(await signFrameReplay('user',replay),s.signed.signedUrl);assert.deepEqual(s.signs,[{bucket:'frame-replays',path:'night/frame.mp4',seconds:60}])
})
test('wrong actors cannot sign; account changes discard signed results',async()=>{
 resetService();await assert.rejects(signFrameReplay('other',replay));assert.equal(s.signs.length,0)
 s.switchActor=true;await assert.rejects(signFrameReplay('user',replay),/Wrong actor/)
})
test('signing errors and missing URLs fail without automatic retry',async()=>{
 for(const result of [{error:{message:'forbidden'}},{signed:null}]){resetService();Object.assign(s,result);await assert.rejects(signFrameReplay('user',replay),/could not be opened/);assert.equal(s.signs.length,1)}
})
let component=await readFile(new URL('../../src/features/connected/FrameReplays.tsx',import.meta.url),'utf8')
component=component.replace(/^import .*$/gm,'')
const {FrameReplays}=await import(compile(`
const React={createElement:(type,props,...children)=>({type,props:props??{},children})};const Modal='modal';
const useState=value=>{const h=globalThis.h,i=h.cursor++;if(!(i in h.states))h.states[i]=value;return [h.states[i],next=>{h.states[i]=typeof next==='function'?next(h.states[i]):next}]};
const useRef=value=>{const h=globalThis.h,i=h.cursor++;return h.states[i]??(h.states[i]={current:value})};
const useEffect=f=>globalThis.h.effects.push(f);
const listFrameReplays=(...args)=>{globalThis.h.reads.push(args);return globalThis.h.list()};
const signFrameReplay=(...args)=>{globalThis.h.signs.push(args);return globalThis.h.sign()};
`+component))
const frame={id:'frame',group_id:'group',frame_number:1,status:'completed'}
function harness(){globalThis.h={cursor:0,states:[],effects:[],reads:[],signs:[],list:async()=>[replay],sign:async()=> 'https://storage.test/signed'};const render=()=>{h.cursor=0;h.effects=[];return FrameReplays({userId:'user',sessionId:'night',children:action=>[action(frame),action({...frame,id:'missing'})]})};return render}
function nodes(n){return Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]}
const find=(tree,type)=>nodes(tree).find(n=>n.type===type)
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function loaded(){const render=harness();render();const cleanups=h.effects.map(f=>f());await tick();return {render,cleanups}}
test('registered frames alone show Watch Replay; metadata fetch never signs',async()=>{
 const {render}=await loaded();const tree=render();assert.equal(nodes(tree).filter(n=>n.type==='button').length,1);assert.equal(find(tree,'button').children[0],'Watch Replay');assert.equal(h.signs.length,0)
})
test('tap opens loading modal, requests one URL, and renders native inline video',async()=>{
 const {render}=await loaded();let resolve;h.sign=()=>new Promise(r=>{resolve=r});find(render(),'button').props.onClick();let tree=render();assert.ok(find(tree,'modal'));assert.match(JSON.stringify(tree),/Opening replay/);assert.equal(h.signs.length,1)
 find(tree,'button').props.onClick();assert.equal(h.signs.length,1)
 resolve('https://storage.test/signed');await tick();tree=render();const video=find(tree,'video');assert.equal(video.props.controls,true);assert.equal(video.props.playsInline,true);assert.equal(video.props.src,'https://storage.test/signed')
})
test('playback/expiry failure removes URL and waits for explicit fresh-link action',async()=>{
 const {render}=await loaded();find(render(),'button').props.onClick();await tick();find(render(),'video').props.onError();let tree=render();assert.equal(find(tree,'video'),undefined);assert.match(JSON.stringify(tree),/expired/);assert.equal(h.signs.length,1)
 nodes(tree).find(n=>n.children.includes('Open fresh replay link')).props.onClick();await tick();assert.equal(h.signs.length,2);assert.ok(find(render(),'video'))
})
test('sign failure stays in dismissible modal without retrying',async()=>{
 const {render}=await loaded();h.sign=async()=>{throw Error('forbidden')};find(render(),'button').props.onClick();await tick();const tree=render();assert.match(JSON.stringify(tree),/Check your connection and access/);assert.equal(h.signs.length,1);find(tree,'modal').props.onClose();assert.equal(find(render(),'modal'),undefined)
})
test('closing or unmounting discards late signing responses',async()=>{
 for(const unmount of [false,true]){const {render,cleanups}=await loaded();let resolve;h.sign=()=>new Promise(r=>{resolve=r});find(render(),'button').props.onClick();if(unmount)cleanups.forEach(f=>f?.());else find(render(),'modal').props.onClose();resolve('https://storage.test/late');await tick();assert.equal(find(render(),'video'),undefined)}
})
test('metadata failure keeps history and offers explicit availability refresh',async()=>{
 const render=harness();h.list=async()=>{throw Error('unavailable')};render();h.effects.forEach(f=>f());await tick();const tree=render();assert.match(JSON.stringify(tree),/availability could not be checked/);assert.equal(h.reads.length,1);assert.equal(h.signs.length,0);assert.equal(nodes(tree).filter(n=>n.props.className==='text-button watch-replay').length,0)
})
test('SessionView mounts replay viewing only in expanded Frame History for completed frames',async()=>{
 const source=await readFile(new URL('../../src/features/connected/SessionView.tsx',import.meta.url),'utf8');assert.match(source,/historyOpen && <FrameReplays/);assert.match(source,/f.status === 'completed' && watchReplay\(f\)/);assert.match(source,/key=\{`\$\{game.userId\}:\$\{sessionId\}`\}/)
})
