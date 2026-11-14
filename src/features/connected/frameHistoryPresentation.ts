import type { SavedFrame } from '../../data/remote/database.types'
/** Ownership comes from the caller's linked UUID, never a display name or match score. */
export function frameOutcome(frame: SavedFrame, linkedPlayer: string | null | undefined): 'won' | 'lost' | 'neutral' {
  if (frame.status !== 'completed' || !frame.winner_id || !linkedPlayer || !frame.participants.some(p => p.player_id === linkedPlayer)) return 'neutral'
  return frame.winner_id === linkedPlayer ? 'won' : 'lost'
}
