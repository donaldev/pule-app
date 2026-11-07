import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/features/auth/services/authService.ts', import.meta.url), 'utf8')
let sequence = 0
async function service(auth, href = 'http://localhost:5173/#/play', storage = new Map()) {
  globalThis.__puleAuthMock = { auth }
  const location = { href, origin: new URL(href).origin, hash: new URL(href).hash, assign(url) { this.href=url } }
  globalThis.window = { location, sessionStorage: {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, history: { replaceState(_state, _title, path) { location.href = new URL(path, location.origin).href; location.hash=new URL(location.href).hash } } }
  const input = source.replace("import { getSupabase } from '../../../data/remote/supabase'", 'const getSupabase = () => globalThis.__puleAuthMock')
  const code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(code + `\n// isolated ${sequence++}`).toString('base64'))
}
test('signup uses root confirmation redirect without creating a player or group', async () => {
  let request
  const api = await service({ signUp: async args => { request = args; return { data: { session: null }, error: null } } })
  assert.deepEqual(await api.signUp('synthetic@example.invalid', 'synthetic-password'), { session: null })
  assert.equal(request.options.emailRedirectTo, 'http://localhost:5173/')
  assert.equal(request.email, 'synthetic@example.invalid')
})
test('StrictMode/concurrent initialization exchanges the confirmation code once', async () => {
  let exchanges = 0; let saved = null
  const api = await service({
    exchangeCodeForSession: async code => { exchanges++; assert.equal(code, 'synthetic-code'); await Promise.resolve(); saved = { user: { id: 'synthetic-user' } }; return { error: null } },
    getSession: async () => ({ data: { session: saved }, error: null }),
  }, 'http://localhost:5173/?code=synthetic-code#/play')
  const [a, b] = await Promise.all([api.initializeAuth(), api.initializeAuth()])
  assert.equal(exchanges, 1); assert.deepEqual(a, b)
  assert.equal(new URL(window.location.href).searchParams.has('code'), false)
})
test('failed confirmation removes the code and returns safe recovery guidance', async () => {
  const api = await service({ exchangeCodeForSession: async () => ({ error: { message: 'backend-sensitive-diagnostic' } }) }, 'http://localhost:5173/?code=synthetic-failed-code')
  await assert.rejects(api.initializeAuth(), error => /sign in with your password/.test(error.message) && !error.message.includes('backend-sensitive'))
  assert.equal(new URL(window.location.href).search, '')
})
test('confirmation error hash is cleared without reflecting untrusted message', async () => {
  const api = await service({}, 'http://localhost:5173/#error=access_denied&error_description=untrusted-diagnostic')
  await assert.rejects(api.initializeAuth(), error => error.message.includes('confirmation') && !error.message.includes('untrusted-diagnostic'))
  assert.equal(new URL(window.location.href).hash, '#/play')
})
test('resend uses same allowed root URL; no scoring service involved', async () => {
  let request
  const api = await service({ resend: async args => { request = args; return { error: null } } })
  await api.resendConfirmation('synthetic@example.invalid')
  assert.equal(request.type, 'signup'); assert.equal(request.options.emailRedirectTo, 'http://localhost:5173/')
})
test('sign-out is scoped to this browser', async () => {
  let request
  const api = await service({ signOut: async args => { request = args; return { error: null } } })
  await api.signOut(); assert.deepEqual(request, { scope: 'local' })
})

