import { compressedReplayOutputLimit } from '../../data/replayUploadLimit.mjs'
import { inspectRecordingTiming, type RecordingTiming } from '../../features/replays/recordingGeometry'
import { audioBitrate, compressionSupport, planCompression, compressVideo, type CompressionPlan } from '../../features/replays/videoCompression'
import { videoSampleTypes } from '../../features/replays/videoSampleTypes'

const MAX_SOURCE_BYTES = 2 * 1024 ** 3

function details(element: HTMLElement, entries: [string, string][]) {
  element.replaceChildren(...entries.flatMap(([label, value]) => {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    return [term, description]
  }))
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`
const rate = (bits: number) => `${Math.round(bits / 1000)} kbps`
const seconds = (value: number) => `${value.toFixed(1)} s`

function waitForMetadata(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const listeners = new AbortController()
    const options = { signal: listeners.signal, once: true }
    function finish(error?: unknown) {
      listeners.abort()
      if (error) reject(error)
      else resolve()
    }
    video.addEventListener('loadedmetadata', () => finish(), options)
    video.addEventListener('error', () => finish(Error('This browser could not open the MP4.')), options)
    signal.addEventListener('abort', () => finish(signal.reason), options)
    if (signal.aborted) finish(signal.reason)
  })
}

type Source = {
  file: File
  duration: number
  width: number
  height: number
  // The original capture metadata remains tied to the selected File for this session.
  timing: RecordingTiming | null
}

function setup() {
  const fileInput = document.querySelector<HTMLInputElement>('#file')!
  const original = document.querySelector<HTMLElement>('#original')!
  const settingsList = document.querySelector<HTMLElement>('#settings')!
  const start = document.querySelector<HTMLButtonElement>('#start')!
  const cancel = document.querySelector<HTMLButtonElement>('#cancel')!
  const status = document.querySelector<HTMLElement>('#status')!
  const progress = document.querySelector<HTMLProgressElement>('#progress')!
  const result = document.querySelector<HTMLElement>('#result')!
  const output = document.querySelector<HTMLElement>('#output')!
  const preview = document.querySelector<HTMLVideoElement>('#preview')!
  const download = document.querySelector<HTMLAnchorElement>('#download')!
  const budget: [string, string] = ['Maximum output', mb(compressedReplayOutputLimit)]
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  let source: Source | undefined
  let settings: CompressionPlan | undefined
  let sourceUrl = ''
  let outputUrl = ''
  let operation: AbortController | undefined

  if (!compressionSupport()) {
    status.textContent = 'This browser does not report H.264 MP4 compression support.'
    return
  }
  status.textContent = 'Choose a recording to check its format.'
  fileInput.disabled = false

  function clearSource() {
    video.removeAttribute('src')
    video.load()
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    sourceUrl = ''
  }

  function clearResult() {
    result.hidden = true
    preview.removeAttribute('src')
    preview.load()
    download.removeAttribute('href')
    if (outputUrl) URL.revokeObjectURL(outputUrl)
    outputUrl = ''
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    operation?.abort()
    const controller = new AbortController()
    operation = controller
    clearSource()
    clearResult()
    source = settings = undefined
    start.disabled = true
    details(original, [])
    details(settingsList, [budget])
    status.textContent = 'Reading local video metadata…'
    try {
      if (!/\.mp4$/i.test(file.name) || file.size < 1 || file.size > MAX_SOURCE_BYTES) {
        throw Error('Choose an MP4 recording no larger than 2 GiB.')
      }
      sourceUrl = URL.createObjectURL(file)
      const metadata = waitForMetadata(video, controller.signal)
      video.src = sourceUrl
      const [, timing, sampleTypes] = await Promise.all([
        metadata, inspectRecordingTiming(file), videoSampleTypes(file),
      ])
      controller.signal.throwIfAborted()
      const { videoWidth: width, videoHeight: height, duration } = video
      if (!Number.isFinite(duration) || duration <= 0 || width < 16 || height < 16 || width * height > 3840 * 2160) {
        throw Error('Use a playable recording with a known duration and no more than 4K pixels.')
      }
      const hasAudio = sampleTypes.audio.length > 0
      source = { file, width, height, duration, timing }
      settings = planCompression(source, hasAudio)
      const { audio } = settings
      details(original, [['File', file.name], ['Size', mb(file.size)], ['Resolution', `${width} × ${height}`],
        ['Duration', seconds(duration)], ['Video codec', sampleTypes.video.join(', ') || 'Unavailable']])
      details(settingsList, [budget, ['Canvas', `${settings.width} × ${settings.height} · up to 30 fps`],
        ['Video bitrate', rate(settings.videoRate)], ['Format', audio ? 'MP4 · H.264 + AAC' : 'MP4 · H.264 · video only'],
        ...(audio ? [['Audio bitrate', rate(audioBitrate)] as [string, string]] : [])])
      status.textContent = hasAudio && !audio ? 'AAC is unavailable. Compression will produce a silent video.' : 'Ready to compress.'
      start.disabled = false
    } catch (error) {
      if (operation === controller) status.textContent = error instanceof Error ? error.message : 'Could not inspect the recording.'
    } finally {
      if (operation === controller) { clearSource(); operation = undefined }
    }
  })

  start.addEventListener('click', async () => {
    if (!source || !settings || operation) return
    const input = source
    const target = settings
    const controller = new AbortController()
    operation = controller
    clearResult()
    start.disabled = fileInput.disabled = true
    cancel.disabled = false
    progress.value = 0
    progress.hidden = false
    status.textContent = 'Compressing…'
    try {
      const { blob, geometry, sampleTypes, elapsed } = await compressVideo(input.file, input.duration, target, controller.signal,
        (fraction, elapsed) => {
          progress.value = fraction
          status.textContent = `Compressing… ${seconds(elapsed)} elapsed`
        })
      outputUrl = URL.createObjectURL(blob)
      preview.src = outputUrl
      download.href = outputUrl
      download.download = input.file.name.replace(/\.mp4$/i, '') + '_compressed.mp4'
      details(output, [['Size', mb(blob.size)], ['Size reduction', `${(100 * (1 - blob.size / input.file.size)).toFixed(1)}%`],
        ['Resolution', `${geometry.width} × ${geometry.height}`],
        ['Format', `MP4 · H.264 (${sampleTypes.video[0]})${target.audio ? ' · AAC (mp4a)' : ''}`],
        ['200 MB limit', blob.size <= compressedReplayOutputLimit ? 'Met' : 'Exceeded'], ['Compression time', seconds(elapsed)]])
      result.hidden = false
      progress.value = 1
      status.textContent = blob.size <= compressedReplayOutputLimit ? 'Compression complete.' : 'Compression complete. The output exceeds 200 MB.'
    } catch (error) {
      status.textContent = controller.signal.aborted ? 'Compression cancelled.' : error instanceof Error ? error.message : 'Compression failed.'
    } finally {
      operation = undefined
      progress.hidden = true
      cancel.disabled = true
      start.disabled = fileInput.disabled = false
    }
  })
  cancel.addEventListener('click', () => operation?.abort())
  window.addEventListener('pagehide', () => {
    operation?.abort()
    clearSource()
    clearResult()
  })
}

if (import.meta.env.DEV) setup()
