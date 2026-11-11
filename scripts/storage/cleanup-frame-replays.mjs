/** One bounded trusted-worker run. Schedule outside the browser; never import in src. */
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export async function runReplayCleanup(client, limit = 20) {
  const { data, error } = await client.rpc('claim_frame_replay_cleanup', { p_limit: limit })
  if (error || !Array.isArray(data)) throw new Error('Could not claim replay cleanup.')
  const counts = { claimed: data.length, completed: 0, failed: 0 }
  for (const item of data) {
    // SQL assigns paths; still fail closed before using powerful worker credentials.
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    if (item.bucket !== 'frame-replays' || !new RegExp(`^${uuid}/${uuid}(?:/${uuid})?\\.mp4$`).test(item.storage_path)
      || !new RegExp(`^${uuid}$`).test(item.lease_id)) throw new Error('Invalid replay cleanup lease.')
    let success = false
    try {
      const result = await client.storage.from('frame-replays').remove([item.storage_path])
      success = !result.error
    } catch { /* Leave durable retry work; no metadata is discarded. */ }
    try {
      const ack = await client.rpc('finish_frame_replay_cleanup', {
        p_path: item.storage_path, p_lease: item.lease_id, p_success: success,
      })
      if (ack.error || !success) counts.failed++
      else counts.completed++
    } catch { counts.failed++ } // Lease expiry permits recovery after lost acknowledgment.
  }
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = process.env.SUPABASE_URL
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !secret) throw new Error('Worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    const parsed = new URL(url)
    if (parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) throw new Error('Invalid worker endpoint.')
    const client = createClient(url, secret, { db: { schema: 'app' }, auth: { persistSession: false, autoRefreshToken: false } })
    const result = await runReplayCleanup(client)
    console.log(JSON.stringify(result)) // Counts only; never paths, URLs or credentials.
    if (result.failed) process.exitCode = 1
  } catch {
    console.error('Replay cleanup failed; inspect the durable queue and worker configuration.')
    process.exitCode = 1
  }
}
