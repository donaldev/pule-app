import type { Intent } from './operationCoordinator'
const scoring=new Set(['start_session','start_frame','complete_frame','correct_frame','finalize_session','set_frame_paused'])
const setup=new Set(['create_group','create_guest','create_guest_with_email','create_venue','adopt_rule_version','resolve_matchup','create_player_invitation','accept_player_invitation','revoke_player_invitation','claim_guest_email','initialize_my_player','remove_match'])
export function validIntent(value:unknown,userId:string):value is Intent {
  if(!value||typeof value!=='object')return false
  const v=value as Partial<Intent>
  if(v.userId!==userId||typeof v.id!=='string'||!v.id||typeof v.name!=='string'||!(v.kind==='scoring'?scoring:v.kind==='setup'?setup:new Set()).has(v.name)||!v.args||typeof v.args!=='object'||Array.isArray(v.args)||v.args.p_operation!==v.id||!['pending','uncertain','conflict','rejected'].includes(v.status??''))return false
  return v.name!=='remove_match'||(typeof v.args.p_session==='string'&&!!v.args.p_session&&Number.isSafeInteger(v.args.p_expected_revision)&&Number(v.args.p_expected_revision)>0&&['abandon','delete'].includes(String(v.args.p_mode)))
}
export function unreadableSnapshot(value:unknown,userId:string) {
  if(value===undefined || validIntent(value,userId))throw new Error('Recovery record changed. Check its saved status instead of resetting it.')
  const snapshot=JSON.stringify(value)
  if(typeof snapshot!=='string')throw new Error('This record cannot be exported safely. Keep browser data and contact support.')
  return snapshot
}
export function confirmUnreadableReset(value:unknown,userId:string,snapshot:string,confirmed:boolean) {
  if(!confirmed || unreadableSnapshot(value,userId)!==snapshot)throw new Error('Recovery record changed or reset was not confirmed. Nothing was cleared.')
}
export class RecoveryStorageError extends Error {
  readonly reason:'malformed'|'unavailable'|'blocked'
  constructor(reason:'malformed'|'unavailable'|'blocked',message:string){super(message);this.reason=reason;this.name='RecoveryStorageError'}
}
