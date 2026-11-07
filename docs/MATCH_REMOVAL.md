# Abandon and delete matches — local implementation

No hosted migration, request, real match deletion or deployment performed. The owner explicitly chose permanent purging of match-specific evidence over hiding records while retaining that evidence.

## Player experience

Open a match from Play/Resume or History, then expand **Match options** below the match controls. Active group owners/admins see **Abandon match** on unfinished nights and **Delete match** on finalized nights. Scorers, participants and viewers do not gain deletion authority merely by viewing/playing.

The confirmation shows the saved date, venue and player names, warns that the match and all recorded frames will be permanently discarded, and offers Keep match. Existing finalization is unchanged. Match options is separate from frame confirmation/scoring. Dialog content scrolls within the viewport and its actions wrap on narrow screens.

Only acknowledged server success clears the match, refreshes session lists/standings and navigates to Play for abandonment or History for deletion. Errors preserve the screen; uncertain writes retain their existing operation UUID/payload and use the existing receipt/retry flow. An interrupted removal can be confirmed read-only without trying to load the now-deleted match.

## Pending migration — approval required

`supabase/migrations/202611050003_match_removal.sql`

SHA-256: `f621c2c7bf2530b2b4065d38a80b116b115fcc6cb9ec3294b274d2b0dbbbedb6`

- Authenticated `app.remove_match(operation, session, expected_revision, mode)` enforces active owner/admin authority, current revision and the matching active/finalized status. `app.get_match_removal(session)` provides a narrow owner/admin-only acknowledgment read. No client table DELETE grant or new writable RLS policy.
- Atomic, explicitly ordered purge of frame participants, frames, session participants/results, legacy frame observations/resolutions, session/frame legacy links, match events and old scoring-operation payloads, then the selected session and exclusively associated source records. Shared source evidence is retained if another match still references it; unrelated import batches, sources, player/venue links and identity data stay intact.
- Existing append-only triggers stay enabled. A client-inaccessible transaction-scoped per-row allowlist admits only the selected evidence deletes. Ordinary evidence changes and unrelated deletes still fail. No GUC bypass, disabled triggers or blanket cascade.
- Minimal immutable audit: session/group UUIDs, actor/operation UUIDs, action, expected revision and removal time. Old operation UUIDs remain as small tombstones to prevent stale start-session retries recreating a deleted night; their original sporting/private payloads are purged. Successful removal receipts contain only IDs and action metadata.
- A group-scoped lifecycle lock serializes removal against native scoring. Native commands retain their existing validation/authorization and function OID; a short added guard rejects purged operation replay. Removal also locks the session and current membership and uses a short lock timeout. Concurrent removals converge on one audit; a changed mode/revision fails closed.
- Deferred session-integrity validation tolerates an absent parent after authorized physical deletion, and is explicitly flushed inside the privileged transaction before success. Exact matchup constraints, all FKs and RLS remain enabled.

Physical deletion makes existing read APIs exclude the match naturally. Home falls back to the next remaining finalized night; history, H2H, group and personal aggregates read only remaining records. No special client-side statistics subtraction or historical player rewrite.

## Verification

- Disposable local PostgreSQL 14.8: **36 assertions**, including two simultaneous connections removing the same night. Empty/populated abandonment; native finalized deletion; imported score-only and detailed evidence purge; scorer denial; stale revision/mode/resume; identical and repeated requests; old start-operation replay rejection; receipt acknowledgment; group/personal statistics; unchanged other match/player/account link; client permissions; append-only protection; injected mid-purge failure/complete rollback.
- Focused frontend: **45 tests passed** (operations/receipt matching, recovery presentation, result authority and scoring regressions).
- ESLint and TypeScript/Vite production build passed. Existing main-bundle size advisory remains.
- No real JWT/PostgREST, PostgreSQL 17 or physical Pixel dialog test was performed. Responsive dialog CSS reuses the existing modal, with scroll bounds and wrapping controls; device visual review remains.

Run the focused SQL checks with the existing isolated local server on port 55439:

```sh
python3 -B scripts/database/run_tests.py --sql-test match_removal.sql
```

The runner creates/drops only its disposable database. No real Local/QA data is used.

## Before use

Review/approve this new migration separately before any hosted application; do not edit deployed migrations. The frontend actions depend on these RPCs. Frontend deployment is not included. Permanent removal cannot be undone through the app; no restore/reopen feature was added. Do not rerun the historical importer as recovery: removal is intentional, and future snapshot/import work must explicitly account for the deletion audit. Synthetic verification does not establish a hosted migration or physical-device execution result.
