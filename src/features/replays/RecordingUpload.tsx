import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { assertDirectReplayUploadSize, compressedReplayOutputLimit, directReplayUploadLimit } from '../../data/replayUploadLimit.mjs'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { ReplayUploadStatus, SavedFrame } from '../../data/remote/database.types'
import { finalizeRecording, getFrameRecording, removeFrameReplay, getRecordingStatus, queueRecording, reserveRecording, transferRecording } from '../../data/remote/recordingService'
import { displaySize, inspectRecording, inspectRecordingTiming, sourceToDisplay, validCorners, type Point, type RecordingGeometry, type RecordingTiming } from './recordingGeometry'
import { compressionSupport, compressVideo, planCompression, scaleCompressionCorners } from './videoCompression'
import { RecordingFilePicker, RecordingProgress } from './RecordingFilePicker'
import { RecordingCorners } from './RecordingCorners'
import { videoSampleTypes } from './videoSampleTypes'
import { clearRecording, hashRecording, readRecording, recordingKey, saveRecording, type RecordingDraft } from './recordingJournal'

export function RecordingUploadAction({ userId, frame, onPublished, onManage, refreshKey }: { userId: string; frame: SavedFrame; onPublished: () => void; onManage?: (status: ReplayUploadStatus) => void; refreshKey?: string }) {
  const [pending, setPending] = useState<ReplayUploadStatus | null>(null)
  const [checked, setChecked] = useState(false)
  const [checkError, setCheckError] = useState(false)
  const [showPending, setShowPending] = useState(false)
  useEffect(() => {
    let active = true
    getFrameRecording(userId, frame.id).then(value => { if (active) { setPending(value); setChecked(true); setCheckError(false) } }).catch(() => { if (active) { setChecked(true); setCheckError(true) } })
    return () => { active = false }
  }, [userId, frame.id, refreshKey])
  function close() {
    setShowPending(false)
    void getFrameRecording(userId, frame.id).then(setPending).catch(() => {})
    onPublished()
  }
  if (onManage) {
    if (!checked || checkError || !pending || pending.status === 'cleanup' || pending.status === 'cleaned'
      || (pending.processing_status && pending.processing_status !== 'uploaded')) return null
    return <button type="button" className="text-button replay-pending"
      aria-label={`Manage recording for frame ${frame.frame_number}`} onClick={() => onManage(pending)}>Manage</button>
  }

  return <>
    {!checked ? <p role="status">Checking recording…</p> : checkError ? <p role="alert">Recording availability couldn’t be checked. Close and reopen these details to try again.</p> : pending ? <button type="button" className="text-button replay-pending" onClick={() => setShowPending(true)}>{pending.status === 'cleanup' || pending.processing_status === 'failed' ? 'Removing recording…' : pending.status === 'reserved' ? 'Upload pending' : 'Processing replay'}</button>
      : <button type="button" className="button frame-recording-action" onClick={() => setShowPending(true)}><Icon name="upload" /><span>Add recording</span></button>}
    {showPending && <RecordingUploadDialog key={`${userId}:${frame.id}`} userId={userId} frame={frame} initialStatus={pending} onClose={close}
      onPublished={() => { void getFrameRecording(userId, frame.id).then(setPending).catch(() => {}); onPublished() }}
      onRemoved={() => { setShowPending(false); setPending(null); onPublished() }} />}
  </>
}

export function RecordingUploadDialog({ onClose, ...upload }: Omit<Parameters<typeof RecordingUpload>[0], 'onDone'> & { onClose: () => void }) {
  return <Modal title={`Create replay · Frame ${upload.frame.frame_number}`} onClose={onClose}>
    <RecordingUpload {...upload} onDone={onClose} />
  </Modal>
}

