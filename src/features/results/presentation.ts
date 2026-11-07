import type { SessionState, Standing } from '../../data/remote/database.types'
export function displayDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date not recorded'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)))
}
export function frameRate(won: number, lost: number | null) {
  return lost === null || won+lost===0 ? null : won/(won+lost)*100
}
export function rankPlayers(rows: Standing[]) {
  const diff=(p:Standing)=>p.frames_lost===null?Number.NEGATIVE_INFINITY:p.frames_won-p.frames_lost
  const metric=(a:Standing,b:Standing)=>b.wins-a.wins || (a.losses??0)-(b.losses??0) || b.frames_won-a.frames_won || (diff(a)===diff(b)?0:diff(b)>diff(a)?1:-1)
  const sorted=[...rows].sort((a,b)=>metric(a,b)||a.display_name.localeCompare(b.display_name)||a.player_id.localeCompare(b.player_id))
  return sorted.map((p,i)=>({...p,rank:i>0 && metric(p,sorted[i-1])===0 ? sorted.findIndex(q=>metric(q,p)===0)+1:i+1}))
}
export function nightOutcome(state:SessionState) {
  if(state.session.status!=='finalized')return state.session.status==='active'?'In progress':'Not completed'
  if(state.participants.length<2)return 'Result not recorded'
  const scores=state.participants.map(p=>state.scores[p.player_id])
  if(scores.some(s=>s==null))return 'Result not recorded'
  const top=Math.max(...scores as number[])
  const winners=state.participants.filter(p=>state.scores[p.player_id]===top)
  if(state.participants.length>2)return winners.length>1?'Shared top score':`${winners[0]?.display_name ?? 'Player'} · top score`
  return winners.length>1 ? 'Draw' : `${winners[0]?.display_name ?? 'Player'} won`
}
export function headToHead(states:SessionState[], a:string,b:string) {
  let nights=0,wins=0,losses=0,draws=0,forFrames=0,againstFrames=0
  for(const s of states){
    if(s.session.status!=='finalized'||s.session.result_quality!=='approved'||s.participants.length!==2
      ||!s.participants.some(p=>p.player_id===a)||!s.participants.some(p=>p.player_id===b))continue
    const x=s.scores[a],y=s.scores[b];if(x==null||y==null)continue
    nights++;forFrames+=x;againstFrames+=y;if(x>y)wins++;else if(x<y)losses++;else draws++
  }
  return {nights,wins,losses,draws,forFrames,againstFrames}
}
