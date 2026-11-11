import { actorAuthorization, getSupabase } from './supabase'
import type { FrameReplay } from './database.types'

export async function listFrameReplays(userId: string, sessionId: string): Promise<FrameReplay[]> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().from('frame_replays')
    .select('frame_id,group_id,session_id,storage_path,created_at').eq('session_id', sessionId)
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error || !data) throw new Error('Replay availability could not be checked.')
  await actorAuthorization(userId)
  return data.filter(row => row.session_id === sessionId && row.storage_path === `${sessionId}/${row.frame_id}.mp4`)
}

export async function signFrameReplay(userId: string, replay: FrameReplay): Promise<string> {
  await actorAuthorization(userId)
  const { data, error } = await getSupabase().storage.from('frame-replays').createSignedUrl(replay.storage_path, 60)
  if (error || !data?.signedUrl) throw new Error('This replay could not be opened. Please try again.')
  await actorAuthorization(userId)
  return data.signedUrl
}
