import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { getMyPlayerInitialization, type PlayerInitialization as Status } from '../../data/remote/playerInitializationService'
import type { ConnectedGame } from '../connected/useConnectedGame'
type Outcome=Status|{status:'complete'|'failed'}
export function PlayerInitialization({game,route,claimPrompt,children}:{game:ConnectedGame;route:string;claimPrompt:ReactNode;children:ReactNode}) {
 const [outcome,setOutcome]=useState<Outcome|null>(null),[name,setName]=useState(''),[suppliedName,setSuppliedName]=useState<string|null>(null),[retry,setRetry]=useState(0)
 const job=useRef<Promise<Outcome>|null>(null)
 const linked=!!game.matchupCatalog?.player_id,claimRoute=route.startsWith('/claim/')
 const paused=!game.ready||game.loading||game.busy||!!game.intent||!!game.recoveryProblem
 const run=useEffectEvent(async():Promise<Outcome>=>{
  const status=await getMyPlayerInitialization(game.userId)
  if(status.status==='initialize'||status.status==='name_required'&&suppliedName){
   const ok=await game.setup('initialize_my_player',{p_name:suppliedName??(status.status==='initialize'?status.name:null)})
   return {status:ok?'complete':'failed'}
  }
  return status
 })
 useEffect(()=>{
  if(linked||claimRoute||paused)return
  let live=true
  job.current??=run()
  job.current.then(value=>{if(live)setOutcome(value)}).catch(()=>{if(live)setOutcome({status:'failed'})})
  return()=>{live=false}
 },[linked,claimRoute,paused,retry])
 const again=()=>{job.current=null;setOutcome(null);setRetry(n=>n+1)}
 // Claims and Account/recovery must remain reachable even when initialization is blocked.
 if(linked||claimRoute||route==='/account'||outcome?.status==='linked'||outcome?.status==='complete')return children
 if(game.intent||game.recoveryProblem)return <section className="narrow-page"><p>A saved action needs checking before you continue.</p><a className="button button-secondary" href="#/account">Open Account</a></section>
 if(outcome?.status==='claim_required')return <section className="narrow-page"><h1>Connect your existing games</h1><p>Open your player invitation, or ask the person who invited you for a fresh link. Your games will stay with the same player.</p>{claimPrompt}<a className="text-button" href="#/account">Account</a></section>
 if(outcome?.status==='confirmation_required')return <section className="narrow-page"><h1>Confirm your email</h1><p>Confirm your email, then return here to continue.</p><button className="button" onClick={again}>Check again</button><a className="text-button" href="#/account">Account</a></section>
 if(outcome?.status==='name_required')return <form className="narrow-page connected-form" onSubmit={e=>{e.preventDefault();if(name.trim()){setSuppliedName(name.trim());again()}}}><h1>What should we call you?</h1><label>Name<input autoFocus required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label><button className="button" disabled={!name.trim()}>Continue</button><a className="text-button" href="#/account">Account</a></form>
 if(outcome?.status==='failed')return <section className="narrow-page"><p role="alert">{game.actionError||'Your account setup could not finish. Please try again.'}</p><button className="button" onClick={again}>Try again</button><a className="text-button" href="#/account">Account</a></section>
 return <p role="status">Getting your account ready…</p>
}
