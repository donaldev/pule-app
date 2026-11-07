import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64')
const {validatePublicBuild}=await import(url(await read('scripts/pwa/config.ts')))
test('build accepts only browser credentials and checks the intended Netlify project',()=>{
 const env={VITE_SUPABASE_URL:'https://pgljdmevusgvvlplaedt.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}
 assert.doesNotThrow(()=>validatePublicBuild(env,true))
 assert.throws(()=>validatePublicBuild({},true),/Set VITE/)
 assert.throws(()=>validatePublicBuild({...env,VITE_SUPABASE_URL:'https://other.supabase.co'},true),/pgljdme/)
 assert.throws(()=>validatePublicBuild({...env,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'}),/secret/)
 const jwt=role=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature'
 assert.doesNotThrow(()=>validatePublicBuild({...env,VITE_SUPABASE_PUBLISHABLE_KEY:jwt('anon')}))
 assert.throws(()=>validatePublicBuild({...env,VITE_SUPABASE_PUBLISHABLE_KEY:jwt('service_role')}),/Only a publishable/)
})
test('manifest and exported brand icons have valid install dimensions and root scope',async()=>{
 const manifest=JSON.parse(await read('public/manifest.webmanifest'))
 for(const key of ['name','short_name'])assert.equal(manifest[key],'Pule')
 for(const key of ['start_url','scope','id'])assert.equal(manifest[key],'/')
 assert.equal(manifest.display,'standalone');assert.ok(manifest.icons.some(i=>i.purpose==='maskable'))
 for(const icon of [...manifest.icons,{src:'/pwa/apple-touch-icon.png',sizes:'180x180'}]){
  const bytes=await readFile(new URL('../../public'+icon.src,import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG')
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes)
 }
 const html=await read('index.html');assert.match(html,/viewport-fit=cover/);assert.match(html,/apple-touch-icon/)
})
test('worker is static-only, waits for closed clients, and has no injected auto-update',async()=>{
 const config=await read('vite.config.ts'),registration=await read('src/pwa/register.ts')
 assert.match(config,/runtimeCaching:\[\]/);assert.match(config,/skipWaiting:false/);assert.match(config,/clientsClaim:false/);assert.match(config,/injectRegister:false/)
 assert.match(config,/ignoreURLParametersMatching:\[\]/)
 assert.doesNotMatch(registration,/\.reload\(|\.postMessage\(|\.skipWaiting\(|\.claim\(|indexedDB|localStorage/)
 assert.match(registration,/updateViaCache:'none'/)
 const netlify=await read('netlify.toml');assert.match(netlify,/publish = "dist"/);assert.match(netlify,/to = "\/index.html"/);assert.match(netlify,/no-store/);assert.match(netlify,/immutable/)
})
test('waiting-worker notification never activates a worker or reloads an unsafe tab',async()=>{
 let update,installed,visible,notice=0,checks=0
 const worker={state:'installing',addEventListener(name,fn){if(name==='statechange')installed=fn}}
 const registration={waiting:null,installing:worker,addEventListener(name,fn){if(name==='updatefound')update=fn},async update(){checks++}}
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{async register(path,options){assert.equal(path,'/sw.js');assert.equal(options.updateViaCache,'none');return registration}}}})
 globalThis.document={visibilityState:'visible',addEventListener(name,fn){if(name==='visibilitychange')visible=fn}}
 const api=await import(url(await read('src/pwa/register.ts')))
 const unsubscribe=api.subscribeToUpdates(()=>notice++)
 await api.registerPuleWorker();assert.equal(api.getUpdateWaiting(),false)
 update();registration.waiting=worker;worker.state='installed';installed();assert.equal(api.getUpdateWaiting(),true);assert.equal(notice,1)
 visible();await new Promise(resolve=>setImmediate(resolve));assert.equal(checks,1);unsubscribe()
})

test('Account update notice has no reload action and respects protected work wording',async()=>{
 let waiting=false
 const React={createElement:(type,props,...children)=>({type,props,children:children.flat(Infinity)})}
 globalThis.__pwaUi={React,useSyncExternalStore:()=>waiting,getUpdateWaiting:()=>waiting,subscribeToUpdates:()=>()=>{}}
 const src=(await read('src/pwa/AppUpdateStatus.tsx')).replace(/^import .*$/gm,'')
 const {AppUpdateStatus}=await import(url('const {React,useSyncExternalStore,getUpdateWaiting,subscribeToUpdates}=globalThis.__pwaUi;'+src))
 assert.equal(AppUpdateStatus({protectedWork:false}),null)
 waiting=true
 const text=n=>typeof n==='object'?n.children.map(text).join(' '):String(n??'')
 assert.match(text(AppUpdateStatus({protectedWork:true})),/resolve any saved actions first/)
 assert.match(text(AppUpdateStatus({protectedWork:false})),/Close every Pule tab\/window/)
 assert.doesNotMatch(src,/reload\(|postMessage\(/)
})
