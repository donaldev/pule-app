import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ReplayShot, ReplayShotAction } from '../../data/remote/database.types'
import { getReplayShotWorkspace, reviewReplayShot, setReplayShotFavourite } from '../../data/remote/replayService'
import { Icon } from '../../components/ui/Icon'
import { ShotEditor } from './ShotEditor'
import { ShotCollection } from './ShotCollection'
import { replayBounds, shotTime, type ShotBounds } from './shotTimeline'
import type { createReplayPlayback, PlaybackState } from './replayPlayback'

const boundsOf = (shot: ReplayShot): ShotBounds => ({ start: shot.effective_replay_start_ms, end: shot.effective_replay_end_ms })

export function ReplayShots({ userId, frameId, frameNumber, path, transport, playbackState,
  active, canReview, duration, position, sign, overlay, onReviewing, swipe }: {
  userId: string; frameId: string; frameNumber: number; path: string
  transport: RefObject<ReturnType<typeof createReplayPlayback> | null>
  playbackState: PlaybackState; active: boolean; canReview: boolean
  duration: number; position: number; sign: () => Promise<string>
  overlay: HTMLDivElement | null; onReviewing: (reviewing: boolean) => void
  swipe: RefObject<((direction: number) => void) | null>
}) {
  const [shots, setShots] = useState<ReplayShot[] | null>(null)
  const [rejectedCount, setRejectedCount] = useState(0)
  const [favouritesAvailable, setFavouritesAvailable] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [mode, setMode] = useState<'view' | 'review' | 'edit'>('view')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [undo, setUndo] = useState<ReplayShot>()
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const exporter = useRef<AbortController>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getReplayShotWorkspace(userId, frameId, path, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setShots(result.shots)
      setRejectedCount(result.rejectedCount)
      setFavouritesAvailable(result.favouritesAvailable)
    }).catch(() => {
      if (!controller.signal.aborted) setError('Shots could not be loaded.')
    })
    return () => controller.abort()
  }, [userId, frameId, path, attempt])
  useEffect(() => () => exporter.current?.abort(), [])

  const original = useMemo(() => shots?.toSorted((a, b) => a.shot_number - b.shot_number) ?? [], [shots])
  const ready = useMemo(() => original.filter(s => s.confidence === 'high' || s.accepted)
    .sort((a, b) => boundsOf(a).start - boundsOf(b).start || a.shot_number - b.shot_number), [original])
  const reviewing = mode !== 'view'
  const playlist = reviewing ? original : ready
  const current = playlist.find(shot => shot.candidate_key === selected)
  const index = current ? playlist.indexOf(current) : -1
  const outstanding = original.filter(shot => !shot.accepted).length
  const reviewed = original.length + rejectedCount - outstanding
  const total = original.length + rejectedCount
  const replayEnd = duration || Math.max(1, ...ready.map(shot => boundsOf(shot).end))

  const select = useCallback((shot: ReplayShot | undefined, play = true) => {
    setSelected(shot?.candidate_key)
    if (!shot) { transport.current?.stop(); return }
    const bounds = boundsOf(shot)
    transport.current?.seek(bounds.start, play ? bounds.end : undefined)
  }, [transport])

  useEffect(() => { onReviewing(reviewing) }, [onReviewing, reviewing])

  useEffect(() => {
    if (!active || reviewing || !overlay || busy) return
    swipe.current = direction => {
      const shot = playlist[index < 0 ? 0 : index + direction]
      if (shot) select(shot)
    }
    return () => { swipe.current = null }
  }, [active, reviewing, overlay, busy, index, playlist, swipe, select])

  function startReview() {
    cancelExport()
    setMode('review')
    setMessage('')
    select(original.find(s => !s.accepted) ?? original[0], false)
    requestAnimationFrame(() => heading.current?.focus())
  }

  function finishReview() {
    setMode('view')
    setUndo(undefined)
    setMessage('')
    select(ready.find(s => s.candidate_key === selected) ?? ready[0], false)
    requestAnimationFrame(() => heading.current?.focus())
  }

  function reload() {
    transport.current?.stop()
    setError('')
    setMessage('')
    setShots(null)
    setUndo(undefined)
    setSelected(undefined)
    setMode('view')
    setAttempt(n => n + 1)
  }

  async function review(shot: ReplayShot, action: ReplayShotAction, bounds?: ShotBounds) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const revision = await reviewReplayShot(userId, frameId, shot, action, bounds)
      const updated = { ...shot, revision }
      if (action === 'reject') {
        setUndo(updated)
        setRejectedCount(count => count + 1)
        setShots(rows => rows?.filter(row => row.candidate_key !== shot.candidate_key) ?? [])
        setMessage('Shot rejected.')
      } else if (action === 'restore') {
        setShots(rows => [...(rows ?? []), updated])
        setRejectedCount(count => Math.max(0, count - 1))
        setUndo(undefined)
        select(updated, false)
        setMessage('Shot restored.')
      } else if (action === 'edit' && bounds) {
        const replay = replayBounds(shot, bounds)
        setShots(rows => rows?.map(row => row.candidate_key === shot.candidate_key ? {
          ...updated, edit_needs_review: false,
          edited_source_start_ms: bounds.start, edited_source_end_ms: bounds.end,
          effective_replay_start_ms: replay.start, effective_replay_end_ms: replay.end,
        } : row) ?? [])
        setMode('review')
        transport.current?.seek(replay.start)
        setMessage('Shot boundaries saved.')
      } else if (action === 'accept') {
        setShots(rows => rows?.map(row => row.candidate_key === shot.candidate_key ? { ...updated, accepted: true } : row) ?? [])
        setMessage('Shot kept.')
      }
      if (action === 'accept' || action === 'reject') {
        const later = original.filter(row => row.shot_number > shot.shot_number)
        select(later[0] ?? original.find(row => row.candidate_key !== shot.candidate_key && !row.accepted), false)
      }
      requestAnimationFrame(() => heading.current?.focus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The review change could not be confirmed.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function favourite(shot: ReplayShot) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const value = await setReplayShotFavourite(userId, frameId, shot, !shot.favourite)
      setShots(rows => rows?.map(row => row.candidate_key === shot.candidate_key ? { ...row, favourite: value } : row) ?? [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update favourite.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function download(shot: ReplayShot, number: number) {
    if (exporter.current) return
    const controller = new AbortController()
    exporter.current = controller
    setExporting(true)
    setError('')
    try {
      const workspace = await getReplayShotWorkspace(userId, frameId, path, controller.signal)
      const saved = workspace.shots.find(row => row.candidate_key === shot.candidate_key && (row.confidence === 'high' || row.accepted))
      if (!saved) throw Error('This shot is no longer available. Reload shots to continue.')
      const media = await import('./shotMedia')
      const clip = await media.extractShot(await sign(), boundsOf(saved), controller.signal)
      const url = URL.createObjectURL(clip)
      const link = document.createElement('a')
      link.href = url
      link.download = `Pule_Frame_${frameNumber}_Shot_${number}.mp4`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not save this shot.')
    } finally {
      exporter.current = null
      if (!controller.signal.aborted) setExporting(false)
    }
  }

  function cancelExport() {
    exporter.current?.abort()
    setExporting(false)
  }

  const number = index + 1
  const actions = current && <div className="shot-actions shot-view-actions">
          {favouritesAvailable && <button type="button" className="button button-secondary" disabled={busy}
            aria-pressed={!!current.favourite} onClick={() => void favourite(current)}>
            {current.favourite ? '★ Favourited' : '☆ Favourite'}
          </button>}
          <button type="button" className="button button-secondary" disabled={exporting}
            onClick={() => void download(current, number)}><Icon name="download" size={16} />Download Shot</button>
          {exporting && <button type="button" className="button button-secondary" onClick={cancelExport}>Cancel export</button>}
          {exporting && <p role="status">Preparing shot…</p>}
        </div>
  const immersiveBounds = current && boundsOf(current)
  const immersiveControls = active && overlay && !reviewing && createPortal(
    <div className="replay-overlay-content">
      {immersiveBounds && <label className="shot-range"><span>Shot timeline</span>
        <input type="range" min={immersiveBounds.start} max={immersiveBounds.end}
          value={Math.max(immersiveBounds.start, Math.min(position, immersiveBounds.end))}
          disabled={!playbackState.ready}
          onChange={event => transport.current?.seek(event.currentTarget.valueAsNumber, undefined, true)} />
      </label>}
      <div className="shot-actions replay-immersive-transport">
        <button type="button" className="button button-secondary" disabled={busy || index <= 0}
          onClick={() => select(playlist[index - 1])}>Previous</button>
        <button type="button" className="button" disabled={!playbackState.ready || !playlist.length}
          onClick={() => immersiveBounds ? transport.current?.toggle(immersiveBounds) : select(playlist[0])}>
          {playbackState.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="button button-secondary" disabled={busy || index >= playlist.length - 1}
          onClick={() => select(playlist[index + 1])}>Next</button>
        <button type="button" className="button button-secondary" disabled={!playbackState.ready || !current}
          onClick={() => select(current)}>Replay shot</button>
      </div>
      {actions}
      {error && <p role="alert">{error}</p>}
    </div>, overlay)

  return <section hidden={!active} className="replay-workspace" aria-label={reviewing ? 'Shot review' : 'Shots'}>
    {immersiveControls}
    {error && <div className="shot-feedback"><p role="alert">{error}</p>
      <button type="button" className="button button-secondary" disabled={busy} onClick={reload}>Reload shots</button></div>}
    {!shots && !error && <p role="status">Loading shots…</p>}
    {shots && !total && <p>No shots are available for this replay.</p>}
    {mode === 'edit' && current ? <ShotEditor key={current.candidate_key} shot={current} number={number} busy={busy}
      onScrub={ms => transport.current?.seek(ms, undefined, true)} onPreview={bounds => transport.current?.seek(bounds.start, bounds.end)}
      onSave={bounds => void review(current, 'edit', bounds)} onCancel={() => {
        select(current, false)
        setMode('review')
      }} /> : <>
      {!!total && <header className="shot-workspace-heading">
        <div>
          <h3 ref={heading} tabIndex={-1}>{reviewing ? 'Review shots' : current ? `Shot ${number}` : 'Shots'}</h3>
          <p>{reviewing ? `${reviewed} of ${total} reviewed` : `${ready.length} ready${canReview && outstanding ? ` · ${outstanding} to review` : ''}`}</p>
        </div>
        {canReview && !reviewing && !!original.length && <button type="button" className="button button-secondary"
          onClick={startReview}>{outstanding ? 'Review Shots' : 'Edit Shots'}</button>}
      </header>}

      {current && reviewing && <p className="shot-review-position">
        Candidate {current.shot_number} <span>{current.accepted ? 'Kept' : current.confidence === 'high' ? 'High confidence' : 'Possible shot'}</span>
      </p>}
      {!!shots?.length && <div className="shot-transport">
        <button type="button" className="button button-secondary" disabled={busy || index <= 0}
          onClick={() => select(playlist[index - 1])}>Previous</button>
        <button type="button" className="button" disabled={!playbackState.ready || !playlist.length}
          onClick={() => current ? transport.current?.toggle(boundsOf(current)) : select(playlist[0])}>
          {playbackState.playing ? 'Pause' : 'Play shot'}
        </button>
        <button type="button" className="button button-secondary" disabled={busy || index >= playlist.length - 1}
          onClick={() => select(playlist[index + 1])}>Next</button>
      </div>}

      {reviewing ? <>
        {current && <div className="shot-actions shot-review-actions">
          <button type="button" className="button" disabled={busy} onClick={() => void review(current, 'accept')}>Keep</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void review(current, 'reject')}>Reject</button>
          <button type="button" className="button button-secondary" disabled={busy || !playbackState.ready}
            onClick={() => { select(current, false); setMode('edit') }}>Edit Boundaries</button>
        </div>}
        {!current && <p>{outstanding ? 'Choose Next to continue reviewing.' : 'All candidates have been reviewed.'}</p>}
        <div className="shot-review-finish">
          <p role="status">{message || 'Choices are saved as you go.'}</p>
          {undo && <button type="button" className="button button-secondary" disabled={busy}
            onClick={() => void review(undo, 'restore')}>Undo rejection</button>}
          <button type="button" className="button button-secondary" disabled={busy} onClick={finishReview}>Save and Finish Review</button>
        </div>
      </> : <>
        {!!ready.length && <div className="shot-replay-timeline">
          <label className="shot-range"><span>Replay timeline <strong>{shotTime(position)}</strong></span>
            <input type="range" min={0} max={replayEnd} value={Math.min(position, replayEnd)}
              aria-valuetext={shotTime(position)} onChange={event => transport.current?.seek(event.currentTarget.valueAsNumber, undefined, true)} />
          </label>
          <button type="button" className="shot-markers" aria-label="Jump to a shot marker. Use previous and next to choose a shot."
            title="Jump to nearest shot" onClick={event => {
              if (!event.detail) { select(ready[(index + 1) % ready.length]); return }
              const rect = event.currentTarget.getBoundingClientRect()
              const point = (event.clientX - rect.left) / rect.width * replayEnd
              select(ready.reduce((nearest, shot) => Math.abs(boundsOf(shot).start - point) < Math.abs(boundsOf(nearest).start - point) ? shot : nearest))
            }}>
            {ready.map(shot => <i key={shot.candidate_key} data-selected={shot.candidate_key === selected}
              style={{ left: `${100 * boundsOf(shot).start / replayEnd}%` }} />)}
          </button>
        </div>}
        {!overlay && actions}
        {!!ready.length && active && <ShotCollection shots={ready} selected={selected} onSelect={select} sign={sign} />}
        {!!total && !ready.length && <p>No shots are ready to watch yet.</p>}
      </>}
    </>}
  </section>
}
