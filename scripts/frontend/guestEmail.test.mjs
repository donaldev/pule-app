import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
async function load(path,replace=[]){let s=await readFile(new URL(path,import.meta.url),'utf8');for(const [a,b]of replace)s=s.replace(a,b);return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'))}
const api=await load('../../src/data/remote/identityService.ts',[["import { getSupabase } from './supabase'",'const getSupabase=()=>globalThis.__emailMock'],["import { DatabaseOperationError } from './scoringService'",'class DatabaseOperationError extends Error {}']])
const {expectedCommand}=await load('../../src/data/local/receiptRecovery.ts')
test('lookup normalizes email and returns only an authorized player locator',async()=>{
 let args;globalThis.__emailMock={rpc:async(n,a)=>{args={n,a};return{data:{player_id:'existing',display_name:'Alex',group_id:'allowed',email:'private'},error:null}}}
 assert.deepEqual(await api.findGuestByEmail(' Alex@Example.invalid '),{player_id:'existing',display_name:'Alex',group_id:'allowed'})
 assert.deepEqual(args,{n:'find_guest_by_email',a:{p_email:'alex@example.invalid'}})
})
test('new email intent compares normalized full payload while old saved intent stays unchanged',()=>{
 const old={kind:'setup',name:'create_guest',args:{p_group:'g',p_name:'Alex'}}
 assert.deepEqual(expectedCommand(old),{action:'create_guest',group_id:'g',data:{name:'Alex'}})
 assert.deepEqual(expectedCommand({...old,name:'create_guest_with_email',args:{...old.args,p_email:' Alex@Example.invalid '}}),{action:'create_guest',group_id:'g',data:{name:'Alex',email:'alex@example.invalid'}})
})
test('Google discovery has no caller-supplied email and validates a single eligible candidate',async()=>{
 let args;globalThis.__emailMock={rpc:async(n,a)=>{args={n,a};return{data:{status:'eligible',player_id:'existing',player_name:'Alex',matchup_count:2},error:null}}}
 assert.deepEqual(await api.getGuestEmailClaim(),{status:'eligible',player_id:'existing',player_name:'Alex',matchup_count:2})
 assert.deepEqual(args,{n:'get_guest_email_claim',a:{}})
 globalThis.__emailMock={rpc:async()=>({data:{status:'eligible',player_name:'Private'},error:null})};await assert.rejects(api.getGuestEmailClaim())
})
test('a missing discovery migration does not attempt a write or interrupt login',async()=>{
 globalThis.__emailMock={rpc:async()=>({data:null,error:{code:'PGRST202'}})}
 assert.deepEqual(await api.getGuestEmailClaim(),{status:'none'})
 assert.deepEqual(expectedCommand({kind:'setup',name:'claim_guest_email',args:{p_player:'existing'}}),{action:'claim_guest_email',group_id:null,data:{player_id:'existing'}})
})
