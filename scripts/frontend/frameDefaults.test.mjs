import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/connected/frameDefaults.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { frameDefaults } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const state = (frames = []) => ({ session: { initial_breaker_id: 'b' }, participants: [{player_id:'a',side:1},{player_id:'b',side:2}], frames })
test('two players are preselected and opening breaker comes from saved session', () => {
  assert.deepEqual(frameDefaults(state()), {pair:['a','b'],breaker:'b'})
})
test('alternates latest saved breaker by frame number regardless of winner or response order', () => {
  const s = state([{frame_number:2,status:'completed',breaker_id:'a',winner_id:'a'},{frame_number:1,status:'completed',breaker_id:'b',winner_id:'a'}])
  assert.equal(frameDefaults(s).breaker,'b')
  s.frames[0].winner_id='b'
  assert.equal(frameDefaults(s).breaker,'b')
})
test('uses actual manual override rather than initial-breaker parity', () => {
  assert.equal(frameDefaults(state([{frame_number:2,status:'completed',breaker_id:'b'}])).breaker,'a')
})
test('missing latest breaker requires explicit choice; voided frames are ignored', () => {
  assert.equal(frameDefaults(state([{frame_number:1,status:'completed',breaker_id:null}])).breaker,'')
  assert.equal(frameDefaults(state([{frame_number:2,status:'voided',breaker_id:'a'},{frame_number:1,status:'completed',breaker_id:'b'}])).breaker,'a')
})
test('three-player setup remains manual and suggestions do not mutate saved history', () => {
  const s=state();s.participants.push({player_id:'c',side:3});const before=JSON.stringify(s)
  assert.deepEqual(frameDefaults(s),{pair:['',''],breaker:''});assert.equal(JSON.stringify(s),before)
})

test('both initial breakers alternate over five saved frames, surviving reload, navigation and earlier edits',()=>{
 for(const initial of ['a','b']){
 let saved=state();saved.session.initial_breaker_id=initial
 for(let number=1;number<=5;number++){
  const expected=number%2===1?initial:initial==='a'?'b':'a'
  assert.equal(frameDefaults(saved).breaker,expected)
  saved.frames.push({frame_number:number,status:'completed',breaker_id:expected,winner_id:number%3===0?'a':'b'})
  saved=JSON.parse(JSON.stringify(saved)) // reconstructed persisted state after reload/navigation
  const before=frameDefaults(saved);saved.frames[0].winner_id=number%2?'b':'a';assert.deepEqual(frameDefaults(saved),before)
 }
 assert.equal(frameDefaults(saved).breaker,initial==='a'?'b':'a')
 }
})
