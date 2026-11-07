import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const url=source=>'data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64')
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8')
const validationUrl=url(await read('src/data/local/intentValidation.ts'))
const {validIntent,confirmUnreadableReset}=await import(validationUrl)
const receiptUrl=url(await read('src/data/local/receiptRecovery.ts'))
const coordinatorUrl=url((await read('src/data/local/operationCoordinator.ts')).replace("'./receiptRecovery'",JSON.stringify(receiptUrl)))
const {OperationCoordinator}=await import(coordinatorUrl)
const {restoreStartupRecovery}=await import(url(await read('src/data/local/startupRecovery.ts')))
const intent=(name='remove_match')=>({id:'original-op',userId:'account',kind:'setup',name,args:{p_operation:'original-op',p_session:'night',p_expected_revision:1,p_mode:'abandon'},createdAt:'2026-01-01',status:'uncertain'})
test('reload accepts removal and every newer supported setup operation without rewriting UUID/payload',()=>{
 for(const name of ['remove_match','create_guest_with_email','resolve_matchup','claim_guest_email','create_player_invitation','accept_player_invitation','revoke_player_invitation'])assert.equal(validIntent(intent(name),'account'),true)
 for(const value of [null,{},'broken',{...intent(),name:'obsolete_unknown'},{...intent(),args:{...intent().args,p_mode:'anything'}}])assert.equal(validIntent(value,'account'),false)
 assert.equal(validIntent(intent(),'other-account'),false)
})
test('startup acknowledges exact removed-session receipt without reading a nonexistent session or replaying removal',async()=>{
 let saved=intent(),sends=0
 const store={read:async()=>structuredClone(saved),remove:async()=>{saved=null}}
 const queue=new OperationCoordinator(store,async()=>{sends++})
 const result=await restoreStartupRecovery(queue,'account',async()=>({status:'confirmed_committed',operation_id:'original-op',actor_id:'account',group_id:'group',command:{action:'remove_match',group_id:null,data:{session_id:'night',expected_revision:1,mode:'abandon'}},committed_at:'2026-01-01',saved:{kind:'setup',entity_id:'night'}}),async()=>({id:'night',group_id:'group',removed:true,mode:'abandon'}))
 assert.equal(result.intent,null);assert.equal(saved,null);assert.equal(sends,0)
 assert.equal((await restoreStartupRecovery(queue,'account',async()=>{throw Error('no lookup expected')},async()=>{})).intent,null)
})
test('missing or failed receipt preserves a genuine pending operation on reload',async()=>{
 for(const lookup of [async()=>({status:'not_confirmed'}),async()=>{throw Error('offline')}]) {
 const original=intent();const queue=new OperationCoordinator({read:async()=>structuredClone(original),remove:async()=>{throw Error('must not clear')}},async()=>{throw Error('must not send')})
 assert.deepEqual((await restoreStartupRecovery(queue,'account',lookup,async()=>{})).intent,original)
 }
})
test('a different acknowledged removal needs explicit exact-target proof, not a fabricated original receipt',async()=>{
 let removed=0
 const queue=new OperationCoordinator({read:async()=>intent(),remove:async()=>{removed++}},async()=>{throw Error('must never resend')})
 await queue.restore('account')
 await assert.rejects(queue.acknowledgeRemovedMatch('account',async()=>({id:'other-night',group_id:'group',removed:true,mode:'abandon'})))
 assert.equal(removed,0);assert.ok(queue.current)
 await queue.acknowledgeRemovedMatch('account',async()=>({id:'night',group_id:'group',removed:true,mode:'abandon'}))
 assert.equal(removed,1);assert.equal(queue.current,null)
})
test('malformed reset requires explicit review and exact unchanged exported contents; valid intents cannot be reset',()=>{
 const bad={...intent(),name:'obsolete_unknown'},snapshot=JSON.stringify(bad)
 assert.throws(()=>confirmUnreadableReset(bad,'account',snapshot,false))
 assert.throws(()=>confirmUnreadableReset({...bad,id:'another'},'account',snapshot,true))
 assert.throws(()=>confirmUnreadableReset(intent(),'account',JSON.stringify(intent()),true))
 confirmUnreadableReset(bad,'account',snapshot,true)
})
// Minimal IndexedDB model exercises actual read/open error classification without browser data.
function indexedDBModel(rows,{unavailable=false}={}) {
 return {open(){const request={};queueMicrotask(()=>{if(unavailable){request.onerror();return}request.result={close(){},transaction(){let aborted=false;const tx={abort(){aborted=true;queueMicrotask(()=>tx.onabort())},objectStore(){return {get(key){const req={};queueMicrotask(()=>{req.result=rows.get(key);req.onsuccess();queueMicrotask(()=>{if(!aborted)tx.oncomplete()})});return req},delete(key){rows.delete(key)}}}};return tx}};request.onsuccess()});return request}}
}
let sequence=0
async function actualStore(rows,options){globalThis.indexedDB=indexedDBModel(rows,options);return import(url((await read('src/data/local/intentStore.ts')).replace("'./intentValidation'",JSON.stringify(validationUrl)).replace("'./journalPolicy'",JSON.stringify(url(await read('src/data/local/journalPolicy.ts')))).replace('import.meta.env.VITE_SUPABASE_URL',"'https://project.example.invalid'")+`\n// ${sequence++}`))}
test('actual storage separates malformed data from unavailable storage, exports privately, and rejects changed-record reset',async()=>{
 const rows=new Map([['account',{bad:true}]])
 const api=await actualStore(rows)
 await assert.rejects(api.intentStore.read('account'),e=>e.reason==='malformed')
 const snapshot=await api.exportUnreadableIntent('account');assert.equal(rows.size,1)
 rows.set('account',intent())
 await assert.rejects(api.resetUnreadableIntent('account',snapshot,true));assert.equal(rows.size,1)
 assert.deepEqual(await api.intentStore.read('account'),intent())
 rows.set('account',{bad:true});rows.set('other-account',{private:'untouched'})
 await api.resetUnreadableIntent('account',snapshot,true);assert.equal(await api.intentStore.read('account'),null);assert.equal(rows.has('other-account'),true)
 const unavailable=await actualStore(new Map(),{unavailable:true})
 await assert.rejects(unavailable.intentStore.read('account'),e=>e.reason==='unavailable')
 globalThis.indexedDB=indexedDBModel(new Map());assert.equal(await unavailable.intentStore.read('account'),null)
})
test('notification state dismisses explicitly and success notices expire without clearing pending recovery',async()=>{
 let values=[],cursor=0,effectCursor=0,previous=[],cleanups=[],jobs=[],timer,coordinator,submits=0
 const state=initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]}
 const useEffect=(f,deps)=>{const i=effectCursor++;if(!previous[i]||deps.some((v,j)=>v!==previous[i][j])){previous[i]=deps;jobs.push(()=>{cleanups[i]?.();cleanups[i]=f()})}}
 const mock={useState:state,useRef:v=>state({current:v})[0],useCallback:f=>f,useEffect,
  OperationCoordinator:class{current=null;busy=false;constructor(){coordinator=this}async submit(){submits++;return {id:'venue',group_id:'group'}}async checkSaved(){return {status:'not_confirmed',message:'Request preserved'}}},intentStore:{},restoreStartupRecovery:async()=>({intent:null,acknowledged:null}),
  listGroups:async()=>[],getMyMemberships:async()=>[],listPlayerContexts:async()=>[],getMyMatchups:async()=>null,
  getSetupOptions:async()=>({players:[],venues:[],rules:[],seasons:[]}),listSessions:async()=>[],getStandings:async()=>[],
  chooseGroup:()=>'',readLastGroup:()=>'',rememberGroup:()=>{},RecoveryStorageError:class extends Error{}
 }
 globalThis.__notifications=mock
 globalThis.window={location:{hash:'#/play'},setTimeout:(f,delay)=>{assert.equal(delay,3000);timer=f;return 99},clearTimeout(){},addEventListener(){},removeEventListener(){}}
 globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}}
 const imports=Object.keys(mock).join(',')
 let src=(await read('src/features/connected/useConnectedGame.ts')).replace(/^import .*$/gm,'').replaceAll('import.meta.env.VITE_SUPABASE_URL',"'https://project.example.invalid'")
 src=`const {${imports}}=globalThis.__notifications;\n`+src
 const {useConnectedGame}=await import(url(src))
 const render=()=>{cursor=0;effectCursor=0;const game=useConnectedGame('account','');const pending=jobs;jobs=[];pending.forEach(f=>f());return game}
 render();await new Promise(resolve=>setImmediate(resolve));let game=render()
 assert.equal(game.ready,true)
 const onlineDescriptor=Object.getOwnPropertyDescriptor(navigator,'onLine')
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
 assert.equal(await game.scoring('start_frame',{}),false);assert.equal(submits,0)
 if(onlineDescriptor)Object.defineProperty(navigator,'onLine',onlineDescriptor);else delete navigator.onLine
 game=render();assert.match(game.actionError,/offline/)

 await game.setup('create_venue',{p_group:'group',p_name:'Test venue'});game=render()
 assert.equal(game.notice,'Saved.')
 timer();game=render();assert.equal(game.notice,'')
 await game.setup('create_venue',{p_group:'group',p_name:'Test venue'});game=render();game.dismissNotifications();game=render()
 assert.equal(game.notice,'');assert.equal(game.error,'')
 // Notification dismissal never invokes storage clearing, resend, or coordinator discard.
 coordinator.current=intent();await game.checkSaved();game=render();assert.deepEqual(game.intent,intent())
 game.dismissNotifications();game=render();assert.deepEqual(game.intent,intent());assert.equal(game.lookupNotice,'')
 await new Promise(resolve=>setImmediate(resolve));game=render();await new Promise(resolve=>setImmediate(resolve));game=render()
 assert.equal(game.actionError,'');assert.equal(game.inputBlocked,false)
 assert.equal(await game.setup('create_venue',{p_group:'group',p_name:'Blocked attempt'}),false);game=render()
 assert.match(game.actionError,/previous action/);assert.deepEqual(coordinator.current,intent())
 game.dismissNotifications();game=render();assert.equal(game.actionError,'');assert.deepEqual(game.intent,intent())
})

test('startup clears obsolete removal only with authorized exact-target outcome proof, never by replay',async()=>{
 for(const correct of [true,false]) {
 let clears=0
 const queue=new OperationCoordinator({read:async()=>intent(),remove:async()=>{clears++}},async()=>{throw Error('must not send')})
 const result=await restoreStartupRecovery(queue,'account',async()=>({status:'not_confirmed'}),async()=>{},async()=>({id:correct?'night':'other-night',group_id:'group',removed:true,mode:'abandon'}))
 assert.equal(clears,correct?1:0);assert.equal(result.intent===null,correct)
 }
})
