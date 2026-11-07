import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8')
const url=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')
const performanceUrl=url(await read('src/features/stats/performance.ts'))
const {rivalryOpponents,rivalryRecord}=await import(url((await read('src/features/stats/rivalry.ts')).replace("'./performance'",JSON.stringify(performanceUrl))))
const night=(i,own,other,opponent='opponent')=>({id:`night-${i}`,date:`2026-01-${String(i).padStart(2,'0')}`,instant:null,participants:[{player_id:'me',name:'You',frames_won:own},{player_id:opponent,name:'Same name',frames_won:other}]})
test('one opponent needs no selector; default is most completed nights and names never merge identities',()=>{
 assert.equal(rivalryOpponents([night(1,2,1)],'me').length,1)
 const options=rivalryOpponents([night(1,2,1,'a'),night(2,2,1,'b'),night(3,2,1,'b')],'me')
 assert.equal(options.length,2);assert.equal(options[0].id,'b');assert.equal(options[0].nights,2)
 assert.equal(options[0].name,options[1].name)
})
test('only exact two-player identities count; multiplayer and unrelated players are excluded',()=>{
 const multi=night(2,3,1);multi.participants.push({player_id:'third',name:'Third',frames_won:2})
 const unrelated=night(3,4,1);unrelated.participants[0].player_id='someone-else'
 const rows=[night(1,5,3),multi,unrelated]
 assert.equal(rivalryRecord(rows,'me','opponent').nights,1)
 assert.deepEqual(rivalryOpponents(rows,'me').map(x=>x.id),['opponent'])
})
test('official score-only scores, draws, newest-first form and chronological progression',()=>{
 const rows=[night(3,8,8),night(1,10,5),night(2,4,9)]
 const record=rivalryRecord(rows,'me','opponent')
 assert.deepEqual([record.wins,record.losses,record.draws,record.nights],[1,1,1,3])
 assert.equal(record.forFrames,22);assert.equal(record.againstFrames,22);assert.equal(record.winRate,50)
 assert.deepEqual(record.progress.recent.map(n=>n.id),['night-3','night-2','night-1'])
 assert.deepEqual(record.progress.series.map(p=>[p.wins,p.losses]),[[1,0],[1,1],[1,1]])
})
test('repeat sporting IDs count once, conflicts fail closed, last ten bounded and input unchanged',()=>{
 const rows=Array.from({length:12},(_,i)=>night(i+1,2,1)),before=JSON.stringify(rows)
 const record=rivalryRecord([...rows,rows[0]],'me','opponent')
 assert.equal(record.nights,12);assert.equal(record.progress.recent.length,10);assert.equal(record.progress.recent[0].id,'night-12')
 assert.equal(JSON.stringify(rows),before)
 assert.throws(()=>rivalryRecord([rows[0],{...rows[0],participants:night(1,99,1).participants}],'me','opponent'),/Conflicting/)
})
test('unknown scores, unavailable chronology and empty history do not invent wins or ordering',()=>{
 const missing=night(1,null,2);missing.date=null
 const record=rivalryRecord([missing],'me','opponent')
 assert.equal(record.forFrames,null);assert.equal(record.winRate,null);assert.equal(record.progress.series.length,0)
 assert.deepEqual(rivalryOpponents([],'me'),[])
 assert.equal(rivalryRecord([],'me','opponent').nights,0)
})
test('reviewed historical rivalry retains 37 official nights and 407–351 without detailed-frame invention',async t=>{
 let p;try{p=JSON.parse(await readFile(new URL('../../data/legacy/validation-nov-4/proposed-records.json',import.meta.url),'utf8'))}catch(error){if(error.code==='ENOENT'){t.skip('private fixture not present');return}throw error}
 const own=p.players.find(x=>x.source_label==='Donal').id,other=p.players.find(x=>x.source_label==='Sean').id
 const rows=p.sessions.map(s=>({id:s.id,date:s.occurred_on,instant:null,participants:s.participants.map(player=>({player_id:player.player_id,name:p.players.find(x=>x.id===player.player_id).source_label,frames_won:p.historical_reported_results.find(r=>r.session_id===s.id&&r.player_id===player.player_id).frames_won}))}))
 const record=rivalryRecord(rows,own,other)
 assert.deepEqual([record.nights,record.wins,record.losses,record.draws,record.forFrames,record.againstFrames],[37,19,13,5,407,351])
 assert.equal(record.progress.recent[0].date,'2026-11-03')
 assert.equal(record.progress.series.at(-1).wins,19);assert.equal(record.progress.series.at(-1).losses,13)
})
test('date-only ties are grouped in progression and never split at the last-ten boundary',()=>{
 const rows=Array.from({length:11},(_,i)=>night(i+1,2,1));rows[1].date=rows[0].date
 const record=rivalryRecord(rows,'me','opponent')
 assert.equal(record.progress.sameDay,true);assert.equal(record.progress.series.length,10)
 assert.equal(record.progress.series[0].wins,2);assert.equal(record.progress.series.at(-1).night,11)
 assert.equal(record.progress.recent.length,11)
})
