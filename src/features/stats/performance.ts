import type { PersonalStats } from '../../data/remote/identityService'
export interface PersonalNight { id:string; date:string|null; instant:string|null; participants:{player_id:string;name:string;frames_won:number|null}[] }
export type FormResult='W'|'L'|'D'|'M'|'—'
export function resultFor(night:PersonalNight,playerId:string):FormResult {
  if(night.participants.length!==2)return 'M'
  const own=night.participants.find(p=>p.player_id===playerId)?.frames_won
  const other=night.participants.find(p=>p.player_id!==playerId)?.frames_won
  if(own==null||other==null)return '—'
  return own>other?'W':own<other?'L':'D'
}
export function ratio(won:number,lost:number|null) { return lost===null||won+lost===0?null:100*won/(won+lost) }
export function performance(totals:PersonalStats,nights:PersonalNight[]|null) {
  const avgWon=totals.nights?totals.frames_won/totals.nights:null
  const avgLost=totals.nights&&totals.frames_lost!==null?totals.frames_lost/totals.nights:null
  if(nights===null)return {avgWon,avgLost,current:null,longest:null,recent:[],series:[],ordered:false,currentRange:null,longestRange:null}
  // Calendar days are authoritative; UUID tie-breaking is display stability, not chronology.
  const dated=nights.filter(n=>n.date).sort((a,b)=>a.date!.localeCompare(b.date!) || a.id.localeCompare(b.id))
  const groups=new Map<string,PersonalNight[]>()
  for(const n of dated)groups.set(n.date!,[...(groups.get(n.date!)??[]),n])
  let wins=0,losses=0,count=0,ordered=dated.length===nights.length
  const series:{night:number;wins:number;losses:number;date:string}[]=[]
  let states=new Set(['0,0'])
  const advance=(input:Set<string>,win:boolean)=>new Set([...input].map(state=>{const [run,best]=state.split(',').map(Number);const next=win?run+1:0;return `${next},${Math.max(best,next)}`}))
  for(const [date,rows] of groups){
    const pair=rows.filter(n=>resultFor(n,totals.player_id)!=='M')
    const precise=rows.every(n=>n.instant)&&new Set(rows.map(n=>Date.parse(n.instant!))).size===rows.length
    if(precise){rows.sort((a,b)=>Date.parse(a.instant!)-Date.parse(b.instant!));pair.sort((a,b)=>Date.parse(a.instant!)-Date.parse(b.instant!))}
    if(rows.length>1&&!precise)ordered=false
    for(const n of pair){const r=resultFor(n,totals.player_id);count++;if(r==='W')wins++;if(r==='L')losses++}
    if(pair.length)series.push({night:count,wins,losses,date})
    if(precise||pair.length<2){for(const n of pair)states=advance(states,resultFor(n,totals.player_id)==='W')}
    else {
      // Explore outcome orders, never assign an invented order to same-day matches.
      const w=pair.filter(n=>resultFor(n,totals.player_id)==='W').length,r=pair.length-w
      const grid=new Map<string,Set<string>>([['0,0',states]])
      for(let i=0;i<=w;i++)for(let j=0;j<=r;j++){
        const at=grid.get(`${i},${j}`);if(!at)continue
        for(const [ni,nj,win] of [[i+1,j,true],[i,j+1,false]] as const){if(ni>w||nj>r)continue;const key=`${ni},${nj}`;grid.set(key,new Set([...(grid.get(key)??[]),...advance(at,win)]))}
      }
      states=grid.get(`${w},${r}`)!
    }
  }
  const known=dated.length===nights.length&&nights.every(n=>resultFor(n,totals.player_id)!=='—')
  const ranges=[0,1].map(index=>{const values=[...states].map(s=>Number(s.split(',')[index]));return [Math.min(...values),Math.max(...values)] as [number,number]})
  return {avgWon,avgLost,current:known&&ranges[0][0]===ranges[0][1]?ranges[0][0]:null,longest:known&&ranges[1][0]===ranges[1][1]?ranges[1][0]:null,currentRange:known?ranges[0]:null,longestRange:known?ranges[1]:null,recent:[...groups.values()].flat().toReversed().slice(0,10),series,ordered}
}
