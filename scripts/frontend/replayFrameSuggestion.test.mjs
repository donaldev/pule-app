import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function load(name) {
  const source = await readFile(new URL(`../../src/features/replays/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const { inspectRecordingTiming } = await load('recordingGeometry')
const { suggestReplayFrame } = await load('suggestReplayFrame')
const night = Date.parse('2026-10-26T02:00:00Z')
const now = night + 86400_000
const at = seconds => new Date(night + seconds * 1000).toISOString()
const frames = [
  { id: '10', started_at: at(0), completed_at: at(600) },
  { id: '11', started_at: at(625), completed_at: at(1200) },
  { id: '12', started_at: null, completed_at: null },
]
const eligible = new Set(frames.map(frame => frame.id))
const embedded = (start, durationMs) => ({ startMs: night + start * 1000, durationMs, reliability: 'high', source: 'creation-date' })

test('ranks clear overlap, tolerates an early start, and uses a unique containing frame for a start-only recording', () => {
  for (const timing of [embedded(20, 510_000), embedded(-20, 590_000), embedded(20, null)]) {
    assert.equal(suggestReplayFrame(timing, frames, eligible), '10')
  }
})

test('leaves ambiguous, distant, missing, weak or occupied recordings for manual selection', () => {
  for (const timing of [
    embedded(400, 450_000), embedded(612, null), embedded(1800, null), null,
    { ...embedded(20, null), reliability: 'weak', source: 'lastModified' },
  ]) assert.equal(suggestReplayFrame(timing, frames, eligible), null)
  assert.equal(suggestReplayFrame(embedded(20, null), [frames[2]], eligible), null)
  assert.equal(suggestReplayFrame(embedded(20, 600_000), frames, new Set(['11', '12'])), null)
})

function u32(value) {
  const field = Buffer.alloc(4)
  field.writeUInt32BE(value)
  return field
}

function box(type, ...payload) {
  const body = Buffer.concat(payload)
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body])
}

function movie({ date, startMs = night - 3600_000, version = 0, lastModified = 0 } = {}) {
  const header = Buffer.alloc(version === 0 ? 20 : 32)
  const epochSeconds = (startMs - Date.UTC(1904, 0, 1)) / 1000
  header[0] = version
  if (version === 0) {
    header.writeUInt32BE(epochSeconds, 4)
    header.writeUInt32BE(1000, 12)
    header.writeUInt32BE(510_000, 16)
  } else {
    header.writeBigUInt64BE(BigInt(epochSeconds), 4)
    header.writeUInt32BE(1000, 20)
    header.writeBigUInt64BE(510_000n, 24)
  }
  const metadata = date ? [box('meta', u32(0),
    box('keys', u32(0), u32(1), box('mdta', Buffer.from('com.apple.quicktime.creationdate'))),
    box('ilst', box('\x00\x00\x00\x01', box('data', u32(1), u32(0), Buffer.from(date)))),
  )] : []
  return new File([box('mdat', Buffer.alloc(32)), box('moov', box('mvhd', header), ...metadata)], 'recording.mp4', { lastModified })
}

test('reads offset-bearing QuickTime dates before v0/v1 movie-header timestamps', async () => {
  assert.deepEqual(await inspectRecordingTiming(movie({ date: '2026-10-25T19:00:00-07:00' }), now), embedded(0, 510_000))
  for (const version of [0, 1]) {
    assert.deepEqual(await inspectRecordingTiming(movie({ version }), now), {
      startMs: night - 3600_000, durationMs: 510_000, source: 'mvhd', reliability: 'medium',
    })
  }
})

test('ignores invalid, timezone-less and placeholder timestamps and returns weak file evidence separately', async () => {
  const zero = Date.UTC(1904, 0, 1)
  for (const date of ['2026-10-26T02:00:00', '2026-02-30T02:00:00Z', '2030-10-26T02:00:00Z']) {
    assert.equal(await inspectRecordingTiming(movie({ date, startMs: zero }), now), null)
  }
  const malformed = new File(['not a movie'], 'recording.mp4', { lastModified: night })
  assert.deepEqual(await inspectRecordingTiming(malformed, now), {
    startMs: night, durationMs: null, source: 'lastModified', reliability: 'weak',
  })
})
