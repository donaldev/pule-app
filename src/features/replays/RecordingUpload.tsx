import { useEffect, useRef, useState } from 'react'
import { recordingLabel } from './recordingPresentation'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayUploadStatus, SavedFrame } from '../../data/remote/database.types'
import { finalizeRecording, getRecordingStatus, queueRecording, reserveRecording, transferRecording } from '../../data/remote/recordingService'
import { displaySize, displayToSource, inspectRecording, pointerToDisplay, sourceToDisplay, validCorners, type Point, type RecordingGeometry } from './recordingGeometry'
import { clearRecording, hashRecording, readRecording, recordingKey, saveRecording, type RecordingDraft } from './recordingJournal'

export function RecordingUploadAction({ userId, frame, onPublished }: { userId: string; frame: SavedFrame; onPublished: () => void }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="text-button watch-replay" aria-label={`Upload or check recording for frame ${frame.frame_number}`} onClick={() => setOpen(true)}>Upload / recording status</button>
    {open && <Modal title={`Frame ${frame.frame_number} recording`} onClose={() => setOpen(false)}>
      <RecordingUpload key={`${userId}:${frame.id}`} userId={userId} frame={frame} onPublished={onPublished} />
    </Modal>}</>
}
export function RecordingUpload({ userId, frame, onPublished }: { userId: string; frame: SavedFrame; onPublished: () => void }) {
  const key = recordingKey(import.meta.env.VITE_SUPABASE_URL, userId, frame.id)
  const [initial] = useState(() => { try { return { draft: readRecording(key, userId, frame.id), error: '' } } catch { return { draft: null, error: 'Recording recovery could not be read. Use the original browser; nothing was discarded.' } } })
  const [draft, setDraft] = useState<RecordingDraft | null>(initial.draft)
  const [checkedAt, setCheckedAt] = useState(Date.now)
  const [status, setStatus] = useState<ReplayUploadStatus | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [geometry, setGeometry] = useState<RecordingGeometry | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [preview, setPreview] = useState('')
  const [marked, setMarked] = useState(false)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(initial.error)
  const alive = useRef(true), locked = useRef(false), cancel = useRef<AbortController | null>(null)
  const transfer = useRef<ReturnType<typeof transferRecording> | null>(null)
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const objectUrl = useRef('')
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; cancel.current?.abort(); transfer.current?.pause(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [])
  useEffect(() => {
    let active = true
    if (initial.draft?.uploadId) getRecordingStatus(userId, initial.draft.uploadId).then(value => { if (active) { setStatus(value); setCheckedAt(Date.now()) } }).catch(() => { if (active) setError('Could not check the saved recording. Tap Check status before continuing.') })
    return () => { active = false }
  }, [initial.draft?.uploadId, userId])
  function ensureActive() { if (!alive.current) throw Error('Recording closed.'); cancel.current?.signal.throwIfAborted() }
  function persist(next: RecordingDraft) { saveRecording(key, next); setDraft(next); return next }
  async function run(label: string, task: () => Promise<void>) {
    if (locked.current || initial.error) return
    locked.current = true; setCheckedAt(Date.now()); setBusy(label); setError(''); setProgress(0); cancel.current = new AbortController()
    try {
      if (!navigator.locks) throw Error('This browser cannot safely coordinate recording uploads. Use a current Safari or Chrome browser.')
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        if (!lock) throw Error('This recording is open in another tab. Pause it there first.')
        await task()
      })
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Recording could not be saved. Check status before trying again.') }
    finally { locked.current = false; if (alive.current) { setBusy(''); setCheckedAt(Date.now()) } }
  }
  async function choose(chosen?: File) {
    if (!chosen) return
    await run('Checking recording', async () => {
      if (chosen.type && chosen.type !== 'video/mp4' || !/\.mp4$/i.test(chosen.name) || chosen.size < 1 || chosen.size > 262144000) throw Error('Choose an MP4 recording up to 250 MiB. Export MOV recordings as MP4 first.')
      const g = await inspectRecording(chosen); ensureActive()
      const hash = await hashRecording(chosen, cancel.current!.signal, n => { if (alive.current) setProgress(n) }); ensureActive()
      const fixed = draft?.reservationRequested || draft?.uploadId
      if (draft && fixed && (draft.hash !== hash || draft.bytes !== chosen.size)) throw Error('Select the exact original file for this saved recording. A different file cannot replace it.')
      const next = (fixed ? draft : null) ?? { version: 1, userId, frameId: frame.id, operation: crypto.randomUUID(), hash, bytes: chosen.size, geometry: g, corners: [] } satisfies RecordingDraft
      persist(next)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(chosen)
      setPreview(objectUrl.current); setFile(chosen); setGeometry(g); setMarked(false)
      setPoints(next.corners.map(p => sourceToDisplay(p, g)))
    })
  }
  function capture() {
    if (!geometry || !video.current || !canvas.current) return
    const expected = displaySize(geometry), v = video.current
    if (v.videoWidth !== expected.width || v.videoHeight !== expected.height || !Number.isFinite(v.duration) || v.duration <= 0 || v.duration > 7200) {
      setError('This browser cannot display this recording’s orientation or duration reliably. Export a standard MP4 and try again.'); return
    }
    v.pause()
    const c = canvas.current, scale = Math.min(1, 960 / expected.width)
    c.width = Math.round(expected.width * scale); c.height = Math.round(expected.height * scale)
    try { c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height); setMarked(true); setError('') }
    catch { setError('Could not show this frame. Play or seek the video, then try again.') }
  }
  const rawCorners = geometry ? points.map(p => displayToSource(p, geometry)) : []
  const valid = !!geometry && validCorners(rawCorners, geometry.width, geometry.height)
  const processing = !!status?.processing_status && ['queued', 'processing', 'completed'].includes(status.processing_status)
  const expired = status && (['cleanup', 'cleaned'].includes(status.status) || (!status.processing_status && Date.parse(status.expires_at) <= checkedAt))
  async function start() {
    await run('Uploading recording', async () => {
      if (!file || !draft || !geometry || !valid) throw Error('Choose the recording and mark four corners first.')
      let saved = persist({ ...draft, geometry, corners: rawCorners, reservationRequested: true })
      const reserved = saved.uploadId ? await getRecordingStatus(userId, saved.uploadId) : await reserveRecording(userId, frame.id, saved.operation, file.size)
      ensureActive()
      if (reserved.frame_id !== frame.id || reserved.expected_bytes !== saved.bytes) throw Error('Saved recording does not match this frame.')
      setStatus(reserved); saved = persist({ ...saved, uploadId: reserved.upload_id })
      if (reserved.status !== 'reserved') throw Error('This recording is already uploaded or expired. Check status to continue.')
      if (Date.parse(reserved.expires_at) <= Date.now()) throw Error('The upload reservation has expired. Check status before starting a new recording.')
      if (!saved.transferred) {
        transfer.current = transferRecording(file, userId, reserved, saved.hash, n => { if (alive.current) setProgress(n) })
        await transfer.current.start(); ensureActive()
        persist({ ...saved, transferred: true })
      }
      setBusy('Confirming recording')
      const uploaded = await finalizeRecording(userId, reserved.upload_id); ensureActive(); setStatus(uploaded)
    })
  }
  async function confirmUpload() {
    await run('Confirming recording', async () => {
      if (!draft?.uploadId) return
      persist(draft)
      const next = await finalizeRecording(userId, draft.uploadId); ensureActive()
      persist({ ...draft, transferred: true }); setStatus(next)
    })
  }
  async function createReplay() {
    await run('Queueing replay', async () => {
      if (!draft?.uploadId || !geometry || !valid) throw Error('Reopen the original file and mark four valid corners.')
      const saved = persist({ ...draft, geometry, corners: rawCorners })
      const next = await queueRecording(userId, draft.uploadId, saved.corners, geometry.width, geometry.height); ensureActive(); setStatus(next)
    })
  }
  async function check() {
    await run('Checking recording', async () => {
      if (!draft) return
      const next = draft.uploadId ? await getRecordingStatus(userId, draft.uploadId) : await reserveRecording(userId, frame.id, draft.operation, draft.bytes)
      ensureActive(); persist({ ...draft, uploadId: next.upload_id }); setStatus(next)
      if (next.processing_status === 'completed') onPublished()
    })
  }
  return <section className="recording-upload" aria-label="Frame recording upload">
    <p>Upload one complete recording of frame {frame.frame_number}. Keep the camera still and the whole table visible.</p>
    <p role="status">{status?.status === 'reserved' && !status.processing_status ? 'Recording reserved. Continue uploading the original file.' : recordingLabel(status)}</p>
    {!!status?.retain_until && !processing && <p className="annotation">Available for retry until {new Date(status.retain_until).toLocaleString()}.</p>}
    {(!processing && !expired) && <>
      <label className="recording-file">{draft?.reservationRequested || draft?.uploadId ? 'Reopen the original MP4' : 'Choose MP4 recording'}<input type="file" accept="video/mp4,.mp4" disabled={!!busy || !!initial.error} onChange={e => void choose(e.target.files?.[0])} /></label>
      {preview && <>
        <video ref={video} src={preview} controls playsInline preload="metadata" onError={() => setError('This browser cannot play the selected video. Export a compatible MP4.')} />
        <button type="button" className="button button-secondary" disabled={!!busy} onClick={capture}>Use this view to mark corners</button>
        <p className="annotation">Pause where the table is clear. Tap its four corners in order around the edge.</p>
        <div className="recording-table" hidden={!marked}>
          <canvas ref={canvas} />
          {geometry && <svg viewBox={`0 0 ${displaySize(geometry).width} ${displaySize(geometry).height}`} aria-label="Table corner selection" role="img" preserveAspectRatio="none" onPointerDown={e => {
            if (busy || points.length >= 4) return
            const rect = e.currentTarget.getBoundingClientRect()
            setPoints(p => [...p, pointerToDisplay(e.clientX, e.clientY, rect, geometry)])
          }}><polygon points={points.map(p => p.join(',')).join(' ')} />{points.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r={displaySize(geometry).width / 35} /><text x={p[0]} y={p[1]} fontSize={displaySize(geometry).width / 28} textAnchor="middle" dominantBaseline="central">{i + 1}</text></g>)}</svg>}
        </div>
        {marked && <><p>{points.length} of 4 corners selected.{points.length === 4 && !valid && ' Select four distinct corners around the table, without crossing edges.'}</p><div className="connected-actions"><button type="button" className="text-button" disabled={!!busy || points.length >= 4} onClick={() => { if (geometry) setPoints(p => [...p, [displaySize(geometry).width / 2, displaySize(geometry).height / 2]]) }}>Add corner at center</button><button type="button" className="text-button" disabled={!!busy || !points.length} onClick={() => setPoints(p => p.slice(0, -1))}>Undo corner</button><button type="button" className="text-button" disabled={!!busy} onClick={() => setPoints([])}>Reset corners</button></div>
          <details><summary>Adjust corner coordinates</summary>{points.map((p, i) => <div key={i} className="recording-coordinates">{([0, 1] as const).map(axis => <label key={axis}>Corner {i + 1} {axis ? 'Y' : 'X'}<input type="number" min="0" max={geometry ? (axis ? displaySize(geometry).height : displaySize(geometry).width) - 1 : 0} value={Math.round(p[axis])} disabled={!!busy} onChange={e => setPoints(all => all.map((old, n) => n === i ? old.map((value, a) => a === axis ? Number(e.target.value) : value) as Point : old))} /></label>)}</div>)}</details></>}
      </>}
      {!status?.processing_status && <button type="button" className="button" disabled={!!busy || !file || !valid || (!!draft?.uploadId && !status)} onClick={() => void start()}>{draft?.uploadId ? 'Resume upload / confirm save' : 'Upload full frame'}</button>}
      {status?.processing_status && ['uploaded', 'failed'].includes(status.processing_status) && <button type="button" className="button" disabled={!!busy || !file || !valid || (status.attempts ?? 0) >= 3} onClick={() => void createReplay()}>{status.processing_status === 'failed' ? 'Retry with these corners' : 'Create replay'}</button>}
    </>}
    {busy && <div role="status"><p>{busy}…</p>{['Uploading recording', 'Checking recording'].includes(busy) && <progress value={progress} max={100} aria-label={busy} />}{busy === 'Uploading recording' && <button type="button" className="text-button" onClick={() => { cancel.current?.abort(); transfer.current?.pause() }}>Pause upload</button>}</div>}
    {!!draft && (draft.uploadId || draft.reservationRequested) && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void check()}>{draft.uploadId ? 'Check status' : 'Recover saved reservation'}</button>}
    {draft?.uploadId && status?.status === 'reserved' && !expired && <button type="button" className="text-button" disabled={!!busy} onClick={() => void confirmUpload()}>Confirm finished upload</button>}
    {expired && <button type="button" className="text-button" disabled={!!busy} onClick={() => { try { clearRecording(key, draft!); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; setDraft(null); setStatus(null); setFile(null); setGeometry(null); setPreview(''); setMarked(false); setPoints([]) } catch { setError('Recording recovery could not be cleared.') } }}>Start a new recording</button>}
    {status?.processing_status === 'failed' && (status.attempts ?? 0) >= 3 && <p role="status">This recording has reached its three processing attempts. It will expire automatically.</p>}
    {processing && <p className="annotation">You can close this dialog. Check status when you return; nothing is polled in the background.</p>}
    <p className="annotation">Closing pauses transfer. After reopening the app, choose the same file to resume. Your recording stays private.</p>
    {error && <p role="alert" className="connected-error">{error}</p>}
  </section>
}