test('Google uses same-origin PKCE return and retains invitation only in private route state',async()=>{
 let request;const token='a'.repeat(64);const storage=new Map()
 const api=await service({signInWithOAuth:async args=>{request=args;return {error:null}}},'https://pule.example.invalid/#/claim/'+token,storage)
 await api.signInWithGoogle()
 assert.deepEqual(request,{provider:'google',options:{redirectTo:'https://pule.example.invalid/'}})
 assert.equal(storage.get('pule:auth-return'),'#/claim/'+token)
 assert.equal(request.options.redirectTo.includes(token),false)
})
test('OAuth callback exchanges once and restores only an allowed internal route',async()=>{
 let exchanges=0;const storage=new Map([['pule:auth-return','#/claim/'+'b'.repeat(64)]])
 const api=await service({exchangeCodeForSession:async()=>{exchanges++;return {error:null}},getSession:async()=>({data:{session:{user:{id:'synthetic'}}},error:null})},'https://pule.example.invalid/?code=synthetic-code',storage)
 await Promise.all([api.initializeAuth(),api.initializeAuth()]);assert.equal(exchanges,1)
 assert.equal(new URL(window.location.href).hash,'#/claim/'+'b'.repeat(64));assert.equal(storage.size,0)
})
test('OAuth never follows an external saved return URL',async()=>{
 const storage=new Map([['pule:auth-return','https://evil.example.invalid/']])
 const api=await service({exchangeCodeForSession:async()=>({error:null}),getSession:async()=>({data:{session:null},error:null})},'https://pule.example.invalid/?code=synthetic-code',storage)
 await api.initializeAuth();assert.equal(new URL(window.location.href).origin,'https://pule.example.invalid')
})
test('connecting Google uses authenticated identity linking, never sporting identity or email matching',async()=>{
 let request;const storage=new Map()
 const api=await service({getUser:async()=>({data:{user:{id:'existing-account'}},error:null}),linkIdentity:async args=>{request=args;return {data:{url:'https://accounts.google.com/o/oauth2/auth?synthetic=1'},error:null}}},'https://pule.example.invalid/#/account',storage)
 await api.connectGoogle();assert.equal(storage.get('pule:auth-link-user'),'existing-account');assert.equal(request.provider,'google');assert.equal(request.options.skipBrowserRedirect,true);assert.equal(window.location.href,'https://accounts.google.com/o/oauth2/auth?synthetic=1')
})
test('wrong-account provider return is rejected consistently in StrictMode and signed out locally',async()=>{
 let signouts=0;const storage=new Map([['pule:auth-link-user','original-account']])
 const api=await service({exchangeCodeForSession:async()=>({error:null}),getSession:async()=>({data:{session:{user:{id:'other-account'}}},error:null}),signOut:async args=>{assert.equal(args.scope,'local');signouts++;return {error:null}}},'https://pule.example.invalid/?code=synthetic',storage)
 const results=await Promise.allSettled([api.initializeAuth(),api.initializeAuth()]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(signouts,1)
})
test('provider methods expose method names only',async()=>{
 const api=await service({getUserIdentities:async()=>({data:{identities:[{provider:'email',id:'private-id'},{provider:'google',identity_data:{email:'private'}},{provider:'google'}]},error:null})})
 assert.deepEqual(await api.authenticationMethods(),['email','google'])
})
test('OAuth cancellation removes errors without reflecting provider diagnostics',async()=>{
 const api=await service({},'https://pule.example.invalid/?error=access_denied&error_description=secret-diagnostic')
 await assert.rejects(api.initializeAuth(),e=>!e.message.includes('secret-diagnostic'));assert.equal(new URL(window.location.href).search,'')
})

test('Google OAuth refuses insecure non-local app origins',async()=>{
 let called=false;const api=await service({signInWithOAuth:async()=>{called=true;return {error:null}}},'http://192.0.2.1/#/home')
 await assert.rejects(api.signInWithGoogle(),/HTTPS/);assert.equal(called,false)
})

test('Google linking surfaces manual-linking configuration errors and clears pending marker',async()=>{
 const storage=new Map()
 const api=await service({getUser:async()=>({data:{user:{id:'existing-account'}},error:null}),linkIdentity:async()=>({data:{url:null},error:{code:'manual_linking_disabled',message:'Manual linking is disabled'}})},'https://pule.example.invalid/#/account',storage)
 await assert.rejects(api.connectGoogle(),/Enable manual identity linking/)
 assert.equal(storage.has('pule:auth-link-user'),false)
})
test('Google linking rejects missing redirects and exposes browser navigation failure',async()=>{
 for(const url of [null,'https://accounts.google.com/oauth']) {
  const storage=new Map()
  const api=await service({getUser:async()=>({data:{user:{id:'existing-account'}},error:null}),linkIdentity:async()=>({data:{url},error:null})},'https://pule.example.invalid/#/account',storage)
  window.location.assign=()=>{throw new Error('Browser blocked navigation')}
  await assert.rejects(api.connectGoogle(),url?/Browser blocked/:/did not return/)
  assert.equal(storage.has('pule:auth-link-user'),false)
 }
})
test('successful Google callback retains the original Auth account',async()=>{
 const storage=new Map([['pule:auth-link-user','original-account'],['pule:auth-return','#/account']])
 const api=await service({exchangeCodeForSession:async()=>({error:null}),getSession:async()=>({data:{session:{user:{id:'original-account'}}},error:null})},'https://pule.example.invalid/?code=synthetic',storage)
 assert.equal((await api.initializeAuth()).user.id,'original-account')
 assert.equal(window.location.hash,'#/account')
})

test('Netlify deployment redirects to its root origin and preserves an invitation claim',async()=>{
 const storage=new Map();let request
 const origin='https://pule-production-example.netlify.app',token='c'.repeat(64)
 const api=await service({signInWithOAuth:async args=>{request=args;return {error:null}}},origin+'/#/claim/'+token,storage)
 await api.signInWithGoogle();assert.equal(request.options.redirectTo,origin+'/');assert.equal(storage.get('pule:auth-return'),'#/claim/'+token)
})
