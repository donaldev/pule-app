import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const analytics=url(await read('src/features/stats/frameAnalytics.ts'))
const {matchMomentumData}=await import(url((await read('src/features/connected/matchMomentumData.ts')).replace("'../stats/frameAnalytics'",JSON.stringify(analytics))))
const fixture=(winners=['a','b','b','a','a'])=>({session:{id:'s',group_id:'g',status:'finalized',origin:'native',record_kind:'frame_log',result_quality:'approved',sequence_quality:'reconciled',detail_eligible:true,occurred_on:'2026-11-06',occurred_at:null},participants:[{player_id:'a',side:1,display_name:'Alex'},{player_id:'b',side:2,display_name:'Blair'}],scores:{a:winners.filter(p=>p==='a').length,b:winners.filter(p=>p==='b').length},frames:winners.map((winner_id,i)=>({id:'f'+i,session_id:'s',group_id:'g',frame_number:i+1,status:'completed',detail_eligible:true,winner_id,breaker_id:'a',potted_on_break:false,special_event:'regular',black_pocket_code:'TL',elapsed_ms:60000,duration_quality:'server_measured',participants:[{player_id:'a',side:1,foul_count:0},{player_id:'b',side:2,foul_count:1}]}))})
test('exact running scores, baseline, transfers through ties and comeback reconcile with the saved result',()=>{
 const state=fixture(),before=JSON.stringify(state),m=matchMomentumData(state)
 assert.deepEqual(m.points.map(p=>[p.number,p.a,p.b,p.advantage]),[[0,0,0,0],[1,1,0,1],[2,1,1,0],[3,1,2,-1],[4,2,2,0],[5,3,2,1]])
 assert.equal(m.leadChanges,2);assert.equal(m.longest,2);assert.equal(m.comeback,1);assert.equal(m.winner.player_id,'a');assert.equal(m.tied,false);assert.equal(JSON.stringify(state),before)
})
test('clear wins, multiple transfers, tied finishes and one-frame nights',()=>{
 let m=matchMomentumData(fixture(['b','b','b']));assert.equal(m.longest,3);assert.equal(m.comeback,0);assert.equal(m.leadChanges,0)
 m=matchMomentumData(fixture(['a','b','b','a','a','b','b']));assert.equal(m.leadChanges,3);assert.equal(m.comeback,1)
 m=matchMomentumData(fixture(['a','b']));assert.equal(m.tied,true);assert.equal(m.winner,null);assert.equal(m.comeback,null);assert.equal(m.leadChanges,0)
 m=matchMomentumData(fixture(['a']));assert.equal(m.longest,1);assert.equal(m.points.length,2)
})
test('missing, duplicate, incomplete, mismatched and score-only records fail closed',()=>{
 const cases=[s=>s.frames.splice(1,1),s=>s.frames[1].frame_number=1,s=>s.frames[1].id=s.frames[0].id,s=>s.frames[0].session_id='other',s=>s.frames[0].group_id='other',s=>s.frames[0].participants[1].player_id='other',s=>s.frames[0].winner_id=null,s=>s.scores.a++,s=>s.session.record_kind='result_only',s=>s.session.sequence_quality='partial',s=>s.session.detail_eligible=false,s=>s.frames[0].detail_eligible=false,s=>s.session.status='active',s=>s.session.result_quality='disputed',s=>s.frames[0].status='voided',s=>s.participants.push({player_id:'c',side:3,display_name:'Third'})]
 for(const change of cases){const state=fixture();change(state);assert.equal(matchMomentumData(state),null)}
 assert.equal(matchMomentumData(fixture([])),null)
 const imported=fixture();imported.session.origin='imported';assert.ok(matchMomentumData(imported))
})
let values=[],cursor=0
const React={createElement:(type,props,...children)=>typeof type==='function'&&['MatchDisclosureHeading','DisclosureHeading'].includes(type.name)?type({...props,children:children.flat(Infinity)}):({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'}
const useState=initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v}]}
globalThis.__momentum={React,useState,matchMomentumData}
const source=(await read('src/features/connected/MatchMomentum.tsx')).replace(/^import .*$/gm,'')
const {default:Chart}=await import(url('const {React,useState,matchMomentumData}=globalThis.__momentum;const Line="Line",LineChart="LineChart",ReferenceDot="ReferenceDot",ReferenceLine="ReferenceLine",ResponsiveContainer="ResponsiveContainer",XAxis="XAxis",YAxis="YAxis";\n'+source))
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[]
const text=n=>n&&typeof n==='object'?n.children.map(text).join(' ').replace(/\s+/g,' '):String(n??'')
const render=state=>{cursor=0;return nodes(Chart({state}))}
test('tap, keyboard and native selection retain correct detail; chart is step-style with only selected marker',()=>{
 values=[];const state=fixture();let all=render(state)
 assert.match(text(all.find(n=>n.props.className==='momentum-detail')),/Starting score.*before frame 1/)
 all.find(n=>n.props['aria-label']==='Momentum frame').props.onChange({target:{value:'3'}});all=render(state)
 assert.match(text(all.find(n=>n.props.className==='momentum-detail')),/Frame 3.*Blair won.*Alex 1 – 2 Blair.*Blair ahead by 1/)
 all.find(n=>n.props.className==='momentum-plot').props.onKeyDown({key:'ArrowRight',preventDefault(){}});all=render(state);assert.match(text(all.find(n=>n.props.className==='momentum-detail')),/Tied score/)
 all.find(n=>n.props.className==='momentum-plot').props.onClick({clientX:320,currentTarget:{getBoundingClientRect:()=>({left:0,width:320})}});all=render(state);assert.match(text(all.find(n=>n.props.className==='momentum-detail')),/Frame 5/)
 const line=all.find(n=>n.type==='Line');assert.equal(line.props.type,'stepAfter');assert.equal(line.props.dot,false);assert.equal(line.props.isAnimationActive,false)
 assert.equal(all.find(n=>n.type==='ResponsiveContainer').props.height,220);assert.ok(all.find(n=>n.type==='summary'&&text(n)==='View score progression as text'))
 assert.equal(all.filter(n=>n.type==='ReferenceDot').length,1)
 values=[];assert.match(text(render(fixture([]))[0]),/complete, ordered/)
})
test('disclosure starts collapsed, loads on expansion and retains the mounted chart on collapse',async()=>{
 const heading=(await read('src/components/ui/DisclosureHeading.tsx')).replace(/^import .*$/gm,'')
 const src=heading+'\nconst MatchDisclosureHeading=DisclosureHeading;\n'+(await read('src/features/connected/MatchMomentumSection.tsx')).replace(/^import .*$/gm,'')
 const {MatchMomentumSection}=await import(url('const {React,useState}=globalThis.__momentum;class Component{};const lazy=()=>"LazyMomentum",Suspense="Suspense";\n'+src))
 values=[];const draw=()=>{cursor=0;return nodes(MatchMomentumSection({state:fixture()}))};let all=draw()
 assert.equal(all.find(n=>n.type==='button').props['aria-expanded'],false);assert.equal(all.some(n=>n.type==='LazyMomentum'),false)
 all.find(n=>n.type==='button').props.onClick();all=draw();assert.equal(all.find(n=>n.props.id==='match-momentum-content').props.hidden,false);assert.equal(all.some(n=>n.type==='LazyMomentum'),true)
 all.find(n=>n.type==='button').props.onClick();all=draw();assert.equal(all.find(n=>n.props.id==='match-momentum-content').props.hidden,true);assert.equal(all.some(n=>n.type==='LazyMomentum'),true)
})
