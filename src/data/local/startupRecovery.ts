import type { OperationCoordinator } from './operationCoordinator'
import type { ReceiptLookup } from './receiptRecovery'
/** Startup may acknowledge a removal read-only; it must never resend one. */
export async function restoreStartupRecovery(coordinator:OperationCoordinator,userId:string,lookup:(id:string)=>Promise<ReceiptLookup>,reconcile:(receipt:ReceiptLookup)=>Promise<unknown>,verifyRemoved?:(sessionId:string)=>Promise<{id:string;group_id:string;removed?:boolean;mode?:string}>) {
 const found=await coordinator.restore(userId)
 if(found?.name==='remove_match') {
  const outcome=await coordinator.checkSaved(userId,lookup,reconcile)
  if(outcome.status==='confirmed_committed')return {intent:coordinator.current,acknowledged:found}
  if(verifyRemoved){try{await coordinator.acknowledgeRemovedMatch(userId,verifyRemoved);return {intent:coordinator.current,acknowledged:found}}catch{/* No authorized exact-match proof: retain the request unchanged. */}}
 }
 return {intent:coordinator.current,acknowledged:null}
}
