import { lazy, useEffect, useState } from 'react'
const RivalriesView = lazy(() => import('../stats/RivalriesView').then(m => ({default:m.RivalriesView})))
const MyStatsView = lazy(() => import('../stats/MyStatsView').then(m => ({default:m.MyStatsView})))
import { PageHeading } from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import type { SessionState } from '../../data/remote/database.types'
import { listFrameReplays } from '../../data/remote/replayService'
import { getSessionState } from '../../data/remote/scoringService'
import type { ConnectedGame } from '../connected/useConnectedGame'
import { MatchContext } from '../connected/MatchContext'
import { participantKey, playerContextLabel } from '../connected/matchupPresentation'
import { displayDate, frameRate, headToHead, nightOutcome, rankPlayers } from './presentation'

export function PersonalHome({ name, game }: {name:string;game:ConnectedGame}) {
  const results=useNightResults(game,true)
  const latestId=[...game.sessions].filter(s=>s.status==='finalized').sort((a,b)=>(b.occurred_on??'').localeCompare(a.occurred_on??''))[0]?.id
  const latest=results.states.find(s=>s.session.id===latestId)
  const players=rankPlayers(game.standings).slice(0,2)
  const rivalry=players.length===2?headToHead(results.states,players[0].player_id,players[1].player_id):null
  const active=game.sessions.find(s=>s.status==='active' && results.states.some(saved=>saved.session.id===s.id && saved.session.status==='active'))
  return <div className="personal-home"><PageHeading label={name || ''} title="Home" />
    <a className="button home-play" href={active?`#/session/${active.id}`:'#/play'}><Icon name="play" />{active?'Resume match':'Start match'}<Icon name="arrow" /></a>
    {active && <p className="home-active-context">{game.options?.venues.find(v=>v.id===active.venue_id)?.display_name ?? 'Match in progress'} · <a href="#/play">Start a new match</a></p>}
    {game.groups.length>0&&<MatchContext game={game}/>}
    {game.loading||game.listsLoading||results.loading?<p role="status">Loading results…</p>:null}
    {(game.error||results.failures.length>0)&&<p role="alert">Some results couldn’t be loaded. <button className="text-button" onClick={()=>{game.refresh();results.retry()}}>Try again</button></p>}
    {latest && <section className="home-results"><div className="section-title"><h2>Latest result</h2><a href="#/matches">History <Icon name="arrow" /></a></div><NightCard state={latest} game={game}/></section>}
    {!latest&&!game.loading&&!game.listsLoading&&!results.loading&&!game.error&&!results.failures.length&&<p className="home-first-match">{active?'Your result will appear here when the match finishes.':'Choose your players and venue to get the first match underway.'}</p>}
    {rivalry&&rivalry.nights>0&&!results.loading&&!results.failures.length&&!game.error&&<section className="home-rivalry"><div className="section-title"><h2>Head to head</h2></div><div className="rivalry-score"><span>{players[0].display_name}</span><strong>{rivalry.wins}<small>night wins</small></strong><i>–</i><strong>{rivalry.losses}<small>night wins</small></strong><span>{players[1].display_name}</span></div><p>{rivalry.draws} draws · {rivalry.nights} two-player nights</p>{game.sessions.length===100&&<small>Last 100 nights</small>}</section>}
  </div>
}
function useNightResults(game:ConnectedGame, enabled:boolean) {
  const [states,setStates]=useState<Record<string,SessionState>>({})
  const [failures,setFailures]=useState<string[]>([])
  const [loading,setLoading]=useState(false)
  const [retry,setRetry]=useState(0)
  const key=game.sessions.map(s=>s.id).join(',')
  useEffect(()=>{
    let live=true
    if(!enabled || !game.groupId || game.listsLoading)return
    const ids=key?key.split(','):[]
    let cursor=0
    queueMicrotask(()=>{if(live){setStates({});setFailures([]);setLoading(ids.length>0)}})
    async function worker(){while(live && cursor<ids.length){const id=ids[cursor++];try{const s=await getSessionState(id);if(live && s.session.group_id===game.groupId)setStates(p=>({...p,[id]:s}));else if(live)setFailures(p=>[...p,id])}catch{if(live)setFailures(p=>[...p,id])}}}
    Promise.all(Array.from({length:Math.min(4,ids.length)},worker)).finally(()=>{if(live)setLoading(false)})
    return()=>{live=false}
  },[game.groupId,game.listsLoading,key,enabled,retry])
  // Responses are checked against the active scope even before effects clean up old data.
  const scoped=Object.values(states).filter(s=>s.session.group_id===game.groupId && game.sessions.some(r=>r.id===s.session.id))
  return {states:scoped,loading:loading || (enabled && scoped.length+failures.length<game.sessions.length),failures,retry:()=>setRetry(x=>x+1)}
}
function NightCard({state,game}:{state:SessionState;game:ConnectedGame}){
  const [replayCount, setReplayCount] = useState(0)
  useEffect(() => {
    let alive = true
    listFrameReplays(game.userId, state.session.id).then(rows => { if (alive) setReplayCount(rows.length) }).catch(() => {})
    return () => { alive = false }
  }, [game.userId, state.session.id])
  const active=state.session.status==='active'
  const pair=state.participants.length===2
  return <a className={`night-result-card ${pair?'pair-result':''} ${nightOutcome(state)==='Draw'?'draw-result':''}`} href={`#/session/${state.session.id}`} aria-label={`Open match: ${state.participants.map(p=>`${p.display_name} ${state.scores[p.player_id] ?? 'score not recorded'}`).join(' and ')}, ${nightOutcome(state)}, ${displayDate(state.session.occurred_on)}`}>{replayCount > 0 && <span className="replay-count" aria-label={`${replayCount} playable replays`}><Icon name="video" size={18} /> {replayCount}</span>}
    <div className="night-scorelines">{state.participants.map(p=><div key={p.player_id} className={state.session.status==='finalized' && Object.values(state.scores).filter(s=>s===state.scores[p.player_id]).length===1 && state.scores[p.player_id]===Math.max(...Object.values(state.scores).filter((s):s is number=>s!==null)) ? 'result-winner' : ''}><strong>{p.display_name}</strong><span>{state.scores[p.player_id] ?? '—'}</span></div>)}</div>
    <div className="night-result-meta"><span className={active?'result-badge active-night':'result-badge'}>{active?'In progress':nightOutcome(state)}</span><span>{displayDate(state.session.occurred_on)}</span></div>
    <div className="night-result-footer"><span>{game.options?.venues.find(v=>v.id===state.session.venue_id)?.display_name ?? 'Venue not recorded'}</span><span>{active?'Resume match':state.session.record_kind==='result_only'?'View result':'View match'} <Icon name="arrow" /></span></div>
  </a>

}
export function HistoryView({game,groupView=true}:{game:ConnectedGame;groupView?:boolean}){
  const setGroupView=(show:boolean)=>{window.location.hash=show?'/matches/group':'/matches/personal'}
  const ownPlayer=game.matchupCatalog?.player_id
  const result=useNightResults(game,groupView || !!ownPlayer)
  const [selectedMatchup,setSelectedMatchup]=useState('')
  const matchups=[...new Map(result.states.map(s=>[participantKey(s.participants.map(p=>p.player_id)),s.participants])).entries()].filter(([key])=>key)
  const selectedKey=selectedMatchup
  const includesNight=(id:string)=>(groupView || result.states.some(s=>s.session.id===id && s.participants.some(p=>p.player_id===ownPlayer))) && (!selectedKey || participantKey(result.states.find(s=>s.session.id===id)?.participants.map(p=>p.player_id)??[])===selectedKey)
  const finalized=game.sessions.filter(s=>s.status==='finalized').sort((a,b)=>(b.occurred_on??'').localeCompare(a.occurred_on??'')||a.id.localeCompare(b.id))
  const active=game.sessions.filter(s=>s.status!=='finalized')
  return <div className="results-page history-page"><PageHeading label="" title="Match history" />
    <div className="results-tabs" role="group" aria-label="History view"><button aria-pressed={!groupView} onClick={()=>setGroupView(false)}>My history</button><button aria-pressed={groupView} onClick={()=>setGroupView(true)}>Match history</button></div>
    {!groupView && !ownPlayer ? <section className="results-empty"><h2>Personal history</h2><p>Claim your existing games to see them here.</p>{game.groups.length>0&&<button className="button button-secondary" onClick={()=>setGroupView(true)}>View match results</button>}</section>
    : game.loading ? <p role="status">Loading results…</p> : !game.groups.length ? <section className="personal-connection"><h2>No matches yet</h2><p>Head to Play to choose players and start recording matches.</p><a className="button" href="#/play">Go to Play</a></section> : <>
      <MatchContext game={game} />
      {matchups.length>1&&<label className="matchup-filter">Players<select aria-label="Players" value={selectedKey} onChange={e=>setSelectedMatchup(e.target.value)}><option value="">All available nights</option>{matchups.map(([key,players],index)=><option key={key} value={key!}>{playerContextLabel(players)} · {index+1}</option>)}</select></label>}
      {(game.listsLoading||result.loading)&&<p role="status">Loading match results…</p>}
      {game.error&&<p role="alert">We couldn’t load these results. <button className="text-button" onClick={game.refresh}>Try again</button></p>}
      {!!result.failures.length&&<p role="alert">Some results couldn’t be loaded. <button className="text-button" onClick={result.retry}>Try again</button></p>}
      {!game.listsLoading&&!game.error&&!game.sessions.length&&<section className="personal-connection"><h2>No completed nights</h2><p>Completed nights will appear here.</p><a className="button" href="#/play">Start a night</a></section>}
      {active.some(s=>includesNight(s.id))&&<section className="result-list"><h2>In progress</h2>{active.filter(s=>includesNight(s.id)).map(s=>result.states.find(x=>x.session.id===s.id)).filter((s):s is SessionState=>!!s).map(s=><NightCard key={s.session.id} state={s} game={game}/>)}</section>}
      <section className="result-list" aria-label="Completed nights">{finalized.some(s=>includesNight(s.id))&&<h2>Completed</h2>}{finalized.filter(s=>includesNight(s.id)).map(s=>{const saved=result.states.find(x=>x.session.id===s.id);return saved?<NightCard key={s.id} state={saved} game={game}/>:null})}</section>
      {game.sessions.length===100&&<p className="annotation">Showing the latest 100 recorded nights.</p>}
    </>}
  </div>
}
export function StandingsView({game,personal=false}:{game:ConnectedGame;personal?:boolean}){
  const [tab,setTab]=useState<'leaders'|'rivalries'|'personal'>(personal?'personal':'leaders')
  const ranked=rankPlayers(game.standings)
  const rows=ranked
  return <div className="results-page stats-page"><PageHeading label="" title="Stats" />
    <div className="results-tabs stats-tabs" role="group" aria-label="Stats view">{(['personal','rivalries','leaders'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='personal'?'My stats':t==='rivalries'?'Rivalries':'Leaderboards'}</button>)}</div>
    {tab==='personal'?<MyStatsView/>:tab==='rivalries'?<RivalriesView/>:<>
    {!game.groups.length ? <section className="personal-connection"><h2>No stats yet</h2><p>Finish a night to start building your record.</p><a className="button" href="#/play">Go to Play</a></section> : <><MatchContext game={game}/>
    <p className="annotation">All time</p>
    {game.listsLoading&&<p role="status">Loading stats…</p>}
    {game.error&&<p role="alert">We couldn’t load stats. <button className="text-button" onClick={game.refresh}>Try again</button></p>}
    {!game.listsLoading&&!game.error&&!rows.length&&<p className="personal-connection">The first completed night starts your leaderboard.</p>}
    {tab==='leaders'&&<ol className="leaderboard">{rows.map(p=>{const rate=frameRate(p.frames_won,p.frames_lost);const nightRate=frameRate(p.wins,p.losses);return <li key={p.player_id}><div className="leaderboard-heading"><span className="player-rank">{p.rank}</span><h2>{p.display_name}</h2><strong>{p.wins}<small>night wins</small></strong></div><dl className="night-record compact-record"><div><dt>Wins</dt><dd>{p.wins}<span>W</span></dd></div><div><dt>Losses</dt><dd>{p.losses}<span>L</span></dd></div><div><dt>Draws</dt><dd>{p.draws}<span>D</span></dd></div></dl><p className="night-rate">{p.nights} nights played · {nightRate===null?'No decisive nights':`${nightRate.toFixed(1)}% decisive-night win rate`}</p><details className="frame-support"><summary>Frame stats</summary><dl className="player-results"><div><dt>Won</dt><dd>{p.frames_won}</dd></div><div><dt>Lost</dt><dd>{p.frames_lost??'—'}</dd></div><div><dt>Difference</dt><dd>{p.frames_lost===null?'—':`${p.frames_won-p.frames_lost>=0?'+':''}${p.frames_won-p.frames_lost}`}</dd></div><div><dt>Win rate</dt><dd>{rate===null?'—':`${rate.toFixed(1)}%`}</dd></div><div><dt>Frames played</dt><dd>{p.frames_played??'—'}</dd></div></dl></details>{p.multiplayer_nights>0&&<p className="annotation">Night wins, losses and draws count two-player nights only.</p>}</li>})}</ol>}
    {tab==='leaders'&&!!rows.length&&<p className="ranking-note">Tied records share a place. Win rate excludes draws.</p>}
    </>}</>}
  </div>
}
