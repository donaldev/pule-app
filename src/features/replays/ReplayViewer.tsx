import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayMatch } from '../../data/remote/database.types'
import { removeFrameReplay } from '../../data/remote/recordingService'
import { downloadFrameReplay, replayPlaybackLinkSeconds, signFrameReplay } from '../../data/remote/replayService'
import { ReplayShots } from './ReplayShots'
import { createReplayPlayback, type PlaybackState } from './replayPlayback'

export type PlayableReplay = ReplayMatch & {
  frame_id: string
  frame_number: number
  storage_path: string
}

export function ReplayDownload({ userId, replay, iconOnly = false }: {
  userId: string
  replay: PlayableReplay
  iconOnly?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function download() {
    setBusy(true)
    setError(false)
    try {
      await downloadFrameReplay(userId, replay)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return <div className="replay-download">
    <button type="button" className={iconOnly ? 'replay-icon-action' : 'button button-secondary replay-download-action'}
      aria-label={`Download replay for Frame ${replay.frame_number}`} disabled={busy} aria-busy={busy}
      onClick={() => void download()}>
      <Icon name="download" size={18} />{!iconOnly && (busy ? 'Preparing download…' : 'Download Replay')}
    </button>
    {error && <p role="alert" className="replay-download-error">Couldn’t start download. Try again.</p>}
  </div>
}

export function ReplayViewer({ userId, replay, description, onClose, onDeleted }: {
  userId: string
  replay: PlayableReplay
  description?: string
  onClose: () => void
  onDeleted?: () => void
}) {
  const [showShots, setShowShots] = useState(false)
  const [openedShots, setOpenedShots] = useState(false)
  const [playback, setPlayback] = useState<PlaybackState>({ ready: false, playing: false, message: 'Opening replay…', error: '' })
  const transport = useRef<ReturnType<typeof createReplayPlayback> | null>(null)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removalMessage, setRemovalMessage] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const path = replay.storage_path
  const sign = useCallback(() => signFrameReplay(userId, { storage_path: path }), [userId, path])

  useEffect(() => {
    const element = video.current!
    const controller = createReplayPlayback(element, sign,
      replayPlaybackLinkSeconds * 1000, setPlayback)
    transport.current = controller
    return () => {
      transport.current = null
      controller.destroy()
    }
  }, [sign])

  function close() {
    transport.current?.stop()
    onClose()
  }

  async function remove() {
    setRemoving(true)
    setRemovalMessage('')
    try {
      await removeFrameReplay(userId, replay.frame_id, { path })
      onDeleted?.()
      close()
    } catch (reason) {
      setRemovalMessage(reason instanceof Error ? reason.message : 'Replay deletion could not be confirmed.')
    } finally {
      setRemoving(false)
    }
  }

  return <>
    <Modal title={`Frame ${replay.frame_number} replay`} onClose={close} fullScreen>
      <div className={`replay-player${showShots ? ' replay-player-shots' : ''}`}>
        <div className="replay-view-switch" aria-label="Replay view" role="group">
          <button type="button" aria-pressed={!showShots} onClick={() => { transport.current?.stop(); setShowShots(false) }}>Full replay</button>
          <button type="button" aria-pressed={showShots} onClick={() => {
            transport.current?.stop()
            setOpenedShots(true)
            setShowShots(true)
          }}>Shots</button>
        </div>
        <div className="replay-media">
          {description && <p className="replay-context">{description}</p>}
          {playback.message && <p role="status">{playback.message}</p>}
          <video ref={video} controls={!showShots && playback.ready} playsInline preload="metadata"
            onLoadedMetadata={e => setDuration(Math.round(e.currentTarget.duration * 1000) || 0)}
            onTimeUpdate={e => setPosition(Math.round(e.currentTarget.currentTime * 1000))}
            aria-label={`Frame ${replay.frame_number} replay`} />
          {playback.error && <><p role="alert">{playback.error}</p>
            <button type="button" className="button" onClick={() => transport.current?.retry()}>Retry playback</button></>}
        </div>
        {openedShots && <ReplayShots userId={userId} frameId={replay.frame_id} path={path} transport={transport}
          playbackState={playback} active={showShots} canReview={!!onDeleted}
          duration={duration} position={position} sign={sign} frameNumber={replay.frame_number} />}
        {!showShots && <footer className="replay-player-actions">
          <ReplayDownload userId={userId} replay={replay} />
          {onDeleted && <button type="button" className="button button-secondary replay-delete"
            onClick={() => { setRemovalMessage(''); setConfirmDelete(true) }}>Delete Replay</button>}
        </footer>}
      </div>
    </Modal>
    {confirmDelete && <Modal title={`Delete replay for Frame ${replay.frame_number}?`} onClose={() => { if (!removing) setConfirmDelete(false) }}>
      <div className="replay-confirm">
        <p>This removes the video only. Your frame result and statistics stay unchanged.</p>
        <div className="connected-actions">
          <button className="button button-secondary" disabled={removing} onClick={() => setConfirmDelete(false)}>Keep replay</button>
          <button className="button removal-confirm" disabled={removing} onClick={() => void remove()}>{removing ? 'Deleting…' : 'Delete video'}</button>
        </div>
        {removalMessage && <p role="alert">{removalMessage}</p>}
      </div>
    </Modal>}
  </>
}
