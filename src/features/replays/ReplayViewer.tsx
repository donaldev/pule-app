import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayMatch } from '../../data/remote/database.types'
import { removeFrameReplay } from '../../data/remote/recordingService'
import { downloadFrameReplay, replayPlaybackLinkSeconds, signFrameReplay } from '../../data/remote/replayService'
import { ReplayShots } from './ReplayShots'
import { useImmersiveReplay } from './useImmersiveReplay'
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
  const [reviewing, setReviewing] = useState(false)
  const [shotOverlay, setShotOverlay] = useState<HTMLDivElement | null>(null)
  const [aspect, setAspect] = useState<number>()
  const swipe = useRef<((direction: number) => void) | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const stage = useRef<HTMLDivElement>(null)
  const fullscreenButton = useRef<HTMLButtonElement>(null)
  const { immersive, controls, toggle: toggleFullscreen, reveal, tap } = useImmersiveReplay(playback.playing, stage, fullscreenButton)
  const finished = !showShots || !reviewing
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
    if (immersive) { void toggleFullscreen(); return }
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
      <div className={`replay-player${showShots ? ' replay-player-shots' : ''}`} data-finished={finished}>
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
          <div className="replay-stage" ref={stage} data-immersive={immersive}
            data-controls={controls || !!playback.error}
            style={aspect ? { '--replay-aspect': aspect } as CSSProperties : undefined}
            onFocus={e => { if (!(e.target as HTMLElement).classList.contains('replay-gesture')) reveal() }}>
            <video ref={video} controls={!showShots && playback.ready && !immersive} controlsList="nofullscreen" playsInline preload="metadata"
              onLoadedMetadata={e => {
                const v = e.currentTarget
                setDuration(Math.round(v.duration * 1000) || 0)
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
              }}
              onTimeUpdate={e => setPosition(Math.round(e.currentTarget.currentTime * 1000))}
              aria-label={`Frame ${replay.frame_number} replay`} />
            {immersive && <button type="button" className="replay-gesture" aria-label="Show or hide playback controls"
              onPointerDown={e => {
                if (!e.isPrimary) return
                touch.current = { x: e.clientX, y: e.clientY }
                swiped.current = false
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerCancel={() => { touch.current = null }}
              onPointerUp={e => {
                if (!touch.current || !e.isPrimary) return
                const dx = e.clientX - touch.current.x
                const dy = e.clientY - touch.current.y
                touch.current = null
                if (showShots && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                  swiped.current = true
                  swipe.current?.(dx < 0 ? 1 : -1)
                  reveal()
                }
              }}
              onClick={e => { if (!swiped.current || !e.detail) tap(); swiped.current = false }} />}
            {finished && <button type="button" ref={fullscreenButton} className="replay-fullscreen-button"
              onClick={() => void toggleFullscreen()}>
              {immersive ? 'Exit fullscreen' : 'Fullscreen'}
            </button>}
            {(playback.message || playback.error) && <div className="replay-stage-status">
              {playback.message && <p role="status">{playback.message}</p>}
              {playback.error && <><p role="alert">{playback.error}</p>
                <button type="button" className="button" onClick={() => transport.current?.retry()}>Retry playback</button></>}
            </div>}
            {immersive && <div className="replay-overlay" ref={setShotOverlay} onPointerDown={reveal}>
              {!showShots && <div className="replay-overlay-content">
                <label className="shot-range"><span>Replay timeline</span>
                  <input type="range" min={0} max={duration || 1} value={Math.min(position, duration)}
                    disabled={!playback.ready} onChange={e => transport.current?.seek(e.currentTarget.valueAsNumber, undefined, true)} />
                </label>
                <div className="shot-actions">
                  <button type="button" className="button" disabled={!playback.ready}
                    onClick={() => transport.current?.toggle({ start: 0, end: duration })}>{playback.playing ? 'Pause' : 'Play'}</button>
                  <button type="button" className="button button-secondary" disabled={!playback.ready}
                    onClick={() => transport.current?.seek(0, duration)}>Replay</button>
                  <ReplayDownload userId={userId} replay={replay} />
                </div>
              </div>}
            </div>}
          </div>
        </div>
        {openedShots && <ReplayShots userId={userId} frameId={replay.frame_id} path={path} transport={transport}
          playbackState={playback} active={showShots} canReview={!!onDeleted}
          duration={duration} position={position} sign={sign} frameNumber={replay.frame_number}
          overlay={shotOverlay} onReviewing={setReviewing} swipe={swipe} />}
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
