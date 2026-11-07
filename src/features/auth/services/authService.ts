import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getSupabase } from '../../../data/remote/supabase'

// Authentication does not create or claim a sporting player identity.
export async function signIn(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}
export async function signOut() {
  // The account screen confirms retention of any unresolved, account-scoped recovery intent.
  const { error } = await getSupabase().auth.signOut({ scope: 'local' })
  if (error) throw error
}
export async function getAuthenticatedUser() {
  const { data, error } = await getSupabase().auth.getUser()
  if (error) throw error
  return data.user
}
export async function getAuthSession() {
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw error
  return data.session
}
export function onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
  return getSupabase().auth.onAuthStateChange(callback).data.subscription
}

/** Auth registration creates no group membership or sporting-identity claim. */
export async function signUp(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + '/' } })
  if (error) throw error
  return data
}

export async function resendConfirmation(email: string) {
  const { error } = await getSupabase().auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin + '/' } })
  if (error) throw error
}
// Keep return state same-origin and route-only; never put sessions/tokens in query strings.
const returnKey='pule:auth-return'
const linkUserKey='pule:auth-link-user'
function authReturnUrl() {
  const origin=new URL(window.location.origin)
  if(origin.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) throw new Error('Use HTTPS or localhost for secure sign-in.')
  return origin.origin+'/'
}
function saveReturnRoute() {
  const route=window.location.hash
  try { window.sessionStorage.removeItem(returnKey) } catch { /* No stale return route. */ }
  if(/^#\/(account|home|play|claim\/[a-f0-9]{64})$/.test(route)) {
    try { window.sessionStorage.setItem(returnKey,route) } catch { /* Callback can still finish at Home. */ }
  }
}
export async function signInWithGoogle() {
  try { window.sessionStorage.removeItem(linkUserKey) } catch { /* No pending link expected. */ }
  saveReturnRoute()
  const {error}=await getSupabase().auth.signInWithOAuth({provider:'google',options:{redirectTo:authReturnUrl()}})
  if(error)throw new Error('Google sign-in is not available. Please try email and password.')
}
export async function connectGoogle() {
  const user=await getAuthenticatedUser()
  if(!user)throw new Error('Sign in before connecting Google.')
  try { window.sessionStorage.setItem(linkUserKey,user.id) } catch { throw new Error('Allow browser storage before connecting Google.') }
  saveReturnRoute()
  try {
    // Own navigation explicitly so a missing URL cannot leave the button spinning.
    const {data,error}=await getSupabase().auth.linkIdentity({provider:'google',options:{redirectTo:authReturnUrl(),skipBrowserRedirect:true}})
    if(error) {
      if(error.code==='manual_linking_disabled') throw new Error('Connecting Google is disabled in Supabase. Enable manual identity linking in Authentication settings, then try again.')
      throw new Error(error.message || 'Google could not be connected. Please try again.')
    }
    if(!data?.url) throw new Error('Google did not return a connection link. Please try again.')
    const destination=new URL(data.url)
    if(destination.protocol!=='https:') throw new Error('Google returned an insecure connection link.')
    window.location.assign(destination.href)
  } catch(error) {
    try { window.sessionStorage.removeItem(linkUserKey) } catch { /* No retained marker. */ }
    throw error
  }
}
export async function authenticationMethods() {
  const {data,error}=await getSupabase().auth.getUserIdentities()
  if(error)throw error
  return [...new Set(data.identities.map(i=>i.provider))]
}
let initialization: Promise<Session | null> | undefined
async function handleConfirmation() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const hash = new URLSearchParams(url.hash.startsWith('#error=') ? url.hash.slice(1) : '')
  const callbackError = url.searchParams.has('error') || hash.has('error') || url.searchParams.has('error_description')
  if (!code && !callbackError) return
  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key)
  if (hash.has('error')) url.hash = '/play'
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  if (callbackError) { try { window.sessionStorage.removeItem(returnKey); window.sessionStorage.removeItem(linkUserKey) } catch { /* No unsafe fallback. */ } throw new Error('Sign-in or email confirmation could not be completed. Request a new confirmation email or try signing in if already confirmed.')}
  if (code) {
    const { error } = await getSupabase().auth.exchangeCodeForSession(code)
    if (error) throw new Error('Could not finish sign-in or confirmation in this browser. Return to the browser or installed app where you started. If your email is confirmed, sign in with your password; otherwise request a new link.')
    try {
      const route=window.sessionStorage.getItem(returnKey)
      window.sessionStorage.removeItem(returnKey)
      if(route && /^#\/(account|home|play|claim\/[a-f0-9]{64})$/.test(route)) window.history.replaceState(null,'',url.pathname+url.search+route)
    } catch { /* Storage unavailable: no unsafe redirect fallback. */ }
  }
}
export async function initializeAuth() {
  // One exchange in StrictMode; confirmation codes can only be used once.
  initialization ??= (async()=>{
  await handleConfirmation()
  const session=await getAuthSession()
  let expected:string|null=null
  try { expected=window.sessionStorage.getItem(linkUserKey);window.sessionStorage.removeItem(linkUserKey) } catch { /* No retained link marker. */ }
  if(expected && session?.user.id!==expected){await getSupabase().auth.signOut({scope:'local'});throw new Error('Google did not return to your original account. Sign in with your existing email and password; no player was reassigned.')}
  return session
  })()
  return initialization
}
