import type { FrameNight } from './frameAnalytics'
import type { PersonalNight } from './performance'
export function frameInsightsData(nights:PersonalNight[],details:FrameNight[],playerId:string) {
 const ids=new Set<string>(),frames=new Set<string>()
 const known=new Map(nights.filter(n=>n.participants.some(p=>p.player_id===playerId)).map(n=>[n.id,n]))
 return details.flatMap(d=>{
  if(ids.has(d.id))throw new Error('Duplicate frame night.');ids.add(d.id)
  const night=known.get(d.id)
  if(!night||!d.detail_eligible)return []
  const rows=d.frames.filter(f=>f.players.some(p=>p.id===playerId)).map(f=>{
   if(frames.has(f.id))throw new Error('Duplicate frame.');frames.add(f.id)
   const timed=f.elapsed_ms!==null&&(f.elapsed_ms>0||f.elapsed_ms===0&&f.duration_quality==='server_measured')&&['server_measured','imported_unverified'].includes(f.duration_quality)
   return {...f,duration:timed?f.elapsed_ms:null,ownFouls:f.players.find(p=>p.id===playerId)!.fouls}
  }).sort((a,b)=>a.number-b.number)
  if(!rows.length)return []
  const times=rows.flatMap(f=>f.duration===null?[]:[f.duration]).sort((a,b)=>a-b)
  const median=(values:number[])=>values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2
  // Tukey fences are inspection flags only; no observation is removed.
  const quantile=(p:number)=>{const at=(times.length-1)*p,lo=Math.floor(at);return times[lo]+(times[Math.ceil(at)]-times[lo])*(at-lo)}
  const q1=times.length>=4?quantile(.25):null,q3=times.length>=4?quantile(.75):null
  const counters=night.participants.flatMap(p=>{
   const played=rows.filter(f=>f.players.some(a=>a.id===p.player_id))
   const values=played.flatMap(f=>{const v=f.players.find(a=>a.id===p.player_id)!.fouls;return v===null?[]:[v]})
   return played.length?[{id:p.player_id,name:p.name,total:values.length?values.reduce((a,b)=>a+b,0):null,known:values.length,played:played.length,rate:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}]:[]
  })
  return [{night,rows:rows.map(f=>({...f,unusual:f.duration!==null&&q1!==null&&q3!==null&&(f.duration<q1-1.5*(q3-q1)||f.duration>q3+1.5*(q3-q1))})),counters,average:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,median:times.length?median(times):null,timed:times.length,measured:rows.filter(f=>f.duration!==null&&f.duration_quality==='server_measured').length,unverified:rows.filter(f=>f.duration!==null&&f.duration_quality==='imported_unverified').length}]
 }).sort((a,b)=>(b.night.date??'').localeCompare(a.night.date??'')||a.night.id.localeCompare(b.night.id))
}
