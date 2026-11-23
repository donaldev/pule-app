import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { displaySize, displayToSource, sourceToDisplay, validCorners, type Point, type RecordingGeometry } from './recordingGeometry'
import { clampViewport, fitScale, initialViewport, limitToImage, replaceCorner, stageToImage, zoomViewport, type Viewport } from './cornerViewport'

type Gesture =
  | { kind: 'single'; start: Point; view: Viewport; marker: number | null; moved: boolean }
  | { kind: 'pinch'; center: Point; distance: number; view: Viewport }
  | { kind: 'blocked' }

const SEEK_STEP = 0.25
const SEEK_EPSILON = 0.001
const TOUCH_SLOP = 6
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

function timestamp(seconds: number) {
  const centiseconds = Math.round(seconds * 100)
  const whole = Math.floor(centiseconds / 100)
  const fraction = centiseconds % 100
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

export function RecordingCorners({ src, geometry, corners, confirmed, disabled, onChange, onConfirm, onDuration }: {
  src: string
  geometry: RecordingGeometry
  corners: Point[]
  confirmed: boolean
  disabled: boolean
  onChange: (corners: Point[]) => void
  onConfirm: () => void
  onDuration: (seconds: number) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const requested = useRef<number | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const viewport = useRef(initialViewport)
  const [view, setView] = useState(initialViewport)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [ready, setReady] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState<{ index: number; point: Point } | null>(null)
  const image = displaySize(geometry)
  const { width, height } = image
  const imageScale = fitScale(size, image)
  const markerScale = Math.max(0.01, imageScale * view.zoom)

  useEffect(() => {
    if (!stage.current) return
    const element = stage.current
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect()
      setSize({ width: bounds.width, height: bounds.height })
      const next = clampViewport(viewport.current, bounds, { width, height })
      viewport.current = next
      setView(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [width, height])

  function updateView(next: Viewport) {
    viewport.current = next
    setView(next)
  }

  function fail(message: string) {
    requested.current = null
    setReady(false)
    setSeeking(false)
    setError(message)
  }

  function capture() {
    const player = video.current
    const target = canvas.current
    if (!player || !target || player.seeking || player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (player.videoWidth !== width || player.videoHeight !== height
        || !Number.isFinite(player.duration) || player.duration <= 0 || player.duration > 7200) {
      fail('This browser cannot display the recording’s orientation or duration reliably.')
      return
    }
    const scale = Math.min(1, 1440 / Math.max(width, height))
    const canvasWidth = Math.round(width * scale), canvasHeight = Math.round(height * scale)
    if (target.width !== canvasWidth || target.height !== canvasHeight) {
      target.width = canvasWidth
      target.height = canvasHeight
    }
    try {
      const context = target.getContext('2d')
      if (!context) throw Error('Canvas unavailable')
      context.drawImage(player, 0, 0, canvasWidth, canvasHeight)
      requested.current = null
      setDuration(player.duration)
      setTime(player.currentTime)
      setReady(true)
      setSeeking(false)
      setError('')
      onDuration(player.duration)
    } catch {
      fail('Could not show this frame. Try seeking to a different time.')
    }
  }

  function finishSeek() {
    const player = video.current
    if (!player || player.seeking) return
    const target = requested.current
    if (target !== null && Math.abs(player.currentTime - target) > SEEK_EPSILON) {
      try { player.currentTime = target }
      catch { fail('Could not seek to this frame. Try a different time.') }
      return
    }
    capture()
  }

  function seek(seconds: number) {
    const player = video.current
    if (!player || !duration || disabled) return
    // Stop just before the exact end so the decoder has a frame to display.
    const target = Math.min(Math.max(0, duration - 0.001), Math.max(0, seconds))
    requested.current = target
    setTime(target)
    setSeeking(true)
    setError('')
    finishSeek()
  }

  function local(event: PointerEvent<HTMLDivElement>, bounds: DOMRect): Point {
    return [event.clientX - bounds.left, event.clientY - bounds.top]
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!ready || seeking || disabled || event.button !== 0) return
    const point = local(event, event.currentTarget.getBoundingClientRect())
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    const [a, b] = pointers.current.values()
    if (pointers.current.size === 2) {
      setDrag(null)
      gesture.current = { kind: 'pinch', center: midpoint(a, b), distance: Math.max(1, distance(a, b)), view: viewport.current }
    } else if (pointers.current.size === 1) {
      const target = (event.target as Element).closest('[data-corner-index]')
      gesture.current = { kind: 'single', start: point, view: viewport.current,
        marker: target ? Number(target.getAttribute('data-corner-index')) : null, moved: false }
    }
  }

  function markerAt(action: Extract<Gesture, { kind: 'single' }>, index: number, point: Point, bounds: DOMRect) {
    const original = sourceToDisplay(corners[index], geometry)
    const scale = fitScale(bounds, image) * action.view.zoom
    return displayToSource(limitToImage([
      original[0] + (point[0] - action.start[0]) / scale,
      original[1] + (point[1] - action.start[1]) / scale,
    ], image), geometry)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const action = gesture.current
    if (!pointers.current.has(event.pointerId) || !action || disabled || seeking) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = local(event, bounds)
    pointers.current.set(event.pointerId, point)
    if (action.kind === 'pinch') {
      const [a, b] = pointers.current.values()
      updateView(zoomViewport(action.view, action.view.zoom * distance(a, b) / action.distance,
        action.center, midpoint(a, b), bounds, image))
    } else if (action.kind === 'single') {
      if (distance(action.start, point) >= TOUCH_SLOP) action.moved = true
      if (!action.moved) return
      if (action.marker !== null) {
        setDrag({ index: action.marker, point: markerAt(action, action.marker, point, bounds) })
      } else {
        updateView(clampViewport({ ...action.view, x: action.view.x + point[0] - action.start[0],
          y: action.view.y + point[1] - action.start[1] }, bounds, image))
      }
    }
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!pointers.current.delete(event.pointerId)) return
    const action = gesture.current
    gesture.current = pointers.current.size ? { kind: 'blocked' } : null
    setDrag(null)
    if (cancelled || !ready || seeking || disabled || action?.kind !== 'single') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = local(event, bounds)
    if (action.marker !== null) {
      if (action.moved || distance(action.start, point) >= TOUCH_SLOP) {
        onChange(replaceCorner(corners, action.marker, markerAt(action, action.marker, point, bounds)))
      }
    } else if (!action.moved && distance(action.start, point) < TOUCH_SLOP && corners.length < 4) {
      const [x, y] = stageToImage(point, viewport.current, bounds, image)
      if (x >= 0 && x < width && y >= 0 && y < height) {
        onChange([...corners, displayToSource(limitToImage([x, y], image), geometry)])
      }
    }
  }

  function zoomBy(factor: number) {
    const bounds = stage.current?.getBoundingClientRect()
    if (!bounds) return
    const center: Point = [bounds.width / 2, bounds.height / 2]
    updateView(zoomViewport(viewport.current, viewport.current.zoom * factor, center, center, bounds, image))
  }

  const visibleCorners = (drag ? replaceCorner(corners, drag.index, drag.point) : corners).map(point => sourceToDisplay(point, geometry))
  const valid = validCorners(corners, geometry.width, geometry.height)

  return <section className="recording-corners" aria-label="Replay table corners">
    <video ref={video} src={src} hidden playsInline preload="auto" onLoadedData={finishSeek} onSeeked={finishSeek}
      onError={() => fail('This browser cannot play the selected video. Export a compatible MP4.')} />
    <p className="annotation">Find a clear view of the table. Pinch to zoom, then tap the corners in order around the table. Drag a marker to adjust it.</p>
    <div className="recording-timeline">
      <label>Choose a clear video frame <span>{timestamp(time)}</span>
        <input type="range" min={0} max={Math.max(0, duration - 0.001)} step="any" value={time} disabled={!duration || disabled}
          aria-valuetext={timestamp(time)} onChange={event => seek(Number(event.currentTarget.value))} />
      </label>
      <div className="recording-step-controls">
        <button type="button" className="text-button" disabled={!duration || time <= 0 || disabled} onClick={() => seek(time - SEEK_STEP)}>−0.25 s</button>
        <button type="button" className="text-button" disabled={!duration || time >= duration - 0.001 || disabled} onClick={() => seek(time + SEEK_STEP)}>+0.25 s</button>
      </div>
    </div>
    {!ready && !error && <p className="annotation" role="status">Opening video preview…</p>}
    {error && <p role="alert">{error}</p>}
    <div ref={stage} className="recording-table" style={{ aspectRatio: width / height }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)}
      onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}>
      <div className="recording-table-layer" style={{ width: width * imageScale, height: height * imageScale,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <canvas ref={canvas} aria-hidden="true" />
        <svg viewBox={`0 0 ${width} ${height}`} aria-label="Table corner selection" role="img" preserveAspectRatio="none">
          {visibleCorners.length === 4 ? <polygon points={visibleCorners.map(point => point.join(',')).join(' ')} />
            : <polyline points={visibleCorners.map(point => point.join(',')).join(' ')} />}
          {visibleCorners.map(([x, y], index) => <g key={index} data-corner-index={index}>
            <circle cx={x} cy={y} r={22 / markerScale} fill="transparent" className="recording-marker-hit" />
            <circle cx={x} cy={y} r={11 / markerScale} className="recording-marker-dot" />
            <text x={x} y={y} dominantBaseline="central" textAnchor="middle" fontSize={13 / markerScale}>{index + 1}</text>
          </g>)}
        </svg>
      </div>
      {seeking && <span className="recording-seek-status" role="status">Finding frame…</span>}
    </div>
    <div className="recording-corner-controls">
      <button type="button" className="text-button" aria-label="Zoom out" disabled={view.zoom === 1 || !ready || disabled} onClick={() => zoomBy(1 / 1.5)}>−</button>
      <button type="button" className="text-button" aria-label="Zoom in" disabled={view.zoom === 8 || !ready || disabled} onClick={() => zoomBy(1.5)}>+</button>
      <button type="button" className="text-button" disabled={view.zoom === 1 || disabled} onClick={() => updateView(initialViewport)}>Reset zoom</button>
      <button type="button" className="text-button" disabled={!corners.length || disabled} onClick={() => onChange(corners.slice(0, -1))}>Undo</button>
      <button type="button" className="text-button" disabled={!corners.length || disabled} onClick={() => onChange([])}>Reset corners</button>
    </div>
    <p className="annotation" aria-live="polite">{corners.length} of 4 corners marked.{corners.length === 4 && !valid && ' Mark four distinct corners in order around the table.'}</p>
    <button type="button" className="button button-secondary" disabled={!valid || !ready || seeking || !!drag || confirmed || disabled}
      onClick={onConfirm}>{confirmed ? 'Corners confirmed' : 'Confirm corners'}</button>
  </section>
}
