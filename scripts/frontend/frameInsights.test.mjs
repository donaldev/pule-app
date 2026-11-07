import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const {frameInsightsData}=await import(url(await read('src/features/stats/frameInsightsData.ts')))
const night=(id='n',opponent='q')=>({id,date:'2026-11-01',instant:null,participants:[{player_id:'p',name:'Player',frames_won:2},{player_id:opponent,name:opponent,frames_won:1}]})
const frame=(number,ms=60000,quality='server_measured',fouls=0,opponent='q')=>({id:`f${number}`,number,winner:number%2?'p':opponent,breaker:'p',break_pot:true,event:'super_foul',pocket:'TL',elapsed_ms:ms,duration_quality:quality,players:[{id:'p',fouls},{id:opponent,fouls:1}]})
const detail=(frames,id='n')=>({id,date:'2026-11-01',sequence_quality:'reconciled',detail_eligible:true,recorded_frame_count:frames.length,frames})
test('empty and score-only nights have no invented observations',()=>{assert.deepEqual(frameInsightsData([],[],'p'),[]);assert.deepEqual(frameInsightsData([night()],[detail([])],'p'),[])})
test('duration quality, missing timing and measured zero retain their meaning',()=>{
 const before=[frame(1,0),frame(2,0,'imported_unverified'),frame(3,null,'unknown'),frame(4,120000,'imported_unverified')],snapshot=JSON.stringify(before)
 const n=frameInsightsData([night()],[detail(before)],'p')[0]
 assert.equal(n.timed,2);assert.equal(n.measured,1);assert.equal(n.unverified,1);assert.equal(n.median,60000);assert.equal(n.average,60000)
 assert.deepEqual(n.rows.map(f=>f.duration),[0,null,null,120000]);assert.equal(JSON.stringify(before),snapshot)
})
test('foul totals count known zero, exclude missing and do not add Super Foul tags',()=>{
 const n=frameInsightsData([night()],[detail([frame(1,60000,'server_measured',0),frame(2,60000,'server_measured',null),frame(3,60000,'server_measured',3)])],'p')[0]
 assert.deepEqual(n.counters[0],{id:'p',name:'Player',total:3,known:2,played:3,rate:1.5});assert.equal(n.counters[1].total,3)
 assert.equal(frameInsightsData([night()],[detail([frame(1,60000,'server_measured',null)])],'p')[0].counters[0].total,null)
})
test('ordered frames, median and inspection flags preserve unusual values',()=>{
 const n=frameInsightsData([night()],[detail([frame(5,900000),frame(2),frame(1),frame(4),frame(3)])],'p')[0]
 assert.deepEqual(n.rows.map(f=>f.number),[1,2,3,4,5]);assert.equal(n.median,60000);assert.equal(n.average,228000);assert.equal(n.rows[4].unusual,true)
 assert.equal(frameInsightsData([night()],[detail([frame(1)])],'p')[0].rows[0].unusual,false)
})
test('multiple nights, unrelated details and multiplayer sitting out remain isolated',()=>{
 const multi=night();multi.participants.push({player_id:'r',name:'Third',frames_won:0})
 const other=frame(7);other.players=[{id:'q',fouls:9},{id:'r',fouls:7}]
 const n=frameInsightsData([multi,night('b','r')],[detail([frame(1),other]),detail([{...frame(2,50000,'server_measured',2,'r'),id:'other'}],'b'),detail([frame(99)],'unrelated')],'p')
 assert.equal(n.length,2);assert.equal(n.find(n=>n.night.id==='n').rows.length,1);assert.equal(n.find(n=>n.night.id==='b').counters[1].id,'r')
 assert.throws(()=>frameInsightsData([night()],[detail([]),detail([])],'p'),/Duplicate/)
})
let state=[],cursor=0
const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
const rows=[detail([frame(1),frame(2,120000,'imported_unverified',null)]),detail([{...frame(3,180000,'server_measured',2,'r'),id:'third'}],'b')]
globalThis.__insights={React,frameInsightsData,useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v}]} }
const source=(await read('src/features/stats/FrameInsights.tsx')).replace(/^import .*$/gm,'')
const {default:View}=await import(url('const {React,frameInsightsData,useState,useEffect}=globalThis.__insights;const displayDate=v=>v;const getFrameSummary=()=>Promise.resolve([]);const Line="Line",LineChart="LineChart",ReferenceDot="ReferenceDot",ResponsiveContainer="ResponsiveContainer",XAxis="XAxis",YAxis="YAxis";\n'+source))
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const text=n=>n&&typeof n==='object'?n.children.map(text).join(' ').replace(/\s+/g,' '):String(n??'')
const render=()=>{cursor=0;return nodes(View({nights:[night(),night('b','r')],playerId:'p'}))}
test('night/view/frame selection, keyboard controls and text alternatives use persistent details',()=>{
 state=[rows,false,false,0,'n','duration',''];let all=render()
 assert.equal(all.find(n=>n.type==='ResponsiveContainer').props.height,200);assert.equal(all.find(n=>n.type==='Line').props.isAnimationActive,false)
 all.find(n=>n.props.className==='insight-plot').props.onKeyDown({key:'ArrowRight',preventDefault(){}});all=render();assert.match(text(all.find(n=>n.props.className==='insight-detail')),/Frame 2.*2:00/)
 all.find(n=>n.type==='button'&&text(n)==='Fouls').props.onClick();all=render();assert.match(text(all.find(n=>n.props.className==='insight-detail')),/Unknown/)
 all.find(n=>n.props['aria-label']==='Frame insights night').props.onChange({target:{value:'b'}});all=render();assert.match(text(all.find(n=>n.props.className==='insight-detail')),/Frame 3/)
 assert.ok(all.some(n=>n.type==='summary'&&text(n)==='View frame observations as text'))
})
test('empty and unavailable reads render concise states; section loads only after expansion',async()=>{
 state=[[],false,false,0,'','duration',''];assert.match(text(render()[0]),/No eligible/)
 state=[null,false,false,0,'','duration',''];assert.match(text(render()[0]),/aren’t available/)
 const parent=await read('src/features/stats/MyStatsView.tsx');assert.match(parent,/insightsLoaded&&/);assert.match(parent,/lazy\(\(\)=>import\('\.\/FrameInsights'\)\)/)
})

test('duration presentation omits quality distinctions while source calculations remain intact',async()=>{
 const ui=(await read('src/features/stats/FrameInsights.tsx'))+(await read('src/features/stats/FrameAnalyticsSections.tsx'))+(await read('src/features/stats/MyStatsView.tsx'))
 assert.doesNotMatch(ui,/unverified|Server-measured|Timing quality|duration_quality/)
 assert.match(ui,/Timed frames:/);assert.match(ui,/expanded=\{insightsOpened\}/);assert.match(ui,/>Frame Insights<\/DisclosureHeading>/)
 const css=await read('src/app/connected.css');assert.match(css,/winner-choice:not\(\[aria-pressed=true\]\)/)
})
