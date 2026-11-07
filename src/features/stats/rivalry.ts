import { ratio, resultFor, type PersonalNight } from './performance'
/** Input is the caller-only completed/approved summary contract, not a mixed session list. */
function pairs(nights:PersonalNight[],ownId:string) {
 const unique=new Map<string,PersonalNight>()
 for(const n of nights){
  if(n.participants.length!==2||!n.participants.some(p=>p.player_id===ownId)||n.participants[0].player_id===n.participants[1].player_id)continue
  const previous=unique.get(n.id)
  if(previous && JSON.stringify({...previous,participants:[...previous.participants].sort((a,b)=>a.player_id.localeCompare(b.player_id))})!==JSON.stringify({...n,participants:[...n.participants].sort((a,b)=>a.player_id.localeCompare(b.player_id))}))throw new Error('Conflicting rivalry result.')
  unique.set(n.id,n)
 }
 return [...unique.values()]
}
export function rivalryOpponents(nights:PersonalNight[],ownId:string) {
 const opponents=new Map<string,{id:string;name:string;nights:number}>()
 for(const n of pairs(nights,ownId)){
  const other=n.participants.find(p=>p.player_id!==ownId)!
  const record=opponents.get(other.player_id)??{id:other.player_id,name:other.name,nights:0}
  record.nights++;opponents.set(record.id,record)
 }
 return [...opponents.values()].sort((a,b)=>b.nights-a.nights||a.id.localeCompare(b.id))
}
export function rivalryRecord(nights:PersonalNight[],ownId:string,opponentId:string) {
 const rows=pairs(nights,ownId).filter(n=>n.participants.some(p=>p.player_id===opponentId))
 const outcomes=rows.map(n=>resultFor(n,ownId)), wins=outcomes.filter(r=>r==='W').length,losses=outcomes.filter(r=>r==='L').length,draws=outcomes.filter(r=>r==='D').length
 const total=(id:string)=>rows.some(n=>n.participants.find(p=>p.player_id===id)?.frames_won==null)?null:rows.reduce((sum,n)=>sum+n.participants.find(p=>p.player_id===id)!.frames_won!,0)
 const forFrames=total(ownId),againstFrames=total(opponentId),unknown=outcomes.includes('—')
 // Preserve calendar-day ordering without inventing order for date-only same-day nights.
 const sorted=[...rows].sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.instant??'').localeCompare(b.instant??'')||a.id.localeCompare(b.id))
 const ordered=sorted.every(n=>!!n.date)
 const ambiguousDays=new Set(sorted.filter((n,i)=>i>0&&n.date===sorted[i-1].date&&(!n.instant||!sorted[i-1].instant||n.instant===sorted[i-1].instant)).map(n=>n.date))
 let recent=ordered?sorted.slice(-10).reverse():[]
 const boundary=recent.at(-1)?.date
 if(boundary&&ambiguousDays.has(boundary))recent=sorted.filter(n=>n.date!>=boundary).reverse()
 let w=0,l=0
 const series:{night:number;wins:number;losses:number;date:string}[]=[]
 if(ordered&&!unknown)sorted.forEach((n,i)=>{
   const result=resultFor(n,ownId);if(result==='W')w++;if(result==='L')l++
   if(!ambiguousDays.has(n.date)||sorted[i+1]?.date!==n.date)series.push({night:i+1,wins:w,losses:l,date:n.date!})
 })
 return {nights:rows.length,wins,losses,draws,forFrames,againstFrames,unknown,winRate:unknown?null:ratio(wins,losses),progress:{recent,series,ordered,sameDay:ambiguousDays.size>0,latestAmbiguous:recent.length>0&&ambiguousDays.has(recent[0].date)}}
}
