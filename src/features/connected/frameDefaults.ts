import type { FramePair, SessionState } from '../../data/remote/database.types'

/** Suggestions only; starting a frame still sends an explicit pair and breaker. */
export function frameDefaults(state: SessionState): { pair: FramePair; breaker: string } {
  if (state.participants.length !== 2) return { pair: ['', ''], breaker: '' }
  const pair = [...state.participants].sort((a, b) => a.side - b.side).map(p => p.player_id) as FramePair
  const latest = state.frames.filter(f => f.status === 'completed').sort((a, b) => b.frame_number - a.frame_number)[0]
  const breaker = latest ? (pair.includes(latest.breaker_id ?? '') ? pair.find(id => id !== latest.breaker_id)! : '')
    : pair.includes(state.session.initial_breaker_id ?? '') ? state.session.initial_breaker_id! : ''
  return { pair, breaker }
}
