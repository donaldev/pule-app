# Live two-tab recovery investigation

4 November 2026. Investigation used existing source, owner-provided browser observations, enforced read-only hosted SQL and isolated mocked regressions. **No hosted mutation, replay, receipt modification, browser IndexedDB clearing or new test data.**

## Conclusion

The reported Tab 2 state is **correct uncertain-write protection after a client timeout**, not evidence of a received stale-revision rejection being misclassified. The UI was misleading: the generic message near scoring did not distinguish a timeout from a known conflict, while the actual recovery controls were above the long scoring view. Those controls existed; the owner subsequently found them.

A separate cross-tab cleanup bug was reproduced locally and fixed: a successful receipt could still become an endless local uncertainty loop when another tab had already removed the shared journal row. **That is not established as the cause of this incident.** Tab 2 has a different UUID from the acknowledged Tab 1 completion and no committed receipt of its own at the observed snapshot.

The underlying reason the second attempt timed out remains unproven. No usable HTTP response or preserved Network entry is available. The original intent must remain available; the fix does not unlock/discard it automatically.

## Evidence for this session

| Item | Confirmed finding |
| --- | --- |
| Session | `65ae10bb-9af3-4749-a3d8-35092b05f14c` |
| Session state | Active, revision **3** |
| Frames | Exactly **one completed frame**, number 1 |
| Frame UUID | `42baaa5d-33a3-4f60-8dfc-fa9395aba0ac` |
| Committed completion operation | `20c0e7b0-2789-437c-87d7-bd70294f3cbf` |
| Its receipt | Expected revision 2; saved revision 3 |
| Completion event count | Exactly **1** |
| Owner-reported Tab 2 operation | `2bed6a55-a746-4aad-b0f9-bbb4e613efed` |
| Owner-reported error/status | `TimeoutError: signal timed out`; “Save outcome not confirmed” |
| Tab 2 receipt/event count | **0 / 0** at the read-only snapshot |
| Owner-reported Network evidence | No entry visible; preservation before the incident is unknown |
| Exact-operation snapshot | 4 November 2026, 14:38:37 PST / 22:38:37 UTC |

Sanitized, session-scoped evidence: [TWO_TAB_CONFLICT_EVIDENCE.json](TWO_TAB_CONFLICT_EVIDENCE.json). No player names, email addresses, Auth tokens, headers or passwords were collected. Initial recent-session discovery was narrowed in the saved evidence to the owner's identified session.

These are point-in-time findings. The second operation had **not committed** at that snapshot. No receipt is not proof of a failed, canceled or never-delivered HTTP request: rejected transactions do not persist success receipts, and a request might not have reached the transaction at all. An empty Network panel opened after the event is likewise not proof that no request was sent.

## What the client/server code establishes

- [operationCoordinator.ts](../src/data/local/operationCoordinator.ts), `submit` and `execute`: the intent is persisted before `send`; a transport timeout keeps UUID/payload and sets uncertainty. The reported stored operation and timeout indicate the coordinator entered its send path, **not necessarily that an HTTP POST reached Supabase**.
- [scoringService.ts](../src/data/remote/scoringService.ts), `saveScoringCommand`: RPC retry is disabled; a 20-second AbortSignal is used. Authorization acquisition is awaited before execution. The signal is currently created before that wait. The installed SDK also awaits token acquisition inside its authenticated fetch wrapper. Without a trace, time spent in Auth coordination, transport or the server cannot be separated. No networking/timing change was made based on speculation.
- `OperationCoordinator.classifyFailure`: a fresh SQLSTATE `40001` maps to `conflict`. A transport/DOM timeout maps to `uncertain`; a short DOM code such as `23` is not treated as a five-character SQLSTATE. This classification was already correct and is unchanged.
- `OperationCoordinator.retry`: previously uncertain/restored operations remain uncertain after a later error, because a prior attempt might have committed. It does not rebase the revision or generate another UUID. This protection is unchanged.
- [useConnectedGame.ts](../src/features/connected/useConnectedGame.ts), `perform`, `blocked`, `refresh`: `busy` is cleared after the error, but any retained intent deliberately keeps scoring disabled. Refresh reads saved state; it does **not** acknowledge a receipt or clear uncertainty. This is not an indefinitely running `busy` flag.
- [202611030003_rotating_players.sql](../supabase/migrations/202611030003_rotating_players.sql), `private.scoring_command`: membership/assignment checks, idempotency lookup and locked revision validation precede mutation. Successful receipts/events are atomic with frame completion; a rejected transaction leaves no success record. No schema/RPC code changed.
- [App.tsx](../src/app/App.tsx), `OperationStatus`: there were different recovery controls for conflict versus uncertainty at the top. [SessionView.tsx](../src/features/connected/SessionView.tsx) previously showed the same generic “Operation unresolved” message for all retained statuses, without an adjacent recovery action.

