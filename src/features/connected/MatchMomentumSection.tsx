import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { SessionState } from '../../data/remote/database.types'
const MatchMomentum=lazy(()=>import('./MatchMomentum'))
class MomentumBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<p className="annotation">Momentum couldn’t load. Frame history is still available below.</p>:this.props.children}
}
export function MatchMomentumSection({state}:{state:SessionState}) {
 return <section className="connected-section momentum-section"><h2>Match momentum</h2><MomentumBoundary><Suspense fallback={<div style={{height:220}} role="status">Loading match momentum…</div>}><MatchMomentum state={state}/></Suspense></MomentumBoundary></section>
}
