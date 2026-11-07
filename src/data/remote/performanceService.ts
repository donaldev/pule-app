import { getSupabase } from './supabase'
import { getPersonalStats, type PersonalStats } from './identityService'
import type { PersonalNight } from '../../features/stats/performance'
export async function getPersonalPerformance():Promise<{totals:PersonalStats|null;nights:PersonalNight[]|null}> {
  const {data,error}=await getSupabase().rpc('get_my_performance',{})
  if(error && ['PGRST202','42883'].includes(error.code))return {totals:await getPersonalStats(),nights:null}
  if(error)throw new Error('Could not load your performance.')
  const value=data as unknown as {totals:PersonalStats|null;nights:PersonalNight[]}
  if(!value || !Array.isArray(value.nights))throw new Error('Incomplete performance response.')
  if(value.totals===null){if(value.nights.length)throw new Error('Unexpected personal results.');return value}
  const s=value.totals
  if(s.scope!=='all_accessible_approved_nights'||typeof s.player_id!=='string' || !['nights','wins','losses','draws','frames_won','multiplayer_nights','matchups'].every(k=>Number.isSafeInteger(s[k as keyof PersonalStats]) && Number(s[k as keyof PersonalStats])>=0) || (s.frames_lost!==null&&(!Number.isSafeInteger(s.frames_lost)||s.frames_lost<0)) || s.nights!==value.nights.length || new Set(value.nights.map(n=>n.id)).size!==value.nights.length)throw new Error('Incomplete performance totals.')
  for(const n of value.nights){
    if(typeof n.id!=='string'||(n.date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(n.date)||!Number.isFinite(Date.parse(n.date))))||(n.instant!==null&&!Number.isFinite(Date.parse(n.instant)))||!Array.isArray(n.participants)||n.participants.length<2||new Set(n.participants.map(p=>p.player_id)).size!==n.participants.length||!n.participants.some(p=>p.player_id===s.player_id)||n.participants.some(p=>typeof p.name!=='string'||typeof p.player_id!=='string'||(p.frames_won!==null&&(!Number.isSafeInteger(p.frames_won)||p.frames_won<0))))throw new Error('Incomplete night results.')
  }
  return value
}
