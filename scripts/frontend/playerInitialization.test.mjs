import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
let source=await readFile(new URL('../../src/features/identity/PlayerInitialization.tsx',import.meta.url),'utf8')
source=source.replace(/^import .*$/gm,'')
const prelude=`const useState=v=>{const i=globalThis.h.index++;return [globalThis.h.states[i]??v,()=>{}]};const useRef=v=>({current:v});const useEffect=f=>globalThis.h.effects.push(f);const useEffectEvent=f=>f;const getMyPlayerInitialization=async()=>globalThis.h.status;const React={createElement:(type,props,...children)=>({type,props:props??{},children})};`
const code=ts.transpileModule(prelude+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
const {PlayerInitialization}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
function render({linked=false,route='/play',outcome=null,status={status:'initialize',name:'Google Person'},intent=null}={}){
 const calls=[];globalThis.h={index:0,states:[outcome],effects:[],status}
 const game={ready:true,userId:'actor',matchupCatalog:{player_id:linked?'existing':null},intent,setup:async(...args)=>{calls.push(args);return true}}
 const tree=PlayerInitialization({game,route,claimPrompt:'EXISTING CLAIM',children:'APP'})
 return {tree,calls,effects:globalThis.h.effects}
}
test('linked identities and invitation routes preserve existing app without initialization',()=>{
 for(const args of [{linked:true},{route:'/claim/token'}]){const r=render(args);assert.equal(r.tree,'APP');r.effects.forEach(f=>f());assert.equal(r.calls.length,0)}
})
test('confirmed profile initializes using caller-only setup operation',async()=>{
 const r=render();r.effects.forEach(f=>f());await new Promise(r=>setImmediate(r));assert.deepEqual(r.calls,[['initialize_my_player',{p_name:'Google Person'}]])
})
test('missing profile name waits for minimal input without creating a player',async()=>{
 const r=render({outcome:{status:'name_required'},status:{status:'name_required'}});assert.match(JSON.stringify(r.tree),/What should we call you/);r.effects.forEach(f=>f());await new Promise(r=>setImmediate(r));assert.equal(r.calls.length,0)
})
test('guest claim conflict retains original claim prompt and never initializes',async()=>{
 const r=render({outcome:{status:'claim_required'},status:{status:'claim_required'}});assert.match(JSON.stringify(r.tree),/EXISTING CLAIM/);r.effects.forEach(f=>f());await new Promise(r=>setImmediate(r));assert.equal(r.calls.length,0)
})
test('pending recovery blocks initialization but Account remains reachable',()=>{
 const r=render({intent:{id:'pending'}});r.effects.forEach(f=>f());assert.equal(r.calls.length,0);assert.match(JSON.stringify(r.tree),/Open Account/);assert.equal(render({intent:{id:'pending'},route:'/account'}).tree,'APP')
})
test('unconfirmed accounts receive confirmation state without creating an identity',async()=>{
 const r=render({outcome:{status:'confirmation_required'},status:{status:'confirmation_required'}});assert.match(JSON.stringify(r.tree),/Confirm your email/);r.effects.forEach(f=>f());await new Promise(r=>setImmediate(r));assert.equal(r.calls.length,0)
})
test('effect cleanup and replay reuse one initialization promise',async()=>{
 const r=render();const cleanup=r.effects[0]();cleanup();r.effects[0]();await new Promise(r=>setImmediate(r));assert.equal(r.calls.length,1)
})
let serviceSource=await readFile(new URL('../../src/data/remote/playerInitializationService.ts',import.meta.url),'utf8')
serviceSource=serviceSource.replace("import { actorAuthorization, getSupabase } from './supabase'",`const actorAuthorization=async uid=>{if(uid!==globalThis.service.actor)throw Error('Wrong account');return 'Bearer caller'};const getSupabase=()=>({rpc:(name,args)=>{globalThis.service.request={name,args};return {setHeader:(name,value)=>{globalThis.service.header={name,value};return {retry:()=>({abortSignal:async()=>({data:globalThis.service.data,error:globalThis.service.error})})}}}}})`)
const serviceCode=ts.transpileModule(serviceSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {getMyPlayerInitialization}=await import('data:text/javascript;base64,'+Buffer.from(serviceCode).toString('base64'))
test('state read pins caller authorization and sends no user or player identifiers',async()=>{
 globalThis.service={actor:'user',data:{status:'linked',id:'player',group_id:'origin'}}
 assert.deepEqual(await getMyPlayerInitialization('user'),globalThis.service.data)
 assert.deepEqual(globalThis.service.request,{name:'get_my_player_initialization',args:{}})
 assert.deepEqual(globalThis.service.header,{name:'Authorization',value:'Bearer caller'})
 await assert.rejects(getMyPlayerInitialization('other'),/Wrong account/)
})
test('malformed state and failed reads fail closed',async()=>{
 for(const data of [null,{},[],{status:'linked',id:'player'},{status:'initialize',name:''}]){
 globalThis.service={actor:'user',data};await assert.rejects(getMyPlayerInitialization('user'),/Invalid account/)
 }
 globalThis.service={actor:'user',error:{message:'private diagnostic'}};await assert.rejects(getMyPlayerInitialization('user'),/could not be checked/)
})
