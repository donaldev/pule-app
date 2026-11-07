import { getSupabase } from './supabase'
import type { FrameNight } from '../../features/stats/frameAnalytics'
export async function getFrameSummary(expectedPlayerId:string,opponentId:string|null=null):Promise<FrameNight[]|null> {
 const {data,error}=await getSupabase().rpc('get_my_frame_summary',{p_opponent:opponentId})
 if(error&&['PGRST202','42883'].includes(error.code))return null
 if(error)throw new Error('Frame details could not be loaded.')
 const v=data as unknown as {player_id:string|null;nights:FrameNight[]}
 if(!v||v.player_id!==expectedPlayerId||!Array.isArray(v.nights)||new Set(v.nights.map(n=>n.id)).size!==v.nights.length)throw new Error('Frame summary identity or coverage mismatch.')
 const nullableId=(id:unknown)=>id===null||typeof id==='string'
 const seen=new Set<string>()
 for(const n of v.nights){
  if(typeof n.id!=='string'||typeof n.detail_eligible!=='boolean'||!['reconciled','partial','disputed','not_recorded'].includes(n.sequence_quality)||!Number.isSafeInteger(n.recorded_frame_count)||n.recorded_frame_count<0||!Array.isArray(n.frames)||n.frames.length>n.recorded_frame_count||(!n.detail_eligible&&n.frames.length>0))throw new Error('Invalid frame coverage.')
  const numbers=new Set<number>()
  for(const f of n.frames){
   if(seen.has(f.id)||numbers.has(f.number))throw new Error('Duplicate recorded frame.');seen.add(f.id);numbers.add(f.number)
   if(typeof f.id!=='string'||!Number.isSafeInteger(f.number)||f.number<1||!nullableId(f.winner)||!nullableId(f.breaker)||(f.break_pot!==null&&typeof f.break_pot!=='boolean')||!Array.isArray(f.players)||f.players.length!==2||f.players[0].id===f.players[1].id||f.players.some(p=>typeof p.id!=='string'||(p.fouls!==null&&(!Number.isSafeInteger(p.fouls)||p.fouls<0)))||(f.winner!==null&&!f.players.some(p=>p.id===f.winner))||(f.breaker!==null&&!f.players.some(p=>p.id===f.breaker))||(f.elapsed_ms!==null&&(!Number.isSafeInteger(f.elapsed_ms)||f.elapsed_ms<0))||!['server_measured','imported_unverified','unknown'].includes(f.duration_quality)||(f.event!==null&&!['regular','golden_break','break_and_run','dry_clearance','super_foul'].includes(f.event))||(f.pocket!==null&&!['TL','TM','TR','BL','BM','BR'].includes(f.pocket)))throw new Error('Invalid recorded frame.')
  }
 }
 return v.nights
}
