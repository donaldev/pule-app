import { useEffect, useId, useState, type ReactNode } from 'react'
import { Icon } from '../../components/ui/Icon'
import type { FrameRecordingState, FrameReplay, ReplayMatch, ReplayUploadStatus, SavedFrame } from '../../data/remote/database.types'
import { MatchRecordingPicker } from '../replays/MatchRecordingPicker'
import { RecordingUploadAction, RecordingUploadDialog } from '../replays/RecordingUpload'
import { listFrameRecordings } from '../../data/remote/recordingService'
import { listFrameReplays } from '../../data/remote/replayService'

import { ReplayViewer } from '../replays/ReplayViewer'

const replayPreviewLimit = 5
const winTypes = {
  regular: 'Regular win',
  golden_break: 'Golden break',
  break_and_run: 'Break and run',
  dry_clearance: 'Dry clearance',
  super_foul: 'Super foul',
}

export function FrameReplays({ userId, sessionId, match, children, upload, describeFrame, archiveFrames }: {
  match: ReplayMatch
  archiveFrames?: SavedFrame[]
  describeFrame?: (frame: SavedFrame) => string
  upload?: { playerId: string | null; detailEligible: boolean }
  userId: string; sessionId: string; children: (action: (frame: SavedFrame, placement?: 'row' | 'details') => ReactNode, replayCount: number) => ReactNode
}) {
  const [replays, setReplays] = useState<FrameReplay[]>([])
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [playback, setPlayback] = useState<{ frame: SavedFrame; replay: FrameReplay } | null>(null)
  const [showAllReplays, setShowAllReplays] = useState(false)
  const [managedUpload, setManagedUpload] = useState<{ frame: SavedFrame; status: ReplayUploadStatus } | null>(null)
  const [adding, setAdding] = useState(false)
  const [recordings, setRecordings] = useState<FrameRecordingState[]>([])
  const uploadsEnabled = import.meta.env?.VITE_FRAME_RECORDING_UPLOADS === 'true'
  const replayListId = useId()
  const replayRows = (archiveFrames ?? []).flatMap(frame => {
    const replay = replays.find(row => row.frame_id === frame.id && row.group_id === frame.group_id)
    const recording = recordings.find(row => row.frame_id === frame.id)
    return replay || recording ? [{ frame, replay, recording }] : []
  }).sort((a, b) => a.frame.frame_number - b.frame.frame_number)
  const readyCount = replayRows.filter(row => row.replay).length
  const hasReplay = (frame: SavedFrame) => replays.some(r => r.frame_id === frame.id && r.group_id === frame.group_id)
  const eligibleFrames = (archiveFrames ?? []).filter(f => uploadsEnabled && upload?.detailEligible && f.detail_eligible && f.status === 'completed' && f.participants.some(p => p.player_id === upload.playerId) && !hasReplay(f) && !recordings.some(r => r.frame_id === f.id))
  useEffect(() => {
    let alive = true
    const refresh = () => Promise.all([listFrameReplays(userId, sessionId), listFrameRecordings(userId, sessionId)]).then(([rows, active]) => {
      if (alive) { setReplays(rows); setRecordings(active); setAvailability('ready') }
    }).catch(() => { if (alive) setAvailability('failed') })
    void refresh()
    // Do not interrupt file selection/transfer by unmounting its selected frame.
    const timer = adding ? undefined : window.setInterval(() => { void refresh() }, 15_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [userId, sessionId, attempt, adding])
  function watch(frame: SavedFrame) {
    const replay = replays.find(r => r.frame_id === frame.id && r.group_id === frame.group_id)
    if (replay) setPlayback({ frame, replay })
  }
  return <>
    {availability === 'loading' && <p role="status" className="annotation">Checking replays…</p>}
    {availability === 'failed' && <p role="alert" className="annotation">Replay availability could not be checked. <button type="button" className="text-button" onClick={() => { setAvailability('loading'); setAttempt(n => n + 1) }}>Check replays again</button></p>}
    {archiveFrames && <section className="connected-section match-replays">
      <header className="match-replays-heading">
        <h2>Match replays</h2>
        {availability === 'ready' && <p>{replayRows.length} total · {readyCount} ready</p>}
      </header>
      <div className="match-replays-content">
        {availability === 'ready' && !replayRows.length && <p className="annotation">No replays yet.</p>}
        {availability === 'ready' && replayRows.length > 0 && <ul className="match-replay-list" id={replayListId}>
          {replayRows.slice(0, showAllReplays ? undefined : replayPreviewLimit).map(({ frame, replay, recording }) => <li key={frame.id} className="match-replay-row">
            <span className="match-replay-number" aria-hidden="true">{frame.frame_number}</span>
            <div className="match-replay-info">
              <h3>Frame {frame.frame_number}</h3>
              {replay ? <p>{[describeFrame?.(frame), winTypes[frame.special_event ?? 'regular']].filter(Boolean).join(' · ')}</p>
                : <p className="match-replay-status"><Icon name="clock" size={14} />
                  <span>{recording?.state === 'cleanup' ? 'Removing recording…' : recording?.state === 'uploading' ? 'Upload pending' : 'Preparing replay'}</span>
                </p>}
            </div>
            {replay ? <button type="button" className="button match-replay-watch" aria-label={`Watch replay for frame ${frame.frame_number}`} onClick={() => watch(frame)}>Watch</button>
              : recording?.owned && recording.state === 'uploading' && <RecordingUploadAction userId={userId} frame={frame} refreshKey={`${recording.state}:${attempt}`} onManage={status => setManagedUpload({ frame, status })} onPublished={() => setAttempt(n => n + 1)} />}
          </li>)}
        </ul>}
        {availability === 'ready' && replayRows.length > replayPreviewLimit && <button type="button" className="button button-secondary view-all-replays" aria-expanded={showAllReplays} aria-controls={replayListId} onClick={() => setShowAllReplays(value => !value)}>{showAllReplays ? 'Show fewer' : `View all (${replayRows.length})`}<Icon name={showAllReplays ? 'chevronUp' : 'chevronDown'} size={16} /></button>}
        {availability === 'ready' && eligibleFrames.length > 0 && <button type="button" className="button frame-recording-action add-frame-recording" onClick={() => setAdding(true)}><Icon name="upload" />Add frame recording</button>}
        {availability === 'ready' && eligibleFrames.length === 0 && <p className="annotation recording-availability" role="status">{!uploadsEnabled ? 'Recording uploads are disabled in this build.' : !upload?.playerId ? 'Your linked player identity is unavailable.' : !upload.detailEligible ? 'This match is not eligible for recordings.' : !archiveFrames.some(f => f.status === 'completed' && f.detail_eligible && f.participants.some(p => p.player_id === upload.playerId)) ? 'No eligible completed frames for this account.' : 'Every eligible frame already has a recording.'}</p>}
      </div>
    </section>}
    {children((frame, placement = 'row') => {
      if (availability !== 'ready' || frame.status !== 'completed') return null
      const attached = replays.some(r => r.frame_id === frame.id && r.group_id === frame.group_id)
      if (placement === 'row') return attached ? <button type="button" className="text-button frame-replay-indicator" aria-label={`Watch replay for frame ${frame.frame_number}`} onClick={() => void watch(frame)}><Icon name="video" size={16} />Replay</button> : null
      if (attached) return <button type="button" className="button frame-recording-action" aria-label={`Watch replay for frame ${frame.frame_number}`} onClick={() => void watch(frame)}><Icon name="play" /><span>Watch replay</span></button>
      if (import.meta.env?.VITE_FRAME_RECORDING_UPLOADS !== 'true') return <p className="annotation">Uploads unavailable in this build.</p>
      if (!upload?.playerId) return <p className="annotation">Player identity unavailable.</p>
      if (!upload.detailEligible || !frame.detail_eligible) return <p className="annotation">Recording unavailable for this frame.</p>
      if (!frame.participants.some(p => p.player_id === upload.playerId)) return <p className="annotation">Only frame participants can add a recording.</p>
      const recording = recordings.find(r => r.frame_id === frame.id)
      if (recording && (!recording.owned || recording.state === 'cleanup')) return <p role="status" className="annotation">{recording.state === 'cleanup' ? 'Removing recording…' : recording.state === 'uploading' ? 'Uploading' : 'Processing replay'}</p>
      return <RecordingUploadAction userId={userId} frame={frame} onPublished={() => setAttempt(n => n + 1)} />
    }, replays.length)}
    {adding && <MatchRecordingPicker userId={userId} frames={archiveFrames?.filter(frame => frame.status === 'completed') ?? []} eligibleFrames={eligibleFrames}
      describeFrame={describeFrame} onClose={() => setAdding(false)} onPublished={() => setAttempt(n => n + 1)} />}
    {managedUpload && <RecordingUploadDialog userId={userId} frame={managedUpload.frame} initialStatus={managedUpload.status}
      onPublished={() => setAttempt(n => n + 1)} onClose={() => { setManagedUpload(null); setAttempt(n => n + 1) }}
      onRemoved={() => { setManagedUpload(null); setAttempt(n => n + 1) }} />}
    {playback && <ReplayViewer key={playback.replay.storage_path} userId={userId}
      replay={{ ...match, ...playback.replay, frame_number: playback.frame.frame_number }}
      description={describeFrame?.(playback.frame)} onClose={() => setPlayback(null)}
      onDeleted={upload?.detailEligible && playback.frame.detail_eligible && playback.frame.participants.some(p => p.player_id === upload.playerId) ? () => {
        setReplays(rows => rows.filter(r => r.storage_path !== playback.replay.storage_path))
        setAttempt(n => n + 1)
      } : undefined} />}
  </>
}
