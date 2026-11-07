import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
const url=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const perfUrl=url(await read('src/features/stats/performance.ts'))
const {performance,ratio,resultFor}=await import(perfUrl)
const {personalHistoryData}=await import(url((await read('src/features/stats/personalHistoryData.ts')).replace("'./performance'",JSON.stringify(perfUrl))))
const totals={player_id:'p',nights:0,frames_won:0,frames_lost:0}
const night=(id,date,a=3,b=1)=>({id,date,instant:null,participants:[{player_id:'p',name:'Player',frames_won:a},{player_id:'q',name:'Opponent',frames_won:b}]})
const series=rows=>performance(totals,rows).series
const history=rows=>personalHistoryData(rows,series(rows),'p')
test('score-only W/L/D use existing cumulative totals and draws keep the decided denominator unchanged',()=>{
 const rows=[night('a','2026-01-01'),night('b','2026-01-02',2,2),night('c','2026-01-03',1,3)]
 const before=JSON.stringify(rows),points=history(rows)
 assert.deepEqual(points.map(p=>[p.rate,p.wins,p.decided]),[[100,1,1],[100,1,1],[50,1,2]])
 assert.equal(points[1].nights[0].id,'b');assert.equal(JSON.stringify(rows),before)
})
test('same-day source results produce only the existing day-end rate, never invented intermediate ordering',()=>{
 const rows=[night('loss','2026-01-01',1,3),night('win','2026-01-01'),night('draw','2026-01-02',1,1)]
 const points=history(rows);assert.equal(points.length,2);assert.equal(points[0].rate,50);assert.equal(points[0].nights.length,2);assert.equal(points[0].unordered,true)
 assert.equal(points[1].rate,50);assert.deepEqual(points.map(p=>[p.wins,p.losses]),series(rows).map(p=>[p.wins,p.losses]))
})
test('empty, single draw, unavailable scores and undated/multiplayer observations are not invented zeros or losses',()=>{
 assert.deepEqual(history([]),[]);assert.equal(history([night('d','2026-01-01',1,1)])[0].rate,null)
 const rows=[night('a','2026-01-01'),night('unknown','2026-01-02',null,3),night('undated',null),{...night('multi','2026-01-03'),participants:[...night('multi','2026-01-03').participants,{player_id:'r',name:'Third',frames_won:2}]}]
 const points=history(rows);assert.equal(points.length,2);assert.equal(points[1].rate,100);assert.equal(points[1].decided,1);assert.equal(points[1].unavailable,1)
 assert.equal(history([night('unknown','2026-01-01',null,3)])[0].rate,null)
 assert.throws(()=>personalHistoryData([rows[0],rows[0]],series([rows[0]]),'p'),/Duplicate/)
})
let values=[],cursor=0
const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
globalThis.__personalHistoryUi={React,resultFor,personalHistoryData,useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v}]}}
const src=(await read('src/features/stats/PersonalHistoryChart.tsx')).replace(/^import .*$/gm,'')
const prefix='const {React,resultFor,personalHistoryData,useState}=globalThis.__personalHistoryUi;const displayDate=v=>v;const Line="Line",LineChart="LineChart",ReferenceDot="ReferenceDot",ReferenceLine="ReferenceLine",ResponsiveContainer="ResponsiveContainer",XAxis="XAxis",YAxis="YAxis";\n'
const {default:Chart}=await import(url(prefix+src))
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const text=n=>n&&typeof n==='object'?n.children.map(text).join(' ').replace(/\s+/g,' '):String(n??'')
const fixture=rows=>{values=[];return ()=>{cursor=0;return nodes(Chart({nights:rows,series:series(rows),playerId:'p'}))}}
test('persistent tap, keyboard and date selection show the correct source result and rate',()=>{
 const render=fixture([night('a','2026-01-01'),night('draw','2026-01-02',2,2),night('c','2026-01-03',1,3)]);let all=render()
 assert.match(text(all.find(n=>n.props.className==='history-detail')),/Loss/)
 all.find(n=>n.props.className==='personal-history-plot').props.onClick({clientX:42,currentTarget:{getBoundingClientRect:()=>({left:0,width:320})}});all=render();assert.match(text(all.find(n=>n.props.className==='history-detail')),/100.0%/)
 all.find(n=>n.props.className==='personal-history-plot').props.onKeyDown({key:'ArrowRight',preventDefault(){}});all=render();assert.match(text(all.find(n=>n.props.className==='history-detail')),/Draw/)
 all.find(n=>n.props['aria-label']==='Performance date').props.onChange({target:{value:'2026-01-03'}});all=render();assert.match(text(all.find(n=>n.props.className==='history-detail')),/50.0%/)
 assert.equal(all.find(n=>n.type==='ResponsiveContainer').props.height,220);assert.equal(all.find(n=>n.type==='Line').props.isAnimationActive,false)
})
test('same-day match choice retains cumulative day totals and Recent preserves all-time rate',()=>{
 const rows=Array.from({length:12},(_,i)=>night(String(i),`2026-01-${String(i+1).padStart(2,'0')}`));rows.push(night('same','2026-01-03',1,3))
 const render=fixture(rows);let all=render();all.find(n=>n.type==='button'&&text(n)==='Recent').props.onClick();all=render()
 assert.equal(all.find(n=>n.type==='LineChart').props.data.length,10)
 assert.equal(all.find(n=>n.type==='LineChart').props.data.at(-1).rate,ratio(12,1))
 all.find(n=>n.props['aria-label']==='Performance date').props.onChange({target:{value:'2026-01-03'}});all=render()
 all.find(n=>n.props['aria-label']==='Performance night').props.onChange({target:{value:'same'}});all=render()
 const detail=text(all.find(n=>n.props.className==='history-detail'));assert.match(detail,/Loss/);assert.match(detail,/75.0%/);assert.match(detail,/order is unknown/)
 assert.ok(all.some(n=>n.type==='summary'&&text(n)==='View performance as text'))
})
test('single undecided observation keeps the rate unavailable and empty history uses a real empty state',()=>{
 let all=fixture([night('draw','2026-01-01',2,2)])();assert.equal(all.find(n=>n.type==='ReferenceDot'),undefined);assert.match(text(all.find(n=>n.props.className==='history-detail')),/No decided result yet/)
 all=fixture([])();assert.ok(all.some(n=>text(n).includes('Complete a night')))
})
