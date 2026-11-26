import {
  BlobSource, canEncodeVideo, Conversion, EncodedPacketSink, Input, MP4,
  Mp4OutputFormat, Output, Quality, StreamTarget,
} from 'mediabunny'
import { compressedReplayOutputLimit } from '../../data/replayUploadLimit.mjs'
import type { StreamTargetChunk } from 'mediabunny'
import { webCodecsVideoRate } from './webcodecsBudget.mjs'
import { planCompressionBudget } from '../../features/replays/videoCompression'

export type WorkerRequest = {
  action: 'probe' | 'encode'
  file: File
  source: { width: number; height: number; duration: number }
}
export type WorkerReply =
  | { type: 'capabilities'; decoder: string; encoder: string; audio: string; supported: boolean; videoRate?: number; audioBudget: number }
  | { type: 'progress'; fraction: number; bytes: number; processed: number }
  | { type: 'config'; config: Pick<VideoEncoderConfig, 'codec' | 'width' | 'height' | 'bitrate' | 'bitrateMode' | 'framerate' | 'latencyMode' | 'hardwareAcceleration'> }
  | { type: 'tracks'; videoBytes: number; audioBytes?: number }
  | { type: 'output'; blob: Blob }
  | { type: 'error'; message: string }

function send(reply: WorkerReply) {
  self.postMessage(reply)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { action, file, source } = event.data
  const input = new Input({ source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 }), formats: [MP4] })
  let bytes = 0
  let processed = 0
  let fraction = 0
  let videoBytes = 0
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video) throw Error('No video track found.')

    const audioCodec = await audio?.getCodecParameterString()
    const canPreserveAudio = !audio || !!audioCodec?.startsWith('mp4a.40.')
    let audioBytes = 0
    if (audio && canPreserveAudio) {
      for await (const packet of new EncodedPacketSink(audio).packets(undefined, undefined, { metadataOnly: true })) {
        audioBytes += packet.byteLength
      }
    }
    const plan = planCompressionBudget(source, audioBytes)
    const config = await video.getDecoderConfig()
    // Keep the VBR comparison dimensions and 30 fps grid while changing rate control.
    const videoRate = webCodecsVideoRate(source.duration, audioBytes)
    const quality = new Quality({ bitrate: videoRate, bitrateMode: 'constant' })
    const outputConfig = { width: plan.width, height: plan.height, frameRate: 30, quality }
    const probe = async (hardwareAcceleration: 'prefer-hardware' | 'no-preference') => ({
      decode: !!config && typeof VideoDecoder !== 'undefined'
        && !!(await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration })).supported,
      encode: typeof VideoEncoder !== 'undefined' && await canEncodeVideo('avc', { ...outputConfig, hardwareAcceleration }),
    })
    const preferred = await probe('prefer-hardware')
    const hardwareAcceleration = preferred.decode && preferred.encode ? 'prefer-hardware' : 'no-preference'
    const available = hardwareAcceleration === 'prefer-hardware' ? preferred : await probe('no-preference')
    const supported = available.decode && available.encode && canPreserveAudio
    const preference = hardwareAcceleration === 'prefer-hardware' ? 'hardware preference accepted' : 'browser default'
    send({
      type: 'capabilities',
      decoder: `${config?.codec ?? 'Unknown'} · ${available.decode ? preference : 'unsupported'}`,
      encoder: `H.264 CBR · ${available.encode ? preference : 'unsupported'}`,
      audio: audio ? canPreserveAudio ? `${audioCodec} · copied without re-encoding` : 'Only AAC audio is supported for the experiment' : 'No audio track',
      supported, videoRate, audioBudget: audioBytes,
    })
    if (action === 'probe') return
    if (!supported) throw Error('The required video or audio configuration is unavailable on this browser.')

    // Flat MP4 rewrites its mdat header. Fixed-size pages accept these writes
    // without growing or repeatedly copying a contiguous output buffer.
    const pageSize = 1024 * 1024
    const pages: Uint8Array<ArrayBuffer>[] = []
    const target = new StreamTarget(new WritableStream<StreamTargetChunk>({
      write({ data, position }) {
        const end = position + data.byteLength
        bytes = Math.max(bytes, end)
        if (bytes > compressedReplayOutputLimit) throw Error('Output exceeded the 200 MB limit.')
        for (let offset = 0; offset < data.byteLength;) {
          const index = Math.floor((position + offset) / pageSize)
          const start = (position + offset) % pageSize
          const count = Math.min(pageSize - start, data.byteLength - offset)
          const page = pages[index] ??= new Uint8Array(pageSize)
          page.set(data.subarray(offset, offset + count), start)
          offset += count
        }
      },
    }))
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
    const conversion = await Conversion.init({
      input, output, tracks: 'primary', showWarnings: false, tags: {},
      video: {
        ...outputConfig, codec: 'avc', forceTranscode: true, hardwareAcceleration,
        allowTransformationMetadata: false, fit: 'fill',
      },
      audio: { codec: 'aac' },
    })
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (audio && !conversion.utilizedTracks.includes(audio))) {
      throw Error('The encoder could not preserve the selected video and audio tracks.')
    }
    let previousReport = 0
    conversion.onProgress = (nextFraction, sourceSeconds) => {
      fraction = nextFraction
      processed = Math.max(processed, sourceSeconds)
      const now = performance.now()
      if (fraction < 1 && now - previousReport < 250) return
      previousReport = now
      send({ type: 'progress', fraction, bytes, processed })
      send({ type: 'tracks', videoBytes })
    }
    // Conversion does not expose VideoSampleSource's encoder hooks. Observe
    // only this worker's real configuration and encoded chunks, after probing.
    const NativeEncoder = VideoEncoder
    self.VideoEncoder = class extends NativeEncoder {
      constructor(init: VideoEncoderInit) {
        super({ ...init, output(chunk, metadata) {
          videoBytes += chunk.byteLength
          init.output(chunk, metadata)
        } })
      }

      configure(config: VideoEncoderConfig) {
        const { codec, width, height, bitrate, bitrateMode, framerate, latencyMode, hardwareAcceleration } = config
        send({ type: 'config', config: { codec, width, height, bitrate, bitrateMode, framerate, latencyMode, hardwareAcceleration } })
        if (bitrateMode !== 'constant' || bitrate !== videoRate) {
          throw Error('The encoder did not receive the requested constant bitrate.')
        }
        super.configure(config)
      }
    }
    try { await conversion.execute() }
    finally { self.VideoEncoder = NativeEncoder }
    if (!bytes) throw Error('The encoder produced an empty file.')
    const parts = pages.map((page, index) => page.subarray(0, Math.min(pageSize, bytes - index * pageSize)))
    const blob = new Blob(parts, { type: 'video/mp4' })
    const result = new Input({ source: new BlobSource(blob), formats: [MP4] })
    try {
      const outputAudio = await result.getPrimaryAudioTrack()
      let copiedBytes = 0
      if (outputAudio) {
        for await (const packet of new EncodedPacketSink(outputAudio).packets(undefined, undefined, { metadataOnly: true })) {
          copiedBytes += packet.byteLength
        }
      }
      send({ type: 'tracks', videoBytes, audioBytes: copiedBytes })
    } finally {
      result.dispose()
    }
    send({ type: 'output', blob })
  } catch (error) {
    if (action === 'encode') {
      send({ type: 'progress', fraction, bytes, processed })
      send({ type: 'tracks', videoBytes })
    }
    send({ type: 'error', message: error instanceof Error ? error.message : 'WebCodecs failed.' })
  } finally {
    input.dispose()
  }
}
