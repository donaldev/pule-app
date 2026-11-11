import { sha256 } from '@noble/hashes/sha2.js'
import type { RecordingGeometry, Point } from './recordingGeometry'
export interface RecordingDraft {
 source_provider?: 'supabase' | 'r2'; version: 1; userId: string; frameId: string; operation: string; hash: string; bytes: number
 reservationRequested?: boolean; uploadId?: string; transferred?: boolean; geometry: RecordingGeometry; corners: Point[]
}
export function recordingKey(project: string, userId: string, frameId: string) { return `pule:recording:v1:${project}:${userId}:${frameId}` }
export function readRecording(key: string, userId: string, frameId: string): RecordingDraft | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const draft = JSON.parse(raw) as RecordingDraft
  if (draft.source_provider !== undefined && !['supabase', 'r2'].includes(draft.source_provider) || draft.version !== 1 || draft.userId !== userId || draft.frameId !== frameId || !/^[0-9a-f-]{36}$/.test(draft.operation)
    || !/^[0-9a-f]{64}$/.test(draft.hash) || !Number.isSafeInteger(draft.bytes) || draft.bytes < 1 || draft.bytes > 2147483648
    || (draft.uploadId !== undefined && !/^[0-9a-f-]{36}$/.test(draft.uploadId)) || (draft.transferred && !draft.uploadId)
    || !draft.geometry || !Number.isInteger(draft.geometry.width) || !Number.isInteger(draft.geometry.height) || draft.geometry.width < 16 || draft.geometry.height < 16 || draft.geometry.width > 8192 || draft.geometry.height > 8192 || ![0, 90, 180, 270].includes(draft.geometry.rotation) || !Array.isArray(draft.corners) || draft.corners.length > 4 || draft.corners.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n)))) throw Error('Saved recording recovery is unreadable. Keep it unchanged and use the original device.')
  return draft
}
export function saveRecording(key: string, draft: RecordingDraft) {
  const previous = readRecording(key, draft.userId, draft.frameId)
  if (previous && previous.operation !== draft.operation && (previous.reservationRequested || previous.uploadId)) throw Error('Another tab has a saved recording for this frame. Reopen it there.')
  localStorage.setItem(key, JSON.stringify(draft)) // Must succeed before a reservation/write.
}
export async function hashRecording(file: Blob, signal?: AbortSignal, progress?: (percent: number) => void) {
  const hash = sha256.create()
  for (let start = 0; start < file.size; start += 1024 * 1024) {
    signal?.throwIfAborted()
    hash.update(new Uint8Array(await file.slice(start, start + 1024 * 1024).arrayBuffer()))
    progress?.(Math.min(100, Math.floor((start + 1024 * 1024) / file.size * 100)))
  }
  return Array.from(hash.digest(), n => n.toString(16).padStart(2, '0')).join('')
}

export function clearRecording(key: string, draft: RecordingDraft) {
  const current = readRecording(key, draft.userId, draft.frameId)
  if (current && current.operation !== draft.operation) throw Error('The saved recording changed in another tab. Nothing was cleared.')
  localStorage.removeItem(key)
}
