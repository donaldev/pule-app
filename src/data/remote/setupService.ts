import { actorAuthorization, getSupabase } from './supabase'
import { DatabaseOperationError } from './scoringService'
import type { Database, SetupResult } from './database.types'

type Functions = Database['app']['Functions']
type SetupCommand = 'initialize_my_player' | 'remove_match' | 'claim_guest_email' | 'create_group' | 'create_guest_with_email' | 'create_guest' | 'create_venue' | 'adopt_rule_version' | 'resolve_matchup' | 'create_player_invitation' | 'accept_player_invitation' | 'revoke_player_invitation'

/** Stable operation IDs belong to the caller; setup retries do not create duplicates. */
export async function saveSetupCommand<Name extends SetupCommand>(name: Name, args: Functions[Name]['Args'], expectedUserId?: string) {
  const request = getSupabase().rpc(name, args).retry(false).abortSignal(AbortSignal.timeout(20_000)).returns<SetupResult>()
  if (expectedUserId) request.setHeader('Authorization', await actorAuthorization(expectedUserId))
  const { data, error } = await request
  if (error) throw new DatabaseOperationError(error)
  if (!data || typeof data.id !== 'string' || typeof data.group_id !== 'string') throw new Error('Invalid setup response.')
  return data
}

export async function getMyMemberships() {
  const { data, error } = await getSupabase().rpc('get_my_memberships', {})
  if (error) throw new DatabaseOperationError(error)
  return data
}

export interface MatchupCatalog { player_id: string | null; matchups: { group_id: string; player_ids: string[] }[] }
/** Missing migration is a read-only capability check, never an attempted write. */
export async function getMyMatchups(): Promise<MatchupCatalog | null> {
  const { data, error } = await getSupabase().rpc('get_my_matchups', {})
  if (error && ['PGRST202','42883'].includes(error.code)) return null
  if (error) throw new DatabaseOperationError(error)
  const value = data as unknown as MatchupCatalog
  if (!value || !Array.isArray(value.matchups) || (value.player_id !== null && typeof value.player_id !== 'string')
    || value.matchups.some(m => typeof m.group_id !== 'string' || !Array.isArray(m.player_ids) || m.player_ids.length < 2 || m.player_ids.some(id => typeof id !== 'string') || new Set(m.player_ids).size !== m.player_ids.length)) throw new Error('Invalid matchup response.')
  return value
}
