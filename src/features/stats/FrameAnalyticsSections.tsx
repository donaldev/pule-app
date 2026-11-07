import { useEffect, useState, type ReactNode } from 'react'
import { getFrameSummary } from '../../data/remote/framePerformanceService'
import { frameAnalytics, type FrameNight } from './frameAnalytics'
import { displayDate } from '../results/presentation'
import type { PersonalNight } from './performance'
const time=(ms:number)=>{const seconds=Math.round(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
const eventNames:Record<string,string>={regular:'Normal',golden_break:'Golden Break',break_and_run:'Break & Run',dry_clearance:'Dry Clearance',super_foul:'Super Foul'}
const pocketNames:Record<string,string>={TL:'Top left',TM:'Top middle',TR:'Top right',BL:'Bottom left',BM:'Bottom middle',BR:'Bottom right'}
function DistributionBar({label,count,total}:{label:string;count:number;total:number}) {
 return <div className="stat-bar"><div><span>{label}</span><strong>{count} <small>/ {total}</small></strong></div><div className="stat-track"><span style={{width:`${total?100*count/total:0}%`}}/></div></div>
}
export function PocketDistribution({counts,total}:{counts:Record<string,number>;total:number}) {
 const [selected,setSelected]=useState<string|null>(null)
 const percent=(key:string)=>`${(total?100*(counts[key]??0)/total:0).toFixed(1)}%`
 return <><div className="pocket-distribution" data-orientation="break-left-rack-right">
 <svg viewBox="-30 -30 380 220" aria-hidden="true"><rect x="0" y="0" width="320" height="160" rx="8" fill="#103C2C" stroke="#4B3325" strokeWidth="12"/>
 {/* Break left, rack right: decorative ball at 75% of the longitudinal centreline. */}
 <g transform="translate(240 80)"><circle r="14" fill="#090C0A" stroke="#70766D"/><circle r="7" fill="#F1EBDD"/><text y="4" textAnchor="middle" fill="#0B0E0C" fontSize="11" fontWeight="700">8</text></g>
 </svg>
 {Object.entries(pocketNames).map(([key,label],i)=><button type="button" key={key} className="stats-pocket" data-most-used={total>0&&(counts[key]??0)===Math.max(...Object.values(counts))} style={{left:`${100*(30+(i%3)*160)/380}%`,top:`${100*(30+(i<3?0:160))/220}%`}} aria-pressed={selected===key} aria-label={`${label}: ${percent(key)}, ${counts[key]??0} of ${total} recorded wins`} onClick={()=>setSelected(key)}>{percent(key)}</button>)}
 </div><p className="stats-note pocket-detail" role="status">{selected?`${pocketNames[selected]} · ${counts[selected]??0} of ${total} wins · ${percent(selected)}`:`${total} recorded winning pockets · Tap a pocket for details`}</p></>
}
export function FrameAnalyticsSections({nights,playerId,framePerformance}:{nights:PersonalNight[];playerId:string;framePerformance?:ReactNode}) {
 const [details,setDetails]=useState<FrameNight[]|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0)
 useEffect(()=>{let live=true;getFrameSummary(playerId).then(rows=>{if(live){setDetails(rows);setFailed(false)}}).catch(()=>{if(live){setFailed(true);setDetails(null)}}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[playerId,retry])
 const a=frameAnalytics(nights,details,playerId),r=a.records,b=a.breaks,s=a.style,c=a.coverage
 const records:[string,number|null,string][]=[['Most frames in a night',r.mostFrames,''],['Biggest winning margin',r.biggestMargin,'frames'],['Closest victory',r.closestWin,'frames'],['Best frame-winning run',r.longestFrameRun,'frames'],['Biggest comeback',r.biggestComeback,'frames behind'],['Wins after trailing',r.winsAfterTrailing,'nights']]
 const breakRates:[string,typeof b.pot][]=[['Break-pot success',b.pot],['Break hold',b.hold],['Break steal',b.steal]]
 const hasStyle=s.averageWinMs!==null||s.longestMs!==null||s.fouls!==null
 return <>
 {records.some(([,v])=>v!==null)&&<section className="personal-secondary"><h2>My records</h2><dl className="detail-metrics record-achievements">{records.filter(([,v])=>v!==null).map(([label,value,unit])=>{
 const matching=nights.find(n=>{const own=n.participants.find(p=>p.player_id===playerId)?.frames_won,other=n.participants.find(p=>p.player_id!==playerId)?.frames_won;return label==='Most frames in a night'?own===value:(label==='Biggest winning margin'||label==='Closest victory')&&n.participants.length===2&&own!=null&&other!=null&&own>other&&own-other===value})
 return <div key={label}><dt>{label}</dt><dd>{value}<small>{unit}</small></dd>{matching&&<p className="stats-note">{matching.participants.filter(p=>p.player_id!==playerId).map(p=>p.name).join(' · ')} · {displayDate(matching.date)}</p>}</div>})}</dl></section>}
 {loading&&<p role="status" className="stats-note">Loading frame details…</p>}
 {failed&&<p role="alert" className="stats-note">Frame details couldn’t be loaded. <button className="text-button" onClick={()=>{setLoading(true);setRetry(x=>x+1)}}>Try again</button></p>}
 {b.recorded>0||b.steal.total>0||c.events>0?<section className="personal-secondary break-performance"><h2>Break performance</h2><dl className="detail-metrics">{b.recorded>0&&<div><dt>Recorded breaks</dt><dd>{b.recorded}</dd></div>}</dl><div className="rate-bars">{breakRates.filter(([,rate])=>rate.total>0).map(([label,rate])=><div key={label}><div className="rate-heading"><span>{label}</span><strong>{rate.percent!.toFixed(1)}%</strong></div><DistributionBar label={label==='Break steal'?'Opponent breaks':'Your breaks'} count={rate.won} total={rate.total}/></div>)}</div><dl className="detail-metrics">{b.goldenBreaks!==null&&<div><dt>Golden Breaks</dt><dd>{b.goldenBreaks}</dd></div>}{b.breakRuns!==null&&<div><dt>Break & Runs</dt><dd>{b.breakRuns}</dd></div>}</dl><p className="stats-note">{c.events>0&&<>Win types: {c.events} recorded wins. </>}Hold: win on your break; steal: win on your opponent’s break.</p></section>:null}
 {(framePerformance||hasStyle)&&<section className="personal-secondary frame-performance"><h2>Frame performance</h2>{framePerformance&&<><h3 className="detail-subtitle frame-results-subtitle">Frame results</h3>{framePerformance}</>}{hasStyle&&<><h3 className="detail-subtitle">Playing style</h3><dl className="detail-metrics">{s.averageWinMs!==null&&<div><dt>Average winning-frame duration</dt><dd>{time(s.averageWinMs)}<small>{c.winTimes} timed wins</small></dd></div>}{s.fastestWinMs!==null&&<div><dt>Fastest frame win</dt><dd>{time(s.fastestWinMs)}</dd></div>}{s.longestMs!==null&&<div><dt>Longest frame</dt><dd>{time(s.longestMs)}<small>{c.durations} timed frames</small></dd></div>}{s.fouls!==null&&<div><dt>Recorded fouls</dt><dd>{s.fouls}<small>{c.fouls} recorded frames</small></dd></div>}</dl></>}</section>}
 {c.events>0&&<section className="personal-secondary win-type-performance"><h2>Your frame wins by type</h2><div className="rate-bars">{Object.entries(s.types).map(([key,count])=><DistributionBar key={key} label={eventNames[key]??key} count={count} total={c.events}/>)}</div></section>}
 {c.pockets>0&&<section className="personal-secondary pocket-performance"><h2>Black-ball pockets in your wins</h2><PocketDistribution counts={s.pockets} total={c.pockets}/></section>}
 {!loading&&!failed&&c.frames===0&&<p className="stats-note">{c.available?'No eligible frame details are recorded for these nights.':'Detailed frame metrics aren’t available yet.'}</p>}
 </>
}
