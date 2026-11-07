import type { Intent } from '../../data/local/operationCoordinator'
export function recoveryPresentation(intent: Intent, error = '') {
  void error
  if(intent.name==='remove_match')return {
    title:['conflict','rejected'].includes(intent.status)?'Match removal needs review':'Check match removal',
    explanation:'This device has a saved removal request. Check its status before starting another match.',
    action:'View save status',
  }
  if (intent.status === 'conflict') return {
    title: 'Scores changed on another screen',
    explanation: 'This action wasn’t saved. Refresh scores before continuing.',
    action: 'View save status',
  }
  if (intent.status === 'rejected') return {
    title: 'This action couldn’t be saved',
    explanation: 'Your last saved scores are safe. Refresh scores to review them.',
    action: 'View save status',
  }
  return {
    title: 'We can’t confirm your save yet',
    explanation: 'Scoring is paused to avoid counting twice. Refresh to see the latest scores; your pending action will stay safe.',
    action: 'View save status',
  }
}
export function revealRecovery() {
  const panel = document.getElementById('operation-recovery')
  panel?.focus({ preventScroll: true })
  panel?.scrollIntoView({ block: 'start', behavior: 'auto' })
}

// Presentation scope only. The account-wide journal lock is deliberately unchanged.
export function recoveryVisibleOnRoute(intent: Intent, route: string): boolean {
  if(intent.name==='remove_match')return route===`/session/${intent.args.p_session}` || ['/play','/matches','/matches/group'].includes(route)
  if(intent.name==='claim_guest_email')return !route.startsWith('/session/')
  if (['create_player_invitation','revoke_player_invitation'].includes(intent.name)) return route === '/account'
  if (intent.name === 'accept_player_invitation') return route.startsWith('/claim/') || route === '/account'
  if (typeof intent.args.p_session === 'string') return route === `/session/${intent.args.p_session}`
  // Creation has no saved match ID yet; keep its recovery at the originating setup.
  if (intent.name === 'create_group') return route === '/new-group' || route === '/play'
  return route === '/setup' || route === '/group-settings'
    || (route === '/play' && (intent.name === 'start_session' || intent.name === 'create_venue' || intent.name === 'create_guest' || intent.name === 'create_guest_with_email' || intent.name === 'resolve_matchup'))
}
