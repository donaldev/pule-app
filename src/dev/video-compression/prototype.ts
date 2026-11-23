import { inspectRecording, inspectRecordingTiming, type RecordingTiming } from '../../features/replays/recordingGeometry'
import { videoSampleTypes } from './sampleTypes'

const MAX_BYTES = 100_000_000
const MAX_SOURCE_BYTES = 2 * 1024 ** 3
const MAX_HELD_BYTES = 110_000_000
const AUDIO_RATE = 128_000
const MP4_WITH_AUDIO = 'video/mp4;codecs=avc1,mp4a.40.2'
const MP4_VIDEO_ONLY = 'video/mp4;codecs=avc1'

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

type Settings = { width: number; height: number; videoRate: number; audio: boolean; mime: string }

function measureSettings(source: Source, audio: boolean, mime: string): Settings {
  // Reserve 2% for container overhead and 10% for bitrate variation.
  const videoRate = Math.min(8_000_000, Math.floor(MAX_BYTES * 0.88 * 8 / source.duration) - (audio ? AUDIO_RATE : 0))
  if (videoRate < 350_000) throw Error('The recording is too long for a useful result within the 100 MB budget.')
  const shortEdge = videoRate >= 2_000_000 ? 1080 : 720
  const scale = Math.min(1, shortEdge / Math.min(source.width, source.height), shortEdge * 16 / 9 / Math.max(source.width, source.height))
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
  return { width: even(source.width * scale), height: even(source.height * scale), videoRate, audio, mime }
}

function record(video: HTMLVideoElement, settings: Settings, signal: AbortSignal) {
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
        ...(settings.audio ? { audioBitsPerSecond: AUDIO_RATE } : {}),
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
          finish(Error(`Partial output reached ${mb(bytes)}, exceeding the 100 MB target. Compression stopped to limit memory use.`))
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
  const budget: [string, string] = ['Maximum output', mb(MAX_BYTES)]
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  let source: Source | undefined
  let settings: Settings | undefined
  let sourceUrl = ''
  let outputUrl = ''
  let operation: AbortController | undefined

  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function'
      || typeof HTMLCanvasElement.prototype.captureStream !== 'function'
      || typeof video.requestVideoFrameCallback !== 'function') {
    status.textContent = 'This browser does not provide the video capture APIs required for this prototype.'
    return
  }
  const supportsAudio = typeof AudioContext !== 'undefined' && MediaRecorder.isTypeSupported(MP4_WITH_AUDIO)
  const supportsVideo = MediaRecorder.isTypeSupported(MP4_VIDEO_ONLY)
  if (!supportsAudio && !supportsVideo) {
    status.textContent = 'This browser does not report H.264 MP4 recording support.'
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

  // A fresh media element per run keeps Web Audio's one-source-node-per-element rule.
  function playbackElement() {
    const player = document.createElement('video')
    player.playsInline = true
    player.preload = 'auto'
    return player
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
      const audio = hasAudio && supportsAudio
      if (!audio && !supportsVideo) throw Error('This browser does not support video-only H.264 MP4 recording.')
      source = { file, width, height, duration, timing }
      settings = measureSettings(source, audio, audio ? MP4_WITH_AUDIO : MP4_VIDEO_ONLY)
      details(original, [['File', file.name], ['Size', mb(file.size)], ['Resolution', `${width} × ${height}`],
        ['Duration', seconds(duration)], ['Video codec', sampleTypes.video.join(', ') || 'Unavailable']])
      details(settingsList, [budget, ['Canvas', `${settings.width} × ${settings.height} · up to 30 fps`],
        ['Video bitrate', rate(settings.videoRate)], ['Format', audio ? 'MP4 · H.264 + AAC' : 'MP4 · H.264 · video only'],
        ...(audio ? [['Audio bitrate', rate(AUDIO_RATE)] as [string, string]] : [])])
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
    const player = playbackElement()
    player.muted = !target.audio
    const url = URL.createObjectURL(input.file)
    clearResult()
    start.disabled = fileInput.disabled = true
    cancel.disabled = false
    progress.value = 0
    progress.hidden = false
    status.textContent = 'Compressing…'
    const started = performance.now()
    const update = window.setInterval(() => {
      progress.value = Math.min(1, player.currentTime / input.duration)
      status.textContent = `Compressing… ${seconds((performance.now() - started) / 1000)} elapsed`
    }, 500)
    try {
      // Start playback and any AudioContext from the button gesture.
      player.src = url
      const blob = await record(player, target, controller.signal)
      const elapsed = (performance.now() - started) / 1000
      window.clearInterval(update)
      status.textContent = 'Checking output format…'
      const [geometry, sampleTypes] = await Promise.all([inspectRecording(blob), videoSampleTypes(blob)])
      controller.signal.throwIfAborted()
      if (!/^video\/mp4(?:;|$)/i.test(blob.type) || sampleTypes.video.length !== 1
          || !['avc1', 'avc3'].includes(sampleTypes.video[0])
          || (target.audio ? sampleTypes.audio.length !== 1 || sampleTypes.audio[0] !== 'mp4a' : sampleTypes.audio.length > 0)) {
        throw Error('The output did not have the expected MP4 video or audio format.')
      }
      outputUrl = URL.createObjectURL(blob)
      preview.src = outputUrl
      download.href = outputUrl
      download.download = input.file.name.replace(/\.mp4$/i, '') + '_compressed.mp4'
      details(output, [['Size', mb(blob.size)], ['Size reduction', `${(100 * (1 - blob.size / input.file.size)).toFixed(1)}%`],
        ['Resolution', `${geometry.width} × ${geometry.height}`],
        ['Format', `MP4 · H.264 (${sampleTypes.video[0]})${target.audio ? ' · AAC (mp4a)' : ''}`],
        ['100 MB target', blob.size <= MAX_BYTES ? 'Met' : 'Exceeded'], ['Compression time', seconds(elapsed)]])
      result.hidden = false
      progress.value = 1
      status.textContent = blob.size <= MAX_BYTES ? 'Compression complete.' : 'Compression complete. The output exceeds 100 MB.'
    } catch (error) {
      status.textContent = controller.signal.aborted ? 'Compression cancelled.' : error instanceof Error ? error.message : 'Compression failed.'
    } finally {
      window.clearInterval(update)
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(url)
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
