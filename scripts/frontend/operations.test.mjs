import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const receiptSource = await readFile(new URL('../../src/data/local/receiptRecovery.ts', import.meta.url), 'utf8')
const receiptCode = ts.transpileModule(receiptSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const receiptUrl = 'data:text/javascript;base64,' + Buffer.from(receiptCode).toString('base64')
const source = (await readFile(new URL('../../src/data/local/operationCoordinator.ts', import.meta.url), 'utf8')).replace("'./receiptRecovery'", JSON.stringify(receiptUrl))
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { OperationCoordinator, classifyFailure } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const policySource = await readFile(new URL('../../src/data/local/journalPolicy.ts', import.meta.url), 'utf8')
const policyCode = ts.transpileModule(policySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { journalMutation } = await import('data:text/javascript;base64,' + Buffer.from(policyCode).toString('base64'))
function memoryStore() {
  const rows = new Map()
  return {
    rows,
    async read(userId) { return structuredClone(rows.get(userId) ?? null) },
    async create(intent) { journalMutation(rows.get(intent.userId), intent, 'add'); rows.set(intent.userId, structuredClone(intent)) },
    async update(intent) { journalMutation(rows.get(intent.userId), intent, 'update'); rows.set(intent.userId, structuredClone(intent)) },
    async remove(intent) { if (journalMutation(rows.get(intent.userId), intent, 'remove') === 'delete') rows.delete(intent.userId) },
  }
}
function intent(id = 'operation-one', userId = 'account-one') {
  return { id, userId, kind: 'scoring', name: 'complete_frame', args: { p_operation: id, p_session: 'synthetic-session', p_expected_revision: 2, p_winner: 'synthetic-player' }, createdAt: '2026-01-01T00:00:00Z', status: 'pending' }
}
test('journal commits before network send and is removed after acknowledgment', async () => {
  const store = memoryStore()
  const queue = new OperationCoordinator(store, async i => { assert.deepEqual(store.rows.get(i.userId), i); return { saved: true } })
  assert.deepEqual(await queue.submit(intent()), { saved: true })
  assert.equal(queue.current, null); assert.equal(store.rows.size, 0)
})
test('storage failure prevents any network write', async () => {
  const store = memoryStore(); store.create = async () => { throw new Error('Quota') }
  let sent = 0
  const queue = new OperationCoordinator(store, async () => { sent++ })
  await assert.rejects(queue.submit(intent()), /Quota/)
  assert.equal(sent, 0); assert.equal(queue.busy, false)
})
test('lost acknowledgment survives refresh and retries identical UUID/payload once', async () => {
  const store = memoryStore(); const receipts = new Map(); let wins = 0; let attempts = 0
  const seen = []
  const sender = async i => {
    attempts++; seen.push(structuredClone(i.args))
    if (!receipts.has(i.id)) { wins++; receipts.set(i.id, { score: wins }) }
    if (attempts === 1) throw new TypeError('Failed to fetch')
    return receipts.get(i.id)
  }
  const first = new OperationCoordinator(store, sender)
  await assert.rejects(first.submit(intent()))
  assert.equal(first.current.status, 'uncertain')
  const reloaded = new OperationCoordinator(store, sender)
  await reloaded.restore('account-one')
  assert.deepEqual(await reloaded.retry('account-one'), { score: 1 })
  assert.equal(wins, 1); assert.deepEqual(seen[0], seen[1]); assert.equal(store.rows.size, 0)
})
test('conflict cannot be rebased or retried as a new operation automatically', async () => {
  const store = memoryStore(); let sends = 0
  const queue = new OperationCoordinator(store, async () => { sends++; throw { code: '40001' } })
  await assert.rejects(queue.submit(intent()))
  assert.equal(queue.current.status, 'conflict')
  await assert.rejects(queue.retry('account-one'), /Review/)
  await assert.rejects(queue.submit(intent('new-id')), /previous/)
  assert.equal(sends, 1)
  await queue.discardRejected(); assert.equal(store.rows.size, 0)
})
test('known SQL validation rejection stays available for explicit review', async () => {
  const queue = new OperationCoordinator(memoryStore(), async () => { throw { code: '23514' } })
  await assert.rejects(queue.submit(intent()))
  assert.equal(queue.current.status, 'rejected')
  await queue.discardRejected(); assert.equal(queue.current, null)
})
test('uncertain intent cannot be discarded', async () => {
  const queue = new OperationCoordinator(memoryStore(), async () => { throw new Error('Disconnected') })
  await assert.rejects(queue.submit(intent()))
  await assert.rejects(queue.discardRejected(), /Uncertain/)
  assert.equal(queue.current.id, 'operation-one')
})
test('same coordinator prevents rapid overlapping submissions', async () => {
  let release; let sends = 0
  const queue = new OperationCoordinator(memoryStore(), async () => { sends++; await new Promise(r => { release = r }); return {} })
  const first = queue.submit(intent())
  await assert.rejects(queue.submit(intent('second')), /previous/)
  await new Promise(r => setImmediate(r)); release(); await first
  assert.equal(sends, 1)
})
test('separate coordinators cannot overwrite a committed unresolved journal', async () => {
  const store = memoryStore(); let sends = 0
  const a = new OperationCoordinator(store, async () => { sends++; throw new Error('Lost response') })
  const b = new OperationCoordinator(store, async () => { sends++; return {} })
  await assert.rejects(a.submit(intent()))
  await assert.rejects(b.submit(intent('different-id')), /Another tab/)
  assert.equal(sends, 1); assert.equal(store.rows.get('account-one').id, 'operation-one')
})
test('different account cannot retry another account intent', async () => {
  const store = memoryStore(); let sends = 0
  const queue = new OperationCoordinator(store, async () => { sends++; throw new Error('Network') })
  await assert.rejects(queue.submit(intent()))
  await assert.rejects(queue.retry('account-two'), /account/)
  assert.equal(sends, 1)
  const other = new OperationCoordinator(store, async () => {})
  assert.equal(await other.restore('account-two'), null)
})
test('cleanup failure after server acknowledgment remains safely retryable', async () => {
  const store = memoryStore(); const original = store.remove; let calls = 0
  store.remove = async i => { if (++calls === 1) throw { code: '42501', message: 'Storage blocked' }; await original(i) }
  const receipt = { serverSaved: true }; const ids = []
  const queue = new OperationCoordinator(store, async i => { ids.push(i.id); return receipt })
  await assert.rejects(queue.submit(intent()))
  assert.equal(queue.current.status, 'uncertain')
  assert.deepEqual(await queue.retry('account-one'), receipt)
  assert.deepEqual(ids, ['operation-one', 'operation-one'])
})
test('failure to checkpoint uncertainty still preserves original committed intent', async () => {
  const store = memoryStore(); store.update = async () => { throw new Error('Quota') }
  const queue = new OperationCoordinator(store, async () => { throw new Error('Network') })
  await assert.rejects(queue.submit(intent()))
  assert.equal(store.rows.get('account-one').args.p_operation, 'operation-one')
  assert.equal(store.rows.get('account-one').status, 'pending')
})
test('auth/API/network errors remain uncertain; proven SQL failures are rejected', () => {
  for (const e of [{ code: 'PGRST301' }, { code: '500' }, { code: 23 }, { code: '23' }, new TypeError('fetch')]) assert.equal(classifyFailure(e), 'uncertain')
  for (const code of ['22023', '23514', '42501', '55000']) assert.equal(classifyFailure({ code }), 'rejected')
})

test('a denied retry cannot erase an earlier possibly committed write', async () => {
  const store = memoryStore(); let attempts = 0
  const queue = new OperationCoordinator(store, async () => { if (++attempts === 1) throw new TypeError('Lost acknowledgment'); throw { code: '42501' } })
  await assert.rejects(queue.submit(intent()))
  await assert.rejects(queue.retry('account-one'))
  assert.equal(queue.current.status, 'uncertain')
  await assert.rejects(queue.discardRejected(), /Uncertain/)
  assert.equal(store.rows.get('account-one').id, 'operation-one')
})
test('refresh-restored in-flight intent stays uncertain even if retry is rejected', async () => {
  const store = memoryStore(); await store.create(intent())
  const queue = new OperationCoordinator(store, async () => { throw { code: '40001' } })
  await queue.restore('account-one')
  await assert.rejects(queue.retry('account-one'))
  assert.equal(queue.current.status, 'uncertain')
  assert.equal(queue.current.args.p_expected_revision, 2)
})

test('receipt acknowledgment resolves a stale tab when another tab already removed the journal', async () => {
  const store = memoryStore(); let release; let attempts = 0; let awards = 0
  const sender = async () => { if (++attempts === 1) { awards++; await new Promise(r => { release = r }) }; return { saved: true, score: awards } }
  const a = new OperationCoordinator(store, sender)
  const b = new OperationCoordinator(store, sender)
  const first = a.submit(intent())
  await new Promise(r => setImmediate(r))
  await b.restore('account-one')
  release(); await first
  assert.equal(store.rows.size, 0)
  assert.equal(b.current.id, 'operation-one')
  assert.deepEqual(await b.retry('account-one'), { saved: true, score: 1 })
  assert.equal(b.current, null); assert.equal(store.rows.size, 0); assert.equal(awards, 1)
})
test('two tabs acknowledging the same restored request can clean up idempotently', async () => {
  const store = memoryStore(); await store.create(intent())
  const a = new OperationCoordinator(store, async () => ({ saved: true }))
  const b = new OperationCoordinator(store, async () => ({ saved: true }))
  await a.restore('account-one'); await b.restore('account-one')
  const replies = await Promise.all([a.retry('account-one'), b.retry('account-one')])
  assert.deepEqual(replies, [{ saved: true }, { saved: true }])
  assert.equal(a.current, null); assert.equal(b.current, null); assert.equal(store.rows.size, 0)
})
test('acknowledging an old receipt never deletes a different newer operation', async () => {
  const store = memoryStore(); await store.create(intent())
  const queue = new OperationCoordinator(store, async () => {
    store.rows.set('account-one', intent('newer-operation'))
    return { saved: true }
  })
  await queue.restore('account-one')
  await assert.rejects(queue.retry('account-one'), /another operation/)
  assert.equal(store.rows.get('account-one').id, 'newer-operation')
  assert.equal(queue.current.id, 'operation-one')
  assert.equal(queue.current.status, 'uncertain')
})
test('missing journal is not permission to erase or reclassify a timeout intent', async () => {
  const store = memoryStore()
  const queue = new OperationCoordinator(store, async () => { throw { code: '23', message: 'TimeoutError: signal timed out' } })
  await assert.rejects(queue.submit(intent()))
  assert.equal(queue.current.status, 'uncertain')
  assert.equal(queue.current.args.p_operation, 'operation-one')
  await assert.rejects(queue.discardRejected(), /Uncertain/)
})

const { expectedCommand, receiptMatches } = await import(receiptUrl)
function recoveryIntent() {
  return { ...intent(), status: 'uncertain', args: { ...intent().args, p_frame: 'synthetic-frame', p_p1_fouls: 0, p_p2_fouls: 1, p_potted_on_break: false, p_special: 'regular' } }
}
function receipt(i = recoveryIntent()) {
  return { status: 'confirmed_committed', operation_id: i.id, actor_id: i.userId, group_id: 'synthetic-group',
    command: expectedCommand(i), saved: { kind: 'scoring', session_id: i.args.p_session, revision: 3 }, committed_at: '2026-01-01T00:00:01Z' }
}
async function restoredCheck(sender = async () => { throw new Error('Mutation must never be called') }) {
  const store = memoryStore(); const i = recoveryIntent(); await store.create(i)
  const queue = new OperationCoordinator(store, sender); await queue.restore(i.userId)
  return { store, i, queue }
}
test('negative read-only lookup leaves UUID payload status and revision exactly unchanged', async () => {
  const { store, i, queue } = await restoredCheck()
  const before = structuredClone(store.rows.get(i.userId))
  const out = await queue.checkSaved(i.userId, async () => ({ status: 'not_confirmed' }), async () => assert.fail('must not reconcile'))
  assert.equal(out.status, 'not_confirmed'); assert.deepEqual(store.rows.get(i.userId), before); assert.deepEqual(queue.current, before)
  assert.equal(queue.busy, false)
})
test('lookup timeout/failure does not resend or rewrite the original intent', async () => {
  const { store, i, queue } = await restoredCheck()
  const out = await queue.checkSaved(i.userId, async () => { throw new Error('TimeoutError') }, async () => assert.fail('must not reconcile'))
  assert.equal(out.status, 'lookup_failed'); assert.deepEqual(store.rows.get(i.userId), i); assert.deepEqual(queue.current, i)
})
test('matching receipt reconciles current saved state before journal cleanup', async () => {
  const { store, i, queue } = await restoredCheck()
  let reconciled = false
  const remove = store.remove
  store.remove = async op => { assert.equal(reconciled, true); await remove(op) }
  const current = { session: { id: i.args.p_session, revision: 9 } }
  const out = await queue.checkSaved(i.userId, async id => { assert.equal(id, i.id); return receipt(i) }, async () => { reconciled = true; return current })
  assert.equal(out.status, 'confirmed_committed'); assert.deepEqual(out.result, current); assert.equal(store.rows.size, 0); assert.equal(queue.current, null)
})
test('receipt with mismatched command field is never acknowledged', async () => {
  const { store, i, queue } = await restoredCheck(); const mismatch = receipt(i)
  mismatch.command.data.p2_fouls = 99
  const out = await queue.checkSaved(i.userId, async () => mismatch, async () => assert.fail('must not reconcile'))
  assert.equal(out.status, 'context_mismatch'); assert.deepEqual(store.rows.get(i.userId), i)
})
test('wrong actor operation session group or saved revision cannot acknowledge intent', async () => {
  for (const mutate of [r => { r.actor_id = 'other-account' }, r => { r.operation_id = 'other-operation' }, r => { r.saved.session_id = 'other-session' }, r => { r.saved.revision = 2 }, r => { r.saved.revision = 4 }]) {
    const { store, i, queue } = await restoredCheck(); const wrong = receipt(i); mutate(wrong)
    const out = await queue.checkSaved(i.userId, async () => wrong, async () => assert.fail('must not reconcile'))
    assert.equal(out.status, 'context_mismatch'); assert.deepEqual(store.rows.get(i.userId), i)
  }
})
test('failure to load authorized current state preserves original after confirmed receipt', async () => {
  const { store, i, queue } = await restoredCheck()
  const out = await queue.checkSaved(i.userId, async () => receipt(i), async () => { throw new Error('membership revoked or network failed') })
  assert.equal(out.status, 'reconciliation_failed'); assert.deepEqual(queue.current, i); assert.deepEqual(store.rows.get(i.userId), i)
})
test('cleanup failure keeps recovery data and allows another read-only check', async () => {
  const { store, i, queue } = await restoredCheck(); const remove = store.remove; let cleanup = 0
  store.remove = async op => { if (++cleanup === 1) throw new Error('Storage failure'); await remove(op) }
  const first = await queue.checkSaved(i.userId, async () => receipt(i), async () => ({ fresh: true }))
  assert.equal(first.status, 'cleanup_failed'); assert.deepEqual(store.rows.get(i.userId), i); assert.deepEqual(queue.current, i)
  const second = await queue.checkSaved(i.userId, async () => receipt(i), async () => ({ fresh: true }))
  assert.equal(second.status, 'confirmed_committed')
})
test('two tabs checking the same receipt acknowledge safely with no mutation replay', async () => {
  const { store, i, queue: a } = await restoredCheck()
  const b = new OperationCoordinator(store, async () => assert.fail('must not send')); await b.restore(i.userId)
  const results = await Promise.all([a.checkSaved(i.userId, async () => receipt(i), async () => ({})), b.checkSaved(i.userId, async () => receipt(i), async () => ({}))])
  assert.ok(results.every(r => r.status === 'confirmed_committed')); assert.equal(store.rows.size, 0)
})
test('newer intent appearing during receipt reconciliation is not deleted', async () => {
  const { store, i, queue } = await restoredCheck(); const newer = intent('newer-operation')
  const out = await queue.checkSaved(i.userId, async () => receipt(i), async () => { store.rows.set(i.userId, structuredClone(newer)); return {} })
  assert.equal(out.status, 'cleanup_failed'); assert.deepEqual(store.rows.get(i.userId), newer); assert.deepEqual(queue.current, i)
})
test('another account cannot initiate lookup of the loaded original intent', async () => {
  const { store, i, queue } = await restoredCheck()
  const out = await queue.checkSaved('other-account', async () => assert.fail('must not lookup'), async () => assert.fail('must not reconcile'))
  assert.equal(out.status, 'lookup_failed'); assert.deepEqual(store.rows.get(i.userId), i)
})
test('matchup resolution uses the existing retained intent and exact receipt comparison', async () => {
  const store=memoryStore()
  const i={id:'matchup-operation',userId:'account-one',kind:'setup',name:'resolve_matchup',status:'uncertain',createdAt:'2026-11-04T00:00:00Z',args:{p_operation:'matchup-operation',p_players:['player-b','player-a'],p_timezone:'UTC'}}
  await store.create(i)
  const queue=new OperationCoordinator(store,async()=>assert.fail('read-only check must not resend'))
  await queue.restore(i.userId)
  const {expectedCommand}=await import(receiptUrl)
  const evidence={status:'confirmed_committed',operation_id:i.id,actor_id:i.userId,group_id:'matchup-group',committed_at:'2026-11-04T00:00:00Z',command:expectedCommand(i),saved:{kind:'setup',entity_id:'matchup-group'}}
  const wrong=structuredClone(evidence);wrong.command.data.players.reverse()
  assert.equal((await queue.checkSaved(i.userId,async()=>wrong,async()=>assert.fail('wrong payload'))).status,'context_mismatch')
  assert.deepEqual(store.rows.get(i.userId),i)
  const out=await queue.checkSaved(i.userId,async()=>evidence,async()=>({id:'matchup-group',group_id:'matchup-group',matchup:true,player_ids:['player-a','player-b']}))
  assert.equal(out.status,'confirmed_committed');assert.equal(store.rows.size,0)
})

test('match removal receipts bind exact match, revision and destructive action',async()=>{
 const original={id:'remove-op',userId:'account-one',kind:'setup',name:'remove_match',args:{p_operation:'remove-op',p_session:'night-one',p_expected_revision:7,p_mode:'abandon'},createdAt:'2026-01-01T00:00:00Z',status:'uncertain'}
 const command=expectedCommand(original)
 assert.deepEqual(command,{action:'remove_match',group_id:null,data:{session_id:'night-one',expected_revision:7,mode:'abandon'}})
 const saved={status:'confirmed_committed',operation_id:'remove-op',actor_id:'account-one',group_id:'group-one',command,committed_at:'2026-01-01',saved:{kind:'setup',entity_id:'night-one'}}
 assert.equal(receiptMatches(original,saved),true)
 assert.equal(receiptMatches(original,{...saved,command:{...command,data:{...command.data,mode:'delete'}}}),false)
})

test('correction receipts bind new dependent values while legacy payloads stay unchanged',()=>{
 const old={id:'correction',userId:'user',kind:'scoring',name:'correct_frame',args:{p_operation:'correction',p_session:'night',p_expected_revision:3,p_frame:'first',p_winner:'a',p_p1_fouls:0,p_p2_fouls:0,p_reason:'Edited saved frame'}}
 assert.equal('correction_details' in expectedCommand(old).data,false)
 const next=structuredClone(old);next.args.p_details={special_event:'golden_break',potted_on_break:true,offender_id:null}
 const command=expectedCommand(next);assert.deepEqual(command.data.correction_details,next.args.p_details)
 const receipt={status:'confirmed_committed',operation_id:'correction',actor_id:'user',group_id:'group',command,committed_at:'2026-11-05',saved:{kind:'scoring',session_id:'night',revision:4}}
 assert.equal(receiptMatches(next,receipt),true);assert.equal(receiptMatches(old,receipt),false)
 const altered=structuredClone(receipt);altered.command.data.correction_details.potted_on_break=false;assert.equal(receiptMatches(next,altered),false)
})
