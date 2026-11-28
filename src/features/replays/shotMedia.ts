import { CanvasSink, Conversion, Input, MP4, Mp4OutputFormat, Output, StreamTarget, UrlSource } from 'mediabunny'
import type { ShotBounds } from './shotTimeline'

function openReplay(url: string) {
  return new Input({ formats: [MP4], source: new UrlSource(url, {
    maxCacheSize: 8 * 1024 * 1024, parallelism: 1, getRetryDelay: () => null,
    requestInit: { credentials: 'omit' },
  }) })
}

class ShotExportError extends Error {}

export async function extractShot(url: string, bounds: ShotBounds, signal: AbortSignal) {
  signal.throwIfAborted()
  const input = openReplay(url)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  const target = new StreamTarget(new WritableStream({
    write({ data, position }) {
      if (position !== bytes || bytes + data.byteLength > 64 * 1024 * 1024) {
        throw new ShotExportError('This shot is too large to save here. Try trimming it or download the full replay.')
      }
      bytes += data.byteLength
      chunks.push(data.slice())
    },
  }))
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target })
  let conversion: Conversion | undefined
  function cancel() {
    if (conversion) void conversion.cancel().catch(() => {})
    input.dispose()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    conversion = await Conversion.init({
      input, output, tracks: 'primary', trim: { start: bounds.start / 1000, end: bounds.end / 1000 },
      copy: { boundaryPolicy: 'shrink', boundaryTolerance: 0 }, tags: {}, showWarnings: false,
    })
    signal.throwIfAborted()
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      throw new ShotExportError('This browser cannot export this shot. Try another browser or download the full replay.')
    }
    await conversion.execute()
    signal.throwIfAborted()
    if (!bytes) throw new ShotExportError('The selected bounds contain no exportable video.')
    return new Blob(chunks, { type: 'video/mp4' })
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof ShotExportError) throw error
    throw Error('Could not export this shot. Check your connection or try another browser.', { cause: error })
  } finally {
    input.dispose()
    signal.removeEventListener('abort', cancel)
  }
}

export async function openShotThumbnails(url: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const input = openReplay(url)
  const dispose = () => input.dispose()
  signal.addEventListener('abort', dispose, { once: true })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw Error('Thumbnail decoding unavailable')
    const sink = new CanvasSink(track, { width: 192, height: 108, fit: 'contain', poolSize: 1 })
    return {
      async get(ms: number) {
        const frame = await sink.getCanvas(ms / 1000)
        if (!frame) return
        const { canvas } = frame
        if ('toDataURL' in canvas) return canvas.toDataURL('image/jpeg', .72)
        // CanvasSink uses an OffscreenCanvas where available.
        const copy = document.createElement('canvas')
        copy.width = canvas.width
        copy.height = canvas.height
        copy.getContext('2d')?.drawImage(canvas, 0, 0)
        return copy.toDataURL('image/jpeg', .72)
      },
    }
  } catch (error) {
    dispose()
    signal.removeEventListener('abort', dispose)
    throw error
  }
}
