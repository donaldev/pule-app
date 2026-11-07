import { useEffect, useState } from 'react'
import { findGuestByEmail, type ExistingGuest } from '../../data/remote/identityService'
import { PageHeading } from '../../components/ui/Primitives'
import type { SessionRoster } from '../../data/remote/database.types'
import type { ConnectedGame } from './useConnectedGame'
import { participantKey } from './matchupPresentation'
import { MatchContext } from './MatchContext'
import { nightSetupDefaults } from './nightSetupDefaults'
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

export function PlayWelcome({ game }: { game: ConnectedGame }) {
  return <section className="narrow-page play-welcome"><PageHeading label="Play" title="Who’s playing tonight?" /><p>Add the people playing tonight. You can choose a different lineup next time.</p><button className="button" disabled={game.inputBlocked} onClick={() => void game.setup('create_group', { p_name: 'Pool matches', p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })}>{game.busy ? 'Getting ready…' : '+ Add players'}</button>{game.actionError&&<p role="alert" className="connected-error">{game.actionError}</p>}</section>
}
export function NightSetup({ game }: { game: ConnectedGame }) {
  if (!game.options) return <p role="status">{game.error ? 'We couldn’t load your players and venues. Please refresh.' : 'Loading players…'}</p>
  return <NightSetupForm key={game.groupId} game={game} />
}
function NightSetupForm({ game }: { game: ConnectedGame }) {
  const options = game.options!
  const automatic = !!game.matchupCatalog
  const selectable = automatic ? [...new Map((game.playerContexts ?? []).filter(p => game.memberships.some(m => m.group_id === p.group_id && ['owner','admin','scorer'].includes(m.role))).map(p => [p.player_id,p])).values()] : options.players
  const suggested = nightSetupDefaults(options.players, options.venues, game.standings, game.sessions)
  const registered = game.matchupCatalog?.matchups.find(m => m.group_id === game.groupId)
  const ownPlayer = game.matchupCatalog?.player_id
  const defaults = ownPlayer && selectable.some(p=>p.player_id===ownPlayer) && !suggested.players.includes(ownPlayer) ? [ownPlayer,...suggested.players.slice(0,1)] : suggested.players
  const initialPlayers = game.resolvedGroupId===game.groupId && game.resolvedPlayers?.length>=2 ? game.resolvedPlayers : registered?.player_ids ?? defaults
  const [players, setPlayers] = useState<string[]>(initialPlayers.every(id=>selectable.some(p=>p.player_id===id)) ? initialPlayers : defaults)
  const [venue, setVenue] = useState(suggested.venue)
  const [season, setSeason] = useState('')
  const [breaker, setBreaker] = useState('')
  const [newPlayer, setNewPlayer] = useState('')
  const [newEmail,setNewEmail]=useState('')
  const [existingGuest,setExistingGuest]=useState<ExistingGuest|null>(null)
  const [checkingEmail,setCheckingEmail]=useState(false)
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [playerFeedback, setPlayerFeedback] = useState('')
  const [playerAdded,setPlayerAdded]=useState(false)
  const [newVenue, setNewVenue] = useState('')
  const [venueFeedback, setVenueFeedback] = useState('')
  useEffect(()=>{if(!playerAdded)return;const timer=window.setTimeout(()=>{setPlayerFeedback('');setPlayerAdded(false)},3000);return()=>window.clearTimeout(timer)},[playerAdded])
  useEffect(()=>{if(!venueFeedback)return;const timer=window.setTimeout(()=>setVenueFeedback(''),3000);return()=>window.clearTimeout(timer)},[venueFeedback])
  const ruleId = options.rules.find(r => r.label === 'Pule standard')?.id ?? options.rules[0]?.id ?? ''
  const needsResolution = automatic && (!registered || participantKey(players) !== participantKey(registered.player_ids))
  const canChoose = automatic ? selectable.length > 0 : game.canScore
  const firstBreaker = players.includes(breaker) ? breaker : players[0] ?? ''
  const valid = players.length >= 2 && players.every(id => selectable.some(p => p.player_id === id)) && options.venues.some(v => v.id === venue) && options.rules.some(r => r.id === ruleId) && !!firstBreaker
  return <div className="narrow-page connected-form night-setup">{!automatic && game.groups.length > 1 && <MatchContext game={game} />}<PageHeading label="New match" title="Who’s playing?" />
    {!ruleId && !needsResolution && <p className="setup-guidance" role="status">New match nights aren’t available yet. You can still view your history.</p>}
    {game.canScore && <section className="play-add-player">
      <button className="button button-secondary" aria-expanded={addingPlayer} onClick={() => setAddingPlayer(v => !v)}>+ Add player</button>
      {addingPlayer && <form onSubmit={async e => {
        e.preventDefault()
        if (game.inputBlocked || checkingEmail || !newPlayer.trim() || !newEmail.trim()) return
        setCheckingEmail(true);setPlayerFeedback('');setPlayerAdded(false);setExistingGuest(null)
        try {
          const existing=await findGuestByEmail(newEmail)
          if(existing){setExistingGuest(existing);return}
          if(await game.setup('create_guest_with_email',{p_group:game.groupId,p_name:newPlayer.trim(),p_email:newEmail.trim().toLowerCase()})) {
            setNewPlayer('');setNewEmail('');setAddingPlayer(false);setPlayerAdded(true);setPlayerFeedback('Player added. Select them below.')
          }
        } catch {setPlayerFeedback('We couldn’t add this player. Please try again.')}
        finally {setCheckingEmail(false)}
      }}><fieldset disabled={game.inputBlocked||checkingEmail}><label>Player name<input autoFocus required maxLength={100} value={newPlayer} onChange={e=>{setNewPlayer(e.target.value);setExistingGuest(null)}} /></label>
        <label>Player email<input type="email" required maxLength={254} autoComplete="off" value={newEmail} onChange={e=>{setNewEmail(e.target.value);setExistingGuest(null)}} /></label>
        <p className="annotation">Their email stays private.</p>
        <button className="button" disabled={!newPlayer.trim()||!newEmail.trim()||checkingEmail}>Add player</button>
      </fieldset></form>}
      {playerFeedback && <p role={playerAdded?'status':'alert'}>{playerFeedback}{!playerAdded&&<button type="button" className="text-button notification-close" aria-label="Close player message" onClick={()=>setPlayerFeedback('')}>×</button>}</p>}
      {existingGuest&&<div role="status"><p>This player already exists: {existingGuest.display_name}.</p><button className="button button-secondary" disabled={game.inputBlocked} onClick={()=>{
        if(automatic || existingGuest.group_id===game.groupId){setPlayers(current=>current.includes(existingGuest.player_id)?current:[...current,existingGuest.player_id]);game.refresh()}
        else game.selectGroup(existingGuest.group_id,false)
        setAddingPlayer(false);setExistingGuest(null);setNewPlayer('');setNewEmail('')
      }}>Use {existingGuest.display_name}</button></div>}
    </section>}
    <form onSubmit={e => {
      e.preventDefault()
      if (game.inputBlocked) return
      if (needsResolution && players.length>=2 && players.every(id=>selectable.some(p=>p.player_id===id))) {
        void game.setup('resolve_matchup', {p_players:players,p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}); return
      }
      if (valid && game.canScore) void game.scoring('start_session', { p_group: game.groupId, p_venue: venue, p_rule_version: ruleId, p_players: players as SessionRoster, p_breaker: firstBreaker, p_season: season || null })
    }}><fieldset disabled={game.inputBlocked || !canChoose}>
      <legend>Tonight’s players <span className="annotation">· {players.length} selected</span></legend>
      {ownPlayer && selectable.some(p=>p.player_id===ownPlayer) && <p className="annotation">Your player: {selectable.find(p=>p.player_id===ownPlayer)?.display_name}</p>}
      <div className="night-player-picker">{selectable.map(p => <label key={p.player_id} className={players.includes(p.player_id) ? 'selected' : ''}><input type="checkbox" checked={players.includes(p.player_id)} onChange={e => setPlayers(current => e.target.checked ? [...current,p.player_id] : current.filter(id => id !== p.player_id))} /><span>{p.display_name}{selectable.filter(other=>sameName(other.display_name,p.display_name)).length>1 ? ` · ${selectable.findIndex(other=>other.player_id===p.player_id)+1}` : ''}</span></label>)}</div>
      {players.length < 2 && <p className="annotation">Choose two or more players.</p>}
      {!needsResolution && <><label>Where are you playing?<select aria-label="Where are you playing?" required value={venue} onChange={e => setVenue(e.target.value)}><option value="">Choose a venue</option>{options.venues.map(v => <option value={v.id} key={v.id}>{v.display_name}</option>)}</select></label>
      <label>Who breaks first?<select aria-label="Who breaks first?" required value={firstBreaker} onChange={e => setBreaker(e.target.value)}><option value="">Choose a player</option>{players.map(id => <option key={id} value={id}>{selectable.find(p => p.player_id === id)?.display_name}</option>)}</select></label>

      {!!options.seasons.length && <label>Season<select value={season} onChange={e => setSeason(e.target.value)}><option value="">Unassigned</option>{options.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      </>}
      <button className="button w-full start-night" disabled={needsResolution ? players.length<2 || !participantKey(players) : !valid}>{game.busy ? 'Please wait…' : needsResolution ? 'Continue with these players' : 'Start match'}</button>
    </fieldset></form>
    {game.canScore && <details className="add-venue"><summary>Add a new venue</summary><form onSubmit={async e => {
      e.preventDefault(); if (game.inputBlocked || !newVenue.trim() || options.venues.some(v => sameName(v.display_name,newVenue))) return
      if (await game.setup('create_venue', {p_group:game.groupId,p_name:newVenue.trim()})) { setNewVenue(''); setVenueFeedback('Venue added. Choose it from the list above.') }
    }}><fieldset disabled={game.inputBlocked}><label>New venue name<input value={newVenue} required maxLength={160} onChange={e => setNewVenue(e.target.value)} /></label><button className="button button-secondary" disabled={!newVenue.trim() || options.venues.some(v => sameName(v.display_name,newVenue))}>Add venue</button></fieldset></form>{venueFeedback && <p role="status">{venueFeedback}</p>}</details>}
    {game.actionError&&<p role="alert" className="connected-error">{game.actionError}<button type="button" className="text-button notification-close" aria-label="Close setup error" onClick={game.dismissNotifications}>×</button></p>}
    {!canChoose && <p className="annotation">You can view these matches. Ask the scorer for access to record results.</p>}
  </div>
}
