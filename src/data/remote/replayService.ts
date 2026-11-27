import { actorAuthorization, getSupabase } from './supabase'
import type { FrameReplay, MyReplay, ReplayMatch, ReplayShot, ReplayShotAction } from './database.types'

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

export async function listMyReplays(userId: string): Promise<MyReplay[]> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc('get_my_replays')
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error || !data) throw new Error('Your replays could not be loaded.')
  await actorAuthorization(userId)
  return data
}

export async function signFrameReplay(userId: string, replay: Pick<FrameReplay, 'storage_path'>, filename?: string): Promise<string> {
  await actorAuthorization(userId)
  const { data, error } = await getSupabase().storage.from('frame-replays').createSignedUrl(replay.storage_path, 60, filename ? { download: filename } : undefined)
  if (error || !data?.signedUrl) throw new Error('This replay could not be opened. Please try again.')
  await actorAuthorization(userId)
  return data.signedUrl
}

export async function downloadFrameReplay(userId: string, replay: ReplayMatch & { storage_path: string; frame_number: number }) {
  const venue = replay.venue_name.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Match'
  const date = replay.occurred_on && /^\d{4}-\d{2}-\d{2}$/.test(replay.occurred_on) ? `_${replay.occurred_on}` : ''
  const filename = `Pule_${venue}${date}_Frame${replay.frame_number}.mp4`
  const href = await signFrameReplay(userId, replay, filename)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
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

export async function listReplayShots(userId: string, frameId: string, path: string, signal: AbortSignal): Promise<ReplayShot[]> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc('list_frame_replay_shots', { p_frame: frameId })
    .setHeader('Authorization', authorization).retry(false)
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
  await actorAuthorization(userId)
  if (error?.code === 'PGRST202') return [] // Older deployments may lack the shot index RPC.
  if (error || !Array.isArray(data)) throw Error('Shots could not be loaded.')
  return data.filter(shot => shot.storage_path === path)
}

export async function reviewReplayShot(userId: string, frameId: string, shot: ReplayShot,
  action: ReplayShotAction, bounds?: { start: number; end: number }) {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc('review_frame_replay_shot', {
    p_frame: frameId, p_path: shot.storage_path, p_candidate: shot.candidate_key,
    p_revision: shot.revision, p_action: action,
    ...(bounds && { p_start_ms: bounds.start, p_end_ms: bounds.end }),
  }).setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  await actorAuthorization(userId)
  if (error?.code === '40001' || error?.code === '55000') {
    throw Error('This shot changed since it was opened. Reload shots to get the latest version.')
  }
  if (error?.code === '42501') throw Error('Only eligible frame participants can review shots.')
  if (error || typeof data !== 'number') throw Error('The review change could not be confirmed. Reload shots before trying again.')
  return data
}