export function RecordingUpload({ userId, frame, onPublished, initialFile, initialTiming, initialStatus, onDone, onRemoved, onReplaceVideo }: { userId: string; frame: SavedFrame; onPublished: () => void; initialFile?: File; initialTiming?: RecordingTiming | null; initialStatus?: ReplayUploadStatus | null; onDone: () => void; onRemoved?: () => void; onReplaceVideo?: (file: File) => void }) {
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
  const [busy, setBusy] = useState<'reading' | 'preparing' | 'compressing' | 'checking-output' | 'uploading' | 'finishing' | ''>('')
  const [removing, setRemoving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [progress, setProgress] = useState<number>()
  const [compressionElapsed, setCompressionElapsed] = useState(0)
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
  } | null | undefined>(undefined)
  const [compressSelected, setCompressSelected] = useState(false)
  const [compressed, setCompressed] = useState<{
    file: File; geometry: RecordingGeometry; operation: string
  } | null>(null)
  const [recoveryUrl, setRecoveryUrl] = useState('')
  const compressing = busy === 'compressing' || busy === 'checking-output'
  const sourceProvider = draft ? draft.source_provider ?? 'supabase' : import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 'r2' : 'supabase'
  const savedUpload = !!(status || draft?.reservationRequested || draft?.uploadId)
  const oversizedResume = (status?.source_provider === 'r2' && status.expected_bytes > directReplayUploadLimit)
    || (draft?.source_provider === 'r2' && (draft.reservationRequested || draft.uploadId) && draft.bytes > directReplayUploadLimit)
  const requiresCompression = sourceProvider === 'r2' && !!file && file.size > directReplayUploadLimit
  const wantsCompression = requiresCompression || compressSelected
  const shouldCompress = wantsCompression && !compressed
  const canPrepareCompression = (requiresCompression || import.meta.env?.VITE_REPLAY_COMPRESSION_PILOT === 'true')
    && !draft?.reservationRequested && !draft?.uploadId && !status

  useEffect(() => {
    if (!compressed) { setRecoveryUrl(''); return }
    const url = URL.createObjectURL(compressed.file)
    setRecoveryUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [compressed])
  useEffect(() => {
    if (!canPrepareCompression || !file || !geometry || !duration) return
    if (!compressionSupport()) { setCompression(null); return }
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
  useLayoutEffect(() => {
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
  async function withUploadLock(task: () => Promise<void>) {
    ensureActive()
    if (!navigator.locks) throw Error('This browser cannot safely coordinate recording uploads. Use a current Safari or Chrome browser.')
    await navigator.locks.request(key, { ifAvailable: true }, async lock => {
      ensureActive()
      if (!lock) throw Error('This recording is open in another tab. Pause it there first.')
      await task()
    })
  }
  async function run(label: typeof busy, task: () => Promise<void>) {
    if (locked.current || initial.error || removing || !alive.current) return
    locked.current = true; setCheckedAt(Date.now()); setBusy(label); setError(''); setProgress(undefined); cancel.current = new AbortController()
    try {
      await task()
    } catch (reason) {
      if (alive.current) {
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
    await run('reading', () => withUploadLock(async () => {
      if (chosen.type && chosen.type !== 'video/mp4' || !/\.mp4$/i.test(chosen.name) || chosen.size < 1 || chosen.size > (import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 2147483648 : 262144000)) throw Error(`Choose an MP4 recording up to ${import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? '2 GiB' : '250 MiB'}. Export MOV recordings as MP4 first.`)
      let previous = draft
      if (previous?.uploadId) {
        const saved = await getRecordingStatus(userId, previous.uploadId); ensureActive()
        if (['cleanup', 'cleaned'].includes(saved.status)) { clearRecording(key, previous); previous = null; setDraft(null); setStatus(null) }
        else if (saved.source_provider === 'r2') assertDirectReplayUploadSize(saved.expected_bytes)
      }
      const fixed = previous?.reservationRequested || previous?.uploadId
      const provider = fixed ? previous?.source_provider : import.meta.env.VITE_RECORDING_UPLOAD_API_URL ? 'r2' : 'supabase'
      if (provider === 'r2' && fixed && previous) assertDirectReplayUploadSize(previous.bytes)
      if (provider === 'r2' && chosen.size > directReplayUploadLimit && !compressionSupport()) {
        throw Error('Videos over 200 MB must be compressed to 100 MB or less. This browser cannot compress MP4s. Choose a smaller compatible MP4.')
      }
      const g = await inspectRecording(chosen); ensureActive()
      if (previous && fixed) {
        setBusy('preparing')
        const hash = await hashRecording(chosen, cancel.current!.signal, n => { if (alive.current) setProgress(n) })
        ensureActive()
        if (previous.hash !== hash || previous.bytes !== chosen.size) throw Error(previous.compressedName ? `Select ${previous.compressedName} to resume this compressed upload.` : 'Select the exact original file for this saved recording. A different file cannot replace it.')
      }
      // New selections only need an upload identity once the final bytes are chosen.
      const next = fixed ? previous : null
      setDraft(next)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(chosen)
      setCompression(undefined); setDuration(0); setCompressSelected(false); setCompressed(null)
      setPreview(objectUrl.current); setFile(chosen); setGeometry(g); setCornersConfirmed(false)
      setRawCorners(next?.corners ?? [])
    }))
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
  async function compress(source: File) {
    if (!compression) throw Error('This video cannot be compressed. Choose a smaller compatible MP4.')
    const signal = cancel.current!.signal
    try {
      const result = await compressVideo(source, compression.duration, compression.plan, signal, (fraction, elapsedSeconds) => {
        if (!alive.current || signal.aborted) return
        setCompressionElapsed(elapsedSeconds)
        setProgress(fraction >= 1 ? undefined : fraction * 100)
        if (fraction >= 1) setBusy('checking-output')
      })
      ensureActive()
      if (!result.blob.size) throw Error('Compression produced an empty video.')
      if (result.blob.size > compressedReplayOutputLimit) throw Error('The compressed video exceeds the 100 MB compressed output limit.')
      if (result.blob.size >= source.size) throw Error('Compression did not make this recording smaller.')
      const finished = new File([result.blob], source.name.replace(/\.mp4$/i, '') + '_compressed.mp4', { type: 'video/mp4' })
      const selected = { file: finished, geometry: result.geometry, operation: crypto.randomUUID() }
      setCompressed(selected)
      return selected
    } catch (reason) {
      const message = signal.aborted ? 'Compression cancelled.' : reason instanceof Error ? reason.message : 'Compression failed.'
      throw Error(`${message} ${requiresCompression
        ? 'Try again or choose a smaller MP4.'
        : 'Try again or turn off compression to upload the original.'}`)
    }
  }
  async function start() {
    await run(shouldCompress ? 'compressing' : 'preparing', async () => {
      if (!file || !geometry || !cornersConfirmed || !valid) throw Error('Choose the recording and mark four corners first.')
      if (oversizedResume) throw Error('Cancel this oversized upload before starting a new recording.')
      if (!navigator.locks) throw Error('This browser cannot safely coordinate recording uploads. Use a current Safari or Chrome browser.')
      setCompressionElapsed(0)
      // Start playback in the tap handler so browsers can grant audio playback.
      const selected = wantsCompression ? compressed ?? await compress(file) : null
      ensureActive()
      setBusy('preparing'); setProgress(undefined)
      await withUploadLock(() => upload(file, geometry, selected))
    })
  }
  async function upload(file: File, geometry: RecordingGeometry, selected: typeof compressed) {
    const uploadFile = selected?.file ?? file
    const uploadGeometry = selected?.geometry ?? geometry
    if (sourceProvider === 'r2') assertDirectReplayUploadSize(uploadFile.size)
    // Canvas compression bakes in the original display orientation. Keep the
    // overlay on the original and scale its displayed points for the worker.
    const corners = selected ? scaleCompressionCorners(rawCorners.map(point => sourceToDisplay(point, geometry)), displaySize(geometry), uploadGeometry) : rawCorners
    if (!validCorners(corners, uploadGeometry.width, uploadGeometry.height)) {
      throw Error(requiresCompression
        ? 'The marked table is too small at the compressed resolution. Choose a smaller compatible MP4.'
        : 'The marked table is too small at the compressed resolution. Upload the original recording.')
    }
    let payload = draft
    if (!payload) {
      const hash = await hashRecording(uploadFile, cancel.current!.signal, n => { if (alive.current) setProgress(n) })
      ensureActive()
      payload = { version: 1, userId, frameId: frame.id, source_provider: sourceProvider,
        operation: selected?.operation ?? crypto.randomUUID(), bytes: uploadFile.size, hash,
        ...(selected ? { compressedName: uploadFile.name } : {}), geometry: uploadGeometry, corners }
    }
    setProgress(undefined)
    let saved = persist({ ...payload, geometry: uploadGeometry, corners, reservationRequested: true })
    let current = saved.uploadId ? await getRecordingStatus(userId, saved.uploadId) : await reserveRecording(userId, frame.id, saved.operation, uploadFile.size, saved.hash, saved.source_provider ?? 'supabase')
    ensureActive()
    if (current.frame_id !== frame.id || current.expected_bytes !== saved.bytes) throw Error('Saved recording does not match this frame.')
    if (current.source_provider === 'r2') assertDirectReplayUploadSize(current.expected_bytes)
    setStatus(current); saved = persist({ ...saved, uploadId: current.upload_id })
    if (['queued', 'processing', 'completed'].includes(current.processing_status ?? '')) {
      if (current.processing_status === 'completed') onPublished()
      return
    }
    if (current.processing_status === 'failed') throw Error('This recording failed. A new upload will be available after its video is safely removed.')
    if (current.status === 'reserved') {
      if (Date.parse(current.expires_at) <= Date.now()) throw Error('This recording has expired. It must finish safe cleanup before another recording can be saved.')
      if (!saved.transferred) {
        setBusy('uploading'); setProgress(0)
        transfer.current = transferRecording(uploadFile, userId, current, saved.hash, n => { if (alive.current) setProgress(n) })
        await transfer.current.start(); ensureActive()
        saved = persist({ ...saved, transferred: true })
      }
      setBusy('finishing'); setProgress(undefined)
      current = await finalizeRecording(userId, current.upload_id, current.source_provider); ensureActive(); setStatus(current)
    }
    if (current.processing_status !== 'uploaded') throw Error('This recording cannot be saved yet. Your previous save has been retained.')
    setBusy('finishing'); setProgress(undefined)
    const queued = await queueRecording(userId, current, saved.corners, saved.geometry.width, saved.geometry.height)
    ensureActive(); setStatus(queued); onPublished()
  }
  const stages = {
    reading: { title: 'Preparing video on this device', detail: 'Checking that this video can be used.' },
    preparing: { title: 'Preparing upload', detail: 'Keep this screen open.' },
    compressing: { title: 'Compressing video', detail: `Keep Pule visible and your screen awake. ${Math.floor(compressionElapsed)}s elapsed.` },
    'checking-output': { title: 'Checking compressed video', detail: `Keep Pule visible and your screen awake. ${Math.floor(compressionElapsed)}s elapsed.` },
    uploading: { title: 'Uploading recording', detail: 'Keep this screen open until the upload is confirmed.', icon: 'upload' as const },
    finishing: { title: 'Creating replay job', detail: 'Keep this screen open while Pule confirms your submission.' },
  }
  const calibrating = !!preview && !!geometry && !cornersConfirmed && !processing && !expired && status?.processing_status !== 'failed'
  const step = processing ? 'received' : busy ? 'busy' : calibrating ? 'table' : cornersConfirmed ? 'upload' : 'choose'
  const stepRef = useRef<HTMLElement>(null)
  const previousStep = useRef(step)
  useEffect(() => {
    if (previousStep.current !== step) {
      previousStep.current = step
      stepRef.current?.focus()
    }
  }, [step])
  return <section ref={stepRef} tabIndex={-1} className="recording-upload" data-step={step}
    aria-label={calibrating ? 'Calibrate table' : 'Frame recording upload'}>
    {processing && <>
      <RecordingProgress received icon="check"
        title={status?.processing_status === 'completed' ? 'Your replay is ready' : 'Recording uploaded'}
        detail={status?.processing_status === 'completed' ? undefined : 'Your replay will appear once processing finishes.'} />
      <button type="button" className="button" onClick={onDone}>Done</button>
    </>}
    {status?.processing_status === 'failed' && <p role="alert">We couldn’t create this replay. Removing its video before you upload again.</p>}
    {expired && <p role="alert">This recording is no longer active. A new upload will be available after safe removal.</p>}
    {!processing && !expired && status?.processing_status !== 'failed' && <div className="recording-upload-fields" hidden={!!busy}>
      {oversizedResume && <p role="alert">This saved upload exceeds the 200 MB direct upload limit. Cancel it before choosing another video.</p>}
      {!oversizedResume && (!file || !savedUpload) && <RecordingFilePicker file={file}
        disabled={!!busy || removing || !!initial.error}
        savedName={savedUpload ? draft?.compressedName : undefined}
        onChoose={chosen => file && onReplaceVideo ? onReplaceVideo(chosen) : void choose(chosen)} />}
      {preview && geometry && <div hidden={!calibrating}><RecordingCorners key={preview} src={preview} geometry={geometry} corners={rawCorners}
        confirmed={cornersConfirmed} disabled={!!busy || removing}
        onChange={next => { setRawCorners(next); setCornersConfirmed(false) }}
        onConfirm={() => setCornersConfirmed(true)} onDuration={setDuration} /></div>}
      {cornersConfirmed && <>
        <button type="button" className="text-button recording-edit-table" disabled={removing} onClick={() => setCornersConfirmed(false)}>Edit table corners</button>
        {requiresCompression && compression === null && <p role="alert">This browser can’t compress this video. Choose a compatible MP4 of 200 MB or less.</p>}
        {compression && canPrepareCompression && <>
          {!requiresCompression && <label className="replay-compression-option">
            <input type="checkbox" checked={compressSelected} disabled={removing}
              onChange={e => setCompressSelected(e.currentTarget.checked)} />
            Compress video before upload
          </label>}
          {wantsCompression && !compressed && <p className="annotation">Keep Pule visible and your screen awake during compression.{compression.losesAudio && ' This browser will produce a silent video.'}</p>}
        </>}
        {sourceProvider === 'r2' && !savedUpload && !compressed && compression !== null && <p className="annotation">Videos over 200 MB are compressed before upload.</p>}
        {wantsCompression && compressed && recoveryUrl && <div className="recording-recovery">
          <a className="text-button" href={recoveryUrl} download={compressed.file.name}>Save compressed copy</a>
          <p className="annotation">Use this copy if you need to resume the upload.</p>
        </div>}
        <button type="button" className="button" disabled={removing || !file || !valid || !!initial.error || !!oversizedResume || (shouldCompress && !compression)}
          onClick={() => void start()}>
          {savedUpload ? 'Resume upload' : 'Upload & create replay'}
        </button>
      </>}
    </div>}
    {busy && !processing && <RecordingProgress {...stages[busy]} percent={progress} />}
    {!processing && (compressing ? <button type="button" className="text-button" onClick={() => cancel.current?.abort()}>Cancel compression</button>
      : (file || draft || status) && status?.status !== 'cleanup' && status?.status !== 'cleaned' && status?.processing_status !== 'failed' && <button type="button" className="text-button" disabled={removing || !!initial.error} onClick={() => void remove()}>{removing ? 'Cancelling…' : draft?.reservationRequested || status || busy ? 'Cancel upload' : 'Clear video'}</button>)}
    {confirmCancel && !processing && <Modal title={`Cancel upload for Frame ${frame.frame_number}?`} onClose={() => setConfirmCancel(false)}><div className="recording-cancel-confirm"><div className="connected-actions"><button type="button" className="button button-secondary" onClick={() => setConfirmCancel(false)}>Keep upload</button><button type="button" className="button removal-confirm" onClick={() => void remove(true)}>Cancel upload</button></div></div></Modal>}
    {error && <p role="alert" className="connected-error">{error}</p>}
  </section>
}
