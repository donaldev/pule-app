import { receiptMatches } from './receiptRecovery'
import type { LookupOutcome, ReceiptLookup } from './receiptRecovery'
/** Durable RPC intent only. Supabase is always the authority for saved scores. */
export type OperationStatus = 'pending' | 'uncertain' | 'conflict' | 'rejected'
export interface Intent {
  id: string; userId: string; kind: 'scoring' | 'setup'; name: string
  args: Record<string, unknown>; createdAt: string; status: OperationStatus
}
export interface IntentStore {
  read(userId: string): Promise<Intent | null>
  create(intent: Intent): Promise<void>
  update(intent: Intent): Promise<void>
  remove(intent: Intent): Promise<void>
}
export function classifyFailure(error: unknown): OperationStatus {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '40001') return 'conflict'
  // On an initial single attempt, these SQL errors prove rejection/rollback. Transport, auth and API failures remain retryable.
  if (/^(22|23)[0-9A-Z]{3}$/.test(code) || ['42501', '55000'].includes(code)) return 'rejected'
  return 'uncertain'
}
export class OperationCoordinator {
  current: Intent | null = null
  busy = false
  readonly store: IntentStore
  readonly send: (intent: Intent) => Promise<unknown>
  constructor(store: IntentStore, send: (intent: Intent) => Promise<unknown>) { this.store = store; this.send = send }
  async restore(userId: string) {
    this.current = await this.store.read(userId)
    return this.current
  }
  async submit(intent: Intent): Promise<unknown> {
    if (this.busy || this.current) throw new Error('Resolve the previous saved operation first.')
    this.busy = true
    try {
      await this.store.create(intent) // Transaction must commit before any network write.
      this.current = intent
      return await this.execute(intent)
    } finally { this.busy = false }
  }
  async retry(userId: string): Promise<unknown> {
    if (this.busy || !this.current || this.current.userId !== userId) throw new Error('No operation available for this account.')
    if (['conflict', 'rejected'].includes(this.current.status)) throw new Error('Review the rejected operation before creating a new intent.')
    this.busy = true
    try { return await this.execute(this.current, true) } finally { this.busy = false }
  }
  private async execute(intent: Intent, replay = false) {
    let acknowledged = false
    try {
      const response = await this.send(intent)
      acknowledged = true
      // Cleanup failure is uncertain locally: retain original UUID for a safe receipt retry.
      await this.store.remove(intent)
      this.current = null
      return response
    } catch (error) {
      this.current = { ...intent, status: acknowledged || replay ? 'uncertain' : classifyFailure(error) }
      try { await this.store.update(this.current) } catch { /* Original committed intent remains recoverable. */ }
      throw error
    }
  }
  /** Explicit read-only lookup; never calls send() and never rewrites a negative intent. */
  async checkSaved(userId: string, lookup: (id: string) => Promise<ReceiptLookup>, reconcile: (receipt: ReceiptLookup) => Promise<unknown>): Promise<LookupOutcome> {
    if (this.busy || !this.current || this.current.userId !== userId) return { status: 'lookup_failed', message: 'No saved request is available for this account.' }
    const original = this.current
    this.busy = true
    try {
      let receipt: ReceiptLookup
      try { receipt = await lookup(original.id) }
      catch { return { status: 'lookup_failed', message: 'Could not check this save. The original request is unchanged; no scoring action was resent.' } }
      if (receipt.status === 'not_confirmed') return { status: 'not_confirmed', message: 'No matching authorized receipt was found. This does not prove failure. Your original request is retained and scoring remains locked.' }
      if (!receiptMatches(original, receipt)) return { status: 'context_mismatch', message: 'The receipt does not match every part of this original request. Nothing was cleared.' }
      let result: unknown
      try { result = await reconcile(receipt) }
      catch { return { status: 'reconciliation_failed', message: 'A matching receipt exists, but current saved state could not be verified. The original request is retained.' } }
      try { await this.store.remove(original) }
      catch { return { status: 'cleanup_failed', message: 'The save and current state are confirmed, but local cleanup could not finish safely. The original request is retained; check again without resending it.' } }
      this.current = null
      return { status: 'confirmed_committed', result }
    } finally { this.busy = false }
  }
  /** Explicit outcome acknowledgment, not a fabricated receipt for the original operation.
   * A different authorized removal may already have achieved the exact intended result. */
  async acknowledgeRemovedMatch(userId:string, verify:(sessionId:string)=>Promise<{id:string;group_id:string;removed?:boolean;mode?:string}>) {
    const original=this.current
    if(this.busy||!original||original.userId!==userId||original.kind!=='setup'||original.name!=='remove_match'||typeof original.args.p_session!=='string')throw new Error('No removal request is available.')
    this.busy=true
    try {
      const proof=await verify(original.args.p_session)
      if(proof.removed!==true||proof.id!==original.args.p_session||proof.mode!==original.args.p_mode||!proof.group_id)throw new Error('The server has not confirmed this match removal. Nothing was cleared.')
      await this.store.remove(original)
      this.current=null
      return proof
    } finally {this.busy=false}
  }
  async discardRejected() {
    if (this.busy || !this.current || !['conflict', 'rejected'].includes(this.current.status)) {
      throw new Error('Uncertain writes must be resolved with the original operation ID.')
    }
    await this.store.remove(this.current)
    this.current = null
  }
}
