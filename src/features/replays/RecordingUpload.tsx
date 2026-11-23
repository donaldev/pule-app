import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayUploadStatus, SavedFrame } from '../../data/remote/database.types'
import { finalizeRecording, getFrameRecording, removeFrameReplay, getRecordingStatus, queueRecording, reserveRecording, transferRecording } from '../../data/remote/recordingService'
import { displaySize, inspectRecording, inspectRecordingTiming, sourceToDisplay, validCorners, type Point, type RecordingGeometry, type RecordingTiming } from './recordingGeometry'
import { compressionLimit, compressionSupport, compressVideo, planCompression, scaleCompressionCorners } from './videoCompression'
import { RecordingCorners } from './RecordingCorners'
import { videoSampleTypes } from './videoSampleTypes'
import { clearRecording, hashRecording, readRecording, recordingKey, saveRecording, type RecordingDraft } from './recordingJournal'

export function RecordingUploadAction({ userId, frame, onPublished }: { userId: string; frame: SavedFrame; onPublished: () => void }) {
  const [selected, setSelected] = useState<File | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ReplayUploadStatus | null>(null)
  const [checked, setChecked] = useState(false)
  const [checkError, setCheckError] = useState(false)
  const [showPending, setShowPending] = useState(false)
  useEffect(() => {
    let active = true
    getFrameRecording(userId, frame.id).then(value => { if (active) { setPending(value); setChecked(true); setCheckError(false) } }).catch(() => { if (active) { setChecked(true); setCheckError(true) } })
    return () => { active = false }
  }, [userId, frame.id])
  return <>
    {!checked ? <p role="status">Checking recording…</p> : checkError ? <p role="alert">Recording availability couldn’t be checked. Close and reopen these details to try again.</p> : pending ? <button type="button" className="text-button replay-pending" onClick={() => setShowPending(true)}>{pending.status === 'cleanup' || pending.processing_status === 'failed' ? 'Removing recording…' : pending.status === 'reserved' ? 'Uploading' : 'Processing replay'}</button>
      : <button type="button" className="button frame-recording-action" onClick={() => picker.current?.click()}><Icon name="upload" /><span>Add recording</span></button>}
    <input ref={picker} type="file" accept="video/mp4,.mp4" hidden aria-label="Choose frame recording" onChange={e => { const file = e.target.files?.[0]; if (file) { setSelected(file) }; e.target.value = '' }} />
    {(selected || showPending) && <Modal title={`Create replay · Frame ${frame.frame_number}`} onClose={() => { setSelected(null); setShowPending(false); void getFrameRecording(userId, frame.id).then(setPending).catch(() => {}); onPublished() }}>
      <RecordingUpload key={`${userId}:${frame.id}`} userId={userId} frame={frame} onPublished={() => { void getFrameRecording(userId, frame.id).then(setPending).catch(() => {}); onPublished() }} initialFile={selected ?? undefined} initialStatus={pending} onRemoved={() => { setSelected(null); setShowPending(false); setPending(null); onPublished() }} />
    </Modal>}</>
}
export function RecordingUpload({ userId, frame, onPublished, initialFile, initialTiming, initialStatus, onRemoved }: { userId: string; frame: SavedFrame; onPublished: () => void; initialFile?: File; initialTiming?: RecordingTiming | null; initialStatus?: ReplayUploadStatus | null; onRemoved?: () => void }) {
  const key = recordingKey(import.meta.env.VITE_SUPABASE_URL, userId, frame.id)
  const [initial] = useState(() => { try { return { draft: readRecording(key, userId, frame.id), error: '' } } catch { return { draft: null, error: 'Recording recovery could not be read. Use the original browser; nothing was discarded.' } } })
  const [draft, setDraft] = useState<RecordingDraft | null>(initial.draft)
  const [checkedAt, setCheckedAt] = useState(Date.now)
  const [status, setStatus] = useState<ReplayUploadStatus | null>(initialStatus ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [geometry, setGeometry] = useState<RecordingGeometry | null>(null)
  const [rawCorners, setRawCorners] = useState<Point[]>([])
  const [preview, setPreview] = useState('')
  const [cornersConfirmed, setCornersConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(initial.error)
  const alive = useRef(true), locked = useRef(false), cancel = useRef<AbortController | null>(null)
  const transfer = useRef<ReturnType<typeof transferRecording> | null>(null)
  const objectUrl = useRef('')
  const [duration, setDuration] = useState(0)
  const [compression, setCompression] = useState<{
    duration: number
    plan: ReturnType<typeof planCompression>
    timing: RecordingTiming | null
    losesAudio: boolean
  } | null>(null)
  const [compressSelected, setCompressSelected] = useState(false)
  const [compressionElapsed, setCompressionElapsed] = useState(0)
  const [compressed, setCompressed] = useState<{
    file: File; geometry: RecordingGeometry; hash: string; operation: string
  } | null>(null)
  const [recoveryUrl, setRecoveryUrl] = useState('')
  const compressing = busy === 'Compressing recording'
  const canPrepareCompression = import.meta.env?.VITE_REPLAY_COMPRESSION_PILOT === 'true'
    && !draft?.reservationRequested && !draft?.uploadId && !status

  useEffect(() => {
    if (!compressed) { setRecoveryUrl(''); return }
    const url = URL.createObjectURL(compressed.file)
    setRecoveryUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [compressed])
  useEffect(() => {
    if (!canPrepareCompression || !file || !geometry || !duration || !compressionSupport()) return
    let active = true
    const size = displaySize(geometry)
    void Promise.all([videoSampleTypes(file), initialTiming === undefined || file !== initialFile
      ? inspectRecordingTiming(file) : Promise.resolve(initialTiming)]).then(([sampleTypes, timing]) => {
      if (!active) return
      const hasAudio = sampleTypes.audio.length > 0
      const plan = planCompression({ ...size, duration }, hasAudio)
      setCompression({ duration, plan, timing, losesAudio: hasAudio && !plan.audio })
    }).catch(() => { if (active) setCompression(null) })
    return () => { active = false }
  }, [canPrepareCompression, file, geometry, duration, initialFile, initialTiming])
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
  async function run(label: string, task: () => Promise<void>, localOnly = false) {
    if (locked.current || initial.error || removing) return
    locked.current = true; setCheckedAt(Date.now()); setBusy(label); setError(''); setProgress(0); cancel.current = new AbortController()
    try {
      if (localOnly) { await task(); return }
      if (!navigator.locks) throw Error('This browser cannot safely coordinate recording uploads. Use a current Safari or Chrome browser.')
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        if (!lock) throw Error('This recording is open in another tab. Pause it there first.')
        await task()
      })
    } catch (reason) {
      console.error('Replay save failed', reason)
      if (alive.current) {
        if (localOnly) {
          setError(cancel.current?.signal.aborted ? 'Compression cancelled. You can still upload the original recording.'
            : `${reason instanceof Error ? reason.message : 'Compression failed.'} Turn off compression to upload the original recording.`)
          return
        }
        setError(reason instanceof Error ? reason.message : 'Couldn’t save your video. Check its status before trying again.')
        // A lost response is not proof of failure. Only reflect server-confirmed retirement.
        try {
          const saved = readRecording(key, userId, frame.id)
          if (saved?.uploadId) {
            const current = await getRecordingStatus(userId, saved.uploadId)
            if (alive.current && ['cleanup', 'cleaned'].includes(current.status)) {
              setStatus(current); setError('This recording failed. Removing its video before another upload.'); onPublished()
            }
          }
        } catch { /* Keep the same operation protected when its status is unknown. */ }
      }
    }
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
      if (previous && fixed && (previous.hash !== hash || previous.bytes !== chosen.size)) throw Error(previous.compressedName ? `Select ${previous.compressedName} to resume this compressed upload.` : 'Select the exact original file for this saved recording. A different file cannot replace it.')
      const next = (fixed ? previous : null) ?? { source_provider: import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 'r2' : 'supabase', version: 1, userId, frameId: frame.id, operation: crypto.randomUUID(), hash, bytes: chosen.size, geometry: g, corners: [] } satisfies RecordingDraft
      persist(next)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(chosen)
      setCompression(null); setDuration(0); setCompressSelected(false); setCompressed(null)
      setPreview(objectUrl.current); setFile(chosen); setGeometry(g); setCornersConfirmed(false)
      setRawCorners(next.corners)
    })
  }
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active && initialFile) void choose(initialFile) })
    return () => { active = false }
    // Validate each selected file once; recovery stays bound to the saved operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile])
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
        if (alive.current) { setDraft(null); setStatus(null); setFile(null); setPreview(''); setGeometry(null); setRawCorners([]); setCornersConfirmed(false); setCompressed(null); onRemoved?.() }
      })
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Cancellation could not be confirmed.') }
    finally { if (alive.current) setRemoving(false) }
  }
  async function compress() {
    if (!file || !compression || !cornersConfirmed || !valid) return
    setCompressionElapsed(0)
    await run('Compressing recording', async () => {
      const signal = cancel.current!.signal
      const result = await compressVideo(file, compression.duration, compression.plan, signal, (fraction, seconds) => {
        if (alive.current) { setProgress(fraction * 100); setCompressionElapsed(seconds) }
      })
      ensureActive()
      if (result.blob.size > compressionLimit) throw Error(`The compressed recording is ${(result.blob.size / 1e6).toFixed(2)} MB and exceeds the 100 MB limit.`)
      if (result.blob.size >= file.size) throw Error('Compression did not make this recording smaller.')
      const finished = new File([result.blob], file.name.replace(/\.mp4$/i, '') + '_compressed.mp4', { type: 'video/mp4' })
      const hash = await hashRecording(finished, signal)
      ensureActive()
      setCompressed({ file: finished, geometry: result.geometry, hash, operation: crypto.randomUUID() })
    }, true)
  }
  async function start() {
    await run('Saving replay', async () => {
      if (!file || !draft || !geometry || !cornersConfirmed || !valid) throw Error('Choose the recording and mark four corners first.')
      const selected = compressSelected ? compressed : null
      const uploadFile = selected?.file ?? file
      const uploadGeometry = selected?.geometry ?? geometry
      // Canvas compression bakes in the original display orientation. Keep the
      // overlay on the original and scale its displayed points for the worker.
      const corners = selected ? scaleCompressionCorners(rawCorners.map(point => sourceToDisplay(point, geometry)), displaySize(geometry), uploadGeometry) : rawCorners
      if (!validCorners(corners, uploadGeometry.width, uploadGeometry.height)) {
        throw Error('The marked table is too small at the compressed resolution. Upload the original recording.')
      }
      const payload = selected && !draft.reservationRequested ? {
        ...draft, operation: selected.operation, bytes: uploadFile.size, hash: selected.hash, compressedName: uploadFile.name
      } : draft
      let saved = persist({ ...payload, geometry: uploadGeometry, corners, reservationRequested: true })
      let current = saved.uploadId ? await getRecordingStatus(userId, saved.uploadId) : await reserveRecording(userId, frame.id, saved.operation, uploadFile.size, saved.hash, saved.source_provider ?? 'supabase')
      ensureActive()
      if (current.frame_id !== frame.id || current.expected_bytes !== saved.bytes) throw Error('Saved recording does not match this frame.')
      setStatus(current); saved = persist({ ...saved, uploadId: current.upload_id })
      if (['queued', 'processing', 'completed'].includes(current.processing_status ?? '')) {
        if (current.processing_status === 'completed') onPublished()
        return
      }
      if (current.processing_status === 'failed') throw Error('This recording failed. A new upload will be available after its video is safely removed.')
      if (current.status === 'reserved') {
        if (Date.parse(current.expires_at) <= Date.now()) throw Error('This recording has expired. It must finish safe cleanup before another recording can be saved.')
        if (!saved.transferred) {
          transfer.current = transferRecording(uploadFile, userId, current, saved.hash, n => { if (alive.current) setProgress(n) })
          await transfer.current.start(); ensureActive()
          saved = persist({ ...saved, transferred: true })
        }
        current = await finalizeRecording(userId, current.upload_id, current.source_provider); ensureActive(); setStatus(current)
      }
      if (current.processing_status !== 'uploaded') throw Error('This recording cannot be saved yet. Your previous save has been retained.')
      const queued = await queueRecording(userId, current.upload_id, saved.corners, saved.geometry.width, saved.geometry.height)
      ensureActive(); setStatus(queued); onPublished()
    })
  }
  return <section className="recording-upload" aria-label="Frame recording upload">
    <p>Choose an existing video of the whole frame {frame.frame_number}.</p>
    {processing && <p role="status">{status?.processing_status === 'completed' ? 'Your replay is ready.' : 'Processing replay…'} You can leave this screen. It will appear here after processing finishes.</p>}
    {status?.processing_status === 'failed' && <p role="alert">We couldn’t create this replay. Removing its video before you upload again.</p>}
    {expired && <p role="alert">This recording is no longer active. A new upload will be available after safe removal.</p>}
    {(!processing && !expired && status?.processing_status !== 'failed') && <>
      {!file && !busy && <label className="recording-file">{draft?.reservationRequested && draft.compressedName ? `Choose ${draft.compressedName} to resume` : 'Choose recording'}<input type="file" accept="video/mp4,.mp4" disabled={!!initial.error} onChange={e => void choose(e.target.files?.[0])} /></label>}
      {preview && geometry && <RecordingCorners key={preview} src={preview} geometry={geometry} corners={rawCorners}
        confirmed={cornersConfirmed} disabled={!!busy || removing}
        onChange={next => { setRawCorners(next); setCornersConfirmed(false) }}
        onConfirm={() => setCornersConfirmed(true)} onDuration={setDuration} />}
      {cornersConfirmed && compression && canPrepareCompression && <>
        <label className="replay-compression-option">
          <input type="checkbox" checked={compressSelected} disabled={!!busy || removing}
            onChange={e => setCompressSelected(e.currentTarget.checked)} />
          Compress video before upload
        </label>
        {compressSelected && <p className="annotation">Compression may take about {Math.max(1, Math.ceil(compression.duration / 60))} min, roughly as long as the recording. Keep this screen open. Target: 100 MB or less.{compression.losesAudio && ' This browser will produce a silent video.'}</p>}
      </>}
      {compressSelected && compressed && file && <div>
        <p role="status">Original: {(file.size / 1e6).toFixed(2)} MB · Compressed: {(compressed.file.size / 1e6).toFixed(2)} MB</p>
        {recoveryUrl && <p><a className="text-button" href={recoveryUrl} download={compressed.file.name}>Save compressed copy</a> <span className="annotation">Keep a copy if you might need to resume after closing this screen.</span></p>}
      </div>}
      <button type="button" className="button" disabled={!!busy || removing || !file || !cornersConfirmed || !valid || !!initial.error}
        onClick={() => void (compressSelected && !compressed ? compress() : start())}>
        {compressSelected && !compressed ? 'Compress recording' : 'Save & Create Replay'}
      </button>
    </>}
    {busy && <div role="status"><p>{compressing ? `Compressing… ${Math.floor(compressionElapsed)} s elapsed` : busy === 'Saving replay' ? 'Uploading… Keep this screen open.' : 'Checking recording…'}</p><progress value={progress} max={100} aria-label={busy} /></div>}
    {compressing ? <button type="button" className="text-button" onClick={() => cancel.current?.abort()}>Cancel compression</button>
      : (file || draft || status) && status?.status !== 'cleanup' && status?.status !== 'cleaned' && status?.processing_status !== 'failed' && <button type="button" className="text-button" disabled={removing || !!initial.error} onClick={() => void remove()}>{removing ? 'Cancelling…' : status?.processing_status ? 'Cancel Replay' : 'Cancel Upload'}</button>}
    {confirmCancel && <Modal title={`Cancel replay for Frame ${frame.frame_number}?`} onClose={() => setConfirmCancel(false)}><div className="replay-confirm"><p>Your frame result and statistics stay unchanged.</p><div className="connected-actions"><button type="button" className="button button-secondary" onClick={() => setConfirmCancel(false)}>Keep replay</button><button type="button" className="button removal-confirm" onClick={() => void remove(true)}>Cancel replay</button></div></div></Modal>}
    {error && <p role="alert" className="connected-error">{error}</p>}
  </section>
}
