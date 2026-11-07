import { PageHeading } from '../../components/ui/Primitives'
import { useEffect, useState } from 'react'
import type { ConnectedGame } from '../connected/useConnectedGame'
import { authenticationMethods, connectGoogle } from '../auth/services/authService'
import { getGuestEmailClaim, getMyInvitations, newInvitationToken, previewInvitation, tokenHash, type PlayerInvitation } from '../../data/remote/identityService'
import { playerContextLabel } from '../connected/matchupPresentation'

export function AccountIdentity({game}:{game:ConnectedGame}) {
  const [connecting,setConnecting]=useState(false)
  const [methods,setMethods]=useState<string[]>([])
  const [invitationAvailable,setInvitationAvailable]=useState(false)
  const [invites,setInvites]=useState<PlayerInvitation[]>([])
  const [error,setError]=useState('')
  const [player,setPlayer]=useState('')
  const [email,setEmail]=useState('')
  const [verified,setVerified]=useState(false)
  const [link,setLink]=useState('')
  const [creating,setCreating]=useState(false)
  useEffect(()=>{
    let live=true
    authenticationMethods().then(v=>{if(live)setMethods(v)}).catch(()=>{if(live){setMethods([]);setError('Sign-in methods could not be loaded. Please refresh and try again.')}})
    getMyInvitations().then(v=>{if(live){setInvites(v);setInvitationAvailable(true)}}).catch(()=>{if(live){setInvites([]);setInvitationAvailable(false)}})
    return()=>{live=false}
  },[game.notice,game.groupId])
  const own=game.matchupCatalog?.player_id
  const contexts=game.matchupCatalog?.matchups.filter(m=>m.player_ids.includes(own??'') && game.memberships.some(r=>r.group_id===m.group_id&&['owner','admin'].includes(r.role)))??[]
  const context=contexts.find(m=>m.group_id===game.groupId)
  const targets=context?.player_ids.filter(id=>id!==own)??[]
  const target=targets.includes(player)?player:targets[0]??''
  const pending=invites.some(i=>i.group_id===game.groupId && i.player_id===target && !i.accepted && !i.revoked && new Date(i.expires_at)>new Date())
  const name=(id:string)=>game.playerContexts.find(p=>p.group_id===game.groupId&&p.player_id===id)?.display_name??'Player'
  return <section className="identity-account">
    <h2>Sign-in methods</h2><p>{methods.length?methods.map(m=>m==='google'?'Google':m==='email'?'Email':m).join(' · '):'Sign-in details are unavailable.'}</p>
    {methods.includes('google')?<p role="status">Google is connected.</p>:<button className="button button-secondary" disabled={game.busy||connecting} onClick={async()=>{setConnecting(true);setError('');try{await connectGoogle()}catch(error){setConnecting(false);setError(error instanceof Error?error.message:'Google could not be connected. Please try again.')}finally{setConnecting(false)}}}>{connecting?'Connecting…':'Connect Google'}</button>}
    {own&&invitationAvailable&&(contexts.length>0||invites.length>0)&&<details className="account-invitations"><summary>Manage player invitations</summary>
      {contexts.length>1&&<label>Players<select value={context?.group_id??''} disabled={game.busy} onChange={e=>{setLink('');setVerified(false);game.selectGroup(e.target.value,false)}}><option value="">Choose players</option>{contexts.map((m,i)=><option key={m.group_id} value={m.group_id}>{playerContextLabel(game.playerContexts.filter(p=>p.group_id===m.group_id&&m.player_ids.includes(p.player_id)))} · {i+1}</option>)}</select></label>}
      {!context?<p className="annotation">Choose players in Play before sending an invitation.</p>:<form onSubmit={async e=>{
        e.preventDefault();if(game.blocked||creating||!verified||!target||pending)return
        setCreating(true);setError('');setLink('')
        try{const secret=await newInvitationToken();if(await game.setup('create_player_invitation',{p_group:game.groupId,p_player:target,p_email:email.trim().toLowerCase(),p_token_hash:secret.hash})){setLink(window.location.origin+'/#/claim/'+secret.token);setVerified(false)}}
        catch{setError('The invitation could not be prepared. Please try again.')}finally{setCreating(false)}
      }}><fieldset disabled={game.blocked||creating}><label>Player<select value={target} onChange={e=>{setPlayer(e.target.value);setVerified(false);setLink('')}}>{targets.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label>
        <label>Their email<input type="email" required maxLength={254} value={email} onChange={e=>{setEmail(e.target.value);setVerified(false);setLink('')}}/></label>
        <label className="identity-check"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>I verified this email belongs to {name(target)}.</label>
        <button className="button" disabled={!verified||!email.trim()||pending}>Create invitation link</button>{pending&&<p className="annotation">An invitation is already pending. Revoke it before creating a replacement.</p>}</fieldset></form>}
      {link&&<div role="status"><label>Private invitation link<input readOnly value={link} onFocus={e=>e.target.select()}/></label><p className="annotation">Copy and share privately with that person. It expires in 48 hours. No email was sent.</p></div>}
      {!!invites.filter(i=>!i.accepted&&!i.revoked&&new Date(i.expires_at)>new Date()).length&&<ul className="identity-invites">{invites.filter(i=>!i.accepted&&!i.revoked&&new Date(i.expires_at)>new Date()).map(i=><li key={i.id}><span>{i.email} · {i.accepted?'Accepted':i.revoked?'Revoked':new Date(i.expires_at)<=new Date()?'Expired':'Pending'}</span>{!i.accepted&&!i.revoked&&<button className="text-button" disabled={game.blocked} onClick={()=>{setLink('');void game.setup('revoke_player_invitation',{p_invitation:i.id})}}>Revoke</button>}</li>)}</ul>}
      {!!invites.filter(i=>i.accepted||i.revoked||new Date(i.expires_at)<=new Date()).length&&<details className="past-invitations"><summary>Past invitations</summary><ul className="identity-invites">{invites.filter(i=>i.accepted||i.revoked||new Date(i.expires_at)<=new Date()).map(i=><li key={i.id}><span>{i.email} · {i.accepted?'Accepted':i.revoked?'Revoked':new Date(i.expires_at)<=new Date()?'Expired':'Pending'}</span>{!i.accepted&&!i.revoked&&<button className="text-button" disabled={game.blocked} onClick={()=>{setLink('');void game.setup('revoke_player_invitation',{p_invitation:i.id})}}>Revoke</button>}</li>)}</ul></details>}
    </details>}
    <details><summary>Advanced settings</summary><label>Account ID<input readOnly value={game.userId} onFocus={e=>e.target.select()}/></label></details>

    {game.actionError&&!error&&<p role="alert">{game.actionError}<button type="button" className="text-button notification-close" aria-label="Close action error" onClick={game.dismissNotifications}>×</button></p>}
    {error&&<p role="alert">{error}<button type="button" className="text-button notification-close" aria-label="Close message" onClick={()=>setError('')}>×</button></p>}
  </section>
}
export function ClaimInvitation({game,token}:{game:ConnectedGame;token:string}) {
  const [preview,setPreview]=useState<{player_name:string;expires_at:string}|null>(null)
  const [loading,setLoading]=useState(true)
  const [accepting,setAccepting]=useState(false)
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  useEffect(()=>{let live=true;previewInvitation(token).then(p=>{if(live)setPreview(p)}).catch(()=>{if(live)setPreview(null)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[token,retry])
  return <section className="narrow-page connected-form"><PageHeading label="Invitation" title="Connect your player" />{loading?<p role="status">Checking your invitation…</p>:preview?<><h2>{preview.player_name}</h2><p>Are these your games? Accept to add them to your account.</p><button className="button" disabled={game.blocked||accepting} onClick={async()=>{setAccepting(true);setError('');try{const hash=await tokenHash(token);if(await game.setup('accept_player_invitation',{p_token:token,p_token_hash:hash}))window.location.hash='/stats/personal'}catch{setError('The invitation could not be checked. Use a secure HTTPS connection and try again.')}finally{setAccepting(false)}}}>Accept invitation</button>{game.actionError&&!error&&<p role="alert">{game.actionError}</p>}{error&&<p role="alert">{error}<button type="button" className="text-button notification-close" aria-label="Close message" onClick={()=>setError('')}>×</button></p>}</>:<><p>This invitation is unavailable for this account. Confirm your email, check you’re signed in to the invited account, or ask for a new link.</p><button className="button button-secondary" onClick={()=>{setLoading(true);setRetry(n=>n+1)}}>Check again</button><a className="text-button" href="#/account">Account</a></>}</section>
}
export function GuestEmailClaimPrompt({game}:{game:ConnectedGame}) {
  const [candidate,setCandidate]=useState<import('../../data/remote/identityService').GuestEmailClaim>({status:'none'})
  const [failed,setFailed]=useState(false)
  useEffect(()=>{let live=true;getGuestEmailClaim().then(c=>{if(live)setCandidate(c)}).catch(()=>{if(live)setCandidate({status:'unavailable'})});return()=>{live=false}},[game.userId,game.notice])
  if(candidate.status==='none'||candidate.status==='connected')return null
  if(candidate.status!=='eligible')return <p className="annotation">{candidate.status==='needs_invitation'?'Ask someone you play with for a fresh invitation to connect existing games.':'Your existing games couldn’t be connected. Ask for a fresh invitation or contact the person who invited you.'}</p>
  return <section className="personal-summary" aria-label="Existing games"><h2>We found your existing games</h2><p><strong>{candidate.player_name}</strong></p><p>Are these your games? Add them to your account.</p><button className="button" disabled={game.blocked} onClick={async()=>{setFailed(false);if(await game.setup('claim_guest_email',{p_player:candidate.player_id}))window.location.hash='/stats/personal';else setFailed(true)}}>Claim my games</button>{failed&&<p role="status">We couldn’t confirm the connection. Check the save status before trying again.</p>}</section>
}
