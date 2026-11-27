import { assertDirectReplayUploadSize } from '../replayUploadLimit.mjs'
import { actorAuthorization, getSupabase } from './supabase'
import type { ReplayUploadStatus } from './database.types'

export const recordingQuotaMessage = 'Recording limit reached. Keep this file or save the compressed copy, then resume when a recording slot is available.'

export const r2RecordingEnabled = () => !!import.meta.env.VITE_RECORDING_UPLOAD_API_URL
export async function r2Command(userId: string, body: Record<string, unknown>): Promise<unknown> {
  const url = new URL(import.meta.env.VITE_RECORDING_UPLOAD_API_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/recordings') throw Error('Invalid recording broker configuration.')
  const authorization = await actorAuthorization(userId)
  const response = await fetch(url, { method: 'POST', redirect: 'error', credentials: 'omit', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  if (response.status === 413) throw Error('Direct replay uploads are limited to 200 MB. Compress this video or choose a smaller MP4.')
  if (response.status === 429) {
    const result = await response.json().catch(() => null)
    if (result?.code === 'recording_quota_reached') throw Error(recordingQuotaMessage)
  }
  if (!response.ok) throw Error('Recording request could not be confirmed. Keep the same file and check status before retrying.')
  const result: unknown = await response.json()
  await actorAuthorization(userId)
  return result
}
export function transferR2Recording(file: File, userId: string, reservation: ReplayUploadStatus, progress: (n: number) => void) {
  const controller = new AbortController(); let unsubscribe = () => {}
  const pause = () => { controller.abort(); unsubscribe() }
  return {
    pause,
    start: async () => {
      assertDirectReplayUploadSize(file.size)
      assertDirectReplayUploadSize(reservation.expected_bytes)
      if (file.size !== reservation.expected_bytes) throw Error('The selected recording does not match the saved upload.')
      const { data } = getSupabase().auth.onAuthStateChange((_event, session) => { if (!session || session.user.id !== userId) pause() })
      unsubscribe = () => data.subscription.unsubscribe()
      try {
        const state = await r2Command(userId, { action: 'state', upload: reservation.upload_id }) as { completed: boolean; parts: number[]; partBytes: number }
        controller.signal.throwIfAborted()
        if (state.completed) { progress(100); return }
        if (state.partBytes !== 16777216 || !Array.isArray(state.parts)) throw Error('Invalid multipart state.')
        const count = Math.ceil(file.size / state.partBytes)
        if (state.parts.some(p => !Number.isInteger(p) || p < 1 || p > count) || new Set(state.parts).size !== state.parts.length) throw Error('Invalid saved multipart state.')
        const completed = new Set(state.parts)
        let done = state.parts.reduce((sum, n) => sum + Math.min(state.partBytes, file.size - (n - 1) * state.partBytes), 0)
        progress(Math.floor(done / file.size * 100))
        for (let n = 1; n <= count; n++) {
          if (completed.has(n)) continue
          controller.signal.throwIfAborted()
          const permission = await r2Command(userId, { action: 'part', upload: reservation.upload_id, part: n }) as { url: string; bytes: number }
          controller.signal.throwIfAborted()
          const url = new URL(permission.url), bytes = Math.min(state.partBytes, file.size - (n - 1) * state.partBytes)
          if (url.protocol !== 'https:' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) || url.pathname !== `/pule-frame-recordings/${reservation.storage_path}` || url.searchParams.get('partNumber') !== String(n) || url.searchParams.get('X-Amz-Expires') !== '120' || !url.searchParams.get('X-Amz-SignedHeaders')?.split(';').includes('content-length') || permission.bytes !== bytes) throw Error('Invalid multipart permission.')
          // Blob bodies give Chrome/Safari the exact signed Content-Length; no Supabase token is sent to R2.
          const response = await fetch(url, { method: 'PUT', body: file.slice((n - 1) * state.partBytes, (n - 1) * state.partBytes + bytes), signal: controller.signal, credentials: 'omit', redirect: 'error' })
          if (!response.ok) throw Error('Part not confirmed.')
          done += bytes; progress(Math.floor(done / file.size * 100))
        }
      } catch { throw Error('Upload interrupted. Keep this file selected and tap Resume upload; stored parts will be reused.') }
      finally { unsubscribe() }
    },
  }
}
