import { getMyInvitations, tokenHash } from './identityService'
import { getMyMatchups } from './setupService'
import { actorAuthorization, getSupabase } from './supabase'
import { DatabaseOperationError, getSessionState, getSetupOptions, listGroups } from './scoringService'
import type { ReceiptLookup } from '../local/receiptRecovery'
import type { Intent } from '../local/operationCoordinator'

export async function lookupOperationReceipt(operationId: string, userId: string): Promise<ReceiptLookup> {
  const authorization = await actorAuthorization(userId)
  const { data, error } = await getSupabase().rpc('lookup_operation_receipt', { p_operation: operationId })
    .setHeader('Authorization', authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
  if (error) throw new DatabaseOperationError(error)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid receipt lookup response.')
  if (data.status === 'not_confirmed') return { status: 'not_confirmed' }
  if (data.status !== 'confirmed_committed' || !data.saved || typeof data.saved !== 'object' || Array.isArray(data.saved)
    || !data.command || typeof data.command !== 'object' || Array.isArray(data.command)) throw new Error('Incomplete receipt evidence.')
  return data as unknown as ReceiptLookup
}
export async function reconcileReceipt(intent: Intent, receipt: ReceiptLookup) {
  if (receipt.status !== 'confirmed_committed') throw new Error('Receipt not confirmed.')
  if (receipt.saved.kind === 'scoring') {
    const current = await getSessionState(receipt.saved.session_id)
    if (current.session.id !== receipt.saved.session_id || current.session.group_id !== receipt.group_id
      || current.session.revision < receipt.saved.revision) throw new Error('Current session does not reconcile to the receipt.')
    await actorAuthorization(intent.userId)
    return current // A later correction/revision is valid; never replace it with an old receipt snapshot.
  }
  const entity = receipt.saved.entity_id
  if(intent.name==='remove_match'){
    const data=await getRemovedMatch(String(intent.args.p_session),intent.userId)
    if(data.id!==entity || data.group_id!==receipt.group_id || data.mode!==intent.args.p_mode)throw new Error('Removal could not be confirmed.')
    return data
  }
  if(intent.name==='claim_guest_email'){
    const catalog=await getMyMatchups()
    if(entity!==intent.args.p_player || catalog?.player_id!==entity || !catalog.matchups.some(m=>m.group_id===receipt.group_id && m.player_ids.includes(entity)))throw new Error('Claim no longer accessible.')
    await actorAuthorization(intent.userId)
    return {id:entity,group_id:receipt.group_id}
  }
  if (intent.name === 'accept_player_invitation') {
    if (typeof intent.args.p_token!=='string' || await tokenHash(intent.args.p_token)!==intent.args.p_token_hash) throw new Error('Invitation token context mismatch.')
    const catalog=await getMyMatchups()
    if(catalog?.player_id!==entity || !catalog.matchups.some(m=>m.group_id===receipt.group_id && m.player_ids.includes(entity))) throw new Error('Claimed player or matchup not accessible.')
    await actorAuthorization(intent.userId)
    return {id:entity,group_id:receipt.group_id}
  }
  if (['create_player_invitation','revoke_player_invitation'].includes(intent.name)) {
    const invitation=(await getMyInvitations()).find(i=>i.id===entity && i.group_id===receipt.group_id)
    if(!invitation || (intent.name==='revoke_player_invitation' && !invitation.revoked)
      || (intent.name==='create_player_invitation' && (invitation.player_id!==intent.args.p_player || invitation.email!==String(intent.args.p_email).trim().toLowerCase()))) throw new Error('Invitation evidence not accessible.')
    await actorAuthorization(intent.userId)
    return {id:entity,group_id:receipt.group_id}
  }
  if (intent.name === 'resolve_matchup') {
    const catalog = await getMyMatchups()
    const saved = catalog?.matchups.find(m => m.group_id===receipt.group_id && m.group_id===entity && Array.isArray(intent.args.p_players) && JSON.stringify([...m.player_ids].sort())===JSON.stringify([...intent.args.p_players].sort()))
    if (!saved) throw new Error('Saved matchup not accessible.')
    await actorAuthorization(intent.userId)
    return {id:entity,group_id:receipt.group_id,matchup:true,player_ids:saved.player_ids}
  }
  if (intent.name === 'create_group') {
    if (!(await listGroups()).some(g => g.id === entity && g.id === receipt.group_id)) throw new Error('Saved group not accessible.')
  } else {
    const options = await getSetupOptions(receipt.group_id)
    const exists = ['create_guest','create_guest_with_email'].includes(intent.name) ? options.players.some(p => p.player_id === entity)
      : intent.name === 'create_venue' ? options.venues.some(v => v.id === entity)
        : intent.name === 'adopt_rule_version' && options.rules.some(r => r.id === entity)
    if (!exists) throw new Error('Saved setup record not accessible.')
  }
  await actorAuthorization(intent.userId)
  return { id: entity, group_id: receipt.group_id, ...(intent.name === 'create_group' ? { role: 'owner' } : {}) }
}

/** Actual owner/admin-authorized deletion audit, independent of a particular operation receipt. */
export async function getRemovedMatch(sessionId:string,userId:string) {
 const authorization=await actorAuthorization(userId)
 const {data,error}=await getSupabase().rpc('get_match_removal',{p_session:sessionId}).setHeader('Authorization',authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
 if(error || data?.removed!==true || data.id!==sessionId || !data.group_id || !['abandon','delete'].includes(data.mode??''))throw new Error('This match removal could not be verified. Keep the original request and try checking again.')
 await actorAuthorization(userId)
 return data
}
