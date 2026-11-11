import { createClient } from '@supabase/supabase-js'
import { recordingR2, MAX_SOURCE_BYTES, PART_BYTES, SOURCE_KEY } from '../../scripts/storage/r2Recording.mjs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/

/** Injected adapters allow authorization/failure tests without any live credentials. */
export function recordingHandler(makeClient = createClient, makeR2 = recordingR2) {
  return async ({ request, env }) => {
    const origin = request.headers.get('Origin')
    const allowed = (env.RECORDING_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const cors = { 'Access-Control-Allow-Origin': origin ?? '', 'Vary': 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
    const response = (body, status = 200) => Response.json(body, { status, headers: cors })
    if (!origin || !allowed.includes(origin)) return Response.json({ error: 'Origin denied' }, { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return response({ error: 'Method denied' }, 405)
    try {
      if (!env.SUPABASE_URL?.startsWith('https://') || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Unconfigured broker')
      const authorization = request.headers.get('Authorization')
      if (!authorization?.startsWith('Bearer ') || Number(request.headers.get('Content-Length') ?? 0) > 4096) return response({ error: 'Invalid request' }, 401)
      const reader = request.body?.getReader(); if (!reader) return response({ error: 'Invalid request' }, 400)
      let raw = ''; let bytes = 0
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        bytes += value.length; if (bytes > 4096) { await reader.cancel(); return response({ error: 'Request too large' }, 413) }
        raw += new TextDecoder().decode(value, { stream: true })
      }
      const body = JSON.parse(raw)
      const actor = makeClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { db: { schema: 'app' }, global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { data: user, error } = await actor.auth.getUser(authorization.slice(7))
      if (error || !user.user?.id) return response({ error: 'Sign in again' }, 401)
      const service = makeClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'app' }, auth: { persistSession: false, autoRefreshToken: false } })
      const rpc = async (client, name, args) => {
        const r = await client.rpc(name, args)
        if (r.error) throw Error('Recording authorization or state denied')
        return r.data
      }
      const r2 = makeR2(env)
      if (body.action === 'reserve') {
        if (!UUID.test(body.operation) || !UUID.test(body.frame) || !SHA256.test(body.hash) || !Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > MAX_SOURCE_BYTES) return response({ error: 'Choose one MP4 up to 2 GiB' }, 400)
        return response(await rpc(actor, 'reserve_r2_frame_recording', { p_operation: body.operation, p_frame: body.frame, p_bytes: body.bytes, p_sha256: body.hash }))
      }
      if (!['state', 'part', 'complete'].includes(body.action) || !UUID.test(body.upload)) return response({ error: 'Invalid operation' }, 400)
      let u = await rpc(actor, 'get_r2_frame_recording', { p_upload: body.upload })
      if (u.source_provider !== 'r2' || !SOURCE_KEY.test(u.storage_path) || u.storage_path !== `${u.session_id}/${u.frame_id}/${u.upload_id}.mp4` || u.upload_id !== body.upload || !SHA256.test(u.source_sha256) || !Number.isSafeInteger(u.expected_bytes) || u.expected_bytes < 1 || u.expected_bytes > MAX_SOURCE_BYTES) throw Error('Invalid source identity')
      if (u.status === 'committed') return response(body.action === 'complete' ? u : { status: u, completed: true, parts: [], partBytes: PART_BYTES })
      const head = await r2.head(u.storage_path)
      const verify = h => h && h.bytes === u.expected_bytes && h.type === 'video/mp4' && h.upload === u.upload_id && h.actor === user.user.id && h.sha256 === u.source_sha256 && typeof h.etag === 'string'
      if (head) {
        if (!verify(head)) throw Error('Stored source does not match reservation')
        if (body.action !== 'complete') return response({ status: u, completed: true, parts: [], partBytes: PART_BYTES })
      } else {
        if (!u.multipart_id) {
          const created = await r2.create(u.storage_path, { ...u, actor_id: user.user.id })
          let bound
          try { bound = await rpc(service, 'bind_r2_frame_recording', { p_upload: u.upload_id, p_actor: user.user.id, p_multipart: created }) }
          catch (error) { await r2.abort(u.storage_path, created).catch(() => {}); throw error }
          if (bound !== created) await r2.abort(u.storage_path, created)
          u = { ...u, multipart_id: bound }
        }
        const count = Math.ceil(u.expected_bytes / PART_BYTES)
        const size = n => Math.min(PART_BYTES, u.expected_bytes - (n - 1) * PART_BYTES)
        if (body.action === 'part') {
          if (!Number.isInteger(body.part) || body.part < 1 || body.part > count) return response({ error: 'Invalid part' }, 400)
          return response({ url: await r2.signPart(u.storage_path, u.multipart_id, body.part, size(body.part)), bytes: size(body.part) })
        }
        const parts = await r2.parts(u.storage_path, u.multipart_id)
        const seen = new Set()
        for (const p of parts) {
          if (!Number.isInteger(p.number) || p.number < 1 || p.number > count || p.bytes !== size(p.number) || seen.has(p.number)) throw Error('Part lengths do not match reservation')
          seen.add(p.number)
        }
        if (body.action === 'state') return response({ status: u, completed: false, parts: [...seen], partBytes: PART_BYTES })
        if (parts.length !== count) return response({ error: 'Recording is incomplete. Resume the same file.' }, 409)
        await r2.complete(u.storage_path, u.multipart_id, parts.sort((a, b) => a.number - b.number))
      }
      const verified = await r2.head(u.storage_path)
      if (!verify(verified)) throw Error('Completed object could not be verified')
      const status = await rpc(service, 'confirm_r2_frame_recording', { p_upload: u.upload_id, p_actor: user.user.id, p_bytes: verified.bytes, p_type: verified.type, p_sha256: verified.sha256, p_etag: verified.etag })
      return response(status)
    } catch (error) {
        console.error('Recording API failure', {
          type: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : 'Unknown failure'
        })

        return response({
          error: 'Recording request could not be confirmed. Keep the same file and check status before retrying.'
        }, 409)
      }
  }
}
export const onRequest = recordingHandler()
