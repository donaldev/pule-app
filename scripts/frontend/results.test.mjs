import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const src=await readFile(new URL('../../src/features/results/presentation.ts',import.meta.url),'utf8')
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {displayDate,frameRate,rankPlayers,nightOutcome,headToHead}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const row=(player_id,wins,frames_won,frames_lost)=>({player_id,display_name:player_id,wins,frames_won,frames_lost})
const night=(a,b,kind='result_only')=>({session:{status:'finalized',result_quality:'approved',record_kind:kind},participants:[{player_id:'d',display_name:'Donal'},{player_id:'s',display_name:'Sean'}],scores:{d:a,s:b},frames:[]})
test('human dates retain date-only day; unknown rate is not zero',()=>{
 assert.equal(displayDate('2026-11-03'),'3 Nov 2026');assert.equal(displayDate(null),'Date not recorded')
 assert.equal(frameRate(407,351).toFixed(1),'53.7');assert.equal(frameRate(0,0),null);assert.equal(frameRate(4,null),null)
})
test('ranking order and competition ties are stable without mutating source',()=>{
 const rows=[row('C',2,20,10),row('A',3,10,9),row('B',2,20,10),row('D',2,20,15)]
 assert.deepEqual(rankPlayers(rows).map(p=>[p.player_id,p.rank]),[['A',1],['B',2],['C',2],['D',4]])
 assert.equal(rows[0].player_id,'C')
})
test('unknown difference sorts after known difference when other ranking metrics tie',()=>{
 assert.deepEqual(rankPlayers([row('A',1,5,null),row('B',1,5,8)]).map(p=>p.player_id),['B','A'])
})
test('official result-only and tracked scores count once, never adding raw frames',()=>{
 const a=night(12,5),b=night(16,16,'frame_log');b.frames=Array(32).fill({winner_id:'s'})
 assert.deepEqual(headToHead([a,b],'d','s'),{nights:2,wins:1,losses:0,draws:1,forFrames:28,againstFrames:21})
 assert.equal(nightOutcome(a),'Donal won');assert.equal(nightOutcome(b),'Draw')
})
test('head-to-head excludes active, unapproved, missing scores and multiplayer nights',()=>{
 const active=night(0,0);active.session.status='active'
 const disputed=night(9,3);disputed.session.result_quality='disputed'
 const multi=night(4,3);multi.participants.push({player_id:'a',display_name:'Alan'});multi.scores.a=2
 const unknown=night(null,3)
 assert.equal(headToHead([active,disputed,multi,unknown],'d','s').nights,0)
 assert.equal(nightOutcome(active),'In progress');assert.equal(nightOutcome(unknown),'Result not recorded')
 assert.equal(nightOutcome(multi),'Donal · top score')
 multi.scores.s=4;assert.equal(nightOutcome(multi),'Shared top score')
})
test('private reviewed 37-night fixture preserves official PonDon H2H baseline',async t=>{
 let p;try{p=JSON.parse(await readFile(new URL('../../data/legacy/validation-nov-4/proposed-records.json',import.meta.url),'utf8'))}catch(e){if(e.code==='ENOENT'){t.skip('private fixture not present');return}throw e}
 const names=new Map(p.players.map(x=>[x.id,x.source_label]))
 const states=p.sessions.map(s=>({session:{status:s.status,result_quality:'approved'},participants:s.participants.map(x=>({...x,display_name:names.get(x.player_id)})),scores:Object.fromEntries(p.historical_reported_results.filter(r=>r.session_id===s.id).map(r=>[r.player_id,r.frames_won])),frames:[]}))
 const d=p.players.find(x=>x.source_label==='Donal').id,s=p.players.find(x=>x.source_label==='Sean').id
 assert.deepEqual(headToHead(states,d,s),{nights:37,wins:19,losses:13,draws:5,forFrames:407,againstFrames:351})
})
test('night victories outrank every frame margin; fewer losses break equal night wins',()=>{
 const rows=[{...row('Margin',1,100,0),losses:0},{...row('Nights',2,10,9),losses:20},{...row('Fewer losses',2,5,4),losses:2}]
 assert.deepEqual(rankPlayers(rows).map(p=>p.player_id),['Fewer losses','Nights','Margin'])
 assert.equal(frameRate(19,13).toFixed(1),'59.4')
 assert.equal(frameRate(13,19).toFixed(1),'40.6')
})
