import { useState } from 'react'
import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { displayDate } from '../results/presentation'
import { resultFor, type PersonalNight } from './performance'
import { personalHistoryData, type PersonalHistoryPoint } from './personalHistoryData'
import './PersonalHistoryChart.css'
const rateLabel=(rate:number|null)=>rate===null?'—':`${rate.toFixed(1)}%`
export default function PersonalHistoryChart({nights,series,playerId}:{nights:PersonalNight[];series:PersonalHistoryPoint[];playerId:string}) {
 const [range,setRange]=useState<'recent'|'all'>('all'),[selectedDate,setSelectedDate]=useState<string|null>(null),[selectedNightId,setSelectedNightId]=useState('')
 const points=personalHistoryData(nights,series,playerId)
 const visible=range==='recent'?points.slice(-10):points
 const point=visible.find(p=>p.date===selectedDate)??visible.at(-1)
 if(!point)return <p className="stats-note">{nights.length?'Dated head-to-head results will appear here.':'Complete a night to start your performance history.'}</p>
 const selectedIndex=visible.indexOf(point),selectedNight=point.nights.find(n=>n.id===selectedNightId)??point.nights[0]
 const select=(date:string)=>{setSelectedDate(date);setSelectedNightId('')}
 const first=visible[0],last=visible.at(-1)!,ticks=[...new Set([first.night,visible[Math.floor((visible.length-1)/2)].night,last.night])]
 const left=visible.length===1?0:first.night
 const tickDate=(night:number)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${visible.find(p=>p.night===night)!.date}T00:00:00Z`))
 const other=(n:PersonalNight)=>n.participants.filter(p=>p.player_id!==playerId).map(p=>p.name).join(' · ')
 const score=(n:PersonalNight)=>[...n.participants].sort((a,b)=>Number(b.player_id===playerId)-Number(a.player_id===playerId)).map(p=>`${p.name} ${p.frames_won??'—'}`).join(' · ')
 const outcome=(n:PersonalNight)=>({W:'Win',L:'Loss',D:'Draw',M:'Multiplayer','—':'Result not recorded'})[resultFor(n,playerId)]
 const undated=nights.filter(n=>!n.date&&n.participants.length===2).length
 return <div className="personal-history">
  <div className="history-heading"><span>Night win rate</span><strong>{rateLabel(point.rate)}</strong></div>
  {points.length>10&&<div className="history-ranges" role="group" aria-label="Performance history range">{(['recent','all'] as const).map(value=><button key={value} type="button" aria-pressed={range===value} onClick={()=>{setRange(value);setSelectedDate(null);setSelectedNightId('')}}>{value==='recent'?'Recent':'All'}</button>)}</div>}
  <div className="personal-history-plot" aria-label="Cumulative recorded night win rate" onClick={e=>{
   const bounds=e.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-bounds.left-42)/Math.max(1,bounds.width-58)))
   const target=left+fraction*(last.night-left)
   select(visible.reduce((closest,p)=>Math.abs(p.night-target)<Math.abs(closest.night-target)?p:closest).date)
  }} onKeyDown={e=>{if(e.key==='ArrowLeft'&&selectedIndex>0){e.preventDefault();select(visible[selectedIndex-1].date)}else if(e.key==='ArrowRight'&&selectedIndex<visible.length-1){e.preventDefault();select(visible[selectedIndex+1].date)}}}>
   <ResponsiveContainer width="100%" height={220} minWidth={0}><LineChart data={visible} margin={{top:12,right:16,bottom:8,left:0}} accessibilityLayer>
    <XAxis dataKey="night" type="number" domain={[left,Math.max(left+1,last.night)]} ticks={ticks} tickFormatter={tickDate} tick={{fill:'#A7A99E',fontSize:11}} axisLine={{stroke:'#536357'}} tickLine={false} minTickGap={8}/>
    <YAxis domain={[0,100]} ticks={[0,50,100]} width={42} tickFormatter={value=>`${value}%`} tick={{fill:'#A7A99E',fontSize:11}} axisLine={false} tickLine={false}/>
    <ReferenceLine y={0} stroke="#536357"/>
    <Line name="Night win rate" type="linear" dataKey="rate" stroke="#C2A06B" strokeWidth={3} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false}/>
    <ReferenceLine x={point.night} stroke="#A7A99E" strokeDasharray="2 4"/>
    {point.rate!==null&&<ReferenceDot x={point.night} y={point.rate} r={6} fill="#C2A06B" stroke="#F1EBDD" strokeWidth={2}/>}
   </LineChart></ResponsiveContainer>
  </div>
  <p className="stats-note">Completed head-to-head nights · win rate excludes draws. Early rates can change sharply with only a few decided nights.</p>
  <div className="history-inspection"><button type="button" aria-label="Previous performance date" disabled={selectedIndex===0} onClick={()=>select(visible[selectedIndex-1].date)}>←</button><label>Recorded date<select aria-label="Performance date" value={point.date} onChange={e=>select(e.target.value)}>{visible.map(p=><option key={p.date} value={p.date}>{displayDate(p.date)}{p.nights.length>1?` · ${p.nights.length} nights`:''}</option>)}</select></label><button type="button" aria-label="Next performance date" disabled={selectedIndex===visible.length-1} onClick={()=>select(visible[selectedIndex+1].date)}>→</button></div>
  <div className="history-detail" aria-live="polite" aria-atomic="true"><strong>{displayDate(point.date)}</strong>
   {point.nights.length>1&&<><p className="stats-note">{point.unordered?'Same-day order is unknown. ':''}Rate shown after all nights on this date.</p><label>Night on this date<select aria-label="Performance night" value={selectedNight.id} onChange={e=>setSelectedNightId(e.target.value)}>{point.nights.map(n=><option key={n.id} value={n.id}>{other(n)} · {outcome(n)} · {score(n)}</option>)}</select></label></>}
   <p>{outcome(selectedNight)} · {other(selectedNight)}</p><p>{score(selectedNight)}</p>
   <p className="history-rate">Cumulative win rate <strong>{rateLabel(point.rate)}</strong></p>
   <p className="stats-note">{point.wins} wins / {point.decided} recorded wins and losses{point.rate===null?' · No decided result yet':''}</p>
   {point.unavailable>0&&<p className="stats-note">{point.unavailable} results unavailable; excluded from the rate.</p>}
  </div>
  {undated>0&&<p className="stats-note">{undated} nights without dates are outside this timeline.</p>}
  <details className="history-text"><summary>View performance as text</summary><ol>{visible.map(p=><li key={p.date}>{displayDate(p.date)} · {rateLabel(p.rate)} · {p.wins} / {p.decided} decided nights<ul>{p.nights.map(n=><li key={n.id}>{outcome(n)} · {score(n)}</li>)}</ul></li>)}</ol></details>
 </div>
}
