import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { getPersonalPerformance } from '../../data/remote/performanceService'
import { displayDate } from '../results/presentation'
import { NightTrend } from './NightTrend'
import { resultFor } from './performance'
import { rivalryOpponents, rivalryRecord } from './rivalry'
import './RivalriesView.css'
// Session-only preference; no account data or results are cached here.
const selectedOpponents=new Map<string,string>()
const RivalryProgression=lazy(()=>import('./RivalryProgression'))
class ProgressionBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?this.props.fallback:this.props.children}
}
export function RivalriesView() {
 const [data,setData]=useState<Awaited<ReturnType<typeof getPersonalPerformance>>|null>(null)
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0),[selected,setSelected]=useState<{playerId:string;opponentId:string}|null>(null)
 useEffect(()=>{let live=true;getPersonalPerformance().then(d=>{if(live){setData(d);setError(false)}}).catch(()=>{if(live)setError(true)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[retry])
 if(loading)return <p role="status">Loading rivalries…</p>
 if(error)return <section><p role="alert">Your rivalries couldn’t be loaded.</p><button className="button button-secondary" onClick={()=>{setLoading(true);setRetry(n=>n+1)}}>Try again</button></section>
 if(!data?.totals)return <section className="results-empty"><h2>Your rivalries</h2><p>Claim your existing games to see your rivalries.</p><a className="text-button" href="#/account">Account</a></section>
 if(data.nights===null)return <p className="personal-connection">Your rivalry results aren’t available yet.</p>
 const own=data.totals.player_id,opponents=rivalryOpponents(data.nights,own)
 if(!opponents.length)return <section className="results-empty"><h2>Your next rivalry starts here</h2><p>Finish a head-to-head match to see your record against an opponent.</p><a className="button" href="#/play">Play</a></section>
 const selectedId=selected?.playerId===own?selected.opponentId:selectedOpponents.get(own)
 const opponent=opponents.find(o=>o.id===selectedId)??opponents[0]
 const pairNights=data.nights.filter(n=>n.participants.length===2&&n.participants.some(p=>p.player_id===own)&&n.participants.some(p=>p.player_id===opponent.id))
 const record=rivalryRecord(pairNights,own,opponent.id),ownName=data.totals.display_name??'You'
 return <div className="my-performance personal-rivalry">
 {opponents.length>1?<label className="rivalry-opponent">Playing against<select aria-label="Playing against" value={opponent.id} onChange={e=>{selectedOpponents.set(own,e.target.value);setSelected({playerId:own,opponentId:e.target.value})}}>{opponents.map((o,i)=><option key={o.id} value={o.id}>{o.name}{opponents.filter(x=>x.name===o.name).length>1?` · Player ${i+1}`:''} · {o.nights} {o.nights===1?'night':'nights'}</option>)}</select></label>:<dl className="rivalry-opponent"><dt>Playing against</dt><dd className="rivalry-opponent-name">{opponent.name}</dd></dl>}
 <section className="personal-summary"><h2>Head to head</h2><div className="personal-rivalry-score"><div><span>{ownName}</span><strong>{record.wins}</strong></div><span aria-hidden="true">–</span><div><span>{opponent.name}</span><strong>{record.losses}</strong></div></div><p className="rivalry-record-summary">{record.draws} {record.draws===1?'draw':'draws'} · {record.nights} nights played</p><dl className="personal-metrics"><div><dt>Your night win rate</dt><dd>{record.winRate===null?'—':`${record.winRate.toFixed(1)}%`}</dd></div><div><dt>Frames won</dt><dd>{record.forFrames??'—'}</dd></div><div><dt>Frames lost</dt><dd>{record.againstFrames??'—'}</dd></div></dl><p className="stats-note">Night wins · win rate excludes draws.</p>{record.unknown&&<p className="stats-note">Some final scores weren’t recorded.</p>}</section>
 <section className="personal-form"><h2>{record.progress.recent.length>10?'Recent nights':'Last 10 nights'}</h2>{record.progress.recent.length?<ol>{record.progress.recent.map((n,i)=><li key={n.id}><span className={`form-mark form-${resultFor(n,own)}`} aria-label={({W:'Win',L:'Loss',D:'Draw',M:'Multiplayer','—':'Result unavailable'})[resultFor(n,own)]}>{resultFor(n,own)}</span><div><p>{n.participants.find(p=>p.player_id===own)?.frames_won??'—'} – {n.participants.find(p=>p.player_id===opponent.id)?.frames_won??'—'}</p><small>{displayDate(n.date)}{i===0?(record.progress.latestAmbiguous?' · Latest date':' · Most recent'):''}</small></div></li>)}</ol>:<p className="stats-note">Recent form needs clearly dated match results.</p>}</section>
 <section className="personal-form"><h2>Rivalry progression</h2>{record.progress.sameDay&&<p className="stats-note">Same-day nights are grouped when their order wasn’t recorded.</p>}{record.progress.ordered?<ProgressionBoundary key={`${own}/${opponent.id}`} fallback={<><p className="stats-note">Interactive chart unavailable. Showing summary.</p><NightTrend series={record.progress.series} labels={[ownName,opponent.name]}/></>}><Suspense fallback={<div style={{height:240}} role="status">Loading progression…</div>}><RivalryProgression key={`${own}/${opponent.id}`} nights={pairNights} series={record.progress.series} ownId={own} opponentId={opponent.id} labels={[ownName,opponent.name]}/></Suspense></ProgressionBoundary>:<p className="stats-note">Progress needs clearly dated match results.</p>}</section>
 </div>
}
