import type { ReplayShot } from '../../data/remote/database.types'

export type ShotBounds = { start: number; end: number }

export function editableRange(shot: ReplayShot): ShotBounds {
  const { segment_source_start_ms: start, segment_source_end_ms: sourceEnd,
    segment_replay_start_ms: replayStart, segment_replay_end_ms: replayEnd } = shot
  return { start, end: Math.min(sourceEnd, start + replayEnd - replayStart) }
}

export function replayBounds(shot: ReplayShot, source: ShotBounds): ShotBounds {
  const offset = shot.segment_replay_start_ms - shot.segment_source_start_ms
  return { start: source.start + offset, end: Math.min(source.end + offset, shot.segment_replay_end_ms) }
}

export function shotTime(ms: number) {
  const seconds = (ms % 60_000 / 1000).toFixed(3).padStart(6, '0')
  return `${Math.floor(ms / 60_000)}:${seconds}`
}
