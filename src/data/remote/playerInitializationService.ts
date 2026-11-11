import { actorAuthorization, getSupabase } from './supabase'
export type PlayerInitialization = {status:'linked';id:string;group_id:string}|{status:'initialize';name:string}|{status:'name_required'|'claim_required'|'confirmation_required'}
export async function getMyPlayerInitialization(userId:string):Promise<PlayerInitialization> {
 const authorization=await actorAuthorization(userId)
 const {data,error}=await getSupabase().rpc('get_my_player_initialization',{}).setHeader('Authorization',authorization).retry(false).abortSignal(AbortSignal.timeout(20_000))
 if(error)throw new Error('Account setup could not be checked. Please try again.')
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid account setup response.')
 if(data.status==='linked'&&typeof data.id==='string'&&typeof data.group_id==='string')return {status:'linked',id:data.id,group_id:data.group_id}
 if(data.status==='initialize'&&typeof data.name==='string'&&data.name.trim()&&data.name.length<=100)return {status:'initialize',name:data.name}
 if(['name_required','claim_required','confirmation_required'].includes(String(data.status)))return {status:data.status} as PlayerInitialization
 throw new Error('Invalid account setup response.')
}
