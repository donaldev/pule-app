import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const src=(await readFile(new URL('../../src/data/remote/identityService.ts',import.meta.url),'utf8'))
 .replace("import { getSupabase } from './supabase'",'const getSupabase=()=>globalThis.__identityMock')
 .replace("import { DatabaseOperationError } from './scoringService'",'class DatabaseOperationError extends Error {}')
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('invitation tokens have 256 random bits and only digests are persisted on issue',async()=>{
 const a=await api.newInvitationToken(),b=await api.newInvitationToken()
 assert.match(a.token,/^[a-f0-9]{64}$/);assert.match(a.hash,/^[a-f0-9]{64}$/);assert.notEqual(a.token,b.token);assert.notEqual(a.token,a.hash)
 assert.equal(await api.tokenHash('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
test('personal totals request has no current-rivalry or client-supplied player scope',async()=>{
 let request;globalThis.__identityMock={rpc:async(name,args)=>{request={name,args};return {data:null,error:null}}}
 assert.equal(await api.getPersonalStats(),null);assert.deepEqual(request,{name:'get_my_player_stats',args:{}})
})
test('personal totals fail closed on misleading scope or malformed values',async()=>{
 for(const data of [{player_id:'synthetic',scope:'latest_100'},{player_id:'synthetic',scope:'all_accessible_approved_nights',nights:-1}]){
 globalThis.__identityMock={rpc:async()=>({data,error:null})};await assert.rejects(api.getPersonalStats())
 }
})
