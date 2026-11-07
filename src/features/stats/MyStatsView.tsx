import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { getPersonalPerformance } from '../../data/remote/performanceService'
import { displayDate } from '../results/presentation'
import { performance, ratio, resultFor } from './performance'
import { FrameAnalyticsSections } from './FrameAnalyticsSections'
import { DisclosureHeading } from '../../components/ui/DisclosureHeading'
import { NightTrend } from './NightTrend'
import './MyStatsView.css'
const FrameInsights=lazy(()=>import('./FrameInsights'))
const PersonalHistoryChart=lazy(()=>import('./PersonalHistoryChart'))
class HistoryBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?this.props.fallback:this.props.children}
}
const streak=(value:number|null,range:[number,number]|null)=>value??(range?`${range[0]}–${range[1]}`:'—')
const number=(n:number|null,suffix='')=>n===null?'—':`${n.toFixed(1)}${suffix}`
export function MyStatsView() {
  const [data,setData]=useState<Awaited<ReturnType<typeof getPersonalPerformance>>|null>(null)
  const [insightsOpened,setInsightsOpened]=useState(false)
  const [insightsLoaded,setInsightsLoaded]=useState(false)
  const [trendsOpen,setTrendsOpen]=useState(false)
  const [selectedNight,setSelectedNight]=useState<string|null>(null)
  const [loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{let live=true;getPersonalPerformance().then(d=>{if(live){setData(d);setError(false)}}).catch(()=>{if(live)setError(true)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[retry])
  if(loading)return <p role="status">Loading your stats…</p>
  if(error)return <section><p role="alert">Your stats couldn’t be loaded.</p><button className="button button-secondary" onClick={()=>{setLoading(true);setRetry(n=>n+1)}}>Try again</button></section>
  if(!data?.totals)return <section className="results-empty"><h2>Your games</h2><p>Claim your existing games to see your stats.</p><a className="text-button" href="#/account">Account</a></section>
  const s=data.totals, p=performance(s,data.nights)
  const framePerformance=<dl className="personal-metrics"><div><dt>Won</dt><dd>{s.frames_won}</dd></div><div><dt>Lost</dt><dd>{s.frames_lost??'—'}</dd></div><div><dt>Win rate</dt><dd>{number(ratio(s.frames_won,s.frames_lost),'%')}</dd></div><div><dt>Won per night</dt><dd>{number(p.avgWon)}</dd></div><div><dt>Lost per night</dt><dd>{number(p.avgLost)}</dd></div></dl>
  const recentNight=p.recent.find(n=>n.id===selectedNight)??p.recent[0]
  return <div className="my-performance"><section className="personal-summary"><header className="personal-summary-header"><h2>{s.display_name??'Your record'}</h2>
    <details className="stats-about"><summary aria-label="About these stats" title="About these stats"><span aria-hidden="true">ⓘ</span><span className="sr-only">About these stats</span></summary><div><p>Night results and frame totals include older nights saved as final scores. Breaks, fouls, pockets and timing use available individual frame observations, so their samples can cover a shorter period.</p><p>Missing observations aren’t counted as zero or failed attempts. Frame runs and comebacks need complete, ordered frame logs.</p></div></details></header>
    <dl className="night-record personal-record"><div><dt>Won</dt><dd>{s.wins}</dd></div><div><dt>Lost</dt><dd>{s.losses}</dd></div><div><dt>Drawn</dt><dd>{s.draws}</dd></div></dl>
    <div className="personal-headline"><div><strong>{s.nights}</strong><span>nights played</span></div><div><strong>{number(ratio(s.wins,s.losses),'%')}</strong><span>night win rate</span></div></div>
    <p className="stats-note">Night win rate excludes draws.</p>
    {s.multiplayer_nights>0&&<p className="stats-note">Includes {s.multiplayer_nights} multiplayer {s.multiplayer_nights===1?'night':'nights'}. Night records and streaks count head-to-head nights.</p>}
    {!s.nights&&<p className="stats-note">Finish your first match to start your record.</p>}
  </section>

  {data.nights!==null&&<section className="personal-form personal-performance-history"><h2>Performance over time</h2><HistoryBoundary key={s.player_id} fallback={<><p className="stats-note">Interactive history unavailable.</p><details className="personal-existing-progress"><summary>View performance as text</summary><ol>{p.series.map(day=><li key={day.date}>{displayDate(day.date)} · {number(ratio(day.wins,day.losses),'%')} · {day.wins} wins / {day.wins+day.losses} recorded wins and losses</li>)}</ol></details></>}><Suspense fallback={<div className="personal-history-loading" role="status">Loading performance history…</div>}><PersonalHistoryChart key={s.player_id} nights={data.nights} series={p.series} playerId={s.player_id}/></Suspense></HistoryBoundary></section>}
  {data.nights!==null&&<section className="personal-secondary frame-insights-section"><DisclosureHeading expanded={insightsOpened} controls="frame-insights-content" onToggle={()=>{setInsightsOpened(!insightsOpened);setInsightsLoaded(true)}}>Frame Insights</DisclosureHeading><div id="frame-insights-content" hidden={!insightsOpened}>{insightsLoaded&&<HistoryBoundary key={s.player_id} fallback={<p className="stats-note">Frame Insights couldn’t load. Your other statistics remain available.</p>}><Suspense fallback={<p role="status">Loading Frame Insights…</p>}><FrameInsights key={s.player_id} nights={data.nights} playerId={s.player_id}/></Suspense></HistoryBoundary>}</div></section>}
  <section className="personal-secondary"><h2>Winning streaks</h2><dl className="personal-metrics"><div><dt>Current</dt><dd>{streak(p.current,p.currentRange)}</dd></div><div><dt>Longest</dt><dd>{streak(p.longest,p.longestRange)}</dd></div></dl><p className="stats-note">A loss or draw ends a streak.{(p.currentRange?.[0]!==p.currentRange?.[1]||p.longestRange?.[0]!==p.longestRange?.[1])?' Ranges reflect unknown order within a day.':''}</p></section>
  {data.nights!==null?<FrameAnalyticsSections key={s.player_id} nights={data.nights} playerId={s.player_id} framePerformance={framePerformance}/>:<section className="personal-secondary"><h2>Frame performance</h2><h3 className="detail-subtitle frame-results-subtitle">Frame results</h3>{framePerformance}</section>}
  <section className="personal-form"><h2>Last 10 nights</h2>{p.recent.length?<><p className="stats-note">Newest → oldest · same-day order may be unknown</p><div className="recent-strip" aria-label="Recent results, newest to oldest">{p.recent.map(n=><button type="button" key={n.id} onClick={()=>setSelectedNight(n.id)} className={`form-mark form-${resultFor(n,s.player_id)}`} aria-pressed={recentNight.id===n.id} aria-controls="recent-night-detail" aria-label={`${resultFor(n,s.player_id)} · ${displayDate(n.date)} · ${n.participants.filter(a=>a.player_id!==s.player_id).map(a=>a.name).join(', ')}`}>{resultFor(n,s.player_id)}</button>)}</div><div id="recent-night-detail" className="recent-night-detail" aria-live="polite"><p>{recentNight.participants.filter(a=>a.player_id!==s.player_id).map(a=>a.name).join(' · ')}</p><small>{displayDate(recentNight.date)}</small><p className="form-score">{[...recentNight.participants].sort((a,b)=>Number(b.player_id===s.player_id)-Number(a.player_id===s.player_id)).map(a=>`${a.name} ${a.frames_won??'—'}`).join(' · ')}</p></div></>:<p className="stats-note">Your completed matches will appear here.</p>}</section>
  <section className="personal-secondary personal-existing-progress additional-trends"><DisclosureHeading expanded={trendsOpen} controls="additional-trends-content" onToggle={()=>setTrendsOpen(!trendsOpen)}>Additional trends</DisclosureHeading><div id="additional-trends-content" hidden={!trendsOpen}><h3 className="detail-subtitle">Cumulative wins and losses</h3><NightTrend series={p.series}/>{!p.ordered&&p.series.length>0&&<p className="stats-note">Same-day nights are grouped. No order within a day is implied.</p>}</div></section>
  {s.nights>0&&data.nights===null&&<p className="stats-note">Your totals are ready. Recent form and progress aren’t available yet.</p>}

  </div>
}
