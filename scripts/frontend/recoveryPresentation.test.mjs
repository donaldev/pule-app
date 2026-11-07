import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/connected/recoveryPresentation.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { recoveryPresentation, recoveryVisibleOnRoute, revealRecovery } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
test('known rejection uses plain language and asks for refreshed scores', () => {
  const copy = recoveryPresentation({ status: 'conflict' })
  assert.match(copy.title, /Scores changed/)
  assert.match(copy.explanation, /wasn’t saved/i)
  assert.match(copy.explanation, /Refresh scores/)
})
test('observed timeout copy never claims commit or rejection', () => {
  const copy = recoveryPresentation({ status: 'uncertain' }, 'TimeoutError: signal timed out')
  assert.match(copy.title, /can’t confirm/i)
  assert.match(copy.explanation, /paused to avoid counting twice/)
  assert.match(copy.explanation, /pending action will stay safe/)
  assert.match(copy.explanation, /Refresh to see the latest scores/i)
})
test('restored pending write is also treated as unconfirmed', () => {
  const copy = recoveryPresentation({ status: 'pending' })
  assert.match(copy.title, /can’t confirm/)
  assert.doesNotMatch(copy.title, /rejected/)
})
test('recovery action focuses and reveals the real recovery panel without network or storage', () => {
  const calls = []
  globalThis.document = { getElementById(id) { assert.equal(id, 'operation-recovery'); return { focus: args => calls.push(['focus', args]), scrollIntoView: args => calls.push(['scroll', args]) } } }
  revealRecovery()
  assert.deepEqual(calls.map(c => c[0]), ['focus', 'scroll'])
})

test('match recovery is visible only on its exact match route', () => {
  const intent = { name: 'complete_frame', args: { p_session: 'affected-night' } }
  assert.equal(recoveryVisibleOnRoute(intent, '/session/affected-night'), true)
  for (const route of ['/play', '/matches', '/standings', '/account', '/setup', '/session/another-night']) {
    assert.equal(recoveryVisibleOnRoute(intent, route), false)
  }
})
test('creation recovery stays at setup or Play when no match identity exists yet', () => {
  const intent = { name: 'start_session', args: {} }
  assert.equal(recoveryVisibleOnRoute(intent, '/setup'), true)
  assert.equal(recoveryVisibleOnRoute(intent, '/play'), true)
  assert.equal(recoveryVisibleOnRoute(intent, '/session/unrelated'), false)
})
