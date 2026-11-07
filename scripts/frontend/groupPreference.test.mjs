import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const src=await readFile(new URL('../../src/features/connected/groupPreference.ts',import.meta.url),'utf8')
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {chooseGroup,readLastGroup,rememberGroup}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('single group opens directly; no groups produces onboarding selection',()=>{
 assert.equal(chooseGroup([{id:'p'}],'',''),'p')
 assert.equal(chooseGroup([],'removed','removed'),'')
})
test('current authorized group survives navigation; remembered group restores on refresh',()=>{
 const groups=[{id:'a'},{id:'b'}]
 assert.equal(chooseGroup(groups,'b','a'),'b')
 assert.equal(chooseGroup(groups,'','b'),'b')
})
test('stale and forged preferences never select outside server-authorized groups',()=>{
 assert.equal(chooseGroup([{id:'allowed'}],'forged','revoked'),'allowed')
 assert.equal(chooseGroup([],'forged','revoked'),'')
})
test('UI preference is account/project scoped by caller key and storage failure is harmless',()=>{
 const m=new Map();globalThis.window={localStorage:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}}
 rememberGroup('project:user-a','p');rememberGroup('project:user-b','q')
 assert.equal(readLastGroup('project:user-a'),'p');assert.equal(readLastGroup('project:user-b'),'q')
 globalThis.window={get localStorage(){throw Error('blocked')}}
 assert.equal(readLastGroup('project:user-a'),'');assert.doesNotThrow(()=>rememberGroup('project:user-a','p'))
})
