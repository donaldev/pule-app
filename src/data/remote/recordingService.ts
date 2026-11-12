import { r2Command, r2RecordingEnabled, transferR2Recording } from './r2Recording'
import { Upload } from 'tus-js-client'
import { actorAuthorization, getSupabase } from './supabase'
import type { Database, ReplayUploadStatus } from './database.types'
import type { Point } from '../../features/replays/recordingGeometry'

type Commands = 'reserve_frame_replay_upload' | 'finalize_frame_replay_upload' | 'get_my_frame_replay_upload' | 'queue_frame_replay_processing'
export function validateUploadStatus(value: unknown): ReplayUploadStatus {
  const r = value as ReplayUploadStatus | null
  if (!r || !(r.bucket === 'frame-recordings' && (!r.source_provider || r.source_provider === 'supabase') || r.bucket === 'pule-frame-recordings' && r.source_provider === 'r2') || !['reserved', 'committed', 'cleanup', 'cleaned'].includes(r.status)
    || ![r.upload_id, r.frame_id, r.session_id].every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
    || r.storage_path !== `${r.session_id}/${r.frame_id}/${r.upload_id}.mp4` || !Number.isFinite(Date.parse(r.expires_at))
    || !Number.isSafeInteger(r.expected_bytes) || r.expected_bytes < 1 || r.expected_bytes > (r.source_provider === 'r2' ? 2147483648 : 262144000)
    || (r.processing_status != null && !['uploaded', 'queued', 'processing', 'completed', 'failed'].includes(r.processing_status))) throw Error('Recording uploads are unavailable. Check that the processing backend is installed.')
  return r
}
async function command<Name extends Commands>(userId: string, name: Name, args: Database['app']['Functions'][Name]['Args']) {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc(name, args).setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error) {
    if (error.message.includes('quota')) throw Error('The recording limit has been reached. Try again after old uploads have been cleaned up.')
    if (error.message.includes('reserved') || error.message.includes('replay_exists')) throw Error('This frame already has a recording or replay. Reopen its saved upload on the original device.')
    if (error.message.includes('object_not_verified')) throw Error('The recording is not fully stored yet. Resume upload, then check again.')
    if (error.code === '42501') throw Error('This account cannot attach a recording to this frame.')
    throw Error('The recording request could not be confirmed. Check its status before trying again.')
  }
  await actorAuthorization(userId)
  return validateUploadStatus(data)
}
export const reserveRecording = (userId: string, frameId: string, operation: string, bytes: number, hash?: string, provider?: string) => (provider === 'r2' || !provider && r2RecordingEnabled()) ? r2Command(userId, { action: 'reserve', operation, frame: frameId, bytes, hash }).then(validateUploadStatus) : command(userId, 'reserve_frame_replay_upload', { p_operation: operation, p_frame: frameId, p_bytes: bytes, p_content_type: 'video/mp4' })
export const finalizeRecording = (userId: string, id: string, provider?: string) => provider === 'r2' ? r2Command(userId, { action: 'complete', upload: id }).then(validateUploadStatus) : command(userId, 'finalize_frame_replay_upload', { p_upload: id })
export const getRecordingStatus = (userId: string, id: string) => command(userId, 'get_my_frame_replay_upload', { p_upload: id })
export const queueRecording = (userId: string, id: string, corners: Point[], width: number, height: number) => command(userId, 'queue_frame_replay_processing', { p_upload: id, p_corners: corners, p_width: width, p_height: height })
export function recordingEndpoint(project: string) {
  const url = new URL(project)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw Error('Invalid upload endpoint.')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Invalid upload endpoint.')
  if (/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co')
  return `${url.origin}/storage/v1/upload/resumable`
}
/** No automatic retries/background sync. Explicit resume reuses the same TUS resource. */
export function transferRecording(file: File, userId: string, reservation: ReplayUploadStatus, hash: string, progress: (percent: number) => void) {
  if (reservation.source_provider === 'r2') return transferR2Recording(file, userId, reservation, progress)
  const endpoint = recordingEndpoint(import.meta.env.VITE_SUPABASE_URL)
  let stopped = false
  let unsubscribe = () => {}
  let rejectPending: ((reason: Error) => void) | undefined
  const upload = new Upload(file, {
    endpoint, chunkSize: 6 * 1024 * 1024, retryDelays: null, removeFingerprintOnSuccess: true,
    uploadDataDuringCreation: true, storeFingerprintForResuming: true,
    fingerprint: async () => `pule:${endpoint}:${userId}:${reservation.upload_id}:${hash}`,
    metadata: { bucketName: 'frame-recordings', objectName: reservation.storage_path, contentType: 'video/mp4', cacheControl: '0' },
    onBeforeRequest: async request => {
      const url = new URL(request.getURL())
      if (url.origin !== new URL(endpoint).origin || !(url.pathname === '/storage/v1/upload/resumable' || url.pathname.startsWith('/storage/v1/upload/resumable/'))) throw Error('Invalid saved transfer endpoint.')
      if (stopped) throw Error('Upload paused.')
      const authorization = await actorAuthorization(userId)
      if (stopped) throw Error('Upload paused.')
      request.setHeader('Authorization', authorization)
      request.setHeader('x-upsert', 'false')
    },
  })
  function pause() { stopped = true; unsubscribe(); void upload.abort().catch(() => {}); rejectPending?.(Error('Upload paused.')) }
  return {
    start: () => new Promise<void>((resolve, reject) => {
      rejectPending = reject
      const { data } = getSupabase().auth.onAuthStateChange((_event, session) => { if (!session || session.user.id !== userId) pause() })
      unsubscribe = () => data.subscription.unsubscribe()
      upload.options.onError = () => { unsubscribe(); reject(Error('Upload interrupted. Keep this file selected and tap Resume upload.')) }
      upload.options.onProgress = (sent, total) => { if (!stopped) progress(Math.floor(sent / total * 100)) }
      upload.options.onSuccess = () => { unsubscribe(); if (!stopped) resolve() }
      void upload.findPreviousUploads().then(previous => {
        if (stopped) return
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0])
        upload.start()
      }).catch(() => { unsubscribe(); reject(Error('Could not recover this transfer. Please try again.')) })
    }),
    pause,
  }
}

/** Exact attempt/path only; unknown responses retain the local journal for safe retry. */
export async function removeFrameReplay(userId: string, frameId: string, target: { upload?: string; operation?: string; path?: string }) {
  const authorization = await actorAuthorization(userId)
  const { error } = await getSupabase().rpc('remove_frame_replay', { p_frame: frameId, p_upload: target.upload, p_operation: target.operation, p_path: target.path })
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error) throw Error('Replay removal could not be confirmed. Nothing was cleared locally; try again with the same account.')
  await actorAuthorization(userId)
}
export async function getFrameRecording(userId: string, frameId: string): Promise<ReplayUploadStatus | null> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc('get_my_frame_recording', { p_frame: frameId })
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error) throw Error('Could not check this frame’s recording.')
  await actorAuthorization(userId)
  return data === null ? null : validateUploadStatus(data)
}
