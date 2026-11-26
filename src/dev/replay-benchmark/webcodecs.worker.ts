import {
  BlobSource, canEncodeVideo, Conversion, Input, MP4,
  Mp4OutputFormat, Output, Quality, StreamTarget,
} from 'mediabunny'
import { compressedReplayOutputLimit } from '../../data/replayUploadLimit.mjs'
import type { StreamTargetChunk } from 'mediabunny'
import type { CompressionPlan } from '../../features/replays/videoCompression'

export type WorkerRequest = {
  action: 'probe' | 'encode'
  file: File
  plan: CompressionPlan
}
export type WorkerReply =
  | { type: 'capabilities'; decoder: string; encoder: string; audio: string; supported: boolean }
  | { type: 'progress'; fraction: number }
  | { type: 'output'; blob: Blob }
  | { type: 'error'; message: string }

function send(reply: WorkerReply) {
  self.postMessage(reply)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { action, file, plan } = event.data
  const input = new Input({ source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 }), formats: [MP4] })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video) throw Error('No video track found.')

    const config = await video.getDecoderConfig()
    const quality = new Quality({ bitrate: plan.videoRate })
    const outputConfig = { width: plan.width, height: plan.height, frameRate: 30, quality }
    const probe = async (hardwareAcceleration: 'prefer-hardware' | 'no-preference') => ({
      decode: !!config && typeof VideoDecoder !== 'undefined'
        && !!(await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration })).supported,
      encode: typeof VideoEncoder !== 'undefined' && await canEncodeVideo('avc', { ...outputConfig, hardwareAcceleration }),
    })
    const preferred = await probe('prefer-hardware')
    const hardwareAcceleration = preferred.decode && preferred.encode ? 'prefer-hardware' : 'no-preference'
    const available = hardwareAcceleration === 'prefer-hardware' ? preferred : await probe('no-preference')
    const audioCodec = await audio?.getCodecParameterString()
    const canPreserveAudio = !audio || !!audioCodec?.startsWith('mp4a.40.')
    const supported = available.decode && available.encode && canPreserveAudio
    const preference = hardwareAcceleration === 'prefer-hardware' ? 'hardware preference accepted' : 'browser default'
    send({
      type: 'capabilities',
      decoder: `${config?.codec ?? 'Unknown'} · ${available.decode ? preference : 'unsupported'}`,
      encoder: `H.264 · ${available.encode ? preference : 'unsupported'}`,
      audio: audio ? canPreserveAudio ? `${audioCodec} · copied without re-encoding` : 'Only AAC audio is supported for the experiment' : 'No audio track',
      supported,
    })
    if (action === 'probe') return
    if (!supported) throw Error('The required video or audio configuration is unavailable on this browser.')

    // Flat MP4 rewrites its mdat header. Fixed-size pages accept these writes
    // without growing or repeatedly copying a contiguous output buffer.
    const pageSize = 1024 * 1024
    const pages: Uint8Array<ArrayBuffer>[] = []
    let bytes = 0
    const target = new StreamTarget(new WritableStream<StreamTargetChunk>({
      write({ data, position }) {
        const end = position + data.byteLength
        if (end > compressedReplayOutputLimit) throw Error('Output exceeded the 100 MB limit.')
        bytes = Math.max(bytes, end)
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
    conversion.onProgress = fraction => send({ type: 'progress', fraction })
    await conversion.execute()
    if (!bytes) throw Error('The encoder produced an empty file.')
    const parts = pages.map((page, index) => page.subarray(0, Math.min(pageSize, bytes - index * pageSize)))
    send({ type: 'output', blob: new Blob(parts, { type: 'video/mp4' }) })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'WebCodecs failed.' })
  } finally {
    input.dispose()
  }
}
