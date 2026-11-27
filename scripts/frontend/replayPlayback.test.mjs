import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../../src/features/replays/replayPlayback.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const { createReplayPlayback } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const tick = () => new Promise(resolve => setImmediate(resolve))
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}

class Video extends EventTarget {
  duration = 30
  paused = true
  seeking = false
  error = null
  buffered = { length: 0 }
  positions = []
  loads = []
  position = 0
  get currentTime() { return this.position }
  set currentTime(value) {
    this.position = value
    this.positions.push(value)
    this.seeking = true
    this.emit('seeking')
  }
  set src(url) { this.loads.push(url); this.position = 0; this.seeking = false; this.error = null }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause') } }
  async play() { this.paused = false; this.emit('play') }
  removeAttribute() {}
  load() {}
  emit(event) { this.dispatchEvent(new Event(event)) }
  seeked() { this.seeking = false; this.emit('seeked') }
  interrupt(code) { this.error = { code }; this.pause(); this.emit('error') }
}
async function start(t) {
  const video = new Video()
  const states = []
  let signs = 0
  const controller = createReplayPlayback(video, async () => `signed-${++signs}`, 300_000, state => states.push(state))
  t.after(() => controller.destroy())
  await tick()
  video.emit('loadedmetadata')
  return { video, states, controller }
}

test('paused editor scrubs coalesce, and navigation waits for the current seek', async t => {
  const { video, controller } = await start(t)
  for (let i = 0; i < 80; i++) controller.seek(1000+i*10, undefined, true)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(video.positions, [1.79])
  controller.seek(5000, 6000)
  controller.seek(7000, 8000)
  video.seeked()
  assert.deepEqual(video.positions, [1.79, 7])
  assert.equal(video.paused, false)
  assert.deepEqual(video.loads, ['signed-1'])
})

test('one media recovery restores position and bounded playback, then manual retry remains available', async t => {
  const { video, states, controller } = await start(t)
  controller.seek(9000, 14000)
  video.seeked()
  video.position = 11.2
  video.emit('timeupdate')
  video.interrupt(2)
  await tick()
  video.emit('loadedmetadata')
  assert.equal(video.currentTime, 11.2)
  assert.equal(video.paused, false)
  video.seeked()
  video.position = 14.05
  video.emit('timeupdate')
  assert.equal(video.paused, true)
  assert.equal(video.currentTime, 14)
  video.seeked()
  video.interrupt(3)
  await tick()
  assert.match(states.at(-1).error, /decode/)
  assert.deepEqual(video.loads, ['signed-1', 'signed-2'])
  controller.retry()
  await tick()
  video.emit('loadedmetadata')
  assert.equal(video.currentTime, 14)
  assert.equal(video.paused, true)
})

test('a near-expiry unbuffered seek refreshes once and restores the latest paused target', async t => {
  const { video, controller } = await start(t)
  const clock = Date.now
  Date.now = () => clock() + 290_000
  t.after(() => { Date.now = clock })
  controller.seek(12_000)
  controller.seek(18_000)
  await tick()
  video.emit('loadedmetadata')
  assert.deepEqual(video.loads, ['signed-1', 'signed-2'])
  assert.equal(video.currentTime, 18)
  assert.equal(video.paused, true)
})
