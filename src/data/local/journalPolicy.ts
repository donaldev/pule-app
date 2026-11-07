import type { Intent } from './operationCoordinator'
export type JournalAction = 'add' | 'update' | 'remove'
/** Shared by the actual IndexedDB transaction and isolated regression tests. */
export function journalMutation(previous: Intent | undefined, incoming: Intent, action: JournalAction): 'put' | 'delete' | 'unchanged' {
  if (action === 'add') {
    if (previous) throw new Error('Another tab has an unresolved recovery request. This new action was not sent; inspect recovery before continuing.')
    return 'put'
  }
  // Another tab may already have cleaned up this same acknowledged receipt.
  // No record exists to delete, so cleanup is an idempotent no-op.
  if (action === 'remove' && !previous) return 'unchanged'
  if (previous?.id !== incoming.id) throw new Error('The shared journal belongs to another operation. Existing recovery requests were preserved.')
  if (previous.userId!==incoming.userId || previous.kind!==incoming.kind || previous.name!==incoming.name || JSON.stringify(previous.args)!==JSON.stringify(incoming.args)) throw new Error('The saved request changed. Nothing was cleared or rewritten.')
  return action === 'remove' ? 'delete' : 'put'
}
