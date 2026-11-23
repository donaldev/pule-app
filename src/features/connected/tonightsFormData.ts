import type { SavedFrame, SessionState } from '../../data/remote/database.types'

type FormFrame = Pick<SavedFrame, 'id' | 'session_id' | 'frame_number' | 'status' | 'winner_id' | 'participants' | 'origin'>
type FormPlayer = Pick<SessionState['participants'][number], 'player_id' | 'display_name'>

export function calculateTonightsForm(sessionId: string, frames: readonly FormFrame[], players: readonly FormPlayer[]) {
  const pair = players.length === 2 ? new Set(players.map(player => player.player_id)) : null
  const completed = frames.filter(frame => frame.session_id === sessionId && frame.status === 'completed'
    && (!pair || (frame.participants.length === 2 && frame.participants.every(player => pair.has(player.player_id)))))
    .sort((a, b) => a.frame_number - b.frame_number)

  const recent = completed.slice(-5)
  const wins = new Map<string, number>()
  for (const { winner_id } of recent) {
    if (winner_id !== null) wins.set(winner_id, (wins.get(winner_id) ?? 0) + 1)
  }
  const standings = players.map(player => ({
    id: player.player_id,
    name: player.display_name?.trim() || 'Unknown player',
    wins: wins.get(player.player_id) ?? 0,
  }))
  const names = new Map(standings.map(player => [player.id, player.name]))
  const ranked = [...standings].sort((a, b) => b.wins - a.wins)
  const leader = ranked[0]?.wins > (ranked[1]?.wins ?? 0) ? ranked[0] : null

  const lastWinner = completed.at(-1)?.winner_id
  let consecutive = 0
  if (lastWinner != null) {
    for (let i = completed.length - 1; i >= 0 && completed[i].winner_id === lastWinner; i--) consecutive++
  }
  const streak = lastWinner != null && consecutive >= 2
    ? { name: names.get(lastWinner) ?? 'Unknown player', wins: consecutive }
    : null

  return {
    recent: recent.map(frame => ({
      id: frame.id,
      number: frame.frame_number,
      result: frame.winner_id === null
        ? frame.origin === 'imported' ? 'Winner not recorded' : 'Draw'
        : names.get(frame.winner_id) ?? 'Unknown player',
      hasWinner: frame.winner_id !== null,
    })),
    players: pair ? standings : ranked,
    leader,
    streak,
  }
}
