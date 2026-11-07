import { useSyncExternalStore } from 'react'
import { getUpdateWaiting, subscribeToUpdates } from './register'
export function AppUpdateStatus({protectedWork}:{protectedWork:boolean}) {
 const waiting=useSyncExternalStore(subscribeToUpdates,getUpdateWaiting,()=>false)
 if(!waiting)return null
 return <section className="pwa-update" aria-label="App update"><h2>App update ready</h2><p>{protectedWork?'Finish scoring and resolve any saved actions first. Then close every Pule tab/window and reopen to update.':'Close every Pule tab/window and reopen when you’ve finished scoring to use the update.'}</p></section>
}
