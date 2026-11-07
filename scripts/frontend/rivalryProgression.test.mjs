import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
const url=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const perfUrl=url(await read('src/features/stats/performance.ts'))
const {resultFor}=await import(perfUrl)
const {rivalryRecord}=await import(url((await read('src/features/stats/rivalry.ts')).replace("'./performance'",JSON.stringify(perfUrl))))
const {progressionGroups}=await import(url(await read('src/features/stats/progressionData.ts')))
const night=(id,date,a=3,b=1,instant=null)=>({id,date,instant,participants:[{player_id:'p',name:'Player',frames_won:a},{player_id:'q',name:'Opponent',frames_won:b}]})
const series=rows=>rivalryRecord(rows,'p','q').progress.series
const groups=rows=>progressionGroups(rows,'p','q',series(rows))
test('empty and single-night progression preserve existing official totals',()=>{
 assert.deepEqual(groups([]),[])
 const row=night('first','2026-01-01',7,3);assert.deepEqual(groups([row]),[{night:1,wins:1,losses:0,date:row.date,nights:[row]}])
})
test('same-day uncertainty is one point with every original result, never artificial intra-day totals',()=>{
 const rows=[night('b','2026-01-01',1,3),night('a','2026-01-01',3,1),night('c','2026-01-02',2,2)]
 const points=groups(rows);assert.equal(points.length,2);assert.equal(points[0].nights.length,2)
 assert.deepEqual(points.map(p=>[p.night,p.wins,p.losses]),[[2,1,1],[3,1,1]])
 assert.deepEqual(points[0].nights.map(n=>resultFor(n,'p')),['W','L'])
})
test('verified same-day times remain separate points and multiplayer/unrelated/duplicate rows do not enter detail',()=>{
 const a=night('a','2026-01-01',3,1,'2026-01-01T18:00:00Z'),b=night('b','2026-01-01',1,3,'2026-01-01T20:00:00Z')
 const multi=night('multi','2026-01-02');multi.participants.push({player_id:'third',name:'Third',frames_won:0})
 const other=night('other','2026-01-03');other.participants[1].player_id='other'
 const rows=[b,a,a,multi,other],before=JSON.stringify(rows),points=groups(rows)
 assert.deepEqual(points.map(p=>p.nights.map(n=>n.id)),[['a'],['b']]);assert.equal(JSON.stringify(rows),before)
})
test('unavailable chronology and unknown scores stay unavailable; invalid point coverage fails closed',()=>{
 assert.deepEqual(groups([night('a',null)]),[])
 assert.deepEqual(groups([night('a','2026-01-01',null,3)]),[])
 assert.throws(()=>progressionGroups([night('a','2026-01-01')],'p','q',[{night:2,wins:1,losses:0,date:'2026-01-01'}]),/Incomplete/)
})
let values=[],cursor=0
const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
globalThis.__progressUi={React,resultFor,progressionGroups,useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v}]}}
const src=(await read('src/features/stats/RivalryProgression.tsx')).replace(/^import .*$/gm,'')
const componentSource=`const {React,resultFor,progressionGroups,useState}=globalThis.__progressUi;const displayDate=v=>v;const Line='Line',LineChart='LineChart',ReferenceDot='ReferenceDot',ReferenceLine='ReferenceLine',ResponsiveContainer='ResponsiveContainer',Tooltip='Tooltip',XAxis='XAxis',YAxis='YAxis';\n`+src
const {default:Progression}=await import(url(componentSource))
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const text=n=>n&&typeof n==='object'?n.children.map(text).join(' '):String(n??'')
const fixture=rows=>{values=[];return ()=>{cursor=0;return nodes(Progression({nights:rows,series:series(rows),ownId:'p',opponentId:'q',labels:['Player','Opponent']}))}}
test('point click, keyboard and native selection update persistent detail and highlight',()=>{
 const render=fixture([night('a','2026-01-01'),night('b','2026-01-02',1,3)]);let all=render()
 const detail=()=>all.find(n=>n.props.className==='progression-detail')
 assert.match(text(detail()),/Opponent won/)
 all.find(n=>n.props.className==='progression-chart').props.onClick({clientX:40,currentTarget:{getBoundingClientRect:()=>({left:0,width:320})}});all=render();assert.match(text(detail()),/Player won/)
 assert.ok(all.filter(n=>n.type==='ReferenceDot').every(n=>n.props.x===1))
 all.find(n=>n.props.className==='progression-chart').props.onKeyDown({key:'ArrowRight',preventDefault(){}});all=render();assert.match(text(detail()),/Opponent won/)
 all.find(n=>n.type==='select').props.onChange({target:{value:'1'}});all=render();assert.match(text(detail()),/Player won/)
 assert.ok(all.filter(n=>n.type==='Line').every(n=>n.props.isAnimationActive===false))
 assert.equal(all.find(n=>n.type==='ResponsiveContainer').props.height,240)
})
test('same-day match inspection changes result while retaining grouped cumulative values',()=>{
 const render=fixture([night('a','2026-01-01'),night('b','2026-01-01',1,3)]);let all=render()
 const selects=all.filter(n=>n.type==='select');assert.equal(selects.length,2)
 selects[1].props.onChange({target:{value:'b'}});all=render()
 const detail=text(all.find(n=>n.props.className==='progression-detail'))
 assert.match(detail,/Opponent won/);assert.match(detail.replace(/\s+/g,' '),/Player 1 · Opponent 1/);assert.match(detail,/order is unknown/)
})
test('Recent range keeps global cumulative totals and never splits an ambiguous same-day point',()=>{
 const rows=Array.from({length:12},(_,i)=>night(String(i),`2026-01-${String(i+1).padStart(2,'0')}`))
 rows.push(night('tie','2026-01-03',1,3))
 const render=fixture(rows);let all=render();all.find(n=>n.type==='button'&&text(n)==='Recent').props.onClick();all=render()
 const chart=all.find(n=>n.type==='LineChart');assert.equal(chart.props.data.length,11)
 assert.equal(chart.props.data.at(-1).wins,12);assert.equal(chart.props.data.at(-1).losses,1)
 assert.ok(chart.props.data.some(p=>p.nights?.length===2));assert.equal(all.find(n=>n.type==='details').children[0].type,'summary')
})

