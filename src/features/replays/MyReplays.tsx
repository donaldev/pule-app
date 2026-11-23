import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Back } from '../../components/ui/Primitives'
import type { MyReplay } from '../../data/remote/database.types'
import { listMyReplays } from '../../data/remote/replayService'
import { displayDate } from '../results/presentation'
import { ReplayDownload, ReplayViewer } from './ReplayViewer'

export function MyReplays({ userId }: { userId: string }) {
  const [rows, setRows] = useState<MyReplay[]>([])
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState<Extract<MyReplay, { status: 'ready' }> | null>(null)

  useEffect(() => {
    let active = true
    listMyReplays(userId).then(replays => {
      if (active) setRows(replays)
    }).catch(() => {
      if (active) setFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [userId, attempt])

  function refresh() {
    setLoading(true)
    setFailed(false)
    setAttempt(n => n + 1)
  }

  const matches = new Map<string, MyReplay[]>()
  for (const replay of rows) {
    const match = matches.get(replay.session_id)
    if (match) match.push(replay)
    else matches.set(replay.session_id, [replay])
  }
  const countsUnavailable = (loading || failed) && !rows.length
  const ready = rows.filter(replay => replay.status === 'ready').length

  return <section className="narrow-page my-replays">
    <Back to="/account">Back to Account</Back>
    <header className="my-replays-header">
      <div><h1>My Replays</h1><p>Your pool nights, captured.</p></div>
      <button type="button" className="replay-icon-action" disabled={loading} aria-label="Refresh replays" onClick={refresh}>
        <Icon name="refresh" />
      </button>
    </header>
    <dl className="my-replays-summary" aria-live="polite">
      <div><dt>Ready</dt><dd>{countsUnavailable ? '—' : ready}</dd></div>
      <div><dt>In progress</dt><dd>{countsUnavailable ? '—' : rows.length - ready}</dd></div>
    </dl>
    {loading && <p className="annotation" role="status">Checking replays…</p>}
    {failed && <p role="alert">Couldn’t refresh your replays. Try again.</p>}
    {!loading && !failed && !rows.length && <div className="my-replays-empty">
      <h2>No replays yet</h2><p>Record a frame during your next pool night and create your first replay.</p>
    </div>}
    {[...matches.values()].map(match => {
      const first = match[0]
      const href = `#/session/${first.session_id}`
      return <section className="my-replays-match" key={first.session_id}>
        <h2><a href={href}>
          <span>{first.venue_name}<small>{displayDate(first.occurred_on)}</small></span>
          <Icon name="arrow" size={17} />
        </a></h2>
        <ul>{match.map(replay => <li key={replay.frame_id}>
          <a href={href} className="my-replays-frame">Frame {replay.frame_number}</a>
          {replay.status === 'ready' ? <>
            <span className="my-replays-status">Ready</span>
            <div className="my-replays-actions">
              <button type="button" className="replay-icon-action" aria-label={`Watch replay for Frame ${replay.frame_number}`} onClick={() => setPlaying(replay)}>
                <Icon name="play" size={18} />
              </button>
              <ReplayDownload userId={userId} replay={replay} iconOnly />
            </div>
          </> : <span className="my-replays-status">
            <Icon name={replay.status === 'queued' ? 'clock' : 'refresh'} size={16} />
            {replay.status === 'queued' ? 'Queued' : 'Creating replay'}
          </span>}
        </li>)}</ul>
      </section>
    })}
    {playing && <ReplayViewer key={playing.storage_path} userId={userId} replay={playing}
      description={`${playing.venue_name} · ${displayDate(playing.occurred_on)}`} onClose={() => setPlaying(null)}
      onDeleted={playing.can_delete ? () => {
        setRows(current => current.filter(replay => replay.storage_path !== playing.storage_path))
        refresh()
      } : undefined} />}
  </section>
}
