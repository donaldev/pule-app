import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { activeNavigation, historyReturnPath, matchSessionId, nextMatchLocation } from './matchNavigation'
import { AppUpdateStatus } from '../pwa/AppUpdateStatus'
import { Icon, type IconName } from '../components/ui/Icon'
import { PageHeading } from '../components/ui/Primitives'
const GuestEmailClaimPrompt = lazy(() => import('../features/identity/IdentityViews').then(m => ({default:m.GuestEmailClaimPrompt})))
const AccountIdentity = lazy(() => import('../features/identity/IdentityViews').then(m => ({default:m.AccountIdentity})))
const ClaimInvitation = lazy(() => import('../features/identity/IdentityViews').then(m => ({default:m.ClaimInvitation})))
import { exportUnreadableIntent, resetUnreadableIntent } from '../data/local/intentStore'
import { AuthScreen } from '../features/auth/components/AuthScreen'
import { initializeAuth, onAuthStateChange, signOut } from '../features/auth/services/authService'
import { errorMessage, useConnectedGame, type ConnectedGame } from '../features/connected/useConnectedGame'
import { PlayWelcome, NightSetup } from '../features/connected/SetupViews'
import { SessionView } from '../features/connected/SessionView'
const PersonalHome = lazy(() => import('../features/results/ResultsViews').then(m => ({ default: m.PersonalHome })))
const HistoryView = lazy(() => import('../features/results/ResultsViews').then(m => ({ default: m.HistoryView })))
const StandingsView = lazy(() => import('../features/results/ResultsViews').then(m => ({ default: m.StandingsView })))
import { displayDate } from '../features/results/presentation'
import './connected.css'

