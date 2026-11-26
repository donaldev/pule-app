import { compressedReplayOutputLimit } from '../../data/replayUploadLimit.mjs'
import { inspectRecording } from './recordingGeometry'
import { videoSampleTypes } from './videoSampleTypes'
import type { WorkerReply, WorkerRequest } from './webcodecs.worker'

type Output = Extract<WorkerReply, { type: 'output' }>
type Source = WorkerRequest['source']

export function webCodecsAvailable() {
  return typeof Worker === 'function' && globalThis.isSecureContext
    && typeof OffscreenCanvas === 'function' && typeof VideoDecoder === 'function' && typeof VideoEncoder === 'function'
}

function workerRequest(request: WorkerRequest, signal: AbortSignal, onProgress?: (fraction: number, elapsed: number) => void) {
  return new Promise<boolean | Output>((resolve, reject) => {
    signal.throwIfAborted()
    if (document.hidden && request.action === 'encode') throw Error('Keep this tab visible while compressing.')
    const worker = new Worker(new URL('./webcodecs.worker.ts', import.meta.url), { type: 'module' })
    const started = performance.now()
    let settled = false
    const probeTimeout = request.action === 'probe' ? setTimeout(() => finish(false), 20_000) : undefined
    function finish(result: boolean | Output | Error) {
      if (settled) return
      settled = true
      clearTimeout(probeTimeout)
      signal.removeEventListener('abort', abort)
      document.removeEventListener('visibilitychange', visibility)
      worker.terminate()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const abort = () => finish(Error('Compression cancelled.'))
    const visibility = () => {
      if (document.hidden) finish(Error('Compression stopped when this tab went into the background.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (request.action === 'encode') document.addEventListener('visibilitychange', visibility)
    worker.onerror = () => finish(Error('Could not start the video encoder.'))
    worker.onmessageerror = () => finish(Error('Could not read the video encoder response.'))
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (settled) return
      if (data.type === 'capabilities' && request.action === 'probe') finish(data.supported)
      if (data.type === 'progress') onProgress?.(data.fraction, (performance.now() - started) / 1000)
      if (data.type === 'output') finish(data)
      if (data.type === 'error') finish(Error(data.message))
    }
    try { worker.postMessage(request) }
    catch { finish(Error('Could not open the video in the encoder.')) }
  })
}

export async function probeWebCodecs(file: File, source: Source, signal: AbortSignal) {
  if (!webCodecsAvailable()) return false
  try { return await workerRequest({ action: 'probe', file, source }, signal) === true }
  catch { return false }
}

export async function compressWithWebCodecs(file: File, source: Source, hasAudio: boolean, signal: AbortSignal,
  onProgress: (fraction: number, elapsed: number) => void) {
  const result = await workerRequest({ action: 'encode', file, source }, signal, onProgress)
  signal.throwIfAborted()
  if (typeof result === 'boolean' || result.blob.type !== 'video/mp4'
      || !result.blob.size || result.blob.size > compressedReplayOutputLimit) {
    throw Error('The compressed video is empty or exceeds the 200 MB limit.')
  }
  const [geometry, sampleTypes] = await Promise.all([inspectRecording(result.blob), videoSampleTypes(result.blob)])
  signal.throwIfAborted()
  if (geometry.rotation !== 0 || geometry.width !== result.width || geometry.height !== result.height
      || !Number.isFinite(result.duration) || Math.abs(result.duration - source.duration) > 0.25
      || sampleTypes.video.length !== 1 || !['avc1', 'avc3'].includes(sampleTypes.video[0])
      || (hasAudio ? sampleTypes.audio.length !== 1 || sampleTypes.audio[0] !== 'mp4a' : sampleTypes.audio.length > 0)) {
    throw Error('The compressed video did not preserve the expected format, orientation, or duration.')
  }
  return { blob: result.blob, geometry }
}
