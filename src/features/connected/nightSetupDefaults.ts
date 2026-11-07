/** UI suggestions only; never persists or creates a match. */
export function nightSetupDefaults(
  players: { player_id: string }[], venues: { id: string }[],
  standings: { player_id: string; nights: number }[],
  sessions: { venue_id: string; occurred_on: string | null }[],
) {
  const known = new Set(players.map(p => p.player_id))
  const usual = [...standings].filter(p => known.has(p.player_id) && p.nights > 0)
    .sort((a,b) => b.nights-a.nights || a.player_id.localeCompare(b.player_id)).slice(0,2).map(p => p.player_id)
  const recent = [...sessions].filter(s => s.occurred_on && venues.some(v => v.id === s.venue_id))
    .sort((a,b) => b.occurred_on!.localeCompare(a.occurred_on!))[0]
  return { players: usual.length >= 2 ? usual : players.length === 2 ? players.map(p => p.player_id) : [],
    venue: recent?.venue_id ?? venues[0]?.id ?? '' }
}
