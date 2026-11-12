export type Point = [number, number]
export interface RecordingGeometry { width: number; height: number; rotation: 0 | 90 | 180 | 270 }
interface Box { type: string; start: number; body: number; end: number }
function boxes(v: DataView, start: number, end: number): Box[] {
  const out: Box[] = []
  while (start < end) {
    if (out.length > 10000 || start + 8 > end) throw Error('Invalid MP4 structure.')
    let size = v.getUint32(start), header = 8
    const type = String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + start + 4, 4))
    if (size === 1) { if (start + 16 > end) throw Error('Invalid MP4 box.'); size = Number(v.getBigUint64(start + 8)); header = 16 }
    if (size === 0) size = end - start
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw Error('Invalid MP4 box size.')
    out.push({ type, start, body: start + header, end: start + size }); start += size
  }
  return out
}
function child(v: DataView, parent: Box, type: string) {
  const result = boxes(v, parent.body, parent.end).find(b => b.type === type)
  if (!result) throw Error('Unsupported MP4 video layout.')
  return result
}
/** Bounded MP4 metadata only; do not load the recording into memory. */
export async function inspectRecording(file: Blob): Promise<RecordingGeometry> {
  let offset = 0
  for (let count = 0; offset + 8 <= file.size && count < 10000; count++) {
    const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer())
    const type = String.fromCharCode(...new Uint8Array(header.buffer, 4, 4))
    let size = header.getUint32(0)
    if (size === 1) { if (header.byteLength < 16) throw Error('Invalid video.'); size = Number(header.getBigUint64(8)) }
    if (size === 0) size = file.size - offset
    if (!Number.isSafeInteger(size) || size < 8 || offset + size > file.size) throw Error('Invalid MP4 recording.')
    if (type === 'moov') {
      if (size > 16 * 1024 * 1024) throw Error('This MP4 has too much metadata. Export a simpler MP4 recording.')
      return parseRecordingMetadata(await file.slice(offset, offset + size).arrayBuffer())
    }
    offset += size
  }
  throw Error('Choose a complete MP4 recording. This file has no readable video metadata.')
}
export function parseRecordingMetadata(buffer: ArrayBuffer): RecordingGeometry {
  const v = new DataView(buffer), root = boxes(v, 0, v.byteLength).find(b => b.type === 'moov')
  if (!root) throw Error('Missing MP4 metadata.')
  const videos = boxes(v, root.body, root.end).filter(b => b.type === 'trak').filter(track => {
    const mdia = child(v, track, 'mdia'), hdlr = child(v, mdia, 'hdlr')
    return String.fromCharCode(...new Uint8Array(buffer, hdlr.body + 8, 4)) === 'vide'
  })
  if (videos.length !== 1) throw Error('Choose a recording with one video track.')
  const track = videos[0], tkhd = child(v, track, 'tkhd'), version = v.getUint8(tkhd.body)
  if (version !== 0 && version !== 1) throw Error('Unsupported video transform.')
  const matrix = tkhd.body + (version === 1 ? 52 : 40)
  if (matrix + 36 > tkhd.end) throw Error('Invalid video transform.')
  const values = Array.from({ length: 9 }, (_, i) => v.getInt32(matrix + i * 4))
  const [a, b, u, c, d, vv, , , w] = values
  if (u || vv || w !== 1073741824) throw Error('Unsupported perspective video transform.')
  const transforms = [[65536, 0, 0, 65536], [0, 65536, -65536, 0], [-65536, 0, 0, -65536], [0, -65536, 65536, 0]]
  const rotation = transforms.findIndex(t => t.every((n, i) => n === [a, b, c, d][i])) * 90
  if (rotation < 0) throw Error('Mirrored or scaled videos are unsupported. Export a standard MP4.')
  const stsd = child(v, child(v, child(v, child(v, track, 'mdia'), 'minf'), 'stbl'), 'stsd')
  if (v.getUint32(stsd.body + 4) !== 1) throw Error('Choose a single-format video track.')
  const samples = boxes(v, stsd.body + 8, stsd.end)
  if (samples.length !== 1 || !['avc1', 'avc3', 'hvc1', 'hev1'].includes(samples[0].type)) throw Error('Use an H.264 or HEVC MP4 recording.')
  const sample = samples[0]
  if (sample.body + 78 > sample.end) throw Error('Invalid video dimensions.')
  const width = v.getUint16(sample.body + 24), height = v.getUint16(sample.body + 26)
  for (const box of boxes(v, sample.body + 78, sample.end)) {
    if (box.type === 'pasp' && (box.body + 8 > box.end || v.getUint32(box.body) === 0 || v.getUint32(box.body) !== v.getUint32(box.body + 4))) throw Error('Non-square video pixels are unsupported.')
    if (box.type === 'clap') throw Error('Cropped video transforms are unsupported. Export a standard MP4.')
  }
  if (width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > 33554432) throw Error('This recording exceeds the supported resolution.')
  // Track translation positions the rotated rectangle on the movie canvas; it
  // does not change encoded pixels. Remuxers need not use a canonical origin.
  // Normalize its bounding-box origin, as the single-track video preview does.
  // Only the exact unit right-angle matrices above are supported (no crop/scale).
  const tx = values[6] / 65536, ty = values[7] / 65536
  const bounds = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) =>
    [a / 65536 * x + c / 65536 * y + tx, b / 65536 * x + d / 65536 * y + ty])
  const displayedWidth = Math.max(...bounds.map(p => p[0])) - Math.min(...bounds.map(p => p[0]))
  const displayedHeight = Math.max(...bounds.map(p => p[1])) - Math.min(...bounds.map(p => p[1]))
  if (displayedWidth !== (rotation % 180 ? height : width) || displayedHeight !== (rotation % 180 ? width : height)) throw Error('Unsupported video display bounds. Export a standard MP4.')
  return { width, height, rotation: rotation as RecordingGeometry['rotation'] }
}
export function displaySize(g: RecordingGeometry) { return g.rotation % 180 ? { width: g.height, height: g.width } : { width: g.width, height: g.height } }
/** Clockwise display transform inverted to original encoded pixel centers. */
export function displayToSource([x, y]: Point, g: RecordingGeometry): Point {
  switch (g.rotation) {
    case 90: return [y, g.height - 1 - x]
    case 180: return [g.width - 1 - x, g.height - 1 - y]
    case 270: return [g.width - 1 - y, x]
    default: return [x, y]
  }
}
export function sourceToDisplay([x, y]: Point, g: RecordingGeometry): Point {
  switch (g.rotation) {
    case 90: return [g.height - 1 - y, x]
    case 180: return [g.width - 1 - x, g.height - 1 - y]
    case 270: return [y, g.width - 1 - x]
    default: return [x, y]
  }
}
export function pointerToDisplay(x: number, y: number, rect: { left: number; top: number; width: number; height: number }, g: RecordingGeometry): Point {
  const size = displaySize(g)
  return [Math.max(0, Math.min(size.width - 1, (x - rect.left) / rect.width * size.width)), Math.max(0, Math.min(size.height - 1, (y - rect.top) / rect.height * size.height))]
}
/** Match the processor's float32/integer bounding box, clipped 40px margins and resize. */
export function analysisCrop(points: Point[], width: number, height: number) {
  if (points.length !== 4 || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > 33554432) return null
  const p = points.map(([x, y]) => [Math.fround(x), Math.fround(y)])
  if (p.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height)) return null
  const xs = p.map(([x]) => Math.trunc(x)), ys = p.map(([, y]) => Math.trunc(y))
  const x = Math.max(0, Math.min(...xs) - 40), y = Math.max(0, Math.min(...ys) - 40)
  const w = Math.min(width - x, Math.max(...xs) - Math.min(...xs) + 1 + 80)
  const h = Math.min(height - y, Math.max(...ys) - Math.min(...ys) + 1 + 80)
  if (w <= 0 || h <= 0) return null
  const analysisWidth = Math.min(1440, Math.floor(4096 * w / h))
  if (analysisWidth < 1) return null
  const scaledHeight = h * (analysisWidth / w), floor = Math.floor(scaledHeight)
  // Python round() uses ties-to-even.
  const analysisHeight = Math.max(1, scaledHeight - floor === 0.5 ? floor + floor % 2 : Math.round(scaledHeight))
  return analysisHeight <= 4096 ? { x, y, width: w, height: h, analysisWidth, analysisHeight } : null
}
export function validCorners(points: Point[], width: number, height: number): boolean {
  if (points.length !== 4 || points.some(p => p.some(n => !Number.isFinite(n)) || p[0] < 0 || p[0] >= width || p[1] < 0 || p[1] >= height)) return false
  let direction = 0, area = 0
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (!cross || (direction && Math.sign(cross) !== direction)) return false
    direction = Math.sign(cross); area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area / 2) >= 100 && analysisCrop(points, width, height) !== null
}
