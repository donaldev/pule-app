import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Eyebrow, Modal, PageHeading } from '../../components/ui/Primitives'
import type { FramePair, Pocket, SavedFrame, SessionState, SpecialEvent } from '../../data/remote/database.types'
import type { ConnectedGame } from './useConnectedGame'
import { MatchDisclosureHeading } from './MatchDisclosureHeading'
import { MatchMomentumSection } from './MatchMomentumSection'
import { frameDefaults } from './frameDefaults'
import { displayDate } from '../results/presentation'
import { revealRecovery } from './recoveryPresentation'
function duration(milliseconds: number | null) {
  if (milliseconds === null) return 'Not recorded'
  const s = Math.floor(milliseconds / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function FrameClock({ frame }: { frame: SavedFrame }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer) }, [])
  const shown = (frame.elapsed_ms ?? 0) + (frame.status === 'running' && frame.running_since ? Math.max(0, now - Date.parse(frame.running_since)) : 0)
  return <span className="connected-clock">{duration(shown)}<small>{frame.status === 'paused' ? 'Paused' : 'Playing'}</small></span>
}
function FrameEntry({ frame, state, game, correcting, onSaved }: { frame: SavedFrame; state: SessionState; game: ConnectedGame; correcting: boolean; onSaved: (winnerId?: string) => void }) {
  const pair = [...frame.participants].sort((a, b) => a.side - b.side)
  const [winner, setWinner] = useState(frame.winner_id ?? '')
  const [fouls, setFouls] = useState(pair.map(p => p.foul_count ?? 0))
  const [pot, setPot] = useState<'unknown' | 'yes' | 'no'>(frame.potted_on_break === true ? 'yes' : frame.potted_on_break === false ? 'no' : correcting ? 'unknown' : 'no')
  const [special, setSpecial] = useState<SpecialEvent>(frame.special_event ?? 'regular')
  const [pocket, setPocket] = useState<Pocket | ''>(frame.black_pocket_code ?? '')
  const [offender, setOffender] = useState(frame.offender_id ?? '')
  const name = (id: string) => state.participants.find(p => p.player_id === id)?.display_name ?? 'Unknown player'
  const invalidSpecial = special === 'super_foul' ? !offender || offender === winner : ['golden_break', 'break_and_run'].includes(special) && (winner !== frame.breaker_id || pot !== 'yes')
  const valid = !!winner && fouls.every(f => Number.isInteger(f) && f >= 0) && pot !== 'unknown' && !invalidSpecial && (correcting || !!pocket)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || game.inputBlocked || !game.canScore || (correcting && state.session.status !== 'active')) return
    const base = { p_session: state.session.id, p_expected_revision: state.session.revision, p_frame: frame.id, p_winner: winner, p_p1_fouls: fouls[0], p_p2_fouls: fouls[1] }
    const ok = correcting ? await game.scoring('correct_frame', { ...base, p_reason: 'Edited saved frame', p_details: { special_event: special, potted_on_break: pot === 'yes', offender_id: special === 'super_foul' ? offender || null : null } })
      : await game.scoring('complete_frame', { ...base, p_potted_on_break: pot === 'yes', p_special: special, p_pocket: pocket || null, p_offender: special === 'super_foul' ? offender : null })
    if (ok) onSaved(correcting ? undefined : winner)
  }
  return <form className={`connected-form frame-entry ${winner ? 'is-confirming' : 'is-playing'} ${correcting ? 'is-correcting' : ''}`} onSubmit={e => void submit(e)}><fieldset disabled={game.inputBlocked || !game.canScore}>
    <legend className="sr-only">{correcting ? `Editing frame ${frame.frame_number}` : 'Score this frame'}</legend>
    {!correcting && <>
      <header className="frame-status-bar match-header"><div><h1>{game.options?.venues.find(v => v.id === state.session.venue_id)?.display_name ?? 'At the table'}</h1><small aria-live="polite">Frame {frame.frame_number}{frame.status === 'paused' ? ' · Paused' : ''}</small></div><FrameClock frame={frame} /><button type="button" className="clock-toggle" aria-label={frame.status === 'running' ? 'Pause timer' : 'Resume timer'} onClick={() => void game.scoring('set_frame_paused', { p_session: state.session.id, p_expected_revision: state.session.revision, p_frame: frame.id, p_paused: frame.status === 'running' })}>{frame.status === 'running' ? 'Ⅱ' : '▶'}</button></header>
      <div className="break-strip"><div className="break-choice" role="group" aria-label="Potted on break"><span>Potted on break?</span><div>{(['no', 'yes'] as const).map(value => <button type="button" key={value} aria-pressed={pot === value} onClick={() => { setPot(value); if (value === 'no' && ['golden_break', 'break_and_run'].includes(special)) setSpecial('regular') }}>{value === 'no' ? 'No' : 'Yes'}</button>)}</div></div></div>
    </>}
    <div className="frame-player-cards">{pair.map((p, i) => <section className="frame-player-card" key={p.player_id} aria-label={name(p.player_id)}>
      <h2>{name(p.player_id)}</h2><div className="breaker-marker">{frame.breaker_id === p.player_id ? <span>Breaker</span> : <i />}</div>
      <span className="frame-score">{state.scores[p.player_id] ?? '—'}</span><small>Frames won</small>
      <div className="frame-fouls"><span>Fouls</span><div className="connected-counter">
        <button type="button" aria-label={`Remove foul for ${name(p.player_id)}`} disabled={fouls[i] === 0} onClick={() => setFouls(f => f.map((n, index) => index === i ? Math.max(0, n - 1) : n))}>−</button>
        <output aria-label={`Fouls for ${name(p.player_id)}`} aria-live="polite">{fouls[i]}</output><button type="button" aria-label={`Add foul for ${name(p.player_id)}`} onClick={() => setFouls(f => f.map((n, index) => index === i ? n + 1 : n))}>+</button>
      </div></div>
      <button type="button" className="winner-choice" aria-pressed={winner === p.player_id} onClick={() => { setWinner(p.player_id); if (!correcting && special === 'golden_break' && p.player_id !== frame.breaker_id) setSpecial('regular') }}>{name(p.player_id)} won{winner === p.player_id && <span aria-hidden="true"> ✓</span>}</button>
    </section>)}</div>
    {winner && <>
      <section className="frame-confirmation" aria-label="Complete the frame"><h2 className="sr-only">Complete the frame</h2>
        {!correcting && <fieldset className="pocket-picker"><legend>Black-ball pocket</legend><div className="pocket-table" data-orientation="break-left-rack-right"><span className="eight-ball" aria-hidden="true">8</span>{(['TL', 'TM', 'TR', 'BL', 'BM', 'BR'] as const).map((p, i) => <button type="button" key={p} aria-pressed={pocket === p} aria-label={['Top left', 'Top middle', 'Top right', 'Bottom left', 'Bottom middle', 'Bottom right'][i]} onClick={() => setPocket(p)}><span /></button>)}</div><button type="button" className="text-button" onClick={() => setPocket('')}>{pocket ? 'Clear pocket' : 'Choose a pocket'}</button></fieldset>}
        {correcting && <div className="break-choice" role="group" aria-label="Potted on break"><span>Potted on break?</span><div>{(['no', 'yes'] as const).map(value => <button type="button" key={value} aria-pressed={pot === value} onClick={() => setPot(value)}>{value === 'no' ? 'No' : 'Yes'}</button>)}</div></div>}
        <label className="win-type">Win type<select value={special} onChange={e => { const value = e.target.value as SpecialEvent; setSpecial(value); if (!correcting && value === 'golden_break') { if (frame.breaker_id && pair.some(p => p.player_id === frame.breaker_id)) { setPot('yes'); setWinner(frame.breaker_id) } else setSpecial('regular') } setOffender('') }}>{(['regular', 'golden_break', 'break_and_run', 'dry_clearance', 'super_foul'] as const).map(s => <option key={s} value={s}>{({ regular: 'Normal', golden_break: 'Golden Break', break_and_run: 'Break & Run', dry_clearance: 'Dry Clearance', super_foul: 'Super Foul' })[s]}</option>)}</select></label>
        {special === 'super_foul' && <label>Super Foul offender<select value={offender} onChange={e => setOffender(e.target.value)} required><option value="">Choose offender</option>{pair.map(p => <option key={p.player_id} value={p.player_id}>{name(p.player_id)}</option>)}</select></label>}
        {invalidSpecial && <p className="connected-error">{special === 'super_foul' ? 'Choose an offender different from the winner.' : 'This win type needs the breaker to win and Potted on break set to Yes.'}</p>}
      </section>
      {!correcting && <><button type="submit" className="button w-full confirm-frame" disabled={!valid}>{game.busy ? 'Saving…' : '✓ Confirm frame'}</button>
      <button type="button" className="text-button" onClick={() => setWinner('')}>Back to playing</button></>}
    </>}
    {correcting && <><p className="correction-duration">Recorded duration <output>{duration(frame.elapsed_ms)}</output><small>Timer stopped</small></p><p className="annotation">Frame players, breaker and recorded timing stay unchanged.</p><button type="submit" className="button w-full" disabled={!valid}>{game.busy ? 'Saving…' : 'Save changes'}</button></>}
    {game.actionError&&<p role="alert" className="connected-error">{game.actionError}<button type="button" className="text-button notification-close" aria-label="Close scoring error" onClick={game.dismissNotifications}>×</button></p>}
  </fieldset></form>
}

