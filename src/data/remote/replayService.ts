import { actorAuthorization, getSupabase } from './supabase'
import type { FrameReplay } from './database.types'

export async function listFrameReplays(userId: string, sessionId: string): Promise<FrameReplay[]> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().from('frame_replays')
    .select('frame_id,group_id,session_id,storage_path,created_at').eq('session_id', sessionId)
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error || !data) throw new Error('Replay availability could not be checked.')
  await actorAuthorization(userId)
  return data.filter(row => {
    if (row.session_id !== sessionId) return false
    const base = `${sessionId}/${row.frame_id}`
    return row.storage_path === `${base}.mp4` || (row.storage_path.startsWith(`${base}/`)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/.test(row.storage_path.slice(base.length + 1)))
  })
}

export async function signFrameReplay(userId: string, replay: FrameReplay): Promise<string> {
  await actorAuthorization(userId)
  const { data, error } = await getSupabase().storage.from('frame-replays').createSignedUrl(replay.storage_path, 60)
  if (error || !data?.signedUrl) throw new Error('This replay could not be opened. Please try again.')
  await actorAuthorization(userId)
  return data.signedUrl
}

/** One visible-match batch (paged only for API row limits), under existing replay RLS. */
export async function countPublishedReplays(userId: string, sessionIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(sessionIds)]
  if (!ids.length) return {}
  const authorization = await actorAuthorization(userId)
  const counts: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]))
  let offset = 0
  for (;;) {
    const { data, error, count } = await getSupabase().from('frame_replays')
      .select('frame_id,session_id,storage_path', { count: 'exact' }).in('session_id', ids)
      .range(offset, offset + 499).setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
    if (error || !data || count === null) throw Error('Replay availability could not be checked.')
    for (const row of data) {
      const base = `${row.session_id}/${row.frame_id}`
      if (Object.hasOwn(counts, row.session_id) && (row.storage_path === `${base}.mp4` ||
        row.storage_path.startsWith(`${base}/`) && /^[0-9a-f-]{36}\.mp4$/.test(row.storage_path.slice(base.length + 1)))) counts[row.session_id]++
    }
    offset += data.length
    if (offset >= count) break
    if (!data.length) throw Error('Replay availability could not be checked.')
  }
  await actorAuthorization(userId)
  return counts
}
