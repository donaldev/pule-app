import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayMatch } from '../../data/remote/database.types'
import { removeFrameReplay } from '../../data/remote/recordingService'
import { downloadFrameReplay, signFrameReplay } from '../../data/remote/replayService'
import { ReplayShots } from './ReplayShots'

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
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [videoSize, setVideoSize] = useState<{ width: number; height: number }>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removalMessage, setRemovalMessage] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const path = replay.storage_path

  useEffect(() => {
    let active = true
    signFrameReplay(userId, { storage_path: path }).then(
      signed => { if (active) setUrl(signed) },
      () => { if (active) setError('This replay could not be opened. Check your connection and access, then try again.') }
    )
    return () => { active = false }
  }, [userId, path, attempt])

  function close() {
    video.current?.pause()
    video.current?.removeAttribute('src')
    video.current?.load()
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
    <Modal title={`Frame ${replay.frame_number} replay`} onClose={close}>
      <div className={`replay-player${showShots ? ' replay-player-shots' : ''}`}>
        <div className="replay-view-switch" aria-label="Replay view" role="group">
          <button type="button" aria-pressed={!showShots} onClick={() => { video.current?.pause(); setShowShots(false) }}>Full replay</button>
          <button type="button" aria-pressed={showShots} onClick={() => {
            video.current?.pause()
            setOpenedShots(true)
            setShowShots(true)
          }}>Shots</button>
        </div>
        <div className="replay-media">
          {description && <p className="replay-context">{description}</p>}
          {!url && !error && <p role="status">Opening replay…</p>}
          {url && <video ref={video} key={url} src={url} controls={!showShots} playsInline preload="metadata"
            data-portrait={videoSize && videoSize.height > videoSize.width ? 'true' : undefined}
            style={videoSize ? { aspectRatio: `${videoSize.width} / ${videoSize.height}`, width: `min(100%, calc((100dvh - 230px) * ${videoSize.width / videoSize.height}))` } : undefined}
            onLoadedMetadata={e => {
              const v = e.currentTarget
              if (v.videoWidth > 0 && v.videoHeight > 0) setVideoSize({ width: v.videoWidth, height: v.videoHeight })
            }}
            aria-label={`Frame ${replay.frame_number} replay`}
            onError={() => { setUrl(''); setError('Playback failed or this link has expired. Open a fresh replay link to try again.') }} />}
          {error && <><p role="alert">{error}</p><button type="button" className="button" onClick={() => {
            setError('')
            setVideoSize(undefined)
            setAttempt(n => n + 1)
          }}>Open fresh replay link</button></>}
        </div>
        {openedShots && <ReplayShots userId={userId} frameId={replay.frame_id} path={path} video={video}
          mediaKey={url} active={showShots} canReview={!!onDeleted} />}
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
