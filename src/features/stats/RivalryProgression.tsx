import { useState } from 'react'
import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { displayDate } from '../results/presentation'
import { resultFor, type PersonalNight } from './performance'
import { progressionGroups, type RivalryPoint } from './progressionData'
import './RivalryProgression.css'

export default function RivalryProgression({nights,series,ownId,opponentId,labels}:{nights:PersonalNight[];series:RivalryPoint[];ownId:string;opponentId:string;labels:[string,string]}) {
 const [range,setRange]=useState<'all'|'recent'>('all')
 const [selected,setSelected]=useState<number|null>(null)
 const [nightId,setNightId]=useState('')
 const groups=progressionGroups(nights,ownId,opponentId,series)
 const visible=range==='recent'?groups.slice(-10):groups
 const point=visible.find(p=>p.night===selected)??visible.at(-1)
 if(!point)return <p className="stats-note">No dated completed nights to show yet.</p>
 const selectedIndex=visible.indexOf(point)
 const selectedNight=point.nights.find(n=>n.id===nightId)??point.nights[0]
 const selectPoint=(night:number)=>{setSelected(night);setNightId('')}
 const start=groups.indexOf(visible[0]),baseline=start?groups[start-1]:{night:0,wins:0,losses:0,date:visible[0].date}
 const chartData=[{...baseline,baseline:true},...visible.map(p=>({...p,baseline:false}))]
 const ticks=[baseline.night,...new Set([visible[Math.floor((visible.length-1)/2)].night,visible.at(-1)!.night])]
 const dateTick=(value:number)=>value===baseline.night?(start?'Earlier':'Start'):new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${visible.find(p=>p.night===value)!.date}T00:00:00Z`))
 const maximum=Math.max(1,...chartData.flatMap(p=>[p.wins,p.losses]))
 const score=(id:string)=>selectedNight.participants.find(p=>p.player_id===id)?.frames_won??'—'
 return <div className="rivalry-progression">
  {groups.length>10&&<div className="progression-ranges" role="group" aria-label="Progression range">{(['recent','all'] as const).map(value=><button key={value} type="button" aria-pressed={range===value} onClick={()=>{setRange(value);setSelected(null);setNightId('')}}>{value==='recent'?'Recent':'All'}</button>)}</div>}
  <div className="progression-chart" aria-label="Interactive cumulative rivalry wins" onClick={e=>{
    const bounds=e.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-bounds.left-30)/Math.max(1,bounds.width-46)))
    const target=baseline.night+fraction*(visible.at(-1)!.night-baseline.night)
    selectPoint(visible.reduce((closest,p)=>Math.abs(p.night-target)<Math.abs(closest.night-target)?p:closest).night)
   }} onKeyDown={e=>{if(e.key==='ArrowLeft'&&selectedIndex>0){e.preventDefault();selectPoint(visible[selectedIndex-1].night)}else if(e.key==='ArrowRight'&&selectedIndex<visible.length-1){e.preventDefault();selectPoint(visible[selectedIndex+1].night)}}}>
   <ResponsiveContainer width="100%" height={240} minWidth={0}>
    <LineChart data={chartData} margin={{top:12,right:16,bottom:8,left:0}} accessibilityLayer>
     <XAxis dataKey="night" type="number" domain={[baseline.night,visible.at(-1)!.night]} ticks={ticks} tickFormatter={dateTick} tick={{fill:'#A7A99E',fontSize:11}} tickLine={false} axisLine={{stroke:'#536357'}} minTickGap={8}/>
     <YAxis domain={[0,maximum]} allowDecimals={false} width={30} tick={{fill:'#A7A99E',fontSize:11}} tickLine={false} axisLine={false} tickCount={4}/>
     <ReferenceLine y={0} stroke="#536357"/>
     <Tooltip content={()=>null} cursor={false}/>
     <Line name={labels[0]} type="linear" dataKey="wins" stroke="#C2A06B" strokeWidth={3} dot={false} activeDot={false} isAnimationActive={false}/>
     <Line name={labels[1]} type="linear" dataKey="losses" stroke="#F1EBDD" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false}/>
     <ReferenceLine x={point.night} stroke="#A7A99E" strokeDasharray="2 4"/>
     {point.wins===point.losses?<><ReferenceDot x={point.night} y={point.wins} r={9} fill="#35271F" stroke="#F1EBDD" strokeWidth={2}/><ReferenceDot x={point.night} y={point.wins} r={4} fill="#C2A06B" stroke="#0B100D" strokeWidth={1}/></>:<><ReferenceDot x={point.night} y={point.wins} r={6} fill="#C2A06B" stroke="#0B100D" strokeWidth={2}/><ReferenceDot x={point.night} y={point.losses} r={6} fill="#35271F" stroke="#F1EBDD" strokeWidth={2}/></>}
    </LineChart>
   </ResponsiveContainer>
  </div>
  <p className="progression-key"><span>━ ● {labels[0]}</span><span>━ ○ {labels[1]}</span></p>
  <div className="progression-inspection"><button type="button" aria-label="Previous recorded date" disabled={selectedIndex===0} onClick={()=>selectPoint(visible[selectedIndex-1].night)}>←</button><label>Recorded date<select aria-label="Recorded date" value={point.night} onChange={e=>selectPoint(Number(e.target.value))}>{visible.map(p=><option key={p.night} value={p.night}>{displayDate(p.date)}{p.nights.length>1?` · ${p.nights.length} nights`:''}{visible.filter(v=>v.date===p.date).length>1?` · Night ${p.night}`:''}</option>)}</select></label><button type="button" aria-label="Next recorded date" disabled={selectedIndex===visible.length-1} onClick={()=>selectPoint(visible[selectedIndex+1].night)}>→</button></div>
  <div className="progression-detail" aria-live="polite" aria-atomic="true">
   <strong>{displayDate(point.date)}</strong><p className="progression-lead">{point.wins===point.losses?'Level on night wins':`${point.wins>point.losses?labels[0]:labels[1]} leads by ${Math.abs(point.wins-point.losses)} ${Math.abs(point.wins-point.losses)===1?'night win':'night wins'}`}</p>
   {point.nights.length>1&&<><p className="stats-note">{point.nights.length} nights share this date; their order is unknown. Cumulative wins are shown after the whole date.</p><label>Match on this date<select aria-label="Match on this date" value={selectedNight.id} onChange={e=>setNightId(e.target.value)}>{point.nights.map(n=><option key={n.id} value={n.id}>{labels[0]} {n.participants.find(p=>p.player_id===ownId)?.frames_won??'—'} – {n.participants.find(p=>p.player_id===opponentId)?.frames_won??'—'} {labels[1]}</option>)}</select></label></>}
   <p>{labels[0]} <strong>{score(ownId)} – {score(opponentId)}</strong> {labels[1]}</p>
   <p>{({W:`${labels[0]} won`,L:`${labels[1]} won`,D:'Draw',M:'Multiplayer','—':'Result unavailable'})[resultFor(selectedNight,ownId)]}</p>
   <p className="stats-note">Cumulative night wins · {labels[0]} {point.wins} · {labels[1]} {point.losses}</p>
  </div>
  <details className="progression-text"><summary>View progression as text</summary><ol>{visible.map(p=><li key={p.night}>{displayDate(p.date)} · {labels[0]} {p.wins} wins · {labels[1]} {p.losses} wins{p.nights.length>1?` · after ${p.nights.length} same-day nights`:''}</li>)}</ol></details>
 </div>
}
