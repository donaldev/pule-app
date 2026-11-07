/** Fail builds without printing public keys or accepting server credentials. */
export function validatePublicBuild(env:Record<string,string>,netlify=false) {
 const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY
 if(!url||!key)throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building.')
 let parsed:URL
 try{parsed=new URL(url)}catch{throw new Error('Invalid public Supabase URL.')}
 const local=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||!(parsed.protocol==='https:'||parsed.protocol==='http:'&&local))throw new Error('Use an HTTPS Supabase project origin (HTTP is allowed for localhost).')
 if(netlify&&parsed.origin!=='https://pgljdmevusgvvlplaedt.supabase.co')throw new Error('Netlify production builds must target Supabase project pgljdmevusgvvlplaedt.')
 if(key.startsWith('sb_publishable_'))return
 let role:unknown
 try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role}catch{throw new Error('Use a publishable key or legacy anon key, never a server secret.')}
 if(key.split('.').length!==3||role!=='anon')throw new Error('Only a publishable or legacy anon key can be bundled into Pule.')
}
