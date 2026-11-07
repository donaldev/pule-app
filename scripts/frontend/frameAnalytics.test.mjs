import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../../src/features/stats/frameAnalytics.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {frameAnalytics}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const night=(id='n',date='2026-01-01',p=3,q=2)=>({id,date,instant:null,participants:[{player_id:'p',name:'Player',frames_won:p},{player_id:'q',name:'Opponent',frames_won:q}]})
const frame=(number,winner='p',overrides={})=>({id:`f${number}`,number,winner,breaker:'p',break_pot:true,event:'regular',pocket:'TL',elapsed_ms:60000,duration_quality:'server_measured',players:[{id:'p',fouls:0},{id:'q',fouls:0}],...overrides})
const detail=(frames,id='n',overrides={})=>({id,date:'2026-01-01',sequence_quality:'reconciled',detail_eligible:true,recorded_frame_count:frames.length,frames,...overrides})
test('score-only history contributes score records but never fabricated detailed observations',()=>{
 const a=frameAnalytics([night('a',undefined,12,5),night('b','2026-02-01',10,9)],[],'p')
 assert.equal(a.records.mostFrames,12);assert.equal(a.records.biggestMargin,7);assert.equal(a.records.closestWin,1)
 assert.equal(a.records.longestFrameRun,null);assert.equal(a.breaks.pot.percent,null);assert.equal(a.style.fouls,null)
 assert.equal(a.coverage.frames,0)
})
test('break denominators exclude unknown observations; holds and steals use recorded outcomes',()=>{
 const frames=[frame(1,'q',{break_pot:false}),frame(2,'q',{break_pot:null}),frame(3,'p',{breaker:'q'}),frame(4,'p',{event:'golden_break'}),frame(5,'p',{event:'break_and_run'})]
 const a=frameAnalytics([night()],[detail(frames)],'p')
 assert.equal(a.breaks.recorded,4);assert.equal(a.breaks.pot.total,3);assert.equal(a.breaks.pot.won,2)
 assert.equal(a.breaks.hold.percent,50);assert.equal(a.breaks.steal.percent,100)
 assert.equal(a.breaks.goldenBreaks,1);assert.equal(a.breaks.breakRuns,1)
 assert.equal(a.records.longestFrameRun,3);assert.equal(a.records.biggestComeback,2);assert.equal(a.records.winsAfterTrailing,1)
})
test('duration, fouls, events and pockets include only recorded selected-player samples',()=>{
 const frames=[frame(1,'q',{elapsed_ms:100000,players:[{id:'p',fouls:1},{id:'q',fouls:0}]}),frame(2,'q',{elapsed_ms:null,duration_quality:'unknown',players:[{id:'p',fouls:null},{id:'q',fouls:0}]}),frame(3),frame(4,'p',{elapsed_ms:30000,duration_quality:'imported_unverified',pocket:'TM',players:[{id:'p',fouls:2},{id:'q',fouls:0}]}),frame(5,'p',{elapsed_ms:0,duration_quality:'unknown',pocket:null,event:null,players:[{id:'p',fouls:null},{id:'q',fouls:0}]})]
 const a=frameAnalytics([night()],[detail(frames)],'p')
 assert.equal(a.style.averageWinMs,45000);assert.equal(a.style.fastestWinMs,30000);assert.equal(a.style.longestMs,100000)
 assert.equal(a.style.fouls,3);assert.equal(a.coverage.fouls,3);assert.equal(a.coverage.unverifiedTimes,1)
 assert.deepEqual(a.style.pockets,{TL:1,TM:1});assert.equal(a.coverage.pockets,2);assert.deepEqual(a.style.types,{regular:2})
})
test('partial, disputed, missing-winner and unreconciled detail cannot fabricate streaks or comebacks',()=>{
 const frames=[frame(1),frame(2)]
 for(const d of [detail(frames,'n',{recorded_frame_count:3}),detail(frames,'n',{sequence_quality:'partial'}),detail([frame(1,null)]),detail([frame(1),frame(3)])])assert.equal(frameAnalytics([night('n',undefined,2,0)],[d],'p').records.longestFrameRun,null)
 const a=frameAnalytics([night('n',undefined,12,5)],[detail(frames,'n',{detail_eligible:false,sequence_quality:'disputed'})],'p')
 assert.equal(a.records.mostFrames,12);assert.equal(a.coverage.frames,0)
})
test('frame runs bridge only complete unambiguous nights; score-only gaps break the run',()=>{
 const a=night('a','2026-01-01',2,0),b=night('b','2026-01-03',2,0)
 const details=[detail([frame(1),frame(2)],'a'),detail([frame(1,'p',{id:'b1'}),frame(2,'p',{id:'b2'})],'b')]
 assert.equal(frameAnalytics([a,b],details,'p').records.longestFrameRun,4)
 assert.equal(frameAnalytics([a,night('gap','2026-01-02',8,1),b],details,'p').records.longestFrameRun,2)
 assert.equal(frameAnalytics([a,{...b,date:a.date}],details,'p').records.longestFrameRun,2)
})
test('multiplayer sits out other pairs and never becomes an ordinary comeback or winning margin',()=>{
 const n=night('m',undefined,1,1);n.participants.push({player_id:'r',name:'Third',frames_won:0})
 const a=frameAnalytics([n],[detail([frame(1),frame(2,'q',{id:'other-pair',players:[{id:'q',fouls:0},{id:'r',fouls:0}],breaker:'q'})],'m')],'p')
 assert.equal(a.records.biggestMargin,null);assert.equal(a.records.biggestComeback,null);assert.equal(a.coverage.frames,1);assert.equal(a.records.longestFrameRun,1)
})
test('unknown metadata stays unknown and duplicate canonical IDs fail closed',()=>{
 const unknown=frame(1,null,{breaker:null,break_pot:null,event:null,pocket:null,elapsed_ms:null,duration_quality:'unknown',players:[{id:'p',fouls:null},{id:'q',fouls:null}]})
 const a=frameAnalytics([night('n',undefined,0,0)],[detail([unknown])],'p')
 assert.equal(a.breaks.pot.total,0);assert.equal(a.breaks.goldenBreaks,null);assert.equal(a.style.averageWinMs,null)
 assert.throws(()=>frameAnalytics([night()],[detail([frame(1),frame(1)])],'p'),/Duplicate frame/)
})
test('visible Records, Break Performance and Playing Style render populated observations',async()=>{
 let values=[],cursor=0,effects=[]
 const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
 const frames=[frame(1,'q'),frame(2,'q'),frame(3,'p',{breaker:'q'}),frame(4,'p',{event:'golden_break'}),frame(5,'p',{event:'break_and_run'})]
 globalThis.__detailUi={React,frameAnalytics,getFrameSummary:async()=>[detail(frames)],useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next}]},useEffect(fn){if(!effects.length)effects.push(fn)}}
 const src=(await readFile(new URL('../../src/features/stats/FrameAnalyticsSections.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
 const js=ts.transpileModule('const {React,frameAnalytics,getFrameSummary,useState,useEffect}=globalThis.__detailUi; const displayDate=value=>value??"Date unavailable";\n'+src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
 const {FrameAnalyticsSections}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
 const render=()=>{cursor=0;return FrameAnalyticsSections({nights:[night()],playerId:'p'})}
 render();effects[0]();await new Promise(resolve=>setImmediate(resolve));const tree=render()
 const nodes=n=>n&&typeof n==='object'?[n,...(typeof n.type==='function'?[n.type(n.props)]:n.children).flatMap(nodes)]:[]
 const all=nodes(tree),text=n=>typeof n==='object'&&n?n.children.map(text).join(' '):String(n??'')
 assert.deepEqual(all.filter(n=>n.type==='h2').map(n=>text(n)),['My records','Break performance','Frame performance','Your frame wins by type','Black-ball pockets in your wins'])
 assert.ok(all.some(n=>n.type==='dt'&&text(n)==='Wins after trailing'))
 assert.ok(all.some(n=>n.type==='span'&&text(n)==='Break hold'))
 assert.ok(all.some(n=>n.type==='strong'&&/50\.0\s*%/.test(text(n))))
 assert.ok(all.some(n=>n.type==='dt'&&text(n)==='Average winning-frame duration'))
 assert.ok(all.some(n=>n.type==='h2'&&text(n)==='Black-ball pockets in your wins'))
 assert.equal(all.filter(n=>n.props.className==='stats-pocket').length,6)
 assert.equal(all.filter(n=>n.type==='circle').length,2)
 assert.ok(all.some(n=>n.props['data-orientation']==='break-left-rack-right'))
 assert.ok(all.some(n=>n.props.className==='stats-pocket'&&/\d+\.\d%/.test(text(n))))
 assert.ok(all.some(n=>n.props.className==='stat-track'))
})
const serviceSource=(await readFile(new URL('../../src/data/remote/framePerformanceService.ts',import.meta.url),'utf8')).replace("import { getSupabase } from './supabase'",'const getSupabase=()=>globalThis.__frameSummaryMock')
const serviceCode=ts.transpileModule(serviceSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {getFrameSummary}=await import('data:text/javascript;base64,'+Buffer.from(serviceCode).toString('base64'))
test('frame read sends no player identity and preserves optional exact-opponent scope',async()=>{
 let request;globalThis.__frameSummaryMock={rpc:async(name,args)=>{request={name,args};return {data:{player_id:'p',nights:[detail([frame(1)])]},error:null}}}
 assert.equal((await getFrameSummary('p','q')).length,1)
 assert.deepEqual(request,{name:'get_my_frame_summary',args:{p_opponent:'q'}})
 await assert.rejects(getFrameSummary('someone-else'))
})
test('missing frame RPC stays unavailable; duplicate/ineligible response data is rejected',async()=>{
 globalThis.__frameSummaryMock={rpc:async()=>({data:null,error:{code:'PGRST202'}})}
 assert.equal(await getFrameSummary('p'),null)
 for(const d of [detail([frame(1),frame(1)]),detail([frame(1)],'n',{detail_eligible:false})]){
 globalThis.__frameSummaryMock={rpc:async()=>({data:{player_id:'p',nights:[d]},error:null})}
 await assert.rejects(getFrameSummary('p'))
 }
})

test('pocket percentages retain mapping, sample count and tap selection without changing observations',async()=>{
 const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
 let selected=null
 globalThis.__pocketUi={React,useState:()=>[selected,next=>{selected=next}]}
 const src=(await readFile(new URL('../../src/features/stats/FrameAnalyticsSections.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
 const js=ts.transpileModule('const {React,useState}=globalThis.__pocketUi;\n'+src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
 const {PocketDistribution}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
 const counts={TL:1,TM:2,TR:0,BL:0,BM:0,BR:0},before=JSON.stringify(counts)
 const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
 const text=n=>n&&typeof n==='object'?n.children.map(text).join(' '):String(n??'')
 let all=nodes(PocketDistribution({counts,total:3}))
 const buttons=all.filter(n=>n.type==='button');assert.equal(buttons.length,6)
 assert.equal(text(buttons[0]),'33.3%');assert.equal(text(buttons[1]),'66.7%')
 assert.equal(buttons[0].props['data-most-used'],false);assert.equal(buttons[1].props['data-most-used'],true)
 buttons[1].props.onClick();all=nodes(PocketDistribution({counts,total:3}))
 assert.ok(all.some(n=>n.props.role==='status'&&text(n).includes('Top middle · 2 of 3 wins · 66.7%')))
 assert.equal(all.filter(n=>n.props['aria-pressed']===true).length,1)
 assert.equal(JSON.stringify(counts),before)
})
