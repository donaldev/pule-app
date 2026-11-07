import type { SessionState } from '../../data/remote/database.types'
import { frameAnalytics } from '../stats/frameAnalytics'
/** Reuse the complete-sequence rule used by frame runs/comebacks, with session/pair binding. */
export function matchMomentumData(state:SessionState) {
 const s=state.session,p=[...state.participants].sort((a,b)=>a.side-b.side),frames=[...state.frames].sort((a,b)=>a.frame_number-b.frame_number)
 if(s.status!=='finalized'||s.result_quality!=='approved'||s.record_kind!=='frame_log'||!s.detail_eligible||p.length!==2||p[0].player_id===p[1].player_id||!frames.length)return null
 const ids=p.map(p=>p.player_id)
 if(ids.some(id=>!Number.isSafeInteger(state.scores[id])||state.scores[id]!<0)||new Set(frames.map(f=>f.id)).size!==frames.length||frames.some(f=>f.group_id!==s.group_id||f.session_id!==s.id||f.status!=='completed'||!f.detail_eligible||f.participants.length!==2||new Set(f.participants.map(p=>p.player_id)).size!==2||f.participants.some(p=>!ids.includes(p.player_id))))return null
 const nights=[{id:s.id,date:s.occurred_on,instant:s.occurred_at,participants:p.map(p=>({player_id:p.player_id,name:p.display_name,frames_won:state.scores[p.player_id]}))}]
 const details=[{id:s.id,date:s.occurred_on,sequence_quality:s.sequence_quality,detail_eligible:s.detail_eligible,recorded_frame_count:frames.length,frames:frames.map(f=>({id:f.id,number:f.frame_number,winner:f.winner_id,breaker:f.breaker_id,break_pot:f.potted_on_break,event:f.special_event,pocket:f.black_pocket_code,elapsed_ms:f.elapsed_ms,duration_quality:f.duration_quality,players:f.participants.map(p=>({id:p.player_id,fouls:p.foul_count}))}))}]
 const first=frameAnalytics(nights,details,ids[0]),second=frameAnalytics(nights,details,ids[1])
 if(first.coverage.orderedNights!==1)return null
 let a=0,b=0,lastLeader=0,leadChanges=0
 const points=[{number:0,winner:null as string|null,a:0,b:0,advantage:0}]
 for(const f of frames){
  if(f.winner_id===ids[0])a++;else b++
  const advantage=a-b,leader=Math.sign(advantage)
  // Reaching a tie is not a lead change; count a transfer once another player leads.
  if(leader&&lastLeader&&leader!==lastLeader)leadChanges++
  if(leader)lastLeader=leader
  points.push({number:f.frame_number,winner:f.winner_id,a,b,advantage})
 }
 const tied=a===b,winner=tied?null:a>b?p[0]:p[1]
 const longest=Math.max(first.records.longestFrameRun!,second.records.longestFrameRun!)
 const runPlayers=p.filter((_,i)=>(i===0?first:second).records.longestFrameRun===longest).map(p=>p.display_name)
 return {players:p,points,leadChanges,longest,runPlayers,tied,winner,comeback:tied?null:(a>b?first:second).records.biggestComeback!}
}