const navigation: { to: string; title: string; icon: IconName }[] = [
  { to: '/home', title: 'Home', icon: 'home' },
  { to: '/play', title: 'Play', icon: 'play' },
  { to: '/matches', title: 'History', icon: 'matches' },
  { to: '/stats', title: 'Stats', icon: 'chart' },
  { to: '/account', title: 'Account', icon: 'user' },
]
function useRoute() {
  const [location, setLocation] = useState(() => ({route:window.location.hash.slice(1) || '/home',origin:'/matches'}))
  useEffect(() => {
    const change = () => { const next=window.location.hash.slice(1) || '/home'; setLocation(previous=>nextMatchLocation(previous,next)); window.scrollTo({ top: 0 }) }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return location
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let unsubscribe = () => undefined as void
    try {
      const subscription = onAuthStateChange((_event, found) => {
        if (live) { setSession(found); if (found) setError('') }
      })
      unsubscribe = () => subscription.unsubscribe()
      initializeAuth().then(found => { if (live) setSession(found) })
        .catch(e => { if (live) { setSession(null); setError(errorMessage(e)) } })
        .finally(() => { if (live) setReady(true) })
    } catch (e) {
      // Configuration failures occur asynchronously to keep initialization consistent.
      queueMicrotask(() => { if (live) { setError(errorMessage(e)); setReady(true) } })
    }
    return () => { live = false; unsubscribe() }
  }, [])
  if (!ready) return <div className="connected-auth-shell"><span className="wordmark">pule<span>●</span></span><p role="status" className="muted mt-6">Restoring your account…</p></div>
  if (!session) return <div className="connected-auth-shell"><a className="wordmark" href="#/home">pule<span>●</span></a><AuthScreen initialError={error} /></div>
  return <ConnectedApp key={session.user.id} session={session} />
}
function RecoveryStoragePanel({game}:{game:ConnectedGame}) {
  const [snapshot,setSnapshot]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('')
  const malformed=game.recoveryProblem?.reason==='malformed'
  return <section className="connected-recovery compact-recovery" aria-label="Recovery storage"><strong>{malformed?'A saved request needs review':'Recovery storage is unavailable'}</strong><p>{game.recoveryProblem?.message}</p><button className="button button-secondary" onClick={game.retryRecovery}>Check recovery again</button>
  {malformed&&<details className="recovery-details"><summary>Review a recovery reset</summary><p>We can’t tell whether this unreadable request was saved. Don’t reset it until its server status has been checked. Keep the private recovery file for support; don’t post it publicly.</p>
  <button className="text-button" onClick={async()=>{setError('');try{const raw=await exportUnreadableIntent(game.userId);const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pule-unreadable-recovery.json';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setSnapshot(raw);setConfirmed(false)}catch(e){setError(errorMessage(e))}}}>Download private recovery file</button>
  {snapshot&&<><label className="identity-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I saved the file and checked that no unacknowledged action will be lost.</label><button className="button button-secondary" disabled={!confirmed} onClick={async()=>{if(!window.confirm('Reset only this unreadable request? Only continue if its saved status has been reviewed.'))return;try{await resetUnreadableIntent(game.userId,snapshot,confirmed);game.retryRecovery()}catch(e){setError(errorMessage(e))}}}>Reset reviewed local request</button></>}
  </details>}{error&&<p role="alert">{error}</p>}</section>
}

function ConnectedApp({ session }: { session: Session }) {
  const {route,origin} = useRoute()
  const sessionId = matchSessionId(route)
  const game = useConnectedGame(session.user.id, sessionId)
  const main = useRef<HTMLElement>(null)
  const [accountError, setAccountError] = useState('')
  const {dismissNotifications}=game
  useEffect(()=>{dismissNotifications()},[route,dismissNotifications])
  useEffect(()=>{const clear=()=>setAccountError('');window.addEventListener('hashchange',clear);return()=>window.removeEventListener('hashchange',clear)},[])
  useEffect(() => { main.current?.focus() }, [route])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const change = () => setOnline(navigator.onLine)
    window.addEventListener('online', change); window.addEventListener('offline', change)
    return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change) }
  }, [])
  const live = !!sessionId
  const activeTab=activeNavigation(route,game.state?.session.id===sessionId?game.state.session.status:undefined,origin)
  const nav = navigation.map(n => <a key={n.to} href={`#${n.to}`} className={activeTab===n.to?'active':''} aria-current={activeTab===n.to?'page':undefined}><Icon name={n.icon} /><span>{n.title}</span></a>)
  async function logout() {
    if (game.busy) return
    if (game.intent && !window.confirm('An unresolved request will remain on this device for this account. Sign out and recover it when you return?')) return
    setAccountError('')
    try { await signOut() } catch (e) { setAccountError(errorMessage(e)) }
  }
  return <div className="app-shell connected-app">
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); main.current?.focus() }}>Skip to content</a>
    <aside className="sidebar"><a className="wordmark" href="#/home">pule<span>●</span></a><nav aria-label="Main navigation">{nav}</nav></aside>
    <div className="workspace"><header className="topbar"><a className="wordmark mobile-logo" href="#/home">pule<span>●</span></a><a className="text-button header-account" href="#/account">Account</a></header>

      {!online && !game.intent && <div className="notice notice-warning" role="status">You’re offline. Connect to the internet to save scores.</div>}
      <main id="main" className={`main-content ${live ? 'main-live' : ''}`} tabIndex={-1} ref={main}>
        {!live&&!route.startsWith('/claim/')&&!game.loading&&!game.matchupCatalog?.player_id&&<Suspense fallback={null}><GuestEmailClaimPrompt game={game}/></Suspense>}
        <Suspense fallback={<p role="status">Loading…</p>}>{game.loading && !['/home','/account'].includes(route) && !route.startsWith('/matches') ? <p role="status">Loading your matches…</p> : route === '/account' ? <div className="narrow-page connected-form account-page"><PageHeading label="" title="Account">{session.user.email}</PageHeading><AccountIdentity key={game.groupId} game={game} /><AppUpdateStatus protectedWork={game.busy||!!game.intent||!!game.recoveryProblem||!game.ready||game.state?.session.status==='active'}/>{(game.recoveryProblem||game.intent)&&<details className="recovery-details"><summary>Local save recovery</summary>{game.recoveryProblem?<RecoveryStoragePanel game={game}/>:<><p>Your original saved request is retained.</p><button className="text-button" disabled={game.busy} onClick={()=>void game.checkSaved()}>Check saved status</button>{game.lookupNotice&&<p role="status">{game.lookupNotice}</p>}{game.intent?.name==='remove_match'&&<button className="text-button" disabled={game.busy} onClick={()=>void game.checkRemovedMatch()}>Check whether the match was removed</button>}{game.intent&&['pending','uncertain'].includes(game.intent.status)&&<button className="text-button" disabled={game.busy} onClick={()=>{if(window.confirm('Resend the original saved action? This can change match data if it has not already been saved.'))void game.retry()}}>Resend original action</button>}{game.intent&&['conflict','rejected'].includes(game.intent.status)&&<button className="text-button" disabled={game.busy} onClick={()=>{if(window.confirm('Remove this rejected local request and refresh?'))void game.discardRejected()}}>Clear rejected request</button>}</>}</details>}{accountError && <p role="alert" className="connected-error">{accountError}<button type="button" className="text-button notification-close" aria-label="Close sign-out error" onClick={()=>setAccountError('')}>×</button></p>}<button className="button button-secondary mt-6" disabled={game.busy} onClick={() => void logout()}>Sign out</button></div>
          : /^\/claim\/[a-f0-9]{64}$/.test(route) ? <ClaimInvitation key={route} game={game} token={route.split('/')[2]} />
          : (!game.groups.length && !game.error && ['/play','/setup','/group-settings','/new-group'].includes(route)) ? <PlayWelcome game={game} />
          : route === '/home' ? <PersonalHome name={typeof session.user.user_metadata?.display_name === 'string' ? session.user.user_metadata.display_name : typeof session.user.user_metadata?.name === 'string' ? session.user.user_metadata.name : ''} game={game} />
          : live ? <SessionView key={sessionId} game={game} sessionId={sessionId} historyBackTo={historyReturnPath(origin)} />
          : route === '/group-settings' ? <NightSetup key={game.groupId} game={game} />
          : ['/setup','/new-group'].includes(route) ? <NightSetup key={game.groupId} game={game} />
          : route.startsWith('/matches') ? <HistoryView key={game.groupId} game={game} groupView={route!=='/matches/personal' && !(route==='/matches' && game.matchupCatalog?.player_id)} />
          : ['/stats','/stats/personal','/standings'].includes(route) ? <StandingsView key={game.groupId+route} game={game} personal={route==='/stats/personal'} />
          : <>{game.sessions.some(s => s.status === 'active') && <section className="resume-nights" aria-label="Your active match nights">{game.sessions.filter(s => s.status === 'active').map(s => <a className="connected-match-row" key={s.id} href={`#/session/${s.id}`}><div><strong>Resume match night</strong><p className="annotation">{displayDate(s.occurred_on)} · {game.options?.venues.find(v => v.id === s.venue_id)?.display_name ?? 'Match night'}</p></div><Icon name="arrow" /></a>)}</section>}<NightSetup key={game.groupId} game={game} /></>}

        </Suspense>
      </main>
    </div><nav className="mobile-nav" aria-label="Mobile navigation">{nav}</nav>
  </div>
}
