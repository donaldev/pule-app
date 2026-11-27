import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ReplayShot, ReplayShotAction } from '../../data/remote/database.types'
import { listReplayShots, reviewReplayShot } from '../../data/remote/replayService'
import { Icon } from '../../components/ui/Icon'
import { ShotEditor } from './ShotEditor'
import { replayBounds, shotTime, type ShotBounds } from './shotTimeline'

import type { createReplayPlayback, PlaybackState } from './replayPlayback'

const byReplayTime = (a: ReplayShot, b: ReplayShot) =>
  a.effective_replay_start_ms - b.effective_replay_start_ms || a.shot_number - b.shot_number

function ShotList({ items, selected, busy, onSelect }: {
  items: ReplayShot[]; selected?: string; busy: boolean; onSelect: (shot: ReplayShot) => void
}) {
  return <ul className="shot-list">{items.map(shot => <li key={shot.candidate_key}>
    <button type="button" disabled={busy} aria-pressed={selected === shot.candidate_key} onClick={() => onSelect(shot)}>
      <Icon name="play" size={16} /><strong>Shot {shot.shot_number}</strong>
      <span>{((shot.effective_replay_end_ms - shot.effective_replay_start_ms) / 1000).toFixed(1)}s</span>
    </button>
  </li>)}</ul>
}

