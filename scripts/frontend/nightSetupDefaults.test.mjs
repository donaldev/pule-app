import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/connected/nightSetupDefaults.ts', import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {nightSetupDefaults}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('usual known participants and latest dated venue are suggested without writes or mutation',()=>{
 const players=[{player_id:'d'},{player_id:'s'},{player_id:'a'}],venues=[{id:'soho'},{id:'sneaky'}]
 const standings=[{player_id:'s',nights:37},{player_id:'d',nights:37},{player_id:'removed',nights:100}]
 const sessions=[{venue_id:'soho',occurred_on:'2026-10-28'},{venue_id:'sneaky',occurred_on:'2026-11-03'}]
 const before=JSON.stringify([players,venues,standings,sessions])
 assert.deepEqual(nightSetupDefaults(players,venues,standings,sessions),{players:['d','s'],venue:'sneaky'})
 assert.equal(JSON.stringify([players,venues,standings,sessions]),before)
})
test('empty and multiplayer groups without history stay unselected',()=>{
 assert.deepEqual(nightSetupDefaults([],[],[],[]),{players:[],venue:''})
 assert.deepEqual(nightSetupDefaults([{player_id:'a'},{player_id:'b'},{player_id:'c'}],[],[],[]).players,[])
})
test('two known players preselect; unavailable venues and missing dates are ignored',()=>{
 assert.deepEqual(nightSetupDefaults([{player_id:'a'},{player_id:'b'}],[{id:'v'}],[],[{venue_id:'removed',occurred_on:'2026-11-04'},{venue_id:'v',occurred_on:null}]),{players:['a','b'],venue:'v'})
})
