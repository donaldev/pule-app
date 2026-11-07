import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
let src=await readFile(new URL('../../src/data/remote/receiptService.ts',import.meta.url),'utf8')
src=src.replace("import { getMyInvitations, tokenHash } from './identityService'", "const getMyInvitations=()=>globalThis.__identityReceipt.invites();const tokenHash=async s=>globalThis.__identityReceipt.hash(s)")
 .replace("import { getMyMatchups } from './setupService'",'const getMyMatchups=()=>globalThis.__identityReceipt.catalog()')
 .replace("import { actorAuthorization, getSupabase } from './supabase'",'const actorAuthorization=async id=>{if(id!==globalThis.__identityReceipt.actor)throw Error("Wrong account")};const getSupabase=()=>{}')
 .replace("import { DatabaseOperationError, getSessionState, getSetupOptions, listGroups } from './scoringService'",'class DatabaseOperationError extends Error {};const getSessionState=()=>{};const getSetupOptions=()=>{};const listGroups=()=>{}')
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {reconcileReceipt}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const hash=s=>createHash('sha256').update(s).digest('hex')
const secret='a'.repeat(64)
const i={name:'accept_player_invitation',userId:'recipient',args:{p_token:secret,p_token_hash:hash(secret)}}
const receipt={status:'confirmed_committed',group_id:'matchup',saved:{kind:'setup',entity_id:'sean'}}
const reset=()=>{globalThis.__identityReceipt={actor:'recipient',hash,catalog:async()=>({player_id:'sean',matchups:[{group_id:'matchup',player_ids:['donal','sean']}]}),invites:async()=>[]}}
test('claim receipt reconciles the actual secret digest, own player and explicit matchup membership',async()=>{
 reset();assert.deepEqual(await reconcileReceipt(i,receipt),{id:'sean',group_id:'matchup'})
 await assert.rejects(reconcileReceipt({...i,args:{...i.args,p_token:'b'.repeat(64)}},receipt),/token context/)
 globalThis.__identityReceipt.catalog=async()=>({player_id:'someone-else',matchups:[]});await assert.rejects(reconcileReceipt(i,receipt))
})
test('claim identity without matchup access cannot acknowledge a pending claim',async()=>{
 reset();globalThis.__identityReceipt.catalog=async()=>({player_id:'sean',matchups:[]});await assert.rejects(reconcileReceipt(i,receipt))
})
test('account switching during reconciliation prevents cleanup',async()=>{
 reset();globalThis.__identityReceipt.catalog=async()=>{globalThis.__identityReceipt.actor='other';return {player_id:'sean',matchups:[{group_id:'matchup',player_ids:['donal','sean']}]}}
 await assert.rejects(reconcileReceipt(i,receipt),/Wrong account/)
})
test('invitation creation receipt needs matching player and recipient; revocation needs saved revocation',async()=>{
 reset();globalThis.__identityReceipt.invites=async()=>[{id:'invite',group_id:'matchup',player_id:'sean',email:'sean@example.invalid',revoked:false}]
 const r={...receipt,saved:{kind:'setup',entity_id:'invite'}}
 const intent={name:'create_player_invitation',userId:'recipient',args:{p_player:'sean',p_email:'sean@example.invalid'}}
 await reconcileReceipt(intent,r)
 await assert.rejects(reconcileReceipt({...intent,args:{...intent.args,p_email:'other@example.invalid'}},r))
 await assert.rejects(reconcileReceipt({...intent,name:'revoke_player_invitation'},r))
})
