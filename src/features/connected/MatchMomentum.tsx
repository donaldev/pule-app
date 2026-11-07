import { useState } from 'react'
import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { SessionState } from '../../data/remote/database.types'
import { matchMomentumData } from './matchMomentumData'
import './MatchMomentum.css'
export default function MatchMomentum({state}:{state:SessionState}) {
 const [selected,setSelected]=useState(0)
 const data=matchMomentumData(state)
 if(!data)return <p className="annotation">Momentum needs a complete, ordered frame history matching this night’s final score.</p>
 const {players,points}=data,point=points[Math.min(selected,points.length-1)],last=points.at(-1)!,max=Math.max(1,...points.map(p=>Math.abs(p.advantage)))
 const name=(id:string|null)=>players.find(p=>p.player_id===id)?.display_name??'Not recorded'
 const lead=(advantage:number)=>advantage===0?'Tied score':`${advantage>0?players[0].display_name:players[1].display_name} ahead by ${Math.abs(advantage)}`
 const score=(p:typeof point)=>`${players[0].display_name} ${p.a} – ${p.b} ${players[1].display_name}`
 const ticks=[...new Set([0,Math.ceil(last.number/2),last.number])]
 return <div className="match-momentum">
  <p className="momentum-key"><span>+ {players[0].display_name} ahead</span><span>− {players[1].display_name} ahead</span><span>0 · Tied score</span></p>
  <div className="momentum-plot" tabIndex={0} role="group" aria-label="Frame advantage. Left and right arrows inspect the score." onKeyDown={e=>{const n=e.key==='ArrowLeft'?point.number-1:e.key==='ArrowRight'?point.number+1:-1;if(n>=0&&n<points.length){e.preventDefault();setSelected(n)}}} onClick={e=>{const bounds=e.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-bounds.left-36)/Math.max(1,bounds.width-52)));setSelected(Math.round(fraction*last.number))}}>
   <ResponsiveContainer width="100%" height={220} minWidth={0}><LineChart data={points} margin={{top:12,right:16,bottom:8,left:0}} accessibilityLayer={false}>
    <XAxis dataKey="number" type="number" domain={[0,last.number]} ticks={ticks} tickFormatter={n=>n===0?'Start':String(n)} allowDecimals={false} tickLine={false} tick={{fill:'#A7A99E',fontSize:11}}/>
    <YAxis width={36} domain={[-max,max]} ticks={[-max,0,max]} tickFormatter={n=>n>0?`+${n}`:String(n)} tickLine={false} axisLine={false} tick={{fill:'#A7A99E',fontSize:11}}/>
    <ReferenceLine y={0} stroke="#A7A99E"/>
    <Line name="Frame advantage" type="stepAfter" dataKey="advantage" stroke="#C2A06B" strokeWidth={3} dot={false} activeDot={false} isAnimationActive={false}/>
    <ReferenceDot x={point.number} y={point.advantage} r={6} fill="#C2A06B" stroke="#F1EBDD" strokeWidth={2}/>
   </LineChart></ResponsiveContainer>
  </div><p className="annotation">Frame number · score difference</p>
  <div className="momentum-inspection"><button type="button" aria-label="Previous momentum frame" disabled={point.number===0} onClick={()=>setSelected(point.number-1)}>←</button><label>Inspect score<select aria-label="Momentum frame" value={point.number} onChange={e=>setSelected(Number(e.target.value))}>{points.map(p=><option key={p.number} value={p.number}>{p.number===0?'Starting score':`Frame ${p.number}`}</option>)}</select></label><button type="button" aria-label="Next momentum frame" disabled={point.number===last.number} onClick={()=>setSelected(point.number+1)}>→</button></div>
  <div className="momentum-detail" aria-live="polite" aria-atomic="true"><strong>{point.number===0?'Starting score · before frame 1':`Frame ${point.number} · ${name(point.winner)} won`}</strong><p>{score(point)}</p><p>{lead(point.advantage)}</p></div>
  <dl className="momentum-summary"><div><dt>Lead changes</dt><dd>{data.leadChanges}</dd></div><div><dt>Longest winning run</dt><dd>{data.longest} {data.longest===1?'frame':'frames'} · {data.runPlayers.join(' / ')}</dd></div>{data.winner&&<div><dt>Deficit overcome</dt><dd>{data.comeback} {data.comeback===1?'frame':'frames'} · {data.winner.display_name}</dd></div>}<div><dt>Finish</dt><dd>{data.tied?'Tied':`${data.winner!.display_name} won`}</dd></div></dl><p className="annotation">Lead changes count switches between players, including across a tied score.</p>
  <details className="momentum-text"><summary>View score progression as text</summary><ol>{points.map(p=><li key={p.number}>{p.number===0?'Starting score':`Frame ${p.number} · ${name(p.winner)} won`} · {score(p)} · {lead(p.advantage)}</li>)}</ol></details>
 </div>
}
