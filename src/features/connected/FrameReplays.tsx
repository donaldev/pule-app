import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { FrameReplay, SavedFrame } from '../../data/remote/database.types'
import { RecordingUploadAction } from '../replays/RecordingUpload'
import { removeFrameReplay } from '../../data/remote/recordingService'
import { listFrameReplays, signFrameReplay } from '../../data/remote/replayService'

type Playback = { frame: SavedFrame; url?: string; error?: string }
export function FrameReplays({ userId, sessionId, children, upload, describeFrame, archiveFrames }: {
  archiveFrames?: SavedFrame[]
  describeFrame?: (frame: SavedFrame) => string
  upload?: { playerId: string | null; detailEligible: boolean }
  userId: string; sessionId: string; children: (action: (frame: SavedFrame, placement?: 'row' | 'details') => ReactNode, replayCount: number) => ReactNode
}) {
  const [replays, setReplays] = useState<FrameReplay[]>([])
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SavedFrame | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removalMessage, setRemovalMessage] = useState('')
  const [videoSize, setVideoSize] = useState<{ url: string; width: number; height: number } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const request = useRef(0)
  const signing = useRef(false)
  const [showAllReplays, setShowAllReplays] = useState(false)
  const [adding, setAdding] = useState(false)
  const [selectedFrameId, setSelectedFrameId] = useState('')
  const uploadsEnabled = import.meta.env?.VITE_FRAME_RECORDING_UPLOADS === 'true'
  const hasReplay = (frame: SavedFrame) => replays.some(r => r.frame_id === frame.id && r.group_id === frame.group_id)
  const eligibleFrames = (archiveFrames ?? []).filter(f => uploadsEnabled && upload?.detailEligible && f.detail_eligible && f.status === 'completed' && f.participants.some(p => p.player_id === upload.playerId) && !hasReplay(f))
  const selectedFrame = eligibleFrames.find(f => f.id === selectedFrameId)
  useEffect(() => {
    let alive = true
    listFrameReplays(userId, sessionId).then(rows => {
      if (alive) { setReplays(rows); setAvailability('ready') }
    }).catch(() => { if (alive) setAvailability('failed') })
    return () => { alive = false }
  }, [userId, sessionId, attempt])
  useEffect(() => () => { request.current++; signing.current = false }, [])

  function close() { request.current++; signing.current = false; video.current?.pause(); video.current?.removeAttribute('src'); video.current?.load(); setPlayback(null); setVideoSize(null) }
  async function watch(frame: SavedFrame) {
    const replay = replays.find(r => r.frame_id === frame.id && r.group_id === frame.group_id)
    if (!replay || signing.current) return
    signing.current = true
    const id = ++request.current
    setPlayback({ frame })
    try {
      const url = await signFrameReplay(userId, replay)
      if (id === request.current) setPlayback({ frame, url })
    } catch {
      if (id === request.current) setPlayback({ frame, error: 'This replay could not be opened. Check your connection and access, then try again.' })
    } finally { if (id === request.current) signing.current = false }
  }
  async function remove(frame: SavedFrame) {
    const replay = replays.find(r => r.frame_id === frame.id)
    if (!replay || removing) return
    setRemoving(true); setRemovalMessage('')
    try {
      await removeFrameReplay(userId, frame.id, { path: replay.storage_path })
      setConfirmDelete(null); close(); setReplays(rows => rows.filter(r => r.storage_path !== replay.storage_path)); setAttempt(n => n + 1)
      setRemovalMessage('')
    } catch (reason) { setRemovalMessage(reason instanceof Error ? reason.message : 'Replay deletion could not be confirmed.') }
    finally { setRemoving(false) }
  }
  return <>
    {availability === 'loading' && <p role="status" className="annotation">Checking replays…</p>}
    {availability === 'failed' && <p role="alert" className="annotation">Replay availability could not be checked. <button type="button" className="text-button" onClick={() => { setAvailability('loading'); setAttempt(n => n + 1) }}>Check replays again</button></p>}
    {archiveFrames && <section className="connected-section match-replays"><h2>Match replays{availability === 'ready' ? ` · ${replays.length} ${replays.length === 1 ? 'video' : 'videos'}` : ''}</h2>
      <div id="match-replays-content">
        {availability === 'ready' && !replays.length && <p className="annotation">No replays yet.</p>}
        <div className="match-replay-list">{availability === 'ready' && archiveFrames.filter(hasReplay).slice(0, showAllReplays ? undefined : 3).map(frame => <article key={frame.id} className="match-replay-card">
          <div className="match-replay-card-heading"><span className="replay-placeholder" aria-hidden="true"><Icon name="video" size={24} /></span><div><h3>Frame {frame.frame_number}</h3>{describeFrame && <p>{describeFrame(frame)}</p>}{frame.special_event && <small>{({ regular: 'Regular win', golden_break: 'Golden break', break_and_run: 'Break and run', dry_clearance: 'Dry clearance', super_foul: 'Super foul' })[frame.special_event]}</small>}</div></div>
          <button type="button" className="button frame-recording-action" aria-label={`Watch replay for frame ${frame.frame_number}`} onClick={() => void watch(frame)}><Icon name="play" /><span>Watch replay</span></button>
        </article>)}</div>
        {availability === 'ready' && !showAllReplays && archiveFrames.filter(hasReplay).length > 3 && <button type="button" className="button button-secondary view-all-replays" onClick={() => setShowAllReplays(true)}>View all replays · {replays.length}</button>}
        {availability === 'ready' && eligibleFrames.length > 0 && <button type="button" className="button frame-recording-action add-frame-recording" onClick={() => { setSelectedFrameId(''); setAdding(true) }}><Icon name="upload" />Add frame recording</button>}
        {availability === 'ready' && eligibleFrames.length === 0 && <p className="annotation recording-availability" role="status">{!uploadsEnabled ? 'Recording uploads are disabled in this build.' : !upload?.playerId ? 'Your linked player identity is unavailable.' : !upload.detailEligible ? 'This match is not eligible for recordings.' : !archiveFrames.some(f => f.status === 'completed' && f.detail_eligible && f.participants.some(p => p.player_id === upload.playerId)) ? 'No eligible completed frames for this account.' : 'Every eligible frame already has a replay.'}</p>}
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
      return <RecordingUploadAction userId={userId} frame={frame} onPublished={() => setAttempt(n => n + 1)} />
    }, replays.length)}
    {adding && <Modal title="Add frame recording" onClose={() => setAdding(false)}><div className="replay-frame-picker"><label>Choose frame<select value={selectedFrameId} onChange={e => setSelectedFrameId(e.target.value)}><option value="">Select a frame</option>{eligibleFrames.map(frame => <option key={frame.id} value={frame.id}>Frame {frame.frame_number}{describeFrame ? ` · ${describeFrame(frame)}` : ''}</option>)}</select></label>
      {selectedFrame ? <RecordingUploadAction key={selectedFrame.id} userId={userId} frame={selectedFrame} onPublished={() => setAttempt(n => n + 1)} /> : <button type="button" className="button frame-recording-action" disabled><Icon name="upload" />Add recording</button>}
    </div></Modal>}
    {playback && <Modal title={`Frame ${playback.frame.frame_number} replay`} onClose={close}>
      <div className="replay-player">
        {describeFrame && <p className="replay-context">{describeFrame(playback.frame)}</p>}
        {!playback.url && !playback.error && <p role="status">Opening replay…</p>}
        {playback.url && <video ref={video} key={playback.url} src={playback.url} controls playsInline preload="metadata" data-portrait={videoSize?.url === playback.url && videoSize.height > videoSize.width ? 'true' : undefined}
          style={videoSize?.url === playback.url ? { aspectRatio: `${videoSize.width} / ${videoSize.height}`, width: `min(100%, calc((100dvh - 230px) * ${videoSize.width / videoSize.height}))` } : undefined}
          onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth > 0 && v.videoHeight > 0) setVideoSize({ url: playback.url!, width: v.videoWidth, height: v.videoHeight }) }} aria-label={`Frame ${playback.frame.frame_number} replay`}
          onError={() => setPlayback({ frame: playback.frame, error: 'Playback failed or this link has expired. Open a fresh replay link to try again.' })} />}
        {playback.error && <><p role="alert">{playback.error}</p><button type="button" className="button" onClick={() => void watch(playback.frame)}>Open fresh replay link</button></>}
        {upload?.detailEligible && playback.frame.detail_eligible && playback.frame.participants.some(p => p.player_id === upload.playerId) && <button type="button" className="button button-secondary replay-delete" onClick={() => { setRemovalMessage(''); setConfirmDelete(playback.frame) }}>Delete recording</button>}
      </div>
    </Modal>}
    {confirmDelete && <Modal title={`Delete replay for Frame ${confirmDelete.frame_number}?`} onClose={() => { if (!removing) setConfirmDelete(null) }}>
      <div className="replay-confirm"><p>This removes the video only. Your frame result and statistics stay unchanged.</p>
      <div className="connected-actions"><button className="button button-secondary" disabled={removing} onClick={() => setConfirmDelete(null)}>Keep replay</button><button className="button removal-confirm" disabled={removing} onClick={() => void remove(confirmDelete)}>{removing ? 'Deleting…' : 'Delete video'}</button></div>
      {removalMessage && <p role="alert">{removalMessage}</p>}</div>
    </Modal>}
  </>
}
