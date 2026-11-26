import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { compressedReplayOutputLimit, directReplayUploadLimit } from '../../src/data/replayUploadLimit.mjs'

const source = (await readFile(new URL('../../src/features/replays/videoCompression.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
const prelude = `
const compressedReplayOutputLimit = ${compressedReplayOutputLimit};
const inspectRecording = async () => ({ width: 640, height: 360, rotation: 0 });
const videoSampleTypes = async () => ({video: ['avc1'], audio: []});
`
const { outputText } = ts.transpileModule(prelude + source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { compressVideo, planCompressionBudget } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('Pixel-length plan reserves audio, overhead and observed encoder overshoot', () => {
  const source = { width: 1080, height: 1920, duration: 524.64 }
  const audioBytes = Math.ceil(160_000 * source.duration / 8)
  const plan = planCompressionBudget(source, audioBytes)
  const predicted = plan.videoRate * 2.5 * source.duration / 8 + audioBytes + 4_000_000
  assert.ok(predicted <= 180_000_000 && predicted > 179_999_000)
  assert.equal(plan.videoRate, 1_009_498)
  assert.deepEqual([plan.width, plan.height], [720, 1280])
  assert.ok(planCompressionBudget(source, audioBytes * 2).videoRate < plan.videoRate)
  assert.ok(planCompressionBudget({ ...source, duration: 600 }, audioBytes).videoRate < plan.videoRate)
  assert.equal(planCompressionBudget({ ...source, duration: 5 }, 0).videoRate, 8_000_000)
  assert.throws(() => planCompressionBudget({ ...source, duration: 7200 }, 0), /too long/)
})

test('MediaRecorder accepts 200 MB and stops at one byte over while reporting actual received bytes', async (t) => {
  assert.equal(compressedReplayOutputLimit, 200_000_000)
  assert.equal(directReplayUploadLimit, compressedReplayOutputLimit)
  let extra = 0
  const piece = new Blob([new Uint8Array(1_000_000)])
  class FakeRecorder extends EventTarget {
    state = 'inactive'
    mimeType = 'video/mp4'
    start() {
      this.state = 'recording'
      queueMicrotask(() => {
        for (let i = 0; i < 200; i++) this.dispatchEvent(new MessageEvent('dataavailable', { data: piece }))
        if (extra) this.dispatchEvent(new MessageEvent('dataavailable', { data: new Blob(['x']) }))
        this.stop()
      })
    }
    stop() {
      if (this.state === 'inactive') return
      this.state = 'inactive'
      this.dispatchEvent(new Event('stop'))
    }
  }
  const video = Object.assign(new EventTarget(), {
    readyState: 0, currentTime: 1, cancelVideoFrameCallback() {}, pause() {}, removeAttribute() {}, load() {},
    requestVideoFrameCallback() { return 1 }, async play() {},
  })
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: name => name === 'video' ? video : { getContext: () => ({}), captureStream: () => ({ getTracks: () => [] }) },
  })
  for (const [key, value] of Object.entries({ document, window: { setInterval, clearInterval }, MediaRecorder: FakeRecorder, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }

  let received
  const encode = () => compressVideo(new File(['source'], 'test.mp4'), 1,
    { width: 640, height: 360, videoRate: 1_000_000, audio: false, mime: 'video/mp4' },
    new AbortController().signal, () => {}, bytes => { received = bytes })
  assert.equal((await encode()).blob.size, 200_000_000)
  assert.equal(received, 200_000_000)
  extra = 1
  await assert.rejects(encode(), /200 MB compressed output limit/)
  assert.equal(received, 200_000_001)
})