export function ReplayShots({ userId, frameId, path, transport, playbackState, active, canReview }: {
  userId: string; frameId: string; path: string
  transport: RefObject<ReturnType<typeof createReplayPlayback> | null>
  playbackState: PlaybackState; active: boolean; canReview: boolean
}) {
  const [shots, setShots] = useState<ReplayShot[] | null>(null)
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [undo, setUndo] = useState<ReplayShot>()
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const selection = useRef<HTMLHeadingElement>(null)
  const undoButton = useRef<HTMLButtonElement>(null)
  const status = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    listReplayShots(userId, frameId, path, controller.signal).then(rows => {
      if (!controller.signal.aborted) setShots(rows)
    }).catch(() => {
      if (!controller.signal.aborted) setError('Shots could not be loaded.')
    })
    return () => controller.abort()
  }, [userId, frameId, path, attempt])

  const timeline = shots?.toSorted(byReplayTime) ?? []
  const accepted = timeline.filter(shot => shot.confidence === 'high' || shot.accepted)
  const possible = timeline.filter(shot => shot.confidence === 'possible' && !shot.accepted)
  const current = shots?.find(shot => shot.candidate_key === selected)
  const playlist = current?.confidence === 'possible' && !current.accepted ? possible : accepted
  const index = playlist.findIndex(shot => shot.candidate_key === selected)
  const currentBounds = current && {
    start: current.effective_replay_start_ms, end: current.effective_replay_end_ms,
  }

  function reload() {
    transport.current?.stop()
    setError('')
    setMessage('')
    setShots(null)
    setUndo(undefined)
    setSelected(undefined)
    setEditing(false)
    setAttempt(n => n + 1)
  }

  function select(shot: ReplayShot) {
    setSelected(shot.candidate_key)
    setEditing(false)
    transport.current?.seek(shot.effective_replay_start_ms, shot.effective_replay_end_ms)
    requestAnimationFrame(() => selection.current?.focus())
  }

  async function review(shot: ReplayShot, action: ReplayShotAction, bounds?: ShotBounds) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const revision = await reviewReplayShot(userId, frameId, shot, action, bounds)
      if (action === 'reject') {
        transport.current?.stop()
        setEditing(false)
        setSelected(undefined)
        setUndo({ ...shot, revision })
        setShots(rows => rows?.filter(row => row.candidate_key !== shot.candidate_key) ?? [])
        requestAnimationFrame(() => undoButton.current?.focus())
      } else if (action === 'restore') {
        setShots(rows => [...(rows ?? []).filter(row => row.candidate_key !== shot.candidate_key), { ...shot, revision }])
        setUndo(undefined)
        setMessage(`Shot ${shot.shot_number} restored.`)
        requestAnimationFrame(() => status.current?.focus())
      } else if (action === 'edit' && bounds) {
        const replay = replayBounds(shot, bounds)
        setShots(rows => rows?.map(row => row.candidate_key === shot.candidate_key ? {
          ...row, revision, edit_needs_review: false,
          edited_source_start_ms: bounds.start, edited_source_end_ms: bounds.end,
          effective_replay_start_ms: replay.start, effective_replay_end_ms: replay.end,
        } : row) ?? [])
        transport.current?.seek(replay.start)
        setEditing(false)
        setMessage('Shot boundaries saved.')
        requestAnimationFrame(() => selection.current?.focus())
      } else {
        setShots(rows => rows?.map(row => row.candidate_key === shot.candidate_key ? { ...row, revision, accepted: true } : row) ?? [])
        setMessage(`Shot ${shot.shot_number} accepted.`)
        requestAnimationFrame(() => selection.current?.focus())
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The review change could not be confirmed.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }


  return <div hidden={!active} className="replay-shots">
    {error && <div className="shot-feedback"><p role="alert">{error}</p>
      <button type="button" className="button button-secondary" disabled={busy} onClick={reload}>Reload shots</button></div>}
    {!shots && !error && <p role="status">Loading shots…</p>}
    {message && <p role="status" tabIndex={-1} ref={status}>{message}</p>}
    {undo && <div className="shot-feedback"><p role="status">Shot {undo.shot_number} rejected.</p>
      <button type="button" className="button button-secondary" ref={undoButton} disabled={busy || !shots}
        onClick={() => void review(undo, 'restore')}>Undo</button></div>}
    {shots?.length === 0 && <p>No shots are available for this replay.</p>}
    {current && currentBounds && (editing ? <ShotEditor key={current.candidate_key} shot={current} busy={busy}
      onScrub={ms => transport.current?.seek(ms, undefined, true)} onPreview={bounds => transport.current?.seek(bounds.start, bounds.end)}
      onSave={bounds => void review(current, 'edit', bounds)}
      onCancel={() => {
        transport.current?.seek(currentBounds.start)
        setEditing(false)
        requestAnimationFrame(() => selection.current?.focus())
      }} /> : <section className="shot-selected">
      <h3 ref={selection} tabIndex={-1}>Shot {current.shot_number}</h3>
      <p>{shotTime(currentBounds.start)} – {shotTime(currentBounds.end)}</p>
      <div className="shot-transport">
        <button type="button" className="button button-secondary" disabled={busy || index <= 0}
          onClick={() => select(playlist[index - 1])}>Previous</button>
        <button type="button" className="button" disabled={!playbackState.ready} onClick={() => transport.current?.toggle(currentBounds)}>
          {playbackState.playing ? 'Pause' : 'Play shot'}
        </button>
        <button type="button" className="button button-secondary" disabled={busy || index >= playlist.length - 1}
          onClick={() => select(playlist[index + 1])}>Next</button>
      </div>
      {canReview && <div className="shot-actions">
        {current.confidence === 'possible' && !current.accepted && <button type="button" className="button" disabled={busy}
          onClick={() => void review(current, 'accept')}>Accept</button>}
        <button type="button" className="button button-secondary" disabled={busy || !playbackState.ready}
          onClick={() => { transport.current?.seek(currentBounds.start); setEditing(true) }}>Edit boundaries</button>
        <button type="button" className="button button-secondary" disabled={busy}
          onClick={() => void review(current, 'reject')}>Reject</button>
      </div>}
    </section>)}
    {!!shots?.length && !editing && <>
      <section aria-label="Ready shots"><h3>Ready shots</h3>
        {accepted.length ? <ShotList items={accepted} selected={selected} busy={busy} onSelect={select} /> : <p>No ready shots yet.</p>}
      </section>
      <section aria-label="Possible shots" className="shot-possible"><h3>Possible shots <span>{possible.length} to review</span></h3>
        {possible.length > 0 && <ShotList items={possible} selected={selected} busy={busy} onSelect={select} />}
      </section>
    </>}
  </div>
}
