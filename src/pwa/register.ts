// Updates wait for ALL old Pule windows to close. Never skipWaiting, claim clients,
// reload a page, touch recovery storage or queue requests in this module.
let waiting=false
const listeners=new Set<()=>void>()
export const getUpdateWaiting=()=>waiting
export function subscribeToUpdates(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
function markWaiting(value:boolean){if(waiting===value)return;waiting=value;listeners.forEach(fn=>fn())}
export async function registerPuleWorker() {
 if(!('serviceWorker' in navigator))return
 try {
  const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'})
  const inspect=()=>markWaiting(!!registration.waiting)
  inspect()
  registration.addEventListener('updatefound',()=>{
   const worker=registration.installing
   worker?.addEventListener('statechange',()=>{if(worker.state==='installed')inspect()})
  })
  // A newly deployed worker can be downloaded while scoring; activation still waits.
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible')void registration.update().then(inspect).catch(()=>{})
  })
 }catch{ /* A browser that declines service workers can still use the online app. */ }
}
