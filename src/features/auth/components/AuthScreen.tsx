import { useState, type FormEvent } from 'react'
import { PageHeading } from '../../../components/ui/Primitives'
import { signIn, signUp, resendConfirmation, signInWithGoogle } from '../services/authService'
import { errorMessage } from '../../connected/useConnectedGame'
export function AuthScreen({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else {
        await signUp(email.trim(), password)
        setMessage('Check your inbox to confirm your email. Open the link in this browser, or return here and sign in after confirming.'); setPassword('')
      }
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <div className="narrow-page connected-form">
    <PageHeading label="The next frame" title={mode === 'signin' ? 'Back at the table.' : 'Make it your night.'}>Your opponents. Your matches. Your history.</PageHeading>
    <div className="insight-tabs" role="group" aria-label="Account action">
      <button disabled={busy} aria-pressed={mode === 'signin'} onClick={() => { setMode('signin'); setError(''); setMessage('') }}>Sign in</button>
      <button disabled={busy} aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Create account</button>
    </div>
    <button className="button button-secondary w-full" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await signInWithGoogle()}catch{setError('Google sign-in is unavailable. Please use email and password.')}finally{setBusy(false)}}}>Continue with Google</button>
    <form onSubmit={submit} className="connected-stack"><fieldset disabled={busy}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="connected-error">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}
      <button className="button w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
    </fieldset></form>
    <button className="text-button" disabled={!email || busy} onClick={async () => {
      setBusy(true); setError('')
      try { await resendConfirmation(email.trim()); setMessage('If confirmation is available for this address, an email has been requested. Check your inbox.') }
      catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
    }}>Resend confirmation email</button>
    <p className="annotation">Confirm your email, then head to Play. Your player history stays separate until linked.</p>
  </div>
}
