import { journalMutation } from './journalPolicy'
import type { Intent, IntentStore } from './operationCoordinator'
import { validIntent, unreadableSnapshot, confirmUnreadableReset, RecoveryStorageError } from './intentValidation'
let database: Promise<IDBDatabase> | undefined
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const projectUrl: unknown = import.meta.env.VITE_SUPABASE_URL
    if (typeof projectUrl !== 'string') { reject(new Error('Recovery storage needs a configured project.')); return }
    let blocked=false
    const request = indexedDB.open(`pule-rpc-intents-v1:${new URL(projectUrl).origin}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('intents', { keyPath: 'userId' })
    request.onsuccess = () => {
      const db = request.result
      if(blocked){db.close();return}
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
    request.onerror = () => { database = undefined; reject(new RecoveryStorageError('unavailable','Recovery storage is unavailable. No new write was sent.')) }
    request.onblocked = () => { blocked=true; database=undefined; reject(new RecoveryStorageError('blocked','Close older Pule tabs, then check recovery again.')) }
  })
  return database.catch(error=>{database=undefined;throw error instanceof RecoveryStorageError?error:new RecoveryStorageError('unavailable','Recovery storage could not be opened. Check browser storage permissions and try again.')})
}
async function write(intent: Intent, action: 'add' | 'update' | 'remove') {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('intents', 'readwrite')
    const store = tx.objectStore('intents')
    let failure: unknown
    const request = store.get(intent.userId)
    request.onsuccess = () => {
      const previous = request.result as Intent | undefined
      try {
        const mutation = journalMutation(previous, intent, action)
        if (mutation === 'delete') store.delete(intent.userId)
        else if (mutation === 'put') store.put(intent)
      } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(failure ?? new Error('Recovery journal could not be saved. Existing requests were preserved.'))
  })
}
export const intentStore: IntentStore = {
  async read(userId) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('intents', 'readonly')
      const request = tx.objectStore('intents').get(userId)
      let found: Intent | null = null
      let malformed=false
      request.onsuccess = () => {
        if (request.result !== undefined && !validIntent(request.result, userId)) { malformed=true; tx.abort(); return }
        found = request.result ?? null
      }
      tx.oncomplete = () => resolve(found)
      tx.onabort = tx.onerror = () => reject(new RecoveryStorageError(malformed?'malformed':'unavailable',malformed?'A saved request could not be read. Preserve it before reviewing a reset.':'Recovery storage could not be read. No request was cleared.'))
    })
  },
  create: intent => write(intent, 'add'),
  update: intent => write(intent, 'update'),
  remove: intent => write(intent, 'remove'),
}

/** Explicit, private export; never logs raw recovery payloads. */
export async function exportUnreadableIntent(userId:string):Promise<string> {
 const db=await open()
 return new Promise((resolve,reject)=>{const tx=db.transaction('intents','readonly');const request=tx.objectStore('intents').get(userId);let snapshot='';let failure:unknown
 request.onsuccess=()=>{try{snapshot=unreadableSnapshot(request.result,userId)}catch(error){failure=error;tx.abort()}}
 tx.oncomplete=()=>resolve(snapshot);tx.onabort=tx.onerror=()=>reject(failure??new Error('Recovery export could not finish.'))})
}
export async function resetUnreadableIntent(userId:string,snapshot:string,confirmed:boolean):Promise<void> {
 const db=await open()
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('intents','readwrite');const store=tx.objectStore('intents');const request=store.get(userId);let failure:unknown
 request.onsuccess=()=>{try{confirmUnreadableReset(request.result,userId,snapshot,confirmed);store.delete(userId)}catch(error){failure=error;tx.abort()}}
 tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(failure??new Error('Recovery reset could not finish. Nothing else was cleared.'))})
}
