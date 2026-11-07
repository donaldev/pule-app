import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../../src/features/stats/performance.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {performance,resultFor,ratio}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const totals={player_id:'me',nights:0,wins:0,losses:0,draws:0,frames_won:0,frames_lost:0}
const night=(i,a,b,other='opponent')=>({id:String(i),date:`2026-01-${String(i).padStart(2,'0')}`,instant:null,participants:[{player_id:'me',name:'Me',frames_won:a},{player_id:other,name:other,frames_won:b}]})
test('saved official score-only and native scores produce W/L/D, never raw-frame additions',()=>{
 assert.equal(resultFor(night(1,10,5),'me'),'W');assert.equal(resultFor(night(2,5,10),'me'),'L');assert.equal(resultFor(night(3,8,8),'me'),'D')
 assert.equal(ratio(19,13),59.375);assert.equal(ratio(407,351),407/758*100)
})
test('current/longest streaks reset on draws and losses, recent form is newest first',()=>{
 const rows=[night(1,2,1),night(2,2,1),night(3,1,1),night(4,1,2),night(5,2,1,'second-opponent')]
 const p=performance({...totals,nights:5,frames_won:8,frames_lost:6},rows.toReversed())
 assert.equal(p.current,1);assert.equal(p.longest,2);assert.deepEqual(p.recent.map(n=>n.id),['5','4','3','2','1'])
 assert.equal(p.avgWon,1.6);assert.equal(p.avgLost,1.2);assert.deepEqual(p.series.at(-1),{night:5,wins:3,losses:1,date:'2026-01-05'})
})
test('last ten includes different opponents and multiplayer without fabricating W/L/D',()=>{
 const rows=Array.from({length:12},(_,i)=>night(i+1,2,1,`opponent-${i}`));rows[5].participants.push({player_id:'third',name:'Third',frames_won:3})
 const p=performance({...totals,nights:12},rows)
 assert.equal(resultFor(rows[5],'me'),'M');assert.equal(p.recent.length,10);assert.equal(p.recent[0].id,'12');assert.equal(p.recent.at(-1).id,'3');assert.equal(p.current,11);assert.equal(p.series.length,11)
})
test('empty, unavailable, partial dates and unknown losses stay honest',()=>{
 const empty=performance(totals,[]);assert.equal(empty.avgWon,null);assert.equal(empty.current,0);assert.equal(ratio(0,0),null)
 assert.equal(performance(totals,null).current,null)
 const missing=night(1,2,1);missing.date=null
 assert.equal(performance({...totals,nights:1},[missing]).current,null)
 assert.equal(performance({...totals,nights:1,frames_lost:null},[night(1,2,1)]).avgLost,null)
 const same=night(1,2,1);same.id='other'
 assert.equal(performance({...totals,nights:2},[same,night(1,2,1)]).ordered,false)
})
const serviceSource=(await readFile(new URL('../../src/data/remote/performanceService.ts',import.meta.url),'utf8'))
 .replace("import { getSupabase } from './supabase'",'const getSupabase=()=>globalThis.__performanceMock')
 .replace("import { getPersonalStats, type PersonalStats } from './identityService'",'const getPersonalStats=async()=>globalThis.__personalTotals')
