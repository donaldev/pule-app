import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/connected/matchupPresentation.ts', import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {participantKey,playerContextLabel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const d='acc51043-01a0-507d-8fdd-ae0729e9fe68',s='5c575a65-aa80-590a-843a-0dfc7d5c1d89',a='synthetic-alan'
test('historical participant order does not change the exact set; source ids remain untouched',()=>{
 const ids=[d,s];assert.equal(participantKey(ids),participantKey([s,d]));assert.deepEqual(ids,[d,s])
})
test('different opponents and multiplayer combinations remain distinct',()=>{
 assert.notEqual(participantKey([d,a]),participantKey([d,s]))
 assert.notEqual(participantKey([d,s,a]),participantKey([d,s]))
 assert.equal(participantKey([a,d,s]),participantKey([s,a,d]))
})
test('invalid or duplicate participant identities cannot define a matchup',()=>{
 for(const ids of [[],[d],[d,d],[d,'']])assert.equal(participantKey(ids),null)
})
test('duplicate names never merge identities and labels do not use legacy container names',()=>{
 assert.notEqual(participantKey([d,s]),participantKey([d,a]))
 assert.equal(playerContextLabel([{display_name:'Alex'},{display_name:'Alex'}]),'Alex + Alex')
 assert.equal(playerContextLabel([]),'Available matches')
})
