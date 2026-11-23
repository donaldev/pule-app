import type { RecordingTiming } from './recordingGeometry'

type FrameTiming = { id: string; started_at: string | null; completed_at: string | null }

// Allow modest scoring/camera delays; substantial overlap across two frames is ambiguous.
const BOUNDARY_MS = 30_000
const SUBSTANTIAL_OVERLAP_MS = 30_000

export function suggestReplayFrame(timing: RecordingTiming | null, frames: FrameTiming[], eligibleIds: ReadonlySet<string>): string | null {
  if (!timing || timing.reliability === 'weak') return null
  const { startMs, durationMs } = timing
  if (!Number.isFinite(startMs)) return null
  const endMs = startMs + (durationMs ?? 0)

  const nearby = frames.flatMap(frame => {
    const start = Date.parse(frame.started_at ?? '')
    const end = Date.parse(frame.completed_at ?? '')
    if (!(end > start)) return []
    const gap = Math.max(start - endMs, startMs - end, 0)
    if (gap > BOUNDARY_MS) return []
    const overlap = Math.max(0, Math.min(end, endMs) - Math.max(start, startMs))
    return [{ id: frame.id, overlap, containsStart: start <= startMs && startMs <= end }]
  })

  if (durationMs !== null) {
    const ranked = nearby.filter(frame => frame.overlap > 0).sort((a, b) => b.overlap - a.overlap)
    const [best, next] = ranked
    if (best) {
      if (!eligibleIds.has(best.id) || best.overlap < Math.min(SUBSTANTIAL_OVERLAP_MS, durationMs / 2)) return null
      if (next && (next.overlap >= SUBSTANTIAL_OVERLAP_MS || next.overlap >= best.overlap * 0.8)) return null
      return best.id
    }
  }

  const containing = nearby.filter(frame => frame.containsStart)
  const candidates = containing.length ? containing : nearby
  return candidates.length === 1 && eligibleIds.has(candidates[0].id) ? candidates[0].id : null
}
