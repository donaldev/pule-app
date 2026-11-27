import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ReplayShot } from '../../data/remote/database.types'
import { editableRange, replayBounds, shotTime, type ShotBounds } from './shotTimeline'

export function ShotEditor({ shot, busy, onScrub, onPreview, onSave, onCancel }: {
  shot: ReplayShot
  busy: boolean
  onScrub: (ms: number) => void
  onPreview: (bounds: ShotBounds) => void
  onSave: (bounds: ShotBounds) => void
  onCancel: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const range = editableRange(shot)
  const [bounds, setBounds] = useState(() => {
    const start = Math.max(range.start, Math.min(range.end - 1,
      shot.edit_needs_review ? shot.source_start_ms : shot.edited_source_start_ms ?? shot.source_start_ms))
    const end = Math.min(range.end, shot.edit_needs_review ? shot.source_end_ms : shot.edited_source_end_ms ?? shot.source_end_ms)
    return { start, end }
  })
  const [position, setPosition] = useState(bounds.start)
  const percent = (ms: number) => 100 * (ms - range.start) / (range.end - range.start)
  const toReplay = (ms: number) => shot.segment_replay_start_ms + ms - shot.segment_source_start_ms
  const time = (ms: number) => shotTime(toReplay(ms))

  function scrub(ms: number) {
    setPosition(ms)
    onScrub(toReplay(Math.min(ms, range.end - 1)))
  }

  function moveBoundary(edge: keyof ShotBounds, requested: number) {
    const value = edge === 'start'
      ? Math.max(range.start, Math.min(bounds.end - 1, requested))
      : Math.min(range.end, Math.max(bounds.start + 1, requested))
    setBounds({ ...bounds, [edge]: value })
    scrub(value)
  }

  return <section className="shot-editor" aria-label={`Edit shot ${shot.shot_number}`}>
    <h3 ref={heading} tabIndex={-1}>Edit shot {shot.shot_number}</h3>
    {shot.edit_needs_review && <p role="status">The saved edit falls outside this replay. Adjust the available boundaries to save a new edit.</p>}
    <div className="shot-timeline" aria-hidden="true" style={{
      '--shot-start': `${percent(bounds.start)}%`, '--shot-end': `${percent(bounds.end)}%`,
      '--shot-position': `${percent(position)}%`,
    } as CSSProperties}><span /></div>
    <label className="shot-range"><span>Scrub retained footage <strong>{time(position)}</strong></span>
      <input type="range" min={range.start} max={range.end} value={position}
        aria-valuetext={time(position)} onChange={e => scrub(e.currentTarget.valueAsNumber)} />
    </label>
    {(['start', 'end'] as const).map(edge => {
      const name = edge === 'start' ? 'Start' : 'End'
      const limit = bounds[edge] === range[edge]
      const min = edge === 'start' ? range.start : bounds.start + 1
      const max = edge === 'start' ? bounds.end - 1 : range.end
      return <fieldset key={edge} className="shot-boundary" disabled={busy}>
        <legend>{name} <strong>{time(bounds[edge])}</strong></legend>
        <div className="shot-boundary-controls">
          <button type="button" className="button button-secondary" aria-label={`Move ${edge} earlier by 0.1 seconds`}
            disabled={bounds[edge] === min} onClick={() => moveBoundary(edge, bounds[edge] - 100)}>−0.1</button>
          <input type="range" aria-label={`${name} boundary`} min={range.start} max={range.end}
            value={bounds[edge]} aria-valuetext={time(bounds[edge])}
            onChange={e => moveBoundary(edge, e.currentTarget.valueAsNumber)} />
          <button type="button" className="button button-secondary" aria-label={`Move ${edge} later by 0.1 seconds`}
            disabled={bounds[edge] === max} onClick={() => moveBoundary(edge, bounds[edge] + 100)}>+0.1</button>
        </div>
        {limit && <small>No more footage {edge === 'start' ? 'before' : 'after'} this boundary.</small>}
      </fieldset>
    })}
    <div className="shot-actions">
      <button type="button" className="button button-secondary" disabled={busy}
        onClick={() => { setPosition(bounds.start); onPreview(replayBounds(shot, bounds)) }}>Preview</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="button" disabled={busy} onClick={() => onSave(bounds)}>Save</button>
    </div>
  </section>
}
