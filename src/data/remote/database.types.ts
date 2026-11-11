/** Hand-maintained migration contract. Regenerate from local Supabase before UI wiring. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type UUID = string
export type SessionRoster = [UUID, UUID, ...UUID[]]
export type FramePair = [UUID, UUID]
export type SpecialEvent = 'regular' | 'golden_break' | 'break_and_run' | 'dry_clearance' | 'super_foul'
export type Pocket = 'TL' | 'TM' | 'TR' | 'BL' | 'BM' | 'BR'
export interface SessionRow {
  id: UUID; group_id: UUID; venue_id: UUID; season_id: UUID | null; rule_version_id: UUID
  status: 'active' | 'finalized' | 'abandoned'; origin: 'native' | 'imported'
  record_kind: 'frame_log' | 'result_only'
  result_authority: 'native_frames' | 'approved_historical_reported'
  result_quality: 'approved' | 'disputed' | 'unknown'
  sequence_quality: 'reconciled' | 'partial' | 'disputed' | 'not_recorded'; detail_eligible: boolean
  occurred_on: string | null; occurred_at: string | null; timezone_snapshot: string | null
  date_precision: 'instant' | 'date_only' | 'unknown'; started_at: string | null; finalized_at: string | null
  revision: number; import_batch_id: UUID | null; legacy_match_id: string | null
  created_at: string; initial_breaker_id: UUID | null
}
export interface FrameReplay { frame_id: UUID; group_id: UUID; session_id: UUID; storage_path: string; created_at: string }
export interface FrameParticipant { player_id: UUID; side: 1 | 2; foul_count: number | null }
export interface SavedFrame {
  id: UUID; group_id: UUID; session_id: UUID; frame_number: number
  status: 'running' | 'paused' | 'completed' | 'voided'; origin: 'native' | 'imported'
  winner_id: UUID | null; breaker_id: UUID | null; offender_id: UUID | null
  potted_on_break: boolean | null; black_pocket_code: Pocket | null; special_event: SpecialEvent | null
  elapsed_ms: number | null; running_since: string | null; started_at: string | null; completed_at: string | null
  duration_quality: 'server_measured' | 'imported_unverified' | 'unknown'
  detail_eligible: boolean; quality_flags: Json; revision: number; source_record_id: UUID | null
  participants: FrameParticipant[]
}
export interface SessionState {
  session: SessionRow
  participants: { player_id: UUID; side: number; display_name: string }[]
  standings: SessionStanding[]
  scores: Record<UUID, number | null>
  frames: SavedFrame[]
  corrections: { revision: number; reason: string; committed_at: string }[]
}
export interface SessionStanding { player_id: UUID; frames_won: number; frames_lost: number | null; frames_played: number | null; rank: number | null }
export interface SetupResult { removed?: boolean; mode?: string; invitation_id?: UUID; expires_at?: string; matchup?: boolean; player_ids?: UUID[]; created?: boolean; id: UUID; group_id: UUID; name?: string; display_name?: string; role?: string; ownership_state?: string; label?: string; validation_version?: number; breaker_policy?: string }
export interface Standing { player_id: UUID; display_name: string; nights: number; wins: number; losses: number; draws: number; frames_won: number; frames_lost: number | null; frames_played: number | null; two_player_nights: number; multiplayer_nights: number; unknown_loss_nights: number }
type ReadTable<Row> = { Row: { [Key in keyof Row]: Row[Key] }; Insert: never; Update: never; Relationships: [] }
type Command<Extra> = { p_operation: UUID; p_session: UUID; p_expected_revision: number } & Extra
export interface Database {
  app: {
    Tables: {
      frame_replays: ReadTable<FrameReplay>
      match_sessions: ReadTable<SessionRow>
      groups: ReadTable<{ id: UUID; name: string; timezone: string; status: 'active' | 'archived'; created_at: string }>
      group_players: ReadTable<{ group_id: UUID; player_id: UUID; display_name: string; status: 'active' | 'archived' }>
      venues: ReadTable<{ id: UUID; group_id: UUID; display_name: string }>
      seasons: ReadTable<{ id: UUID; group_id: UUID; name: string; starts_on: string | null; ends_before: string | null; assignment_mode: 'date_range' | 'manual_legacy' }>
      rule_versions: ReadTable<{ id: UUID; group_id: UUID; label: string; rules_status: 'verified' | 'legacy_unknown'; breaker_policy: 'explicit_per_frame'; validation_version: number }>
    }
    Views: Record<string, never>
    Functions: {
      create_player_invitation: { Args: {p_operation:UUID;p_group:UUID;p_player:UUID;p_email:string;p_token_hash:string};Returns:SetupResult }
      accept_player_invitation: { Args: {p_operation:UUID;p_token:string;p_token_hash:string};Returns:SetupResult }
      revoke_player_invitation: { Args: {p_operation:UUID;p_invitation:UUID};Returns:SetupResult }
      preview_player_invitation: { Args: {p_token:string};Returns:Json }
      get_my_player_invitations: { Args: Record<never,never>;Returns:Json }
      get_my_player_stats: { Args: Record<never,never>;Returns:Json }
      get_my_matchups: { Args: Record<never, never>; Returns: Json }
      resolve_matchup: { Args: { p_operation: UUID; p_players: UUID[]; p_timezone: string }; Returns: SetupResult }
      lookup_operation_receipt: { Args: { p_operation: UUID }; Returns: Json }
      create_group: { Args: { p_operation: UUID; p_name: string; p_timezone: string }; Returns: SetupResult }
      remove_match: {Args:{p_operation:UUID;p_session:UUID;p_expected_revision:number;p_mode:'abandon'|'delete'};Returns:SetupResult}
      get_match_removal: {Args:{p_session:UUID};Returns:SetupResult}
      get_my_player_initialization: {Args:Record<never,never>;Returns:Json}
      initialize_my_player: {Args:{p_operation:UUID;p_name?:string|null};Returns:SetupResult}
      get_my_frame_summary: {Args:{p_opponent?:UUID|null};Returns:Json}
      get_my_performance: {Args:Record<never,never>;Returns:Json}
      get_guest_email_claim: {Args:Record<never,never>;Returns:Json}
      claim_guest_email: {Args:{p_operation:UUID;p_player:UUID};Returns:SetupResult}
      find_guest_by_email: {Args:{p_email:string};Returns:Json}
      create_guest_with_email: {Args:{p_operation:UUID;p_group:UUID;p_name:string;p_email:string};Returns:SetupResult}
      create_guest: { Args: { p_operation: UUID; p_group: UUID; p_name: string }; Returns: SetupResult }
      create_venue: { Args: { p_operation: UUID; p_group: UUID; p_name: string }; Returns: SetupResult }
      adopt_rule_version: { Args: { p_operation: UUID; p_group: UUID; p_label: string; p_confirm_review: boolean }; Returns: SetupResult }
      get_my_memberships: { Args: Record<never, never>; Returns: { group_id: UUID; role: 'viewer' | 'scorer' | 'admin' | 'owner' }[] }
      start_session: { Args: { p_operation: UUID; p_group: UUID; p_venue: UUID; p_rule_version: UUID; p_players: SessionRoster; p_breaker: UUID; p_season?: UUID | null }; Returns: SessionState }
      start_frame: { Args: Command<{ p_players: FramePair; p_breaker: UUID }>; Returns: SessionState }
      complete_frame: { Args: Command<{ p_frame: UUID; p_winner: UUID; p_p1_fouls: number; p_p2_fouls: number; p_potted_on_break: boolean; p_special: SpecialEvent; p_pocket?: Pocket | null; p_offender?: UUID | null }>; Returns: SessionState }
      correct_frame: { Args: Command<{ p_frame: UUID; p_winner: UUID; p_p1_fouls: number; p_p2_fouls: number; p_reason: string; p_details?: { special_event: SpecialEvent; potted_on_break: boolean; offender_id: UUID | null } | null }>; Returns: SessionState }
      finalize_session: { Args: Command<Record<never, never>>; Returns: SessionState }
      set_frame_paused: { Args: Command<{ p_frame: UUID; p_paused: boolean }>; Returns: SessionState }
      get_session_state: { Args: { p_session: UUID }; Returns: SessionState }
      get_standings: { Args: { p_group: UUID; p_season?: UUID | null }; Returns: Standing[] }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
