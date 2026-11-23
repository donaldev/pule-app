// Inspect container track sample entries without reading any media payload.
type Box = { kind: string; body: number; end: number }

async function* boxes(file: Blob, start: number, end: number): AsyncGenerator<Box> {
  for (let count = 0; start + 8 <= end && count < 256; count++) {
    const view = new DataView(await file.slice(start, Math.min(start + 16, end)).arrayBuffer())
    const kind = String.fromCharCode(...new Uint8Array(view.buffer, 4, 4))
    const size32 = view.getUint32(0)
    const header = size32 === 1 ? 16 : 8
    if (view.byteLength < header) throw Error('The MP4 has an incomplete box header.')
    const size = size32 === 1 ? Number(view.getBigUint64(8)) : size32 || end - start
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw Error('The MP4 has an invalid box size.')
    yield { kind, body: start + header, end: start + size }
    start += size
  }
}

async function child(file: Blob, parent: Box, kind: string) {
  for await (const box of boxes(file, parent.body, parent.end)) {
    if (box.kind === kind) return box
  }
}

export async function videoSampleTypes(file: Blob) {
  const movie = await child(file, { kind: '', body: 0, end: file.size }, 'moov')
  if (!movie) throw Error('The file does not have a readable MP4 movie header.')
  const video: string[] = []
  const audio: string[] = []
  for await (const track of boxes(file, movie.body, movie.end)) {
    if (track.kind !== 'trak') continue
    const media = await child(file, track, 'mdia')
    if (!media) continue
    const handler = await child(file, media, 'hdlr')
    if (!handler || handler.body + 12 > handler.end) continue
    const handlerKind = await file.slice(handler.body + 8, handler.body + 12).text()
    if (handlerKind !== 'vide' && handlerKind !== 'soun') continue
    const info = await child(file, media, 'minf')
    const table = info && await child(file, info, 'stbl')
    const descriptions = table && await child(file, table, 'stsd')
    if (!descriptions) continue
    for await (const entry of boxes(file, descriptions.body + 8, descriptions.end)) {
      (handlerKind === 'vide' ? video : audio).push(entry.kind)
    }
  }
  return { video, audio }
}
