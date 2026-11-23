import { replayUploadLimit } from '../../data/replayUploadLimit.mjs'
import { inspectRecording, type Point } from './recordingGeometry'
import { videoSampleTypes } from './videoSampleTypes'

const MAX_HELD_BYTES = 110_000_000
export const audioBitrate = 128_000
const MP4_WITH_AUDIO = 'video/mp4;codecs=avc1,mp4a.40.2'
const MP4_VIDEO_ONLY = 'video/mp4;codecs=avc1'

export function compressionSupport() {
  if (typeof MediaRecorder !== 'function' || typeof MediaRecorder.isTypeSupported !== 'function'
      || typeof HTMLCanvasElement.prototype.captureStream !== 'function'
      || typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function') return null
  const audio = typeof AudioContext !== 'undefined' && MediaRecorder.isTypeSupported(MP4_WITH_AUDIO)
  const video = MediaRecorder.isTypeSupported(MP4_VIDEO_ONLY)
  return audio || video ? { audio, video } : null
}

export function planCompression(source: { width: number; height: number; duration: number }, hasAudio: boolean) {
  const support = compressionSupport()
  const audio = hasAudio && !!support?.audio
  if (!audio && !support?.video) throw Error('This browser cannot compress this recording to H.264 MP4.')
  if (!Number.isFinite(source.duration) || source.duration <= 0 || source.width < 16 || source.height < 16
      || source.width * source.height > 3840 * 2160) throw Error('Compression requires a playable recording no larger than 4K.')
  return measurePlan(source, audio, audio ? MP4_WITH_AUDIO : MP4_VIDEO_ONLY)
}

export type CompressionPlan = { width: number; height: number; videoRate: number; audio: boolean; mime: string }

function measurePlan(source: { width: number; height: number; duration: number }, audio: boolean, mime: string): CompressionPlan {
  // Reserve 2% for container overhead and 10% for bitrate variation.
  const videoRate = Math.min(8_000_000, Math.floor(replayUploadLimit * 0.88 * 8 / source.duration) - (audio ? audioBitrate : 0))
  if (videoRate < 350_000) throw Error('The recording is too long for a useful result within the 100 MB budget.')
  const shortEdge = videoRate >= 2_000_000 ? 1080 : 720
  const scale = Math.min(1, shortEdge / Math.min(source.width, source.height), shortEdge * 16 / 9 / Math.max(source.width, source.height))
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
  return { width: even(source.width * scale), height: even(source.height * scale), videoRate, audio, mime }
}

function record(video: HTMLVideoElement, settings: CompressionPlan, signal: AbortSignal) {
  const canvas = document.createElement('canvas')
  canvas.width = settings.width
  canvas.height = settings.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw Error('Canvas video capture is unavailable.')
  const stream = canvas.captureStream(30)
  let audio: AudioContext | undefined
  let destination: MediaStreamAudioDestinationNode | undefined
  let callback = 0
  let recorder: MediaRecorder | undefined
  const events = new AbortController()
  const options = { signal: events.signal }
  const chunks: Blob[] = []
  let bytes = 0

  function draw() {
    context!.drawImage(video, 0, 0, canvas.width, canvas.height)
    callback = video.requestVideoFrameCallback(draw)
  }

  function release() {
    events.abort()
    video.cancelVideoFrameCallback(callback)
    video.pause()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    for (const track of [...stream.getTracks(), ...(destination?.stream.getTracks() ?? [])]) track.stop()
    if (audio) void audio.close().catch(() => {})
    canvas.width = canvas.height = 0
  }

  return new Promise<Blob>((resolve, reject) => {
    function finish(error?: unknown) {
      if (events.signal.aborted) return
      const result = error ? undefined : new Blob(chunks, { type: recorder?.mimeType })
      release()
      chunks.length = 0
      if (result?.size) resolve(result)
      else reject(error ?? Error('The browser did not produce a recording.'))
    }

    try {
      signal.throwIfAborted()
      if (settings.audio) {
        audio = new AudioContext()
        destination = audio.createMediaStreamDestination()
        audio.createMediaElementSource(video).connect(destination)
        for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)
        void audio.resume().catch(finish)
      }
      recorder = new MediaRecorder(stream, {
        mimeType: settings.mime,
        videoBitsPerSecond: settings.videoRate,
        ...(settings.audio ? { audioBitsPerSecond: audioBitrate } : {}),
      })
      signal.addEventListener('abort', () => finish(signal.reason), options)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) finish(Error('Compression stopped when this tab went into the background.'))
      }, options)
      video.addEventListener('error', () => finish(Error('The browser could not decode the full recording.')), options)
      video.addEventListener('ended', () => {
        if (recorder?.state === 'recording') recorder.stop()
      }, options)
      recorder.addEventListener('error', () => finish(Error('The browser could not encode this H.264 MP4.')), options)
      recorder.addEventListener('stop', () => finish(), options)
      recorder.addEventListener('dataavailable', event => {
        if (!event.data.size) return
        bytes += event.data.size
        if (bytes > MAX_HELD_BYTES) {
          finish(Error(`Partial output reached ${(bytes / 1e6).toFixed(2)} MB, exceeding the 100 MB target. Compression stopped to limit memory use.`))
          return
        }
        chunks.push(event.data)
      }, options)

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) context.drawImage(video, 0, 0, canvas.width, canvas.height)
      callback = video.requestVideoFrameCallback(draw)
      recorder.start(1000)
      void video.play().catch(finish)
    } catch (error) {
      finish(error)
    }
  })
}

export async function compressVideo(file: File, duration: number, target: CompressionPlan, signal: AbortSignal,
  onProgress: (fraction: number, elapsedSeconds: number) => void) {
  signal.throwIfAborted()
  if (document.hidden) throw Error('Keep this tab visible while compressing.')
  const player = document.createElement('video')
  player.playsInline = true
  player.preload = 'auto'
  player.muted = !target.audio
  const url = URL.createObjectURL(file)
  const started = performance.now()
  const update = window.setInterval(() => {
    onProgress(Math.min(1, player.currentTime / duration), (performance.now() - started) / 1000)
  }, 500)
  try {
    // Playback and AudioContext start directly from the user's compression gesture.
    player.src = url
    const blob = await record(player, target, signal)
    const elapsed = (performance.now() - started) / 1000
    window.clearInterval(update)
    onProgress(1, elapsed)
    const [geometry, sampleTypes] = await Promise.all([inspectRecording(blob), videoSampleTypes(blob)])
    signal.throwIfAborted()
    if (!/^video\/mp4(?:;|$)/i.test(blob.type) || sampleTypes.video.length !== 1
        || !['avc1', 'avc3'].includes(sampleTypes.video[0])
        || (target.audio ? sampleTypes.audio.length !== 1 || sampleTypes.audio[0] !== 'mp4a' : sampleTypes.audio.length > 0)) {
      throw Error('The output did not have the expected MP4 video or audio format.')
    }
    if (geometry.rotation !== 0 || geometry.width !== target.width || geometry.height !== target.height) {
      throw Error('The browser changed the compressed video orientation or dimensions.')
    }
    return { blob, geometry, sampleTypes, elapsed }
  } finally {
    window.clearInterval(update)
    player.removeAttribute('src')
    player.load()
    URL.revokeObjectURL(url)
  }
}


// The compressed canvas is upright, with the entire displayed frame scaled to fit.
export function scaleCompressionCorners(points: Point[], from: { width: number; height: number }, to: { width: number; height: number }): Point[] {
  return points.map(([x, y]) => [x * to.width / from.width, y * to.height / from.height])
}