test('continuous marker-free lines retain distinct selected markers and an honest lead/tie',()=>{
 const render=fixture([night('a','2026-01-01'),night('b','2026-01-02',1,3)]);let all=render()
 assert.ok(all.filter(n=>n.type==='Line').every(n=>n.props.dot===false&&!n.props.strokeDasharray))
 let dots=all.filter(n=>n.type==='ReferenceDot');assert.deepEqual(dots.map(n=>n.props.r),[9,4]);assert.equal(dots[0].props.stroke,'#F1EBDD');assert.equal(dots[1].props.fill,'#C2A06B')
 assert.match(text(all.find(n=>n.props.className==='progression-lead')),/Level on night wins/)
 all.find(n=>n.type==='select').props.onChange({target:{value:'1'}});all=render()
 assert.match(text(all.find(n=>n.props.className==='progression-lead')),/Player leads by 1 night win/)
 dots=all.filter(n=>n.type==='ReferenceDot');assert.deepEqual(dots.map(n=>n.props.r),[6,6])
})

test('view switches every pair-scoped section and retains selection across remounts, isolated by player',async()=>{
 const source=(await read('src/features/stats/RivalriesView.tsx')).replace(/^import .*$/gm,'')
 const {rivalryOpponents}=await import(url((await read('src/features/stats/rivalry.ts')).replace("'./performance'",JSON.stringify(perfUrl))))
 globalThis.__viewUi={...globalThis.__progressUi,rivalryRecord,rivalryOpponents}
 const code="const {React,useState,rivalryRecord,rivalryOpponents,resultFor}=globalThis.__viewUi;const Component=class{},lazy=()=> 'LazyChart',Suspense='Suspense',useEffect=()=>{},displayDate=v=>v,NightTrend='NightTrend';\n"+source
 const {RivalriesView}=await import(url(code))
 const first=[night('a','2026-01-01'),night('draw','2026-01-02',2,2)],second=night('b','2026-01-03',1,7);second.participants[1]={...second.participants[1],player_id:'r',name:'Another'}
 const multi=night('multi','2026-01-04');multi.participants.push({player_id:'r',name:'Another',frames_won:2})
 const data={totals:{player_id:'p',display_name:'Player'},nights:[...first,second,multi]}
 const mount=()=>{values=[data,false,false,0,null]};const render=()=>{cursor=0;return nodes(RivalriesView())};mount();let all=render()
 const selector=()=>all.find(n=>n.props['aria-label']==='Playing against')
 const chart=()=>all.find(n=>n.type==='LazyChart')
 assert.equal(selector().props.value,'q');assert.deepEqual(chart().props.nights.map(n=>n.id),['a','draw'])
 for(const id of ['r','q','r']){selector().props.onChange({target:{value:id}});all=render();assert.equal(selector().props.value,id);assert.equal(chart().props.opponentId,id);assert.ok(chart().props.nights.every(n=>n.participants.some(p=>p.player_id===id)&&n.participants.length===2))}
 assert.deepEqual(chart().props.series,[{night:1,wins:0,losses:1,date:'2026-01-03'}]);assert.equal(chart().props.key,'p/r')
 const recent=all.find(n=>n.type==='section'&&n.children.some(c=>c?.type==='h2'&&text(c)==='Last 10 nights'));assert.match(text(recent),/1.*7/);assert.doesNotMatch(text(recent),/2026-01-01/)
 const metrics=all.find(n=>n.props.className==='personal-metrics');assert.deepEqual(nodes(metrics).filter(n=>n.type==='dd').map(text),['0.0%','1','7'])
 mount();all=render();assert.equal(selector().props.value,'r')
 values=[{...data,totals:{...data.totals,player_id:'other'},nights:data.nights.map(n=>({...n,participants:n.participants.map(p=>p.player_id==='p'?{...p,player_id:'other'}:p)}))},false,false,0,null];all=render();assert.equal(selector().props.value,'q')
 values=[{totals:data.totals,nights:[]},false,false,0,null];all=render();assert.ok(all.some(n=>n.type==='h2'&&text(n)==='Your next rivalry starts here'))
 values=[{totals:data.totals,nights:[second]},false,false,0,null];all=render();assert.equal(selector(),undefined);assert.equal(chart().props.series.length,1);assert.ok(all.some(n=>n.props.className==='rivalry-opponent-name'&&text(n)==='Another'))
 const third=night('c','2026-01-04',6,2);third.participants[1]={...third.participants[1],player_id:'s',name:'Third rival'}
 values=[{...data,nights:[...data.nights,third]},false,false,0,null];all=render();assert.deepEqual(nodes(selector()).filter(n=>n.type==='option').map(n=>n.props.value),['q','r','s'])
 selector().props.onChange({target:{value:'s'}});all=render();assert.deepEqual(chart().props.nights.map(n=>n.id),['c']);assert.deepEqual(chart().props.series,[{night:1,wins:1,losses:0,date:'2026-01-04'}])
})