**Therefore:** there is no captured `40001` response for Tab 2. Reclassifying its timeout as a definite conflict, erasing the intent or assuming a second award would be unsupported.

## Safe frontend changes implemented

1. **Status-specific recovery next to scoring.** Known conflicts explicitly say the server rejected the request; timeouts explicitly say the outcome is unconfirmed and that saved-state refresh alone does not resolve it. A read-only refresh button and a link to the existing recovery panel are adjacent to the blocked scoreboard.
2. **Recovery panel visibility/focus.** A retained intent reveals/focuses the recovery panel. Correction/finalization dialogs have a path out to recovery so controls are not hidden behind the dialog's inert background.
3. **Idempotent empty-journal cleanup.** New [journalPolicy.ts](../src/data/local/journalPolicy.ts), called by the real IndexedDB transaction, treats removing an already-absent journal row as a no-op. In the normal coordinator path this cleanup happens only after a successful response; it does not acknowledge an uncertain operation by inspecting storage. Updates still require the same ID, and cleanup cannot delete a different newer operation.
4. **Clear local coordination error.** Attempting to add over an existing shared intent now explains that this new action was not sent. This is distinct from a server timeout/conflict.

No classifier relaxation, auto-retry, auto-rebase, existing-intent removal, journal schema migration, server receipt editing or hosted write was performed. The owner's current `2bed6a55-…` payload remains unresolved and must be retained. A future explicitly requested retry would still use that UUID and exact payload; no retry was executed in this investigation.

## Separate cross-tab bug reproduction

Mock-only sequence reproducing the old defect:

1. Tab A persists operation X and starts sending.
2. Tab B restores the same shared X while A is sending; its in-memory coordinator retains X.
3. A receives success and removes X from the shared journal.
4. On a later explicitly invoked **mock** retry, B receives the same success receipt for X.
5. The old IndexedDB cleanup required an existing row with X's ID. With the row already absent, cleanup aborted, and the coordinator classified the local cleanup failure as uncertain. Repeating this could loop indefinitely despite acknowledgment.

The new cleanup is idempotent when the row is absent. A different newer record is preserved, not deleted to force progress. The shared policy is tested directly and through the coordinator with mocked transactional storage. Real browser cross-tab/IndexedDB execution is not claimed as tested here.

Because the actual Tab 2 operation is **2bed6a55-…**, whereas the committed Tab 1 completion is **20c0e7b0-…**, a simple restoration of Tab 1's original operation is not the observed identity pattern. The separate defect explains a genuine possible recovery loop, but does not establish that this timeout followed that sequence.

## Verification

- `npm run test:frontend`: **28/28 passed** (20 existing, 8 new regression/presentation cases).
- `npm run build`: passed.
- `npm run lint`: passed.
- Hosted inspection: read-only SELECTs only; no fixtures, new sessions, retries or operation replays.

New regressions cover absent-row cleanup after another tab's acknowledgment, concurrent acknowledgments of the same mock intent, protection of a different newer record, preservation of timeout identity/payload, distinction between fresh conflict and uncertainty copy, and recovery focus/navigation without storage/network actions. Existing tests continue to protect lost acknowledgment, account isolation and uncertain-error handling.

## Remaining uncertainty and next gate

The timeout's underlying cause and actual HTTP delivery cannot be reconstructed from the available evidence. A preserved, sanitized request-phase/Network trace would be needed during a **separately authorized** future attempt; a received SQL error code is required to call it a known revision rejection. No new network diagnostics that might expose headers/tokens were enabled.

This task deliberately leaves the existing intent untouched and does not prove end-to-end recovery of that live request. Loading the saved session can show the accepted frame but cannot decide the operation's receipt status through the current public API. A dedicated actor/membership-scoped **read-only receipt-status RPC** could improve recovery without replay, but requires a separately reviewed database change and is only proposed here.

No retry, clear-storage instruction or database workaround is part of this report. Keep the original operation UUID and payload until its outcome is resolved through an authorized path.