const serviceCode=ts.transpileModule(serviceSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {getPersonalPerformance}=await import('data:text/javascript;base64,'+Buffer.from(serviceCode).toString('base64'))
const completeTotals={...totals,display_name:'Me',multiplayer_nights:0,matchups:1,scope:'all_accessible_approved_nights'}
test('performance read uses caller identity only and rejects duplicate or incomplete night coverage',async()=>{
 let request
 globalThis.__performanceMock={rpc:async(name,args)=>{request={name,args};return {data:{totals:{...completeTotals,nights:1},nights:[night(1,2,1)]},error:null}}}
 assert.equal((await getPersonalPerformance()).nights.length,1)
 assert.deepEqual(request,{name:'get_my_performance',args:{}})
 for(const rows of [[],[night(1,2,1),night(1,2,1)]]) {
 globalThis.__performanceMock={rpc:async()=>({data:{totals:{...completeTotals,nights:rows.length||1},nights:rows},error:null})}
 await assert.rejects(getPersonalPerformance())
 }
})
test('missing read migration retains complete totals and does not substitute limited match history',async()=>{
 globalThis.__personalTotals=completeTotals
 globalThis.__performanceMock={rpc:async()=>({data:null,error:{code:'PGRST202'}})}
 assert.deepEqual(await getPersonalPerformance(),{totals:completeTotals,nights:null})
})

test('recent-form display order never reverses cumulative progress or mutates history',()=>{
 const rows=[night(3,1,1),night(1,4,2),night(2,2,4)],before=JSON.stringify(rows)
 const p=performance({...totals,nights:3},rows)
 assert.deepEqual(p.recent.map(n=>n.id),['3','2','1'])
 assert.deepEqual(p.series.map(n=>[n.wins,n.losses]),[[1,0],[1,1],[1,1]])
 assert.equal(JSON.stringify(rows),before)
})

test('same-day date-only nights retain recent form and grouped progress, with honest streak ranges',()=>{
 const a=night(1,3,1),b={...night(1,1,3),id:'b'},c=night(2,3,1)
 const p=performance({...totals,nights:3},[c,b,a])
 assert.equal(p.ordered,false)
 assert.deepEqual(p.series,[{night:2,wins:1,losses:1,date:'2026-01-01'},{night:3,wins:2,losses:1,date:'2026-01-02'}])
 assert.equal(p.recent[0].id,'2');assert.equal(p.recent.length,3)
 assert.deepEqual(p.currentRange,[1,2]);assert.deepEqual(p.longestRange,[1,2])
})
test('same-day wins establish exact streaks; precise timestamps restore verified order',()=>{
 const a=night(1,3,1),b={...night(1,3,1),id:'b'}
 assert.equal(performance(totals,[a,b]).longest,2)
 a.instant='2026-01-01T22:00:00Z';b.instant='2026-01-01T20:00:00Z';b.participants[0].frames_won=0
 const p=performance(totals,[a,b]);assert.equal(p.current,1);assert.deepEqual(p.recent.map(n=>n.id),['1','b'])
})
test('an undated night does not hide other dated results or progression',()=>{
 const missing={...night(2,1,2),date:null}
 const p=performance(totals,[night(1,2,1),missing,night(3,2,1)])
 assert.equal(p.recent.length,2);assert.equal(p.series.length,2);assert.equal(p.current,null)
})

test('recent form selects one compact opponent/date/score detail without duplicating all nights',async()=>{
 const React={createElement:(type,props,...children)=>typeof type==='function'&&type.name==='DisclosureHeading'?type({...props,children:children.flat(Infinity)}):({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
 let cursor=0
 const values=[{totals:{...completeTotals,nights:2},nights:[night(1,4,2,'First'),night(2,1,3,'Second')]},false,false,false,null,false,false,0]
 globalThis.__recentUi={React,performance,ratio,resultFor,useEffect:()=>{},useState:()=>{const i=cursor++;return [values[i],value=>{values[i]=value}]}}
 const heading=(await readFile(new URL('../../src/components/ui/DisclosureHeading.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
 const src=heading+'\n'+(await readFile(new URL('../../src/features/stats/MyStatsView.tsx',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
 const js=ts.transpileModule('const {React,performance,ratio,resultFor,useEffect,useState}=globalThis.__recentUi;const displayDate=value=>value;const Component=class{},lazy=()=> "PersonalChart",Suspense="Suspense",FrameAnalyticsSections=()=>null,NightTrend=()=>null;\n'+src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText
 const {MyStatsView}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
 const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
 const text=n=>n&&typeof n==='object'?n.children.map(text).join(' '):String(n??'')
 const render=()=>{cursor=0;return nodes(MyStatsView())}
 let all=render(),detail=all.filter(n=>n.props.id==='recent-night-detail');assert.equal(detail.length,1)
 const about=all.filter(n=>n.type==='details'&&n.props.className==='stats-about');assert.equal(about.length,1)
 assert.match(text(about[0]),/About these stats/);assert.match(text(about[0]),/older nights saved as final scores/);assert.doesNotMatch(text(about[0]),/unverified/)
 assert.equal(about[0].props.open,undefined)
 assert.match(text(detail[0]),/Second/)
 const buttons=all.filter(n=>n.props['aria-controls']==='recent-night-detail');assert.equal(buttons.length,2)
 buttons[1].props.onClick();all=render();detail=all.filter(n=>n.props.id==='recent-night-detail')
 assert.equal(detail.length,1);assert.match(text(detail[0]),/First/);assert.match(text(detail[0]),/2026-01-01/);assert.match(text(detail[0]),/Me 4/)
 assert.equal(all.filter(n=>n.props['aria-pressed']===true).length,1)
 const insight=all.find(n=>n.props['aria-controls']==='frame-insights-content'),trends=all.find(n=>n.props['aria-controls']==='additional-trends-content')
 assert.equal(insight.props['aria-expanded'],false);assert.equal(trends.props['aria-expanded'],false)
 assert.match(text(trends),/Additional trends/);assert.doesNotMatch(text(trends),/View|Hide/)
 const series=all.find(n=>n.props.series)?.props.series
 trends.props.onClick();all=render();assert.equal(all.find(n=>n.props.id==='additional-trends-content').props.hidden,false)
 assert.deepEqual(all.find(n=>n.props.series)?.props.series,series)
 all.find(n=>n.props['aria-controls']==='additional-trends-content').props.onClick();all=render();assert.equal(all.find(n=>n.props.id==='additional-trends-content').props.hidden,true)
 insight.props.onClick();all=render();assert.equal(all.find(n=>n.props.id==='frame-insights-content').props.hidden,false)

})
