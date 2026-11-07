import { actorAuthorization, getSupabase } from './supabase'
import type { Database, SessionState } from './database.types'

type Functions = Database['app']['Functions']
type Mutation = 'start_session' | 'start_frame' | 'complete_frame' | 'correct_frame' | 'finalize_session' | 'set_frame_paused'

export class DatabaseOperationError extends Error {
  readonly code: string
  constructor(error: { message: string; code: string }) {
    super(error.message)
    this.name = 'DatabaseOperationError'
    this.code = error.code
  }
}

function validateState(value: SessionState | null): SessionState {
  // Minimal envelope guard; SQL remains the authority for scoring invariants.
  if (!value || !value.session || typeof value.session.id !== 'string' || !Number.isSafeInteger(value.session.revision)
    || !Array.isArray(value.standings) || !Array.isArray(value.frames) || !Array.isArray(value.participants) || !value.scores) {
    throw new Error('Invalid saved session response; refetch before scoring again.')
  }
  return value
}

/** Caller creates and retains one operation UUID per intent, including retries.
 * No automatic retries or revision rebasing: 40001 requires conflict recovery.
 */
export async function saveScoringCommand<Name extends Mutation>(name: Name, args: Functions[Name]['Args'], expectedUserId?: string) {
  const request = getSupabase().rpc(name, args).retry(false).abortSignal(AbortSignal.timeout(20_000)).returns<SessionState>()
  if (expectedUserId) request.setHeader('Authorization', await actorAuthorization(expectedUserId))
  const { data, error } = await request
  if (error) throw new DatabaseOperationError(error)
  return validateState(data)
}

export async function getSessionState(sessionId: string) {
  const { data, error } = await getSupabase().rpc('get_session_state', { p_session: sessionId })
  if (error) throw new DatabaseOperationError(error)
  return validateState(data)
}

export async function getStandings(groupId: string, seasonId: string | null = null) {
  const { data, error } = await getSupabase().rpc('get_standings', { p_group: groupId, p_season: seasonId })
  if (error) throw new DatabaseOperationError(error)
  return data
}

export async function getSetupOptions(groupId: string) {
  const db = getSupabase()
  const [players, venues, rules, seasons] = await Promise.all([
    db.from('group_players').select('*').eq('group_id', groupId).eq('status', 'active').order('display_name'),
    db.from('venues').select('*').eq('group_id', groupId).order('display_name'),
    db.from('rule_versions').select('*').eq('group_id', groupId).eq('rules_status', 'verified'),
    db.from('seasons').select('*').eq('group_id', groupId).order('name'),
  ])
  for (const result of [players, venues, rules, seasons]) {
    if (result.error) throw new DatabaseOperationError(result.error)
  }
  return { players: players.data ?? [], venues: venues.data ?? [], rules: rules.data ?? [], seasons: seasons.data ?? [] }
}

/** Pair order defines frame side 1/2 and therefore the p1/p2 foul fields. */
export function startSelectedFrame(args: Functions['start_frame']['Args']) {
  return saveScoringCommand('start_frame', args)
}

export async function listSessions(groupId: string) {
  const { data, error } = await getSupabase().from('match_sessions')
    .select('id,group_id,status,venue_id,occurred_on,created_at')
    .eq('group_id', groupId).order('occurred_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(100)
  if (error) throw new DatabaseOperationError(error)
  return data ?? []
}
export async function listGroups() {
  const { data, error } = await getSupabase().from('groups').select('*').order('name')
  if (error) throw new DatabaseOperationError(error)
  return data ?? []
}

/** RLS-filtered display profiles only; no global identity or account-link discovery. */
export async function listPlayerContexts() {
  const { data, error } = await getSupabase().from('group_players')
    .select('group_id,player_id,display_name').eq('status', 'active').order('display_name')
  if (error) throw new DatabaseOperationError(error)
  return data ?? []
}
