import type { PersonalNight } from './performance'
export interface FrameObservation {
 id:string;number:number;winner:string|null;breaker:string|null;break_pot:boolean|null;event:string|null;pocket:string|null;
 elapsed_ms:number|null;duration_quality:string;players:{id:string;fouls:number|null}[]
}
export interface FrameNight {id:string;date:string|null;sequence_quality:string;detail_eligible:boolean;recorded_frame_count:number;frames:FrameObservation[]}
export function frameAnalytics(nights:PersonalNight[],details:FrameNight[]|null,playerId:string) {
 const unique=new Map<string,PersonalNight>()
 for(const n of nights){if(!n.participants.some(p=>p.player_id===playerId))continue;if(unique.has(n.id))throw new Error('Duplicate night summary.');unique.set(n.id,n)}
 const selected=[...unique.values()],byId=new Map<string,FrameNight>()
 for(const d of details??[]){if(byId.has(d.id))throw new Error('Duplicate frame-night summary.');byId.set(d.id,d)}
 const scores=selected.map(n=>n.participants.find(p=>p.player_id===playerId)!.frames_won).filter((x):x is number=>x!==null)
 const pairWins=selected.filter(n=>n.participants.length===2&&n.participants.every(p=>p.frames_won!==null)&&n.participants.find(p=>p.player_id===playerId)!.frames_won!>n.participants.find(p=>p.player_id!==playerId)!.frames_won!)
 const margins=pairWins.map(n=>n.participants.find(p=>p.player_id===playerId)!.frames_won!-n.participants.find(p=>p.player_id!==playerId)!.frames_won!)
 const allFrames:FrameObservation[]=[],seen=new Set<string>()
 for(const n of selected){const d=byId.get(n.id);if(!d?.detail_eligible)continue;for(const f of d.frames){if(seen.has(f.id))throw new Error('Duplicate frame observation.');seen.add(f.id);if(f.players.some(p=>p.id===playerId))allFrames.push(f)}}
 const ownBreaks=allFrames.filter(f=>f.breaker===playerId)
 const knownWinner=(f:FrameObservation)=>f.winner!==null&&f.players.some(p=>p.id===f.winner)
 const pots=ownBreaks.filter(f=>f.break_pot!==null),holds=ownBreaks.filter(knownWinner)
 const steals=allFrames.filter(f=>f.breaker!==null&&f.breaker!==playerId&&f.players.some(p=>p.id===f.breaker)&&knownWinner(f))
 const rate=(won:number,total:number)=>({won,total,percent:total?100*won/total:null})
 const wonFrames=allFrames.filter(f=>f.winner===playerId)
 const events=wonFrames.filter(f=>f.event!==null),types:Record<string,number>={},pockets:Record<string,number>={}
 for(const f of events)types[f.event!]=(types[f.event!]??0)+1
 for(const f of wonFrames)if(f.pocket)pockets[f.pocket]=(pockets[f.pocket]??0)+1
 const durations=allFrames.filter(f=>f.elapsed_ms!==null&&(f.elapsed_ms>0||(f.elapsed_ms===0&&f.duration_quality==='server_measured'))&&['server_measured','imported_unverified'].includes(f.duration_quality))
 const winTimes=durations.filter(f=>f.winner===playerId).map(f=>f.elapsed_ms!)
 const fouls=allFrames.map(f=>f.players.find(p=>p.id===playerId)!.fouls).filter((x):x is number=>x!==null)
 let longest=0,run=0,biggestComeback=0,winsAfterTrailing=0,orderedNights=0,comebackNights=0,previous:PersonalNight|undefined
 const chronological=[...selected].sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.instant??'').localeCompare(b.instant??'')||a.id.localeCompare(b.id))
 const ambiguous=new Set(chronological.filter((n,i)=>i>0&&n.date===chronological[i-1].date&&(!n.instant||!chronological[i-1].instant||n.instant===chronological[i-1].instant)).map(n=>n.date))
 for(const n of chronological){
  const d=byId.get(n.id),frames=[...(d?.frames??[])].sort((a,b)=>a.number-b.number)
  const counts=new Map<string,number>();for(const f of frames)if(f.winner)counts.set(f.winner,(counts.get(f.winner)??0)+1)
  const complete=!!d?.detail_eligible&&d.sequence_quality==='reconciled'&&frames.length>0&&d.recorded_frame_count===frames.length&&frames.every((f,i)=>f.number===i+1&&knownWinner(f))&&n.participants.every(p=>p.frames_won!==null&&p.frames_won===(counts.get(p.player_id)??0))
  if(!complete||!frames.some(f=>f.players.some(p=>p.id===playerId))){run=0;previous=undefined;continue}
  orderedNights++
  if(!previous?.date||!n.date||ambiguous.has(n.date)||ambiguous.has(previous.date))run=0
  let own=0,other=0,deficit=0
  for(const f of frames){
   if(!f.players.some(p=>p.id===playerId))continue
   run=f.winner===playerId?run+1:0;longest=Math.max(longest,run)
   if(f.winner===playerId)own++;else other++
   deficit=Math.max(deficit,other-own)
  }
  if(n.participants.length===2){comebackNights++;if(own>other&&deficit>0){winsAfterTrailing++;biggestComeback=Math.max(biggestComeback,deficit)}}
  previous=n
 }
 return {
  records:{mostFrames:scores.length?Math.max(...scores):null,biggestMargin:margins.length?Math.max(...margins):null,closestWin:margins.length?Math.min(...margins):null,longestFrameRun:orderedNights?longest:null,biggestComeback:comebackNights?biggestComeback:null,winsAfterTrailing:comebackNights?winsAfterTrailing:null},
  breaks:{recorded:ownBreaks.length,pot:rate(pots.filter(f=>f.break_pot).length,pots.length),hold:rate(holds.filter(f=>f.winner===playerId).length,holds.length),steal:rate(steals.filter(f=>f.winner===playerId).length,steals.length),goldenBreaks:events.length?(types.golden_break??0):null,breakRuns:events.length?(types.break_and_run??0):null},
  style:{averageWinMs:winTimes.length?winTimes.reduce((a,b)=>a+b,0)/winTimes.length:null,fastestWinMs:winTimes.length?Math.min(...winTimes):null,longestMs:durations.length?Math.max(...durations.map(f=>f.elapsed_ms!)):null,fouls:fouls.length?fouls.reduce((a,b)=>a+b,0):null,types,pockets},
  coverage:{nights:selected.length,frames:allFrames.length,orderedNights,comebackNights,pot:pots.length,hold:holds.length,steal:steals.length,events:events.length,winTimes:winTimes.length,durations:durations.length,unverifiedTimes:durations.filter(f=>f.duration_quality==='imported_unverified').length,fouls:fouls.length,pockets:Object.values(pockets).reduce((a,b)=>a+b,0),available:details!==null}
 }
}
