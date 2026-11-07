import { getSupabase } from './supabase'
import { DatabaseOperationError } from './scoringService'
export interface PersonalStats { player_id:string;display_name:string|null;nights:number;wins:number;losses:number;draws:number;frames_won:number;frames_lost:number|null;multiplayer_nights:number;matchups:number;scope:'all_accessible_approved_nights' }
export interface PlayerInvitation {id:string;group_id:string;player_id:string;email:string;expires_at:string;accepted:boolean;revoked:boolean}
export async function tokenHash(token:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
}
export async function newInvitationToken() {
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
  return {token,hash:await tokenHash(token)}
}
export async function getPersonalStats():Promise<PersonalStats|null> {
  const {data,error}=await getSupabase().rpc('get_my_player_stats',{})
  if(error)throw new DatabaseOperationError(error)
  if(data===null)return null
  const s=data as unknown as PersonalStats
  if(!s || typeof s.player_id!=='string' || s.scope!=='all_accessible_approved_nights' || ![s.nights,s.wins,s.losses,s.draws,s.frames_won,s.matchups,s.multiplayer_nights].every(v=>Number.isSafeInteger(v)&&v>=0) || (s.frames_lost!==null && (!Number.isSafeInteger(s.frames_lost)||s.frames_lost<0)))throw new Error('Invalid personal statistics response.')
  return s
}
export async function getMyInvitations():Promise<PlayerInvitation[]> {
  const {data,error}=await getSupabase().rpc('get_my_player_invitations',{})
  if(error)throw new DatabaseOperationError(error)
  if(!Array.isArray(data) || data.some(v=>!v || typeof v!=='object' || Array.isArray(v) || typeof v.id!=='string' || typeof v.group_id!=='string' || typeof v.player_id!=='string' || typeof v.email!=='string' || typeof v.expires_at!=='string' || !Number.isFinite(Date.parse(v.expires_at)) || typeof v.accepted!=='boolean' || typeof v.revoked!=='boolean'))throw new Error('Invalid invitation list.')
  return data as unknown as PlayerInvitation[]
}
export async function previewInvitation(token:string):Promise<{player_name:string;expires_at:string}|null> {
  const {data,error}=await getSupabase().rpc('preview_player_invitation',{p_token:token})
  if(error)throw new DatabaseOperationError(error)
  if(data===null)return null
  if(typeof data!=='object'||Array.isArray(data)||typeof data.player_name!=='string'||typeof data.expires_at!=='string')throw new Error('Invalid invitation.')
  return {player_name:data.player_name,expires_at:data.expires_at}
}
export interface ExistingGuest {player_id:string;display_name:string;group_id:string}
/** Null deliberately covers both missing and inaccessible identities; never a global directory. */
export async function findGuestByEmail(email:string):Promise<ExistingGuest|null> {
  const {data,error}=await getSupabase().rpc('find_guest_by_email',{p_email:email.trim().toLowerCase()})
  if(error)throw new DatabaseOperationError(error)
  if(data===null)return null
  if(typeof data!=='object'||Array.isArray(data)||typeof data.player_id!=='string'||typeof data.display_name!=='string'||typeof data.group_id!=='string')throw new Error('Invalid player lookup.')
  return {player_id:data.player_id,display_name:data.display_name,group_id:data.group_id}
}
export type GuestEmailClaim = {status:'none'|'connected'|'unavailable'|'needs_invitation'} | {status:'eligible';player_id:string;player_name:string;matchup_count:number}
export async function getGuestEmailClaim():Promise<GuestEmailClaim> {
  const {data,error}=await getSupabase().rpc('get_guest_email_claim',{})
  if(error && ['PGRST202','42883'].includes(error.code))return {status:'none'}
  if(error)throw new DatabaseOperationError(error)
  if(!data || typeof data!=='object'||Array.isArray(data))throw new Error('Invalid claim discovery.')
  if(['none','connected','unavailable','needs_invitation'].includes(String(data.status)))return {status:data.status} as GuestEmailClaim
  if(data.status!=='eligible'||typeof data.player_id!=='string'||typeof data.player_name!=='string'||typeof data.matchup_count!=='number'||!Number.isSafeInteger(data.matchup_count)||data.matchup_count<1)throw new Error('Invalid claim candidate.')
  return {status:'eligible',player_id:data.player_id,player_name:data.player_name,matchup_count:data.matchup_count}
}
