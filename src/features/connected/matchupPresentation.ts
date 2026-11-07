/** Participant-set equality is identity-based, never name-based. This is not authorization. */
export function participantKey(ids: readonly string[]): string | null {
  if (ids.length < 2 || ids.some(id => !id) || new Set(ids).size !== ids.length) return null
  return [...ids].sort().join('/')
}
/** Existing access containers can contain several matchups. Labels intentionally never use their names. */
export function playerContextLabel(players: readonly { display_name: string }[], fallback = 'Available matches') {
  return players.length ? players.map(p => p.display_name).join(' + ') : fallback
}
