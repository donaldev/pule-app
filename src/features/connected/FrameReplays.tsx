import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../../components/ui/Primitives'
import type { FrameReplay, SavedFrame } from '../../data/remote/database.types'
import { RecordingUploadAction } from '../replays/RecordingUpload'
import { removeFrameReplay } from '../../data/remote/recordingService'
import { listFrameReplays, signFrameReplay } from '../../data/remote/replayService'

type Playback = { frame: SavedFrame; url?: string; error?: string }
export function FrameReplays({ userId, sessionId, children, upload }: {
  upload?: { playerId: string | null; detailEligible: boolean }
  userId: string; sessionId: string; children: (action: (frame: SavedFrame) => ReactNode) => ReactNode
}) {
  const [replays, setReplays] = useState<FrameReplay[]>([])
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removalMessage, setRemovalMessage] = useState('')
  const request = useRef(0)
  const signing = useRef(false)
  useEffect(() => {
    let alive = true
    listFrameReplays(userId, sessionId).then(rows => {
      if (alive) { setReplays(rows); setAvailability('ready') }
    }).catch(() => { if (alive) setAvailability('failed') })
    return () => { alive = false }
  }, [userId, sessionId, attempt])
  useEffect(() => () => { request.current++; signing.current = false }, [])

  function close() { request.current++; signing.current = false; setPlayback(null) }
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
    if (!replay || removing || !window.confirm('Delete this replay? New playback access will stop and its files will be removed by safe cleanup.')) return
    setRemoving(true); setRemovalMessage('')
    try {
      await removeFrameReplay(userId, frame.id, { path: replay.storage_path })
      close(); setReplays(rows => rows.filter(r => r.storage_path !== replay.storage_path)); setAttempt(n => n + 1)
      setRemovalMessage('Replay removed. File cleanup is pending; you can create a new replay.')
    } catch (reason) { setRemovalMessage(reason instanceof Error ? reason.message : 'Replay deletion could not be confirmed.') }
    finally { setRemoving(false) }
  }
  return <>
    {removalMessage && <p role="status" className="annotation">{removalMessage}</p>}
    {availability === 'loading' && <p role="status" className="annotation">Checking replays…</p>}
    {availability === 'failed' && <p role="alert" className="annotation">Replay availability could not be checked. <button type="button" className="text-button" onClick={() => { setAvailability('loading'); setAttempt(n => n + 1) }}>Check replays again</button></p>}
    {children(frame => availability === 'ready' && replays.some(r => r.frame_id === frame.id && r.group_id === frame.group_id)
      ? <><button type="button" className="text-button watch-replay" aria-label={`Watch Replay for frame ${frame.frame_number}`} onClick={() => void watch(frame)}>Watch Replay</button>{upload?.detailEligible && frame.detail_eligible && frame.participants.some(p => p.player_id === upload.playerId) && <button type="button" className="text-button" disabled={removing} onClick={() => void remove(frame)}>Delete Replay</button>}</> : availability === 'ready' && import.meta.env?.VITE_FRAME_RECORDING_UPLOADS === 'true' && upload?.detailEligible && frame.detail_eligible && frame.status === 'completed' && frame.participants.some(p => p.player_id === upload.playerId)
        ? <RecordingUploadAction userId={userId} frame={frame} onPublished={() => setAttempt(n => n + 1)} /> : null)}
    {playback && <Modal title={`Frame ${playback.frame.frame_number} replay`} onClose={close}>
      <div className="replay-player">
        {!playback.url && !playback.error && <p role="status">Opening replay…</p>}
        {playback.url && <video key={playback.url} src={playback.url} controls playsInline preload="metadata" aria-label={`Frame ${playback.frame.frame_number} replay`}
          onError={() => setPlayback({ frame: playback.frame, error: 'Playback failed or this link has expired. Open a fresh replay link to try again.' })} />}
        {playback.error && <><p role="alert">{playback.error}</p><button type="button" className="button" onClick={() => void watch(playback.frame)}>Open fresh replay link</button></>}
      </div>
    </Modal>}
  </>
}
