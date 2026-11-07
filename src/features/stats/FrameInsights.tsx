import { useEffect, useState } from 'react'
import { Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { getFrameSummary } from '../../data/remote/framePerformanceService'
import type { FrameNight } from './frameAnalytics'
import type { PersonalNight } from './performance'
import { frameInsightsData } from './frameInsightsData'
import { displayDate } from '../results/presentation'
import './FrameInsights.css'
const time=(ms:number|null)=>ms===null?'Not available':`${Math.floor(Math.round(ms/1000)/60)}:${String(Math.round(ms/1000)%60).padStart(2,'0')}`
export default function FrameInsights({nights,playerId}:{nights:PersonalNight[];playerId:string}) {
 const [details,setDetails]=useState<FrameNight[]|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0)
 const [nightId,setNight]=useState(''),[view,setView]=useState<'duration'|'fouls'>('duration'),[frameId,setFrame]=useState('')
 useEffect(()=>{let live=true;getFrameSummary(playerId).then(d=>{if(live){setDetails(d);setFailed(false)}}).catch(()=>{if(live)setFailed(true)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[playerId,retry])
 if(loading)return <p role="status">Loading frame observations…</p>
 if(failed)return <p role="alert">Frame observations couldn’t be loaded. <button type="button" className="text-button" onClick={()=>{setLoading(true);setRetry(n=>n+1)}}>Try again</button></p>
 const available=frameInsightsData(nights,details??[],playerId),selected=available.find(n=>n.night.id===nightId)??available[0]
 if(!selected)return <p className="stats-note">{details===null?'Frame insights aren’t available yet.':'No eligible individual frame observations yet. Older final scores remain in your main statistics.'}</p>
 const {night,rows}=selected,frame=rows.find(f=>f.id===frameId)??rows[0],index=rows.indexOf(frame)
 const name=(id:string|null)=>night.participants.find(p=>p.player_id===id)?.name??'Not recorded'
 const label=(n:PersonalNight)=>`${displayDate(n.date)} · ${n.participants.filter(p=>p.player_id!==playerId).map(p=>p.name).join(' / ')}`
 const value=view==='duration'?frame.duration:frame.ownFouls
 return <div className="frame-insights">
  <label>Recorded night<select aria-label="Frame insights night" value={night.id} onChange={e=>{setNight(e.target.value);setFrame('')}}>{available.map(n=><option key={n.night.id} value={n.night.id}>{label(n.night)}</option>)}</select></label>
  <div className="insight-tabs" role="group" aria-label="Frame insight view">{(['duration','fouls'] as const).map(v=><button type="button" key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v==='duration'?'Duration':'Fouls'}</button>)}</div>
  {view==='duration'?<><dl className="insight-metrics"><div><dt>Median frame duration</dt><dd>{time(selected.median)}</dd></div><div><dt>Average frame duration</dt><dd>{time(selected.average)}</dd></div></dl><p className="stats-note">Timed frames: {selected.timed} / {rows.length}</p></>:<><div className="insight-counters">{selected.counters.map(p=><div key={p.id}><strong>{p.name}</strong><span>{p.total??'Unknown'} recorded fouls/scratches</span><small>{p.rate===null?'Rate unavailable':`${p.rate.toFixed(2)} per known frame`} · {p.known} / {p.played} counters known</small></div>)}</div><p className="stats-note">Historical counters recorded scratches; current counters record fouls. Super Foul tags aren’t added. Counters cover frames you played; comparisons use each player’s known frames.</p></>}
  <div className="insight-plot" tabIndex={0} role="group" aria-label={`${view==='duration'?'Frame duration':'Your recorded foul/scratch count'} by frame. Use left and right arrows to inspect.`} onKeyDown={e=>{const next=e.key==='ArrowLeft'?index-1:e.key==='ArrowRight'?index+1:-1;if(next>=0&&next<rows.length){e.preventDefault();setFrame(rows[next].id)}}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect(),x=rows[0].number+Math.max(0,Math.min(1,(e.clientX-r.left-40)/Math.max(1,r.width-56)))*(rows.at(-1)!.number-rows[0].number);setFrame(rows.reduce((a,b)=>Math.abs(b.number-x)<Math.abs(a.number-x)?b:a).id)}}>
   <ResponsiveContainer width="100%" height={200} minWidth={0}><LineChart data={rows} margin={{top:12,right:16,bottom:8,left:0}} accessibilityLayer={false}>
    <XAxis dataKey="number" type="number" domain={[rows[0].number,Math.max(rows[0].number+1,rows.at(-1)!.number)]} allowDecimals={false} tick={{fill:'#A7A99E',fontSize:11}} tickLine={false} minTickGap={24}/>
    <YAxis width={40} domain={[0,'auto']} allowDecimals={view==='duration'} tickFormatter={v=>view==='duration'?time(v):String(v)} tick={{fill:'#A7A99E',fontSize:11}} tickLine={false}/>
    <Line dataKey={view==='duration'?'duration':'ownFouls'} name={view==='duration'?'Frame duration':'Your fouls/scratches'} stroke="#C2A06B" strokeWidth={2} dot={{r:3}} activeDot={false} connectNulls={false} isAnimationActive={false}/>
    {value!==null&&<ReferenceDot x={frame.number} y={value} r={6} fill="#C2A06B" stroke="#F1EBDD" strokeWidth={2}/>}
   </LineChart></ResponsiveContainer>
  </div><p className="stats-note">Frame number · {view==='duration'?'frame duration':'your foul/scratch counter'}</p>
  <div className="insight-inspection"><button type="button" aria-label="Previous insight frame" disabled={index===0} onClick={()=>setFrame(rows[index-1].id)}>←</button><label>Inspect frame<select aria-label="Inspect frame" value={frame.id} onChange={e=>setFrame(e.target.value)}>{rows.map(f=><option key={f.id} value={f.id}>Frame {f.number}</option>)}</select></label><button type="button" aria-label="Next insight frame" disabled={index===rows.length-1} onClick={()=>setFrame(rows[index+1].id)}>→</button></div>
  <div className="insight-detail" aria-live="polite"><strong>Frame {frame.number} · Winner: {name(frame.winner)}</strong>{view==='duration'?<p>{time(frame.duration)}{frame.duration===null&&frame.elapsed_ms!==null?` · Raw recorded value: ${time(frame.elapsed_ms)}`:''}{frame.unusual?' · Unusual within this night; inspect recording':''}</p>:frame.players.map(p=><p key={p.id}>{name(p.id)}: {p.fouls??'Unknown'} fouls/scratches</p>)}</div>
  {view==='duration'&&<p className="stats-note">Unusual flags use this night’s interquartile range with at least four timings; no values are removed.</p>}
  <details className="insight-text"><summary>View frame observations as text</summary><ol>{rows.map(f=><li key={f.id}><strong>Frame {f.number} · Winner: {name(f.winner)}</strong>{view==='duration'?<p>{time(f.duration)}{f.unusual?' · Unusual':''}</p>:<p>{f.players.map(p=>`${name(p.id)}: ${p.fouls??'unknown'}`).join(' / ')} fouls/scratches</p>}</li>)}</ol></details>
 </div>
}
