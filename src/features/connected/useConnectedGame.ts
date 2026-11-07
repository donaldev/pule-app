import { getRemovedMatch, lookupOperationReceipt, reconcileReceipt } from '../../data/remote/receiptService'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Database, SessionState, SetupResult, Standing } from '../../data/remote/database.types'
import { getSessionState, getSetupOptions, listPlayerContexts, getStandings, listGroups, listSessions, saveScoringCommand } from '../../data/remote/scoringService'
import { getMyMemberships, getMyMatchups, saveSetupCommand } from '../../data/remote/setupService'
import { OperationCoordinator, type Intent } from '../../data/local/operationCoordinator'
import { intentStore } from '../../data/local/intentStore'
import { RecoveryStorageError } from '../../data/local/intentValidation'
import { restoreStartupRecovery } from '../../data/local/startupRecovery'
import { chooseGroup, readLastGroup, rememberGroup } from './groupPreference'

type Functions = Database['app']['Functions']
export type ScoringName = 'start_session' | 'start_frame' | 'complete_frame' | 'correct_frame' | 'finalize_session' | 'set_frame_paused'
export type SetupName = 'remove_match' | 'claim_guest_email' | 'create_group' | 'create_guest_with_email' | 'create_guest' | 'create_venue' | 'resolve_matchup' | 'create_player_invitation' | 'accept_player_invitation' | 'revoke_player_invitation'
export function errorMessage(error: unknown) {
  if(error instanceof Error) {
    if(error.message.includes('match_removal_requires_owner_or_admin'))return 'Only a match owner or admin can remove this match.'
    if(error.message.includes('match_status_changed'))return 'This match has changed. Refresh before removing it.'
    if(error.message.includes('match_permanently_removed') || error.message.includes('match_unavailable'))return 'This match is no longer available. Refresh your matches.'
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === '40001') return 'This night changed on another device. Load the latest saved state and review your request.'
  if (error instanceof Error && error.message.includes('assigned_scorer_required')) return 'Only an authorized scorer can change this night.'
  return error instanceof Error ? error.message : 'Could not complete this request. Please try again.'
}
const scoringNames = new Set(['start_session', 'start_frame', 'complete_frame', 'correct_frame', 'finalize_session', 'set_frame_paused'])
// Retain dispatch of old saved intents; no UI can create a rule-adoption request.
const setupNames = new Set(['remove_match','claim_guest_email', 'create_group', 'create_guest_with_email', 'create_guest', 'create_venue', 'adopt_rule_version', 'resolve_matchup', 'create_player_invitation', 'accept_player_invitation', 'revoke_player_invitation'])
async function send(intent: Intent) {
  if(navigator.onLine===false)throw new Error('You’re offline. Connect to the internet before saving.')
  if (intent.kind === 'scoring' && scoringNames.has(intent.name)) {
    return saveScoringCommand(intent.name as ScoringName, intent.args as Functions[ScoringName]['Args'], intent.userId)
  }
  if (intent.kind === 'setup' && setupNames.has(intent.name)) {
    return saveSetupCommand(intent.name as SetupName | 'adopt_rule_version', intent.args as Functions[SetupName | 'adopt_rule_version']['Args'], intent.userId)
  }
  throw new Error('Unrecognized recovery operation. Nothing was sent.')
}
export function useConnectedGame(userId: string, sessionId: string) {
  const groupPreferenceKey = `pule:last-group:${import.meta.env.VITE_SUPABASE_URL}:${userId}`
  const [coordinator] = useState(() => new OperationCoordinator(intentStore, send))
  const [intent, setIntent] = useState<Intent | null>(null)
  const [ready, setReady] = useState(false)
  const [recoveryProblem,setRecoveryProblem]=useState<RecoveryStorageError|null>(null)
  const [recoveryAttempt,setRecoveryAttempt]=useState(0)
  const startup=useRef<ReturnType<typeof restoreStartupRecovery>|null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [actionError,setActionError]=useState('')
  const [notice, setNotice] = useState('')
  const [lookupNotice, setLookupNotice] = useState('')
  const [checkingSaved, setCheckingSaved] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof listGroups>>>([])
  const [memberships, setMemberships] = useState<Awaited<ReturnType<typeof getMyMemberships>>>([])
  const [groupId, setGroupId] = useState('')
  const [matchupCatalog, setMatchupCatalog] = useState<Awaited<ReturnType<typeof getMyMatchups>>>(null)
  const [resolvedGroupId,setResolvedGroupId] = useState('')
  const [resolvedPlayers,setResolvedPlayers] = useState<string[]>([])
  const [playerContexts, setPlayerContexts] = useState<Awaited<ReturnType<typeof listPlayerContexts>>>([])
  const [optionsGroup, setOptionsGroup] = useState('')
  const [loadedGroup, setLoadedGroup] = useState('')
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getSetupOptions>> | null>(null)
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listSessions>>>([])
  const [standings, setStandings] = useState<Standing[]>([])
  const [state, setState] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [listsLoading, setListsLoading] = useState(false)
  useEffect(() => {
    let live = true
    startup.current ??= restoreStartupRecovery(coordinator,userId,id=>lookupOperationReceipt(id,userId),receipt=>reconcileReceipt(coordinator.current!,receipt),id=>getRemovedMatch(id,userId))
    startup.current.then(result=>{if(live){
      setIntent(result.intent);setRecoveryProblem(null);setReady(true)
      if(result.acknowledged && window.location.hash===`#/session/${result.acknowledged.args.p_session}`)window.location.hash=result.acknowledged.args.p_mode==='delete'?'/matches':'/play'
    }}).catch(error=>{if(live)setRecoveryProblem(error instanceof RecoveryStorageError?error:new RecoveryStorageError('unavailable','Recovery storage could not be checked. Your saved request is preserved.'))})
    return () => { live = false }
  }, [coordinator, userId, recoveryAttempt])
  const dismissNotifications=useCallback(()=>{setError('');setNotice('');setLookupNotice('');setActionError('')},[])
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice])
  function retryRecovery(){if(coordinator.busy)return;startup.current=null;setRecoveryProblem(null);setReady(false);setRecoveryAttempt(x=>x+1)}
  useEffect(() => {
    let live = true
    Promise.all([listGroups(), getMyMemberships(), listPlayerContexts().catch(() => []), getMyMatchups()]).then(([g, m, profiles, catalog]) => {
      if (!live) return
      const authorized = g.filter(group => m.some(member => member.group_id === group.id))
      setMatchupCatalog(catalog ? {...catalog, matchups:catalog.matchups.filter(x => authorized.some(g=>g.id===x.group_id))} : null);
      setGroups(authorized); setMemberships(m); setPlayerContexts(profiles.filter(p => authorized.some(g => g.id === p.group_id)))
      setGroupId(current => chooseGroup(authorized, current, readLastGroup(groupPreferenceKey)))
    }).catch(e => { if (live) setError(errorMessage(e)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [generation, groupPreferenceKey])
  useEffect(() => {
    if (groupId && groups.some(g => g.id === groupId)) rememberGroup(groupPreferenceKey, groupId)
  }, [groupId, groups, groupPreferenceKey])
  useEffect(() => {
    if (!groupId) return
    let live = true
    // Loading state is set by actions that change the group/generation.
    let request=0
    const load=()=>{
      const current=++request
      return Promise.all([getSetupOptions(groupId),listSessions(groupId),getStandings(groupId)]).then(([o,s,t])=>{
        if(live&&current===request){setOptions(o);setSessions(s);setStandings(t);setOptionsGroup(groupId)}
      }).catch(e=>{if(live&&current===request){setSessions([]);setError(errorMessage(e))}}).finally(()=>{if(live&&current===request){setListsLoading(false);setLoadedGroup(groupId)}})
    }
    void load()
    const recheck=()=>{if(document.visibilityState==='visible'){setListsLoading(true);void load()}}
    window.addEventListener('focus',recheck);window.addEventListener('hashchange',recheck);document.addEventListener('visibilitychange',recheck)
    return()=>{live=false;window.removeEventListener('focus',recheck);window.removeEventListener('hashchange',recheck);document.removeEventListener('visibilitychange',recheck)}
  }, [groupId, generation])
  useEffect(() => {
    if (!sessionId) return
    let live = true
    getSessionState(sessionId).then(saved => {
      if (live) { setState(saved); setGroupId(saved.session.group_id) }
    }).catch(e => { if (live) setError(errorMessage(e)) })
      .finally(() => { if (live) setSessionLoading(false) })
    return () => { live = false }
  }, [sessionId, generation])

  function refresh() {
    setError(''); setListsLoading(true); setSessionLoading(Boolean(sessionId)); setGeneration(x => x + 1)
  }
  function apply(result: unknown) {
    setActionError('')
    if (result && typeof result === 'object' && 'removed' in result && result.removed === true) {
      setGroupId((result as SetupResult).group_id); setState(null); setNotice('Match removed.'); setListsLoading(true); setGeneration(x=>x+1);
      window.location.hash = 'mode' in result && result.mode === 'delete' ? '/matches' : '/play'; return
    }
    if (result && typeof result === 'object' && 'session' in result) {
      const saved = result as SessionState
      setState(saved); setGroupId(saved.session.group_id); setSessionLoading(true)
      window.location.hash = `/session/${saved.session.id}`
    } else if (result && typeof result === 'object' && 'group_id' in result) {
      const saved = result as SetupResult
      setGroupId(saved.group_id)
      if (saved.matchup && saved.player_ids) { setResolvedGroupId(saved.group_id); setResolvedPlayers(saved.player_ids); window.location.hash = '/setup' }
      if (saved.role === 'owner' && saved.id === saved.group_id) window.location.hash = '/setup'
    }
    setNotice('Saved.'); setListsLoading(true); setGeneration(x => x + 1)
  }
  async function perform(run: () => Promise<unknown>) {
    const origin=window.location.hash
    setBusy(true); setError(''); setNotice('');setActionError('')
    try { apply(await run()); return true }
    catch (e) { if(window.location.hash===origin){setError(errorMessage(e));setActionError(errorMessage(e))}return false }
    finally { setIntent(coordinator.current); setBusy(false) }
  }
  async function checkSaved() {
    if (coordinator.busy || !coordinator.current) return
    const original = coordinator.current
    setBusy(true); setCheckingSaved(true); setLookupNotice('Checking saved operation without resending it…')
    try {
      const outcome = await coordinator.checkSaved(userId,
        id => lookupOperationReceipt(id, userId), receipt => reconcileReceipt(original, receipt))
      if (outcome.status === 'confirmed_committed') {
        setActionError('');apply(outcome.result)
        setLookupNotice('Matching receipt and current saved state confirmed. This request is acknowledged.')
      } else {setLookupNotice(outcome.message);setActionError('The previous action is still unconfirmed. Nothing was resent or cleared.')}
    } catch { setLookupNotice('The status check could not finish. Your original request is retained.') }
    finally { setIntent(coordinator.current); setCheckingSaved(false); setBusy(false) }
  }
  function submit(kind: Intent['kind'], name: string, args: Record<string, unknown>) {
    if(navigator.onLine===false){setActionError('You’re offline. Connect to the internet before saving.');return Promise.resolve(false)}
    if (!ready || coordinator.busy || coordinator.current) {setActionError(!ready?'Your saved request could not be checked. Review local save recovery in Account before scoring.':'A previous action still needs confirmation. Check its saved status before scoring.');return Promise.resolve(false)}
    const id = crypto.randomUUID()
    const operation: Intent = { kind, name, args: { ...args, p_operation: id }, id, userId, status: 'pending', createdAt: new Date().toISOString() }
    return perform(() => coordinator.submit(operation))
  }
  function scoring<Name extends ScoringName>(name: Name, args: Omit<Functions[Name]['Args'], 'p_operation'>) {
    return submit('scoring', name, args)
  }
  function setup<Name extends SetupName>(name: Name, args: Omit<Functions[Name]['Args'], 'p_operation'>) {
    return submit('setup', name, args)
  }
  async function checkRemovedMatch() {
    if(coordinator.busy)return
    setBusy(true);setLookupNotice('')
    try {apply(await coordinator.acknowledgeRemovedMatch(userId,id=>getRemovedMatch(id,userId)))}
    catch(e){setLookupNotice(errorMessage(e))}
    finally{setIntent(coordinator.current);setBusy(false)}
  }
  async function discardRejected() {
    try {
      await coordinator.discardRejected(); setIntent(null); setError('');setActionError(''); refresh()
    } catch (e) { setError(errorMessage(e)) }
  }
  const role = memberships?.find(x => x.group_id === groupId)?.role
  return {
    userId, groups, groupId, playerContexts, matchupCatalog, resolvedPlayers, resolvedGroupId, memberships, role, options: optionsGroup === groupId ? options : null,
    sessions: optionsGroup === groupId && !listsLoading ? sessions : [], standings: optionsGroup === groupId ? standings : [],
    state, loading, sessionLoading, listsLoading: listsLoading || (!!groupId && loadedGroup !== groupId),
    ready, busy, intent, error, notice, lookupNotice, checkingSaved, checkSaved, scoring, setup, refresh, recoveryProblem, retryRecovery, dismissNotifications, checkRemovedMatch, actionError,
    inputBlocked: busy || sessionLoading || listsLoading || (!!groupId && loadedGroup !== groupId),
    blocked: !ready || busy || !!intent || sessionLoading || listsLoading || (!!groupId && loadedGroup !== groupId),
    canScore: ['owner', 'admin', 'scorer'].includes(role ?? ''),
    canAdmin: ['owner', 'admin'].includes(role ?? ''),
    selectGroup(id: string, goToPlay = true) { if (busy || sessionId || !groups.some(g => g.id === id)) return; setGroupId(id); setOptions(null); setSessions([]); setStandings([]); setListsLoading(true); if (goToPlay) window.location.hash = '/play' },
    retry: () => perform(() => coordinator.retry(userId)), discardRejected,
  }
}
export type ConnectedGame = ReturnType<typeof useConnectedGame>
