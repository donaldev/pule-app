import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../../src/app/matchNavigation.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {matchSessionId,nextMatchLocation,historyReturnPath,activeNavigation}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const session='/session/11111111-1111-1111-1111-111111111111'
test('History entry retains personal/group origin while loading and after completion',()=>{
 for(const route of ['/matches','/matches/personal','/matches/group']){
 const next=nextMatchLocation({route,origin:'/play'},session)
 assert.equal(activeNavigation(next.route,undefined,next.origin),'/matches')
 assert.equal(activeNavigation(next.route,'finalized',next.origin),'/matches')
 assert.equal(historyReturnPath(next.origin),route)
 }
})
test('active sessions retain Play and tab switching cannot inherit session highlighting',()=>{
 const before={route:'/play',origin:'/matches'};const next=nextMatchLocation(before,session)
 assert.equal(activeNavigation(next.route,'active',next.origin),'/play')
 for(const tab of ['/account','/home','/stats','/matches'])assert.equal(activeNavigation(tab,'active',next.origin),tab)
 assert.deepEqual(before,{route:'/play',origin:'/matches'})
 assert.equal(activeNavigation(session,'active','/matches/personal'),'/play')
})
test('direct completed links default to History, unchanged session URLs remain compatible',()=>{
 assert.equal(activeNavigation(session,'finalized','/play'),'/matches')
 assert.equal(historyReturnPath('/account'),'/matches');assert.equal(historyReturnPath('https://example.com'),'/matches')
 assert.equal(matchSessionId(session),'11111111-1111-1111-1111-111111111111');assert.equal(matchSessionId('/session/bad'),'')
 assert.equal(activeNavigation('/stats/personal'),'/stats');assert.equal(activeNavigation('/standings'),'/stats')
})
