import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/replays/recordingGeometry.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { parseRecordingMetadata, displaySize, sourceToDisplay, displayToSource } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
function box(type, ...parts) {
  const body = Buffer.concat(parts), result = Buffer.alloc(body.length + 8)
  result.writeUInt32BE(result.length); result.write(type, 4); body.copy(result, 8); return result
}
function fixture(rotation, tx, ty, { version = 0, codec = 'avc1', badMatrix = false, crop = false } = {}) {
  const matrix = [[65536,0,0,65536],[0,65536,-65536,0],[-65536,0,0,-65536],[0,-65536,65536,0]][rotation / 90]
  const header = Buffer.alloc(version ? 96 : 84), offset = version ? 52 : 40
  header[0] = version
  const [a,b,c,d] = matrix
  ;[badMatrix ? 32768 : a,b,0,c,d,0,tx,ty,1073741824].forEach((value,i) => header.writeInt32BE(value, offset + i*4))
  const handler = Buffer.alloc(12); handler.write('vide',8)
  const sample = Buffer.alloc(78); sample.writeUInt16BE(1920,24); sample.writeUInt16BE(1080,26)
  const description = Buffer.alloc(8); description.writeUInt32BE(1,4)
  const file = box('moov',box('trak',box('tkhd',header),box('mdia',box('hdlr',handler),box('minf',box('stbl',box('stsd',description,box(codec,sample,...(crop?[box('clap',Buffer.alloc(32))]:[]))))))))
  return file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)
}
test('phone/remux track translations preserve all supported orientations and reject unsupported metadata', () => {
  for (const rotation of [0,90,180,270]) for (const version of [0,1]) for (const codec of ['avc1','avc3','hvc1','hev1']) for (const [tx,ty] of [[0,0],[1080*65536,0],[1920*65536,1080*65536],[-123*65536,77*65536],[32768,-16384]]) {
    const g = parseRecordingMetadata(fixture(rotation,tx,ty,{version,codec}))
    assert.deepEqual(g,{width:1920,height:1080,rotation})
    const size = displaySize(g)
    for (const p of [[0,0],[1919,0],[1919,1079],[0,1079],[720,400]]) {
      const displayed=sourceToDisplay(p,g)
      assert.ok(displayed[0]>=0 && displayed[0]<size.width && displayed[1]>=0 && displayed[1]<size.height)
      assert.deepEqual(displayToSource(displayed,g),p)
    }
  }
  assert.throws(()=>parseRecordingMetadata(fixture(0,0,0,{badMatrix:true})),/Mirrored or scaled/)
  assert.throws(()=>parseRecordingMetadata(fixture(0,0,0,{codec:'vp09'})),/H.264 or HEVC/)
  assert.throws(()=>parseRecordingMetadata(fixture(0,0,0,{crop:true})),/Cropped/)
  assert.throws(()=>parseRecordingMetadata(fixture(90,0,0).slice(0,40)),/Invalid/)
})
