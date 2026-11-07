import { ratio, resultFor, type PersonalNight } from './performance'
export interface PersonalHistoryPoint { night:number;wins:number;losses:number;date:string }
/** Decorate the existing day-end totals; no new result or streak calculation. */
export function personalHistoryData(nights:PersonalNight[],series:PersonalHistoryPoint[],playerId:string) {
 const seen=new Set<string>(),byDate=new Map<string,PersonalNight[]>()
 for(const n of nights){
  if(!n.participants.some(p=>p.player_id===playerId))continue
  if(seen.has(n.id))throw new Error('Duplicate personal history night.')
  seen.add(n.id)
  if(n.date&&n.participants.length===2)byDate.set(n.date,[...(byDate.get(n.date)??[]),n])
 }
 let unavailable=0
 return series.map(point=>{
  const rows=byDate.get(point.date)
  if(!rows?.length)throw new Error('Incomplete personal history date.')
  const precise=rows.every(n=>n.instant)&&new Set(rows.map(n=>Date.parse(n.instant!))).size===rows.length
  const sources=[...rows].sort((a,b)=>precise?Date.parse(a.instant!)-Date.parse(b.instant!):a.id.localeCompare(b.id))
  unavailable+=sources.filter(n=>resultFor(n,playerId)==='—').length
  return {...point,rate:ratio(point.wins,point.losses),decided:point.wins+point.losses,unavailable,nights:sources,unordered:rows.length>1&&!precise}
 })
}
