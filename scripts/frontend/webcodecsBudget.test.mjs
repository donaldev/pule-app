import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webCodecsVideoRate } from '../../src/features/replays/webcodecsBudget.mjs'

test('Pixel-length CBR target leaves room for copied AAC and MP4 tables', () => {
  const duration = 524.64
  const audioBytes = 12_600_000
  const rate = webCodecsVideoRate(duration, audioBytes)
  const estimatedBytes = rate * duration / 8 + audioBytes + 4_000_000
  assert.ok(estimatedBytes > 174_999_000 && estimatedBytes <= 175_000_000)
  assert.equal(rate, 2_415_370)
  assert.ok(webCodecsVideoRate(duration, audioBytes + 1_000_000) < rate)
})

test('CBR caps short recordings and rejects budgets without usable video bandwidth', () => {
  assert.equal(webCodecsVideoRate(6, 96000), 8_000_000)
  assert.throws(() => webCodecsVideoRate(524.64, 170_000_000), /No usable constant bitrate/)
})
