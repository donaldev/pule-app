import type { ConnectedGame } from './useConnectedGame'
import { playerContextLabel } from './matchupPresentation'

/** Existing authorized histories, not a claim that each container is an exact matchup. */
export function MatchContext({ game }: { game: ConnectedGame }) {
  const profiles = game.playerContexts ?? []
  const participants = (id: string) => game.matchupCatalog?.matchups.find(m=>m.group_id===id)?.player_ids
  const label = (id: string, index: number) => playerContextLabel(
    profiles.filter(p => p.group_id === id && (!participants(id) || participants(id)!.includes(p.player_id))), `Saved matches ${index + 1}`,
  )
  return <div className="results-context">
    {game.groups.length > 1 ? <label>Saved matches<select aria-label="Saved matches" value={game.groupId} disabled={game.busy} onChange={e => game.selectGroup(e.target.value, false)}>
      {game.groups.map((g, index) => <option value={g.id} key={g.id}>{label(g.id, index)} · {index + 1}</option>)}
    </select></label> : <span>{playerContextLabel((game.options?.players ?? []).filter(p=>!participants(game.groupId) || participants(game.groupId)!.includes(p.player_id)))}</span>}
  </div>
}
