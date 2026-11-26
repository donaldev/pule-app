import { compressedReplayOutputLimit } from '../../data/replayUploadLimit.mjs'
import { displaySize, inspectRecording } from '../../features/replays/recordingGeometry'
import { videoSampleTypes } from '../../features/replays/videoSampleTypes'
import { compressVideo, compressionSupport, planCompression } from '../../features/replays/videoCompression'
import type { WorkerReply, WorkerRequest } from './webcodecs.worker'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T
const picker = element<HTMLInputElement>('file')
const choose = element<HTMLButtonElement>('choose')
const cancel = element<HTMLButtonElement>('cancel')
const progress = element<HTMLProgressElement>('progress')
const status = element('status')
const elapsed = element<HTMLOutputElement>('elapsed')
const capabilities = element('capabilities')
const buttons = { baseline: element<HTMLButtonElement>('baseline'), experimental: element<HTMLButtonElement>('experimental') }
type Method = keyof typeof buttons
type Source = WorkerRequest['source'] & { file: File; plan: ReturnType<typeof planCompression> | null; hasAudio: boolean }
let source: Source | undefined
let supported = false
let experimentalRate: number | undefined
let operation: AbortController | undefined
const urls: Partial<Record<Method, string>> = {}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`
const seconds = (value: number) => `${value.toFixed(2)} s`
function details(target: HTMLElement, rows: [string, string][]) {
  target.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    return [term, description]
  }))
}

function controls() {
  const busy = !!operation
  choose.disabled = picker.disabled = busy
  buttons.baseline.disabled = busy || !source?.plan
  buttons.experimental.disabled = busy || !source || !supported
  cancel.disabled = !busy
}

function metadata(blob: Blob, signal: AbortSignal) {
  return new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
    signal.throwIfAborted()
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)
    function finish(error?: unknown) {
      signal.removeEventListener('abort', aborted)
      video.onloadedmetadata = video.onerror = null
      const dimensions = { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve(dimensions)
    }
    const aborted = () => finish(signal.reason)
    video.preload = 'metadata'
    video.onloadedmetadata = () => finish()
    video.onerror = () => finish(Error('Chrome could not open this MP4.'))
    signal.addEventListener('abort', aborted, { once: true })
    video.src = url
  })
}

type RateDiagnostic = Extract<WorkerReply, { type: 'capabilities' | 'config' | 'tracks' }>

function workerRequest(request: WorkerRequest, signal: AbortSignal,
  onProgress?: (fraction: number, bytes: number, processed: number) => void,
  onRateDiagnostic?: (report: RateDiagnostic) => void) {
  return new Promise<Blob | undefined>((resolve, reject) => {
    signal.throwIfAborted()
    if (!window.isSecureContext || typeof Worker !== 'function') throw Error('WebCodecs benchmark requires a secure context and a dedicated worker.')
    const worker = new Worker(new URL('./webcodecs.worker.ts', import.meta.url), { type: 'module' })
    function finish(error?: unknown, blob?: Blob) {
      signal.removeEventListener('abort', aborted)
      worker.terminate()
      if (error) reject(error)
      else resolve(blob)
    }
    const aborted = () => finish(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    worker.onerror = () => finish(Error('Could not run the WebCodecs worker.'))
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      switch (data.type) {
        case 'capabilities':
          supported = data.supported
          experimentalRate = data.videoRate
          capabilities.textContent = `Decoder ${data.decoder} · Encoder ${data.encoder} · Audio ${data.audio}. Hardware use is unverified.`
          onRateDiagnostic?.(data)
          if (request.action === 'probe') finish()
          break
        case 'progress': onProgress?.(data.fraction, data.bytes, data.processed); break
        case 'config':
        case 'tracks': onRateDiagnostic?.(data); break
        case 'output': finish(undefined, data.blob); break
        case 'error': finish(Error(data.message)); break
      }
    }
    worker.postMessage(request)
  })
}

function clear(method: Method) {
  const playback = element(`${method}-playback`)
  playback.hidden = true
  const video = playback.querySelector('video')!
  video.removeAttribute('src')
  video.load()
  playback.querySelector('a')!.removeAttribute('href')
  if (urls[method]) URL.revokeObjectURL(urls[method])
  delete urls[method]
  details(element(`${method}-result`), [])
  element(`${method}-message`).textContent = 'Awaiting a run.'
}

choose.onclick = () => picker.click()
picker.onchange = async () => {
  const file = picker.files?.[0]
  picker.value = ''
  if (!file || operation) return
  const controller = new AbortController()
  operation = controller
  source = undefined
  supported = false
  experimentalRate = undefined
  controls()
  clear('baseline'); clear('experimental')
  details(element('source'), [])
  elapsed.value = ''
  status.textContent = ''
  capabilities.textContent = 'Reading local video metadata…'
  try {
    if (!/\.mp4$/i.test(file.name) || file.size < 1 || file.size > 2 * 1024 ** 3) throw Error('Choose an MP4 no larger than 2 GiB.')
    const [media, geometry, codecs] = await Promise.all([
      metadata(file, controller.signal), inspectRecording(file), videoSampleTypes(file),
    ])
    controller.signal.throwIfAborted()
    details(element('source'), [
      ['File', file.name], ['Size', mb(file.size)], ['Display resolution', `${media.width} × ${media.height}`],
      ['Duration', seconds(media.duration)], ['Rotation', `${geometry.rotation}°`],
      ['Video / audio', `${codecs.video.join(', ')} / ${codecs.audio.join(', ') || 'none'}`],
    ])
    const expected = displaySize(geometry)
    if (media.width !== expected.width || media.height !== expected.height) throw Error('The decoder and MP4 orientation disagree.')
    if (!Number.isFinite(media.duration) || media.duration <= 0 || media.duration > 7200
        || media.width < 16 || media.height < 16 || media.width * media.height > 3840 * 2160) {
      throw Error('Use a playable MP4 up to two hours and no more than 4K pixels.')
    }
    const hasAudio = codecs.audio.length > 0
    const baselineSupport = compressionSupport()
    const baseline = !!(baselineSupport?.video || (hasAudio && baselineSupport?.audio))
    let plan: Source['plan'] = null
    if (baseline) {
      try { plan = planCompression(media, hasAudio) }
      catch (error) { element('baseline-message').textContent = error instanceof Error ? error.message : 'No MediaRecorder plan available.' }
    }
    source = { file, ...media, plan, hasAudio }
    if (!baseline) element('baseline-message').textContent = 'MediaRecorder H.264 is unavailable on this device.'
    else if (hasAudio && plan && !plan.audio) element('baseline-message').textContent = 'MediaRecorder AAC unavailable. This run will be silent.'
    capabilities.textContent = 'Checking WebCodecs configurations on this device…'
    await workerRequest({ action: 'probe', file, source: media }, controller.signal)
  } catch (error) {
    capabilities.textContent = controller.signal.aborted ? 'Selection cancelled.' : error instanceof Error ? error.message : 'Unable to inspect this file.'
  } finally {
    operation = undefined
    controls()
  }
}

function jsHeap() {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
}

async function run(method: Method) {
  if (!source || operation || (method === 'experimental' ? !supported : !source.plan)) return
  const { file, duration, width, height, plan, hasAudio } = source
  const mediaSource = { width, height, duration }
  const controller = new AbortController()
  const { signal } = controller
  operation = controller
  controls()
  clear(method)
  status.textContent = method === 'baseline' ? 'Encoding with MediaRecorder…' : 'Encoding with WebCodecs…'
  progress.removeAttribute('value')
  progress.hidden = false
  const started = performance.now()
  let bytes = 0
  let processed = 0
  let finalBytes: number | undefined
  let finishedIn: number | undefined
  let encoderConfig: Extract<WorkerReply, { type: 'config' }>['config'] | undefined
  let sourceAudioBytes: number | undefined
  let encodedVideoBytes: number | undefined
  let copiedAudioBytes: number | undefined
  let resultRows: [string, string][] = []
  const diagnostics = (time: number): [string, string][] => {
    const bitrate = method === 'baseline' ? plan?.videoRate : experimentalRate
    return [
      ['Requested video bitrate', bitrate === undefined ? 'Unavailable' : `${bitrate.toLocaleString()} bps`],
      ['Actual output bytes', bytes.toLocaleString()],
      ...(method === 'experimental' ? [
        ['Encoder configuration', encoderConfig
          ? `${encoderConfig.codec} · ${encoderConfig.width} × ${encoderConfig.height} · ${encoderConfig.framerate ?? '?'} fps · ${encoderConfig.bitrateMode ?? 'default'} · ${encoderConfig.bitrate?.toLocaleString() ?? '?'} bps · ${encoderConfig.hardwareAcceleration ?? 'default'} · ${encoderConfig.latencyMode ?? 'default'} latency`
          : 'Awaiting configuration'],
        ['Encoded video bytes', encodedVideoBytes?.toLocaleString() ?? '—'],
        ['Observed video bitrate', encodedVideoBytes !== undefined && processed > 0
          ? `${Math.round(encodedVideoBytes * 8 / processed).toLocaleString()} bps` : '—'],
        ['Copied audio bytes', copiedAudioBytes?.toLocaleString() ?? 'Available after finalization'],
        ['Source AAC bytes reserved', sourceAudioBytes?.toLocaleString() ?? '—'],
      ] as [string, string][] : []),
      ['Source processed', `${seconds(processed)} / ${seconds(duration)}`],
      ['Elapsed', seconds(time)],
      ['Speed', time > 0 && processed > 0 ? `${(processed / time).toFixed(2)}× real time` : '—'],
      ['Final output size', finalBytes === undefined ? 'No completed MP4' : mb(finalBytes)],
    ]
  }
  const initialHeap = jsHeap()
  let sampledHeap = initialHeap
  const timer = window.setInterval(() => {
    const time = (performance.now() - started) / 1000
    elapsed.value = `${seconds(time)} elapsed`
    details(element(`${method}-result`), diagnostics(finishedIn ?? time))
    if (sampledHeap !== undefined) sampledHeap = Math.max(sampledHeap, jsHeap() ?? 0)
  }, 250)
  const advance = (fraction: number) => {
    if (fraction < 1) progress.value = fraction
    else {
      progress.removeAttribute('value')
      status.textContent = 'Finalizing MP4…'
    }
  }
  try {
    const blob = method === 'baseline'
      ? (await compressVideo(file, duration, plan!, signal, (fraction) => {
        processed = Math.max(processed, fraction * duration)
        advance(fraction)
      }, (outputBytes, sourceSeconds) => {
        bytes = outputBytes
        processed = Math.max(processed, Math.min(duration, sourceSeconds))
      })).blob
      : await workerRequest({ action: 'encode', file, source: mediaSource }, signal, (fraction, outputBytes, sourceSeconds) => {
        bytes = outputBytes
        processed = Math.max(processed, Math.min(duration, sourceSeconds))
        advance(fraction)
      }, report => {
        if (report.type === 'config') encoderConfig = report.config
        else if (report.type === 'capabilities') sourceAudioBytes = report.audioBudget
        else {
          encodedVideoBytes = report.videoBytes
          copiedAudioBytes = report.audioBytes
        }
      })
    signal.throwIfAborted()
    finishedIn = (performance.now() - started) / 1000
    if (!blob?.size || blob.size > compressedReplayOutputLimit) throw Error('Output must be between 1 byte and 200 MB.')
    finalBytes = bytes = blob.size
    processed = duration
    const [media, geometry, codecs] = await Promise.all([metadata(blob, signal), inspectRecording(blob), videoSampleTypes(blob)])
    signal.throwIfAborted()
    if (geometry.rotation !== 0 || (method === 'baseline' && (media.width !== plan?.width || media.height !== plan.height))
        || !Number.isFinite(media.duration) || !codecs.video.some(codec => codec === 'avc1' || codec === 'avc3')) {
      throw Error('Output did not match the expected upright H.264 format.')
    }
    if (method === 'experimental' && (Math.abs(media.duration - duration) > 0.25
        || (hasAudio && !codecs.audio.includes('mp4a')))) {
      throw Error('Experimental output did not preserve the source duration or AAC audio.')
    }
    const playback = element(`${method}-playback`)
    const url = URL.createObjectURL(blob)
    urls[method] = url
    playback.querySelector('video')!.src = url
    const download = playback.querySelector('a')!
    download.href = url
    download.download = file.name.replace(/\.mp4$/i, '') + `-${method}.mp4`
    resultRows = [
      ['Resolution', `${media.width} × ${media.height}`],
      ['Video / audio', `${codecs.video.join(', ')} / ${codecs.audio.join(', ') || 'none'}`],
      ['Output duration', seconds(media.duration)],
    ]
    playback.hidden = false
    element(`${method}-message`).textContent = 'Ready for playback and download.'
    status.textContent = 'Benchmark complete.'
  } catch (error) {
    const message = signal.aborted ? 'Benchmark cancelled.' : error instanceof Error ? error.message : 'Benchmark failed.'
    element(`${method}-message`).textContent = message
    status.textContent = message
  } finally {
    clearInterval(timer)
    const time = finishedIn ?? (performance.now() - started) / 1000
    elapsed.value = `${seconds(time)} elapsed`
    details(element(`${method}-result`), [
      ...diagnostics(time), ...resultRows,
      ['Main-page JS heap sampled peak', sampledHeap === undefined ? 'Unavailable' : mb(Math.max(sampledHeap, jsHeap() ?? 0))],
    ])
    operation = undefined
    progress.hidden = true
    controls()
  }
}
for (const method of ['baseline', 'experimental'] as const) buttons[method].onclick = () => void run(method)
cancel.onclick = () => operation?.abort()
document.addEventListener('visibilitychange', () => { if (document.hidden) operation?.abort() })
window.addEventListener('pagehide', () => {
  operation?.abort()
  clear('baseline'); clear('experimental')
})
