import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayUploadStatus, SavedFrame } from '../../data/remote/database.types'
import { finalizeRecording, getFrameRecording, removeFrameReplay, getRecordingStatus, queueRecording, reserveRecording, transferRecording } from '../../data/remote/recordingService'
import { displaySize, displayToSource, inspectRecording, pointerToDisplay, sourceToDisplay, validCorners, type Point, type RecordingGeometry } from './recordingGeometry'
import { clearRecording, hashRecording, readRecording, recordingKey, saveRecording, type RecordingDraft } from './recordingJournal'

export function RecordingUploadAction({ userId, frame, onPublished }: { userId: string; frame: SavedFrame; onPublished: () => void }) {
  const [selected, setSelected] = useState<File | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ReplayUploadStatus | null>(null)
  const [showPending, setShowPending] = useState(false)
  useEffect(() => {
    let active = true
    getFrameRecording(userId, frame.id).then(value => { if (active) setPending(value) }).catch(() => {})
    return () => { active = false }
  }, [userId, frame.id])
  return <>
    {pending ? <button type="button" className="text-button replay-pending" onClick={() => setShowPending(true)}>{pending.processing_status === 'failed' ? 'Replay failed' : pending.processing_status === 'queued' || pending.processing_status === 'processing' ? 'Creating replay…' : 'Recording not finished'}</button>
      : <button type="button" className="button button-secondary create-replay" onClick={() => picker.current?.click()}>Create Replay</button>}
    <input ref={picker} type="file" accept="video/mp4,.mp4" hidden aria-label="Choose frame recording" onChange={e => { const file = e.target.files?.[0]; if (file) { setSelected(file) }; e.target.value = '' }} />
    {(selected || showPending) && <Modal title={`Create replay · Frame ${frame.frame_number}`} onClose={() => { setSelected(null); setShowPending(false); void getFrameRecording(userId, frame.id).then(setPending).catch(() => {}); onPublished() }}>
      <RecordingUpload key={`${userId}:${frame.id}`} userId={userId} frame={frame} onPublished={() => { void getFrameRecording(userId, frame.id).then(setPending).catch(() => {}); onPublished() }} initialFile={selected ?? undefined} initialStatus={pending} onRemoved={() => { setSelected(null); setShowPending(false); setPending(null); onPublished() }} />
    </Modal>}</>
}
export function RecordingUpload({ userId, frame, onPublished, initialFile, initialStatus, onRemoved }: { userId: string; frame: SavedFrame; onPublished: () => void; initialFile?: File; initialStatus?: ReplayUploadStatus | null; onRemoved?: () => void }) {
  const key = recordingKey(import.meta.env.VITE_SUPABASE_URL, userId, frame.id)
  const [initial] = useState(() => { try { return { draft: readRecording(key, userId, frame.id), error: '' } } catch { return { draft: null, error: 'Recording recovery could not be read. Use the original browser; nothing was discarded.' } } })
  const [draft, setDraft] = useState<RecordingDraft | null>(initial.draft)
  const [checkedAt, setCheckedAt] = useState(Date.now)
  const [status, setStatus] = useState<ReplayUploadStatus | null>(initialStatus ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [geometry, setGeometry] = useState<RecordingGeometry | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [preview, setPreview] = useState('')
  const [marked, setMarked] = useState(false)
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
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
    if (initial.draft?.uploadId) getRecordingStatus(userId, initial.draft.uploadId).then(value => { if (active) { if (['cleanup', 'cleaned'].includes(value.status)) { try { clearRecording(key, initial.draft!); setDraft(null) } catch { setError('The previous replay was removed, but local recovery could not be cleared.') } } else setStatus(value); setCheckedAt(Date.now()) } }).catch(() => { if (active) setError('Could not check the saved recording. Select the same recording and save again to safely continue.') })
    return () => { active = false }
  }, [initial.draft?.uploadId, userId])
  function ensureActive() { if (!alive.current) throw Error('Recording closed.'); cancel.current?.signal.throwIfAborted() }
  function persist(next: RecordingDraft) { saveRecording(key, next); setDraft(next); return next }
  async function run(label: string, task: () => Promise<void>) {
    if (locked.current || initial.error || removing) return
    locked.current = true; setCheckedAt(Date.now()); setBusy(label); setError(''); setProgress(0); cancel.current = new AbortController()
    try {
      if (!navigator.locks) throw Error('This browser cannot safely coordinate recording uploads. Use a current Safari or Chrome browser.')
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        if (!lock) throw Error('This recording is open in another tab. Pause it there first.')
        await task()
      })
    } catch (reason) { console.error('Replay save failed', reason); if (alive.current) setError(reason instanceof Error ? reason.message : 'Couldn’t save your video. Keep it selected and try again.') }
    finally { locked.current = false; if (alive.current) { setBusy(''); setCheckedAt(Date.now()) } }
  }
  async function choose(chosen?: File) {
    if (!chosen) return
    await run('Checking recording', async () => {
      if (chosen.type && chosen.type !== 'video/mp4' || !/\.mp4$/i.test(chosen.name) || chosen.size < 1 || chosen.size > (import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 2147483648 : 262144000)) throw Error(`Choose an MP4 recording up to ${import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? '2 GiB' : '250 MiB'}. Export MOV recordings as MP4 first.`)
      const g = await inspectRecording(chosen); ensureActive()
      const hash = await hashRecording(chosen, cancel.current!.signal, n => { if (alive.current) setProgress(n) }); ensureActive()
      let previous = draft
      if (previous?.uploadId) {
        const saved = await getRecordingStatus(userId, previous.uploadId); ensureActive()
        if (['cleanup', 'cleaned'].includes(saved.status)) { clearRecording(key, previous); previous = null; setDraft(null); setStatus(null) }
      }
      const fixed = previous?.reservationRequested || previous?.uploadId
      if (previous && fixed && (previous.hash !== hash || previous.bytes !== chosen.size)) throw Error('Select the exact original file for this saved recording. A different file cannot replace it.')
      const next = (fixed ? previous : null) ?? { source_provider: import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 'r2' : 'supabase', version: 1, userId, frameId: frame.id, operation: crypto.randomUUID(), hash, bytes: chosen.size, geometry: g, corners: [] } satisfies RecordingDraft
      persist(next)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(chosen)
      setPreview(objectUrl.current); setFile(chosen); setGeometry(g); setMarked(false)
      setPoints(next.corners.map(p => sourceToDisplay(p, g)))
    })
  }
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active && initialFile) void choose(initialFile) })
    return () => { active = false }
    // Validate each selected file once; recovery stays bound to the saved operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile])
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
    catch { setError('Could not show this frame. Choose the recording again and try again.') }
  }
  const rawCorners = geometry ? points.map(p => displayToSource(p, geometry)) : []
  const valid = !!geometry && validCorners(rawCorners, geometry.width, geometry.height)
  const processing = !!status?.processing_status && ['queued', 'processing', 'completed'].includes(status.processing_status)
  const expired = status && (['cleanup', 'cleaned'].includes(status.status) || (!status.processing_status && Date.parse(status.expires_at) <= checkedAt))
  async function remove(confirmed = false) {
    if (removing || initial.error) return
    if ((draft?.reservationRequested || status) && !confirmed) { setConfirmCancel(true); return }
    setConfirmCancel(false); setRemoving(true); setError('')
    cancel.current?.abort(); transfer.current?.pause()
    try {
      if (!navigator.locks) throw Error('This browser cannot safely cancel this upload.')
      await navigator.locks.request(key, async () => {
        const saved = readRecording(key, userId, frame.id)
        const target = status?.upload_id ?? saved?.uploadId
        if (target || saved?.reservationRequested) await removeFrameReplay(userId, frame.id, target ? { upload: target } : { operation: saved!.operation })
        if (saved && (!target || !saved.uploadId || saved.uploadId === target)) clearRecording(key, saved)
        if (alive.current) { setDraft(null); setStatus(null); setFile(null); setPreview(''); setGeometry(null); setPoints([]); setMarked(false); onRemoved?.() }
      })
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Cancellation could not be confirmed.') }
    finally { if (alive.current) setRemoving(false) }
  }
  async function start() {
    await run('Saving replay', async () => {
      if (!file || !draft || !geometry || !valid) throw Error('Choose the recording and mark four corners first.')
      let saved = persist({ ...draft, geometry, corners: rawCorners, reservationRequested: true })
      let current = saved.uploadId ? await getRecordingStatus(userId, saved.uploadId) : await reserveRecording(userId, frame.id, saved.operation, file.size, saved.hash, saved.source_provider ?? 'supabase')
      ensureActive()
      if (current.frame_id !== frame.id || current.expected_bytes !== saved.bytes) throw Error('Saved recording does not match this frame.')
      setStatus(current); saved = persist({ ...saved, uploadId: current.upload_id })
      if (['queued', 'processing', 'completed'].includes(current.processing_status ?? '')) {
        if (current.processing_status === 'completed') onPublished()
        return
      }
      if (current.processing_status === 'failed') throw Error('Replay processing failed. Your saved recording has been retained; it was not uploaded again.')
      if (current.status === 'reserved') {
        if (Date.parse(current.expires_at) <= Date.now()) throw Error('This recording has expired. It must finish safe cleanup before another recording can be saved.')
        if (!saved.transferred) {
          transfer.current = transferRecording(file, userId, current, saved.hash, n => { if (alive.current) setProgress(n) })
          await transfer.current.start(); ensureActive()
          saved = persist({ ...saved, transferred: true })
        }
        current = await finalizeRecording(userId, current.upload_id, current.source_provider); ensureActive(); setStatus(current)
      }
      if (current.processing_status !== 'uploaded') throw Error('This recording cannot be saved yet. Your previous save has been retained.')
      const queued = await queueRecording(userId, current.upload_id, saved.corners, geometry.width, geometry.height)
      ensureActive(); setStatus(queued); onPublished()
    })
  }
  return <section className="recording-upload" aria-label="Frame recording upload">
    <p>Choose an existing video of the whole frame {frame.frame_number}.</p>
    {processing && <p role="status">{status?.processing_status === 'completed' ? 'Your replay is ready.' : 'Creating replay…'} You can leave this screen. It will appear here after processing finishes.</p>}
    {status?.processing_status === 'failed' && <p role="alert">We couldn’t create this replay. Cancel it below to choose another video.</p>}
    {expired && <p role="alert">This recording has expired. Cancel it below to choose another video.</p>}
    {(!processing && !expired && status?.processing_status !== 'failed') && <>
      {!file && !busy && <label className="recording-file">Choose recording<input type="file" accept="video/mp4,.mp4" disabled={!!initial.error} onChange={e => void choose(e.target.files?.[0])} /></label>}
      {preview && <>
        <video ref={video} src={preview} hidden playsInline preload="auto" onLoadedData={capture} onError={() => setError('This browser cannot play the selected video. Export a compatible MP4.')} />
        <p className="annotation">Tap the four corners of the playing surface, going around the table clockwise or anticlockwise. Pule uses these to identify shots. Use Undo if you miss a corner.</p>
        <div className="recording-table" hidden={!marked}>
          <canvas ref={canvas} />
          {geometry && <svg viewBox={`0 0 ${displaySize(geometry).width} ${displaySize(geometry).height}`} aria-label="Table corner selection" role="img" preserveAspectRatio="none" onPointerDown={e => {
            if (busy || points.length >= 4) return
            const rect = e.currentTarget.getBoundingClientRect()
            setPoints(p => [...p, pointerToDisplay(e.clientX, e.clientY, rect, geometry)])
          }}><polygon points={points.map(p => p.join(',')).join(' ')} />{points.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r={displaySize(geometry).width / 35} /><text x={p[0]} y={p[1]} fontSize={displaySize(geometry).width / 28} textAnchor="middle" dominantBaseline="central">{i + 1}</text></g>)}</svg>}
        </div>
        {marked && <><p>{points.length} of 4 corners selected.{points.length === 4 && !valid && ' These corners cannot be processed. Select four distinct corners inside the video, without crossing edges.'}</p><div className="connected-actions"><button type="button" className="text-button" disabled={!!busy || !points.length} onClick={() => setPoints(p => p.slice(0, -1))}>Undo corner</button><button type="button" className="text-button" disabled={!!busy} onClick={() => setPoints([])}>Reset corners</button></div>
        </>}
      </>}
      <button type="button" className="button" disabled={!!busy || removing || !file || !marked || !valid || !!initial.error} onClick={() => void start()}>Save &amp; Create Replay</button>
    </>}
    {busy && <div role="status"><p>{busy === 'Saving replay' ? 'Saving replay… Keep this screen open.' : 'Checking recording…'}</p><progress value={progress} max={100} aria-label={busy} /></div>}
    {(file || draft || status) && <button type="button" className="text-button" disabled={removing || !!initial.error} onClick={() => void remove()}>{removing ? 'Cancelling…' : status?.processing_status ? 'Cancel Replay' : 'Cancel Upload'}</button>}
    {confirmCancel && <Modal title={`Cancel replay for Frame ${frame.frame_number}?`} onClose={() => setConfirmCancel(false)}><div className="replay-confirm"><p>Your frame result and statistics stay unchanged.</p><div className="connected-actions"><button type="button" className="button button-secondary" onClick={() => setConfirmCancel(false)}>Keep replay</button><button type="button" className="button removal-confirm" onClick={() => void remove(true)}>Cancel replay</button></div></div></Modal>}
    {error && <p role="alert" className="connected-error">{error}</p>}
  </section>
}
