import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordingHandler } from '../../functions/api/recordings.js'
import { recordingR2, PART_BYTES } from '../storage/r2Recording.mjs'
import { runReplayCleanup } from '../storage/cleanup-frame-replays.mjs'

const actor = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', upload = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const session = 'cccccccc-cccc-cccc-cccc-cccccccccccc', frame = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const key = `${session}/${frame}/${upload}.mp4`, hash = 'a'.repeat(64)
const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'private', RECORDING_ALLOWED_ORIGINS: 'https://test.example', R2_ACCOUNT_ID: 'a'.repeat(32), R2_RECORDINGS_BUCKET: 'pule-frame-recordings', R2_ACCESS_KEY_ID: 'example-key', R2_SECRET_ACCESS_KEY: 'example-secret' }
function setup() {
  const calls = []
  const u = { upload_id: upload, session_id: session, frame_id: frame, storage_path: key, source_provider: 'r2', status: 'reserved', expected_bytes: PART_BYTES + 123, source_sha256: hash, multipart_id: 'winner' }
  let stored = null, parts = [], denied = false, invalidUser = false
  const client = (_url, token) => ({
    auth: { getUser: async () => invalidUser ? { error: true, data: {} } : { data: { user: { id: actor } } } },
    rpc: async (name, args) => {
      calls.push({ name, args, token })
      if (denied) return { error: true }
      if (name === 'confirm_r2_frame_recording') { u.status = 'committed'; return { data: { ...u, processing_status: 'uploaded' } } }
      if (name === 'bind_r2_frame_recording') return { data: 'winner' }
      return { data: { ...u } }
    },
  })
  const r2 = {
    head: async () => { calls.push({ r2: 'head' }); return stored },
    create: async () => { calls.push({ r2: 'create' }); return 'loser' },
    abort: async (_key, id) => { calls.push({ r2: 'abort', id }) },
    parts: async () => parts,
    signPart: async (_key, id, number, bytes) => { calls.push({ r2: 'sign', id, number, bytes }); return 'signed-url' },
    complete: async () => { calls.push({ r2: 'complete' }); stored = head() },
  }
  const head = () => ({ bytes: u.expected_bytes, type: 'video/mp4', etag: 'etag', upload, actor, sha256: hash })
  const handler = recordingHandler(client, () => r2)
  const send = (body, origin = 'https://test.example') => handler({ env, request: new Request('https://test.example/api/recordings', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer caller', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  return { calls, u, r2, head, send, setParts: p => { parts = p }, setHead: p => { stored = p }, deny: () => { denied = true }, invalidUser: () => { invalidUser = true } }
}

test('broker rejects untrusted origins, invalid accounts and authorization loss before R2 access', async () => {
  for (const kind of ['origin', 'actor', 'permissions']) {
    const h = setup(); if (kind === 'actor') h.invalidUser(); if (kind === 'permissions') h.deny()
    const r = await h.send({ action: 'state', upload }, kind === 'origin' ? 'https://evil.example' : undefined)
    assert.ok(r.status >= 400); assert.equal(h.calls.filter(x => x.r2).length, 0)
  }
})
test('reservations use actor JWT RPCs, exact byte/hash payload and a 2 GiB limit', async () => {
  const h = setup()
  assert.equal((await h.send({ action: 'reserve', operation: upload, frame, bytes: 1500000000, hash })).status, 200)
  assert.equal(h.calls[0].token, 'public'); assert.equal(h.calls[0].args.p_bytes, 1500000000)
  assert.equal((await h.send({ action: 'reserve', operation: upload, frame, bytes: 2147483649, hash })).status, 400)
})
test('part URLs are restricted to expected part numbers and exact bounded lengths', async () => {
  const h = setup()
  for (const part of [0, 3, 1.5]) assert.equal((await h.send({ action: 'part', upload, part })).status, 400)
  assert.equal((await h.send({ action: 'part', upload, part: 2 })).status, 200)
  assert.deepEqual(h.calls.find(x => x.r2 === 'sign'), { r2: 'sign', id: 'winner', number: 2, bytes: 123 })
})
test('competing multipart creates bind one immutable ID and abort the losing ID', async () => {
  const h = setup(); h.u.multipart_id = null
  assert.equal((await h.send({ action: 'state', upload })).status, 200)
  assert.equal(h.calls.find(x => x.name === 'bind_r2_frame_recording').token, 'private')
  assert.deepEqual(h.calls.find(x => x.r2 === 'abort'), { r2: 'abort', id: 'loser' })
})
test('incomplete, duplicate or oversized parts never register source metadata', async () => {
  for (const parts of [[], [{ number: 1, bytes: PART_BYTES + 1 }], [{ number: 1, bytes: PART_BYTES }, { number: 1, bytes: PART_BYTES }]]) {
    const h = setup(); h.setParts(parts)
    assert.equal((await h.send({ action: 'complete', upload })).status, 409)
    assert.equal(h.calls.some(x => x.name === 'confirm_r2_frame_recording'), false)
  }
})
test('completion verifies durable HEAD before trusted registration and is idempotent', async () => {
  const h = setup(); h.setParts([{ number: 1, bytes: PART_BYTES, etag: 'a' }, { number: 2, bytes: 123, etag: 'b' }])
  const first = await h.send({ action: 'complete', upload }); assert.equal(first.status, 200)
  assert.equal((await first.json()).processing_status, 'uploaded')
  const attest = h.calls.find(x => x.name === 'confirm_r2_frame_recording'); assert.equal(attest.token, 'private'); assert.equal(attest.args.p_actor, actor)
  const second = await h.send({ action: 'complete', upload }); assert.equal((await second.json()).status, 'committed')
  assert.equal(h.calls.filter(x => x.r2 === 'complete').length, 1)
})
test('lost completion acknowledgment recovers existing object without another upload', async () => {
  const h = setup(); h.setHead(h.head())
  assert.equal((await h.send({ action: 'complete', upload })).status, 200)
  assert.equal(h.calls.some(x => x.r2 === 'create' || x.r2 === 'complete'), false)
})
test('wrong size, owner, hash, type or upload identity fails closed', async () => {
  for (const field of ['bytes', 'actor', 'sha256', 'type', 'upload']) {
    const h = setup(); h.setHead({ ...h.head(), [field]: field === 'bytes' ? 1 : 'wrong' })
    assert.equal((await h.send({ action: 'complete', upload })).status, 409)
    assert.equal(h.calls.some(x => x.name === 'confirm_r2_frame_recording'), false)
  }
})
test('real R2 signing binds content length, bucket, key, part, upload and two-minute expiry', async () => {
  const r2 = recordingR2(env, () => { throw Error('No network permitted') })
  const url = new URL(await r2.signPart(key, 'immutable-id', 2, 123))
  assert.equal(url.hostname, env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com')
  assert.equal(url.pathname, '/pule-frame-recordings/' + key)
  assert.equal(url.searchParams.get('uploadId'), 'immutable-id'); assert.equal(url.searchParams.get('partNumber'), '2')
  assert.equal(url.searchParams.get('X-Amz-Expires'), '120'); assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'))
  assert.notEqual(new URL(await r2.signPart(key, 'immutable-id', 2, 124)).searchParams.get('X-Amz-Signature'), url.searchParams.get('X-Amz-Signature'))
  await assert.rejects(r2.signPart('../other', 'id', 1, 123))
  assert.throws(() => recordingR2({ ...env, R2_RECORDINGS_BUCKET: 'public-or-other' }))
})
test('R2 complete is conditional create-only; XML entity responses are rejected', async () => {
  let request
  const r2 = recordingR2(env, async r => { request = r; return new Response('<CompleteMultipartUploadResult><ETag>ok</ETag></CompleteMultipartUploadResult>') })
  await r2.complete(key, 'id', [{ number: 1, etag: '"abc"' }]); assert.equal(request.headers.get('if-none-match'), '*')
  const unsafe = recordingR2(env, async () => new Response('<!DOCTYPE x [<!ENTITY a "bad">]><ListPartsResult/>'))
  await assert.rejects(unsafe.parts(key, 'id'))
})
test('R2 cleanup aborts parts and confirms object absence before acknowledging exact lease', async () => {
  const events = [], lease = { bucket: 'pule-frame-recordings', storage_path: key, lease_id: upload, multipart_id: 'mpu' }
  const client = { rpc: async (name, args) => { events.push(name); if (name === 'claim_frame_replay_cleanup') return { data: [lease] }; assert.equal(args.p_bucket, lease.bucket); return {} } }
  const r2 = { abort: async (k, id) => { assert.equal(k, key); assert.equal(id, 'mpu'); events.push('abort') }, remove: async () => events.push('delete'), head: async () => { events.push('head'); return null } }
  assert.equal((await runReplayCleanup(client, 20, r2)).completed, 1)
  assert.deepEqual(events, ['claim_frame_replay_cleanup', 'head', 'abort', 'delete', 'head', 'finish_frame_replay_cleanup'])
})
test('failed R2 cleanup does not acknowledge removal or touch Supabase replay bytes', async () => {
  const calls = [], client = { rpc: async (name, args) => { if (name === 'claim_frame_replay_cleanup') return { data: [{ bucket: 'pule-frame-recordings', storage_path: key, lease_id: upload }] }; calls.push(args); return {} } }
  const r2 = { remove: async () => {}, head: async () => ({ bytes: 1, upload }) }
  assert.equal((await runReplayCleanup(client, 20, r2)).failed, 1); assert.equal(calls[0].p_success, false)
})

// Exercise the actual browser transport with mocked HTTP only: explicit resume,
// account changes and URL credential boundaries, not a second upload implementation.
import ts from 'typescript'
import { readFile } from 'node:fs/promises'
let browserSource = await readFile(new URL('../../src/data/remote/r2Recording.ts', import.meta.url), 'utf8')
browserSource = browserSource.replace(/^import .*$/gm, '').replaceAll('import.meta.env.VITE_RECORDING_UPLOAD_API_URL', "'https://test.example/api/recordings'")
const prelude = `const actorAuthorization=async()=>{globalThis.browserCalls.auth++;return 'Bearer caller'};const getSupabase=()=>({auth:{onAuthStateChange:fn=>{globalThis.browserCalls.accountChange=fn;return {data:{subscription:{unsubscribe(){}}}}}}});`
const compiled = ts.transpileModule(prelude+browserSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const browser = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const signed = n => `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/pule-frame-recordings/${key}?uploadId=id&partNumber=${n}&X-Amz-Expires=120&X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=example`

test('mobile resume lists stored parts and sends only missing bytes without JWTs to R2', async () => {
 const original=globalThis.fetch;globalThis.browserCalls={auth:0};const puts=[],progress=[]
 const file=new Blob([new Uint8Array(PART_BYTES+123)])
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://test.example')){
   assert.equal(options.headers.Authorization,'Bearer caller');const b=JSON.parse(options.body)
   return Response.json(b.action==='state'?{completed:false,parts:[1],partBytes:PART_BYTES}:{url:signed(2),bytes:123})
  }
  assert.equal(options.headers,undefined);assert.equal(options.body.size,123);puts.push(String(url));return new Response(null,{status:200})
 }
 try{await browser.transferR2Recording(file,actor,{upload_id:upload,storage_path:key},n=>progress.push(n)).start();assert.equal(puts.length,1);assert.equal(progress.at(-1),100)}finally{globalThis.fetch=original}
})
test('mobile part failures never auto-retry and never finalize the reservation', async () => {
 const original=globalThis.fetch;globalThis.browserCalls={auth:0};const actions=[]
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://test.example')){const b=JSON.parse(options.body);actions.push(b.action);return Response.json(b.action==='state'?{completed:false,parts:[],partBytes:PART_BYTES}:{url:signed(1),bytes:123})}
  actions.push('put');return new Response(null,{status:403})
 }
 try{await assert.rejects(browser.transferR2Recording(new Blob([new Uint8Array(123)]),actor,{upload_id:upload,storage_path:key},()=>{}).start(),/interrupted/);assert.deepEqual(actions,['state','part','put'])}finally{globalThis.fetch=original}
})
test('mobile account changes abort active multipart writes', async()=>{
 const original=globalThis.fetch;globalThis.browserCalls={auth:0}
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://test.example')){const b=JSON.parse(options.body);return Response.json(b.action==='state'?{completed:false,parts:[],partBytes:PART_BYTES}:{url:signed(1),bytes:123})}
  return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')));globalThis.browserCalls.accountChange('SIGNED_OUT',null)})
 }
 try{await assert.rejects(browser.transferR2Recording(new Blob([new Uint8Array(123)]),actor,{upload_id:upload,storage_path:key},()=>{}).start(),/interrupted/)}finally{globalThis.fetch=original}
})
