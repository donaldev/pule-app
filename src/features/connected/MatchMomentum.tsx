import { useId } from 'react'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { SessionState } from '../../data/remote/database.types'
import { matchMomentumData } from './matchMomentumData'
import './MatchMomentum.css'
export default function MatchMomentum({state}:{state:SessionState}) {
 const descriptionId=useId()
 const data=matchMomentumData(state)
 if(!data)return <p className="annotation">Momentum needs a complete, ordered frame history matching this night’s final score.</p>
 const {players,points}=data,last=points.at(-1)!,max=Math.max(1,...points.map(p=>Math.abs(p.advantage)))
 const name=(id:string|null)=>players.find(p=>p.player_id===id)?.display_name??'Not recorded'
 const lead=(advantage:number)=>advantage===0?'Tied score':`${advantage>0?players[0].display_name:players[1].display_name} ahead by ${Math.abs(advantage)}`
 const score=(p:(typeof points)[number])=>`${players[0].display_name} ${p.a} – ${p.b} ${players[1].display_name}`
 return <div className="match-momentum">
  <p className="momentum-key"><span>+ {players[0].display_name} leads</span><span>− {players[1].display_name} leads</span></p>
  <div className="momentum-plot" role="img" aria-label="Match momentum: frame-by-frame score difference, with zero showing a tied score." aria-describedby={descriptionId}>
   <ResponsiveContainer width="100%" height={220} minWidth={0}><LineChart data={points} margin={{top:12,right:16,bottom:8,left:0}} accessibilityLayer={false}>
    <XAxis dataKey="number" type="number" domain={[0,last.number]} ticks={[0,last.number]} tickFormatter={n=>n===0?'Start':'Final'} allowDecimals={false} tickLine={false} tick={{fill:'#A7A99E',fontSize:11}}/>
    <YAxis width={36} domain={[-max,max]} ticks={[-max,0,max]} tickFormatter={n=>n>0?`+${n}`:String(n)} tickLine={false} axisLine={false} tick={{fill:'#A7A99E',fontSize:11}}/>
    <ReferenceLine y={0} stroke="#A7A99E"/>
    <Line name="Frame advantage" type="stepAfter" dataKey="advantage" stroke="#C2A06B" strokeWidth={3} dot={false} activeDot={false} isAnimationActive={false}/>
   </LineChart></ResponsiveContainer>
  </div>
  <div id={descriptionId} className="sr-only"><p>Positive values show {players[0].display_name}'s lead; negative values show {players[1].display_name}'s lead. Zero means the scores are tied.</p><ol>{points.map(p=><li key={p.number}>{p.number===0?'Starting score':`Frame ${p.number} · ${name(p.winner)} won`} · {score(p)} · {lead(p.advantage)}</li>)}</ol></div>
 </div>
}