function PairSetup({ game, state }: { game: ConnectedGame; state: SessionState }) {
  const defaults = frameDefaults(state)
  const fixed = state.participants.length === 2
  const [selectedPair, setPair] = useState<FramePair>(() => defaults.pair)
  const [selectedBreaker, setBreaker] = useState(() => defaults.breaker)
  const pair = fixed ? defaults.pair : selectedPair
  const breaker = fixed && defaults.breaker ? defaults.breaker : selectedBreaker
  const name = (id: string) => state.participants.find(p => p.player_id === id)?.display_name ?? 'Unknown player'
  return <form className="connected-form connected-pair-picker" onSubmit={e => {
    e.preventDefault(); void game.scoring('start_frame', { p_session: state.session.id, p_expected_revision: state.session.revision, p_players: pair, p_breaker: breaker })
  }}><fieldset disabled={game.inputBlocked || !game.canScore}><legend>{fixed ? 'Next frame' : 'Who’s playing the next frame?'}</legend>
    {fixed ? <div className="next-frame-players"><strong>{name(pair[0])}</strong><span>vs</span><strong>{name(pair[1])}</strong></div> : <div className="connected-two-column">{([0, 1] as const).map(side => <label key={side}>Player {side + 1}<select required value={pair[side]} onChange={e => { const p = [...pair] as FramePair; p[side] = e.target.value; setPair(p); if (!p.includes(breaker)) setBreaker('') }}><option value="">Select a player</option>{state.participants.map(p => <option key={p.player_id} value={p.player_id} disabled={p.player_id === pair[1 - side]}>{p.display_name}</option>)}</select></label>)}</div>}
    {fixed && defaults.breaker ? <p className="next-frame-breaker">{name(breaker)} breaks next</p> : <><p className="annotation">{fixed ? 'Choose the next breaker to continue.' : 'Choose two players and their breaker.'}</p><label>Breaker<select required value={breaker} onChange={e => setBreaker(e.target.value)}><option value="">Choose breaker</option>{pair.filter(Boolean).map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label></>}
    <button className="button w-full" disabled={!pair[0] || !pair[1] || pair[0] === pair[1] || !pair.includes(breaker)}>Start frame</button>
    {game.actionError&&<p role="alert" className="connected-error">{game.actionError}<button type="button" className="text-button notification-close" aria-label="Close frame error" onClick={game.dismissNotifications}>×</button></p>}
  </fieldset></form>
}
export function SessionView({ game, sessionId, historyBackTo = '/matches' }: { game: ConnectedGame; sessionId: string; historyBackTo?: string }) {
  const [historyOpen,setHistoryOpen]=useState(false)
  const [optionsOpen,setOptionsOpen]=useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [review, setReview] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removalError,setRemovalError]=useState('')
  const [feedback, setFeedback] = useState<{kind:'frame'|'night';key:string;winnerId?:string;score?:number;revision?:number}|null>(null)
  const celebrated = useRef(new Set<string>())
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), feedback.kind === 'night' ? 1800 : 1400)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const state = game.state?.session.id === sessionId ? game.state : null
  if (!state) return <p role="status">{game.error ? 'Match could not be loaded. Refresh scores to try again.' : 'Loading saved match…'}</p>
  const active = state.frames.find(f => f.status === 'running' || f.status === 'paused')
  const editFrame = state.frames.find(f => f.id === editing)
  const open = state.session.status === 'active'
  const visibleFrames = state.frames.filter(f => state.session.origin !== 'imported' || (state.session.detail_eligible && f.detail_eligible))
  const completedFrames = visibleFrames.filter(f => f.status === 'completed')
  const showStandings = !open && state.participants.length > 2
  const name = (id: string | null) => state.participants.find(p => p.player_id === id)?.display_name ?? 'Not recorded'
  const display = active ? active.participants : state.participants
  const frameFeedback = feedback?.kind === 'frame' && state.frames.some(f=>f.id===feedback.key && f.status==='completed' && f.winner_id===feedback.winnerId) && state.scores[feedback.winnerId!] === feedback.score
  const nightFeedback = feedback?.kind === 'night' && state.session.status === 'finalized' && state.session.revision === feedback.revision
  const top = Math.max(...Object.values(state.scores).filter((n): n is number=>n!==null))
  const leaders = state.participants.filter(p=>state.scores[p.player_id]===top)
  const completionLabel = leaders.length>1 ? state.participants.length===2 ? 'Night finished · draw' : 'Night finished · shared top score' : state.participants.length===2 ? `${leaders[0]?.display_name ?? 'Player'} won the night` : `${leaders[0]?.display_name ?? 'Player'} finished top`
  return <div className={`live-page ${open ? 'gameplay-page' : 'completed-match-page'}`}>{!open && <a className="back-link" href={`#${historyBackTo}`}>← Back to History</a>}
    {!active && (open ? <header className="between-frame-header"><h1>{game.options?.venues.find(v => v.id === state.session.venue_id)?.display_name ?? 'At the table'}</h1><span>Next frame · {Math.max(0, ...state.frames.map(f => f.frame_number)) + 1}</span></header> : <PageHeading label="Night finalized" title={game.options?.venues.find(v => v.id === state.session.venue_id)?.display_name ?? 'At the table'} />)}
    {!active && (frameFeedback || nightFeedback) && <div className="saved-feedback-slot">{(frameFeedback || nightFeedback) && <p key={feedback!.key} className={`saved-feedback ${nightFeedback?`night-complete ${leaders.length>1?'draw-complete':''}`:'frame-complete'}`} role="status">{nightFeedback ? completionLabel : `✓ ${name(feedback!.winnerId!)} · frame saved`}</p>}</div>}
    {(!open || !active) && <section className="score-table rail" aria-label="Saved scores"><div className={display.length === 2 ? 'score-pair' : 'connected-score-roster'}>{display.map(p => <div className={`score-side ${frameFeedback && feedback?.winnerId===p.player_id ? 'score-confirmed' : nightFeedback && leaders.length===1 && leaders.some(l=>l.player_id===p.player_id) ? 'night-confirmed' : ''}`} key={p.player_id}><h2>{name(p.player_id)}</h2><span className="big-score">{state.scores[p.player_id] ?? '—'}</span><small className="muted">Frames won</small></div>)}</div></section>}
    {state.session.status==='finalized' && state.participants.length===2 && <MatchMomentumSection key={state.session.id} state={state}/>}
    {open && active && <FrameEntry key={active.id} frame={active} state={state} game={game} correcting={false} onSaved={winnerId => {
      if (!winnerId || celebrated.current.has(active.id)) return
      celebrated.current.add(active.id)
      setFeedback({kind:'frame',key:active.id,winnerId,score:(state.scores[winnerId] ?? 0)+1})
    }} />}
    {open && !active && <PairSetup key={`${state.session.id}:${state.session.revision}`} game={game} state={state} />}
    {(!open || completedFrames.length > 0) && <section className="connected-section gameplay-history match-disclosure"><MatchDisclosureHeading expanded={historyOpen} controls="session-frame-history" onToggle={()=>setHistoryOpen(!historyOpen)}>Frame history · {(open ? completedFrames : visibleFrames).length}</MatchDisclosureHeading><div id="session-frame-history" hidden={!historyOpen}>{!visibleFrames.length && <p className="muted">{state.session.origin === 'imported' ? 'Only the final result is available for this night.' : open ? 'No frames started yet.' : 'No frame records are available for this night.'}</p>}
      <ol className="timeline">{(open ? completedFrames : visibleFrames).map(f => <li key={f.id}><span>{f.frame_number}</span><div><strong>{f.status === 'completed' ? `${name(f.winner_id)} won` : f.status}</strong><details className="frame-details"><summary>{duration(f.elapsed_ms)} · Frame details</summary><p className="annotation">{f.participants.map(p => `${name(p.player_id)} · ${p.foul_count ?? 'unknown'} fouls`).join(' / ')}<br />{duration(f.elapsed_ms)} · {f.special_event?.replaceAll('_', ' ') ?? 'event not recorded'} · Pocket {f.black_pocket_code ?? 'not recorded'}<br />Breaker {name(f.breaker_id)} · Break pot {f.potted_on_break === null ? 'unknown' : f.potted_on_break ? 'Yes' : 'No'}</p></details></div>
      {open && game.canScore && f.status === 'completed' && <button type="button" className="button button-secondary edit-frame" aria-label={`Edit frame ${f.frame_number}`} disabled={game.inputBlocked} onClick={() => setEditing(f.id)}>Edit</button>}</li>)}</ol>
      {!!state.corrections.length && <p className="annotation">{state.corrections.length} correction(s). Latest: {state.corrections.at(-1)?.reason}</p>}
    </div></section>}
    {showStandings && !open && <section className="connected-section"><Eyebrow>Match standings</Eyebrow><div className="connected-table-wrap"><table className="data-table"><thead><tr><th>Player</th><th>Wins</th><th>Losses</th><th>Played</th></tr></thead><tbody>{state.standings.map(p => <tr key={p.player_id}><th>{name(p.player_id)}</th><td>{p.frames_won ?? '—'}</td><td>{p.frames_lost ?? '—'}</td><td>{p.frames_played ?? '—'}</td></tr>)}</tbody></table></div></section>}
    {open && <button className="button button-secondary w-full finish-night" disabled={game.inputBlocked || !!active || !state.frames.some(f => f.status === 'completed') || !game.canScore} onClick={() => setReview(true)}>Finish match night</button>}
    {game.canAdmin && <section className="match-options match-disclosure"><MatchDisclosureHeading expanded={optionsOpen} controls="session-match-options" onToggle={()=>setOptionsOpen(!optionsOpen)}>Match options</MatchDisclosureHeading><div id="session-match-options" hidden={!optionsOpen}><button type="button" className="button button-secondary remove-match" disabled={game.busy} onClick={()=>{setRemovalError('');setRemoving(true)}}>{open?'Abandon match':'Delete match'}</button></div></section>}
    {removing && <Modal title={open?'Abandon match?':'Delete match?'} onClose={()=>{if(!game.busy)setRemoving(false)}}><p>{displayDate(state.session.occurred_on)} · {game.options?.venues.find(v=>v.id===state.session.venue_id)?.display_name ?? 'Venue not recorded'}</p><p>{state.participants.map(p=>p.display_name).join(' · ')}</p><p className="removal-warning">This match and all its recorded frames will be permanently discarded. This cannot be undone.</p><div className="connected-actions"><button className="button button-secondary" disabled={game.busy} onClick={()=>setRemoving(false)}>Keep match</button><button className="button removal-confirm" disabled={game.busy} onClick={async()=>{setRemovalError('');try{if(await game.setup('remove_match',{p_session:state.session.id,p_expected_revision:state.session.revision,p_mode:open?'abandon':'delete'}))setRemoving(false);else setRemovalError('The match could not be removed. Your request has been kept for review.')}catch(error){setRemovalError(error instanceof Error?error.message:'The match could not be removed. Please try again.')}}}>{game.busy?'Removing…':open?'Abandon match':'Delete match'}</button></div>{removalError&&<p role="alert" className="connected-error">{game.actionError||removalError}</p>}</Modal>}
    {review && <Modal title="Finish this match night?" onClose={() => { if (!game.busy) setReview(false) }}><p>Finishing closes this night. You won’t be able to add or change frames.</p><ul className="connected-final-review">{state.standings.map(p => <li key={p.player_id}><strong>{name(p.player_id)}</strong><span>{p.frames_won} wins · {p.frames_lost ?? '—'} losses</span></li>)}</ul><button className="button w-full mt-4" disabled={game.inputBlocked} onClick={async () => { if (await game.scoring('finalize_session', { p_session: state.session.id, p_expected_revision: state.session.revision })) { setReview(false); if (!celebrated.current.has(state.session.id)) { celebrated.current.add(state.session.id); setFeedback({kind:'night',key:state.session.id,revision:state.session.revision+1}) } } }}>Finish night</button>{game.actionError&&<p role="alert" className="connected-error">{game.actionError}</p>}{game.intent && <button className="text-button" onClick={() => { setReview(false); requestAnimationFrame(revealRecovery) }}>Back to scores</button>}</Modal>}
    {open && game.canScore && editFrame && <Modal title={`Editing frame ${editFrame.frame_number}`}  onClose={() => { if (!game.busy) setEditing(null) }}><FrameEntry key={editFrame.id} frame={editFrame} state={state} game={game} correcting onSaved={() => setEditing(null)} />{game.intent && <button className="text-button" onClick={() => { setEditing(null); requestAnimationFrame(revealRecovery) }}>Back to scores</button>}</Modal>}
  </div>
}
