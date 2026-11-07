import type { Intent } from './operationCoordinator'
export type ReceiptLookup = { status: 'not_confirmed' } | {
  status: 'confirmed_committed'; operation_id: string; actor_id: string; group_id: string
  command: Record<string, unknown>; committed_at: string
  saved: { kind: 'scoring'; session_id: string; revision: number } | { kind: 'setup'; entity_id: string }
}
export type LookupOutcome = { status: 'confirmed_committed'; result: unknown }
  | { status: 'not_confirmed' | 'lookup_failed' | 'context_mismatch' | 'reconciliation_failed' | 'cleanup_failed'; message: string }
export function expectedCommand(intent: Intent): Record<string, unknown> {
  const a = intent.args
  let data: Record<string, unknown>
  if (intent.kind === 'setup') {
    switch (intent.name) {
      case 'create_group': data = { name: a.p_name, timezone: a.p_timezone }; break
      case 'remove_match': data={session_id:a.p_session,expected_revision:a.p_expected_revision,mode:a.p_mode}; break
      case 'claim_guest_email': data={player_id:a.p_player}; break
      case 'create_guest_with_email': data = {name:a.p_name,email:String(a.p_email).trim().toLowerCase()}; break
      case 'create_guest': case 'create_venue': data = { name: a.p_name }; break
      case 'create_player_invitation': data = { player_id:a.p_player,email:a.p_email,token_hash:a.p_token_hash }; break
      case 'accept_player_invitation': data = { token_hash:a.p_token_hash }; break
      case 'revoke_player_invitation': data = { invitation_id:a.p_invitation }; break
      case 'resolve_matchup': data = { players: a.p_players, timezone: a.p_timezone }; break
      case 'adopt_rule_version': data = { name: a.p_label, confirmed: a.p_confirm_review }; break
      default: throw new Error('Unsupported command context.')
    }
    return { action: intent.name==='create_guest_with_email'?'create_guest':intent.name, group_id: ['remove_match','claim_guest_email','create_group','resolve_matchup','accept_player_invitation','revoke_player_invitation'].includes(intent.name) ? null : a.p_group, data }
  }
  switch (intent.name) {
    case 'start_session': data = { group_id: a.p_group, venue_id: a.p_venue, rule_version_id: a.p_rule_version, players: a.p_players, breaker_id: a.p_breaker, season_id: a.p_season ?? null }; break
    case 'start_frame': data = { players: a.p_players, breaker_id: a.p_breaker }; break
    case 'complete_frame': data = { frame_id: a.p_frame, winner_id: a.p_winner, p1_fouls: a.p_p1_fouls, p2_fouls: a.p_p2_fouls, potted_on_break: a.p_potted_on_break, special_event: a.p_special, black_pocket_code: a.p_pocket ?? null, offender_id: a.p_offender ?? null }; break
    case 'correct_frame': data = { frame_id: a.p_frame, winner_id: a.p_winner, p1_fouls: a.p_p1_fouls, p2_fouls: a.p_p2_fouls, reason: a.p_reason, ...(a.p_details == null ? {} : { correction_details: a.p_details }) }; break
    case 'set_frame_paused': data = { frame_id: a.p_frame, paused: a.p_paused }; break
    case 'finalize_session': data = {}; break
    default: throw new Error('Unsupported command context.')
  }
  return { action: intent.name, session_id: intent.name === 'start_session' ? null : a.p_session,
    expected_revision: intent.name === 'start_session' ? null : a.p_expected_revision, data }
}
function canonical(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new Error('Incomplete context.')
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid context number.')
  return JSON.stringify(value)
}
export function receiptMatches(intent: Intent, receipt: ReceiptLookup): boolean {
  if (receipt.status !== 'confirmed_committed' || receipt.operation_id !== intent.id || intent.args.p_operation !== intent.id
    || receipt.actor_id !== intent.userId || typeof receipt.group_id !== 'string' || !receipt.group_id || !receipt.committed_at) return false
  try {
    if (canonical(expectedCommand(intent)) !== canonical(receipt.command)) return false
    if (intent.args.p_group && intent.args.p_group !== receipt.group_id) return false
    if (intent.kind === 'scoring') {
      return receipt.saved.kind === 'scoring' && !!receipt.saved.session_id && Number.isSafeInteger(receipt.saved.revision) && receipt.saved.revision > 0
        && (intent.name === 'start_session' ? receipt.saved.revision === 1
          : receipt.saved.session_id === intent.args.p_session && typeof intent.args.p_expected_revision === 'number'
            && Number.isSafeInteger(intent.args.p_expected_revision) && receipt.saved.revision === intent.args.p_expected_revision + 1)
    }
    return receipt.saved.kind === 'setup' && !!receipt.saved.entity_id
      && (intent.name !== 'create_group' || receipt.saved.entity_id === receipt.group_id)
  } catch { return false }
}
