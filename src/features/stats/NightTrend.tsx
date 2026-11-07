import { displayDate } from '../results/presentation'
import type { performance } from './performance'
export function NightTrend({series,labels=['Wins','Losses']}:{labels?:[string,string];series:ReturnType<typeof performance>['series']}) {
  if(series.length<2)return <p className="stats-note">Play at least two head-to-head nights to see your progress.</p>
  const max=Math.max(1,...series.flatMap(p=>[p.wins,p.losses]))
  const x=(i:number)=>34+i*268/(series.length-1), y=(value:number)=>146-value*116/max
  const line=(key:'wins'|'losses')=>series.map((p,i)=>`${x(i)},${y(p[key])}`).join(' ')
  return <><svg className="personal-trend" viewBox="0 0 320 180" role="img" aria-label={`Cumulative night record over ${series.at(-1)!.night} head-to-head nights: ${labels[0]} ${series.at(-1)!.wins}, ${labels[1]} ${series.at(-1)!.losses}.`}>
    <title>{labels.join(' / ')} · cumulative night record</title>
    {[0,max].map(v=><g key={v}><line x1="34" x2="302" y1={y(v)} y2={y(v)} stroke="#536357"/><text x="26" y={y(v)+4} textAnchor="end">{v}</text></g>)}
    <polyline points={line('wins')} fill="none" stroke="#C5A46A" strokeWidth="3"/>
    <polyline points={line('losses')} fill="none" stroke="#D3D6CB" strokeWidth="2" strokeDasharray="5 3"/>
    <text x="34" y="170">{displayDate(series[0].date)}</text><text x="302" y="170" textAnchor="end">{displayDate(series.at(-1)!.date)}</text>
  </svg><p className="trend-key"><span>━ {labels[0]}</span><span>┄ {labels[1]}</span></p><p className="stats-note">{series.at(-1)!.night} head-to-head nights</p></>
}
