import type { PersonalNight } from './performance'
export interface RivalryPoint { night:number;wins:number;losses:number;date:string }
/** Attach source nights to existing cumulative points; never recompute the record. */
export function progressionGroups(nights:PersonalNight[],ownId:string,opponentId:string,series:RivalryPoint[]) {
 const rows=[...new Map(nights.filter(n=>n.participants.length===2&&n.participants.some(p=>p.player_id===ownId)&&n.participants.some(p=>p.player_id===opponentId)).map(n=>[n.id,n])).values()]
  .sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.instant??'').localeCompare(b.instant??'')||a.id.localeCompare(b.id))
 let previous=0
 return series.map(point=>{
  if(!Number.isSafeInteger(point.night)||point.night<=previous||point.night>rows.length)throw new Error('Incomplete rivalry progression.')
  const grouped=rows.slice(previous,point.night);previous=point.night
  if(grouped.some(n=>n.date!==point.date))throw new Error('Mismatched rivalry dates.')
  return {...point,nights:grouped}
 })
}
