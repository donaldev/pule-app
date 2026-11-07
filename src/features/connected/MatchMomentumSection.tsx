import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import { MatchDisclosureHeading } from './MatchDisclosureHeading'
import type { SessionState } from '../../data/remote/database.types'
const MatchMomentum=lazy(()=>import('./MatchMomentum'))
class MomentumBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<p className="annotation">Momentum couldn’t load. Frame history is still available below.</p>:this.props.children}
}
export function MatchMomentumSection({state}:{state:SessionState}) {
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false)
 return <section className="connected-section match-disclosure momentum-section"><MatchDisclosureHeading expanded={open} controls="match-momentum-content" onToggle={()=>{setOpen(!open);setLoaded(true)}}>Match momentum</MatchDisclosureHeading><p className="annotation">Explore how the score changed throughout the night.</p><div id="match-momentum-content" hidden={!open}>{loaded&&<MomentumBoundary><Suspense fallback={<div style={{height:220}} role="status">Loading match momentum…</div>}><MatchMomentum state={state}/></Suspense></MomentumBoundary>}</div></section>
}
