import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../../src/features/connected/tonightsFormData.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { calculateTonightsForm } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const players = [
  { player_id: 'donal', display_name: 'Donal' },
  { player_id: 'sean', display_name: 'Sean' },
  { player_id: 'guest', display_name: 'Guest' },
]
const frame = (number, winner, extra = {}) => ({
  id: String(number), frame_number: number, session_id: 'tonight', status: 'completed', origin: 'native',
  winner_id: winner, participants: players.slice(0, 2), ...extra,
})
const form = (frames, roster = players.slice(0, 2)) => calculateTonightsForm('tonight', frames, roster)

test('two-player form uses canonical order and the last five of the same pair and night', () => {
  const result = form([
    frame(7, 'sean'), frame(3, 'sean'), frame(1, 'donal'), frame(2, 'donal'),
    frame(6, 'sean'), frame(5, 'sean'), frame(4, 'donal'),
    frame(8, 'donal', { status: 'running' }), frame(9, 'donal', { status: 'voided' }),
    frame(10, 'donal', { session_id: 'old' }), frame(11, 'guest', { participants: players.slice(1) }),
  ])
  assert.deepEqual(result.recent.map(f => f.number), [3, 4, 5, 6, 7])
  assert.deepEqual(result.players.map(p => p.wins), [1, 4])
  assert.equal(result.leader.name, 'Sean')
  assert.deepEqual(result.streak, { name: 'Sean', wins: 3 })
})

test('draws occupy a recent slot, break streaks and allow neutral form', () => {
  const result = form([frame(1, 'sean'), frame(2, 'donal'), frame(3, null)])
  assert.equal(result.recent.at(-1).result, 'Draw')
  assert.deepEqual(result.players.map(p => p.wins), [1, 1])
  assert.equal(result.leader, null)
  assert.equal(result.streak, null)
  assert.equal(form([frame(1, 'sean'), frame(2, 'sean'), frame(3, null)]).streak, null)
})

test('multiplayer ranks all players, preserves ties and uses names independent of account linking', () => {
  const result = form([frame(1, 'guest'), frame(2, 'sean'), frame(3, 'guest'), frame(4, 'sean'), frame(5, 'donal')], players)
  assert.deepEqual(result.players.map(p => [p.name, p.wins]), [['Sean', 2], ['Guest', 2], ['Donal', 1]])
  assert.equal(result.leader, null)
  assert.equal(result.streak, null)
  assert.equal(form([frame(1, 'guest')], [...players.slice(0, 2), { ...players[2], display_name: '' }]).recent[0].result, 'Unknown player')
})

test('empty or single-frame nights have no streak, and corrected or removed results are recomputed', () => {
  assert.deepEqual(form([]).recent, [])
  assert.equal(form([]).leader, null)
  assert.equal(form([frame(1, 'sean')]).streak, null)
  const results = Array.from({length: 7}, (_, i) => frame(i + 1, 'sean'))
  assert.equal(form(results).streak.wins, 7)
  const correction = [...results.slice(0, -1), frame(7, 'donal')]
  assert.equal(form(correction).streak, null)
  assert.equal(form(correction).recent.at(-1).result, 'Donal')
  assert.equal(form(correction.slice(0, -1)).streak.wins, 6)
})
