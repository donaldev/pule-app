# Completed-frame win-type corrections

## Production activation — 5 November 2026

Migration 006 applied successfully to `Pule_2.0` (`pgljdmevusgvvlplaedt`) after the owner explicitly waived staging/backup prerequisites. Checksum matched the recorded value and the hosted engine source matched the 003 baseline exactly. Only 006 was pending/applied. One nine-argument correction RPC exists with optional `p_details`; authenticated execution is granted, PUBLIC/anon and direct private-engine execution remain denied. The private engine OID is unchanged.

Quick app-schema export was attempted but failed because Docker/Podman is unavailable; no export/backup is claimed. The existing user-confirmed ngrok frontend at `https://081c-207-216-31-130.ngrok-free.app` serves this checkout's Vite server. Public HTTP checks confirmed the updated editor source is served there. No separate static-host upload or durable frontend-host deployment occurred.

Production PostgreSQL smoke test exercised new disposable session/frame creation, completion, legacy named correction calls, Golden Break and Super Foul correction, idempotent retry, saved-state reload, fixed timing and analytics replacement. Every smoke-test write was enclosed in a transaction that was explicitly rolled back. This used the authenticated database role with server-set claims, not a real browser JWT/PostgREST session. It does not establish cross-session committed-write or physical Pixel verification.

Before/after fingerprints of sessions, frames, frame participants and legacy session results match exactly after rollback. No real match corrections or historical record changes were committed. Refresh the existing phone URL to load the editor. Ngrok/local-server availability remains an operational limitation.

## Original local checkpoint

Implemented locally only. No hosted access, migration application, real scoring writes or frontend deployment.

## Migration and compatibility

`supabase/migrations/202611050006_frame_correction_details.sql`

SHA-256: `9f3e1f48c1c76533c41ed6b65eb8c9832cb6cfd11591c4359756fbd31ca0fdc4`.

Replaces the original eight-argument `app.correct_frame` signature with a single nine-argument signature whose last parameter is `p_details jsonb default null`. Old positional and named calls still work; there is no overlapping overload. Omitting details preserves the old request/receipt shape and original frame details. Authenticated execution only; no table grants or policies change.

New calls supply all three keys together:

```json
{"special_event":"golden_break","potted_on_break":true,"offender_id":null}
```

All existing win types remain supported: regular, golden_break, break_and_run, dry_clearance, super_foul. Non-Super-Foul corrections explicitly supply a null offender; stale non-null offenders are rejected. Super Foul requires a participating offender different from the winner. Golden Break and Break & Run retain their existing breaker/winner/pot constraints.

The migration patches only the existing correction UPDATE branch in the private scoring engine, retaining its OID, transaction, locks, authorization, native/active-night restrictions, revision checks, journal, audit and immediate constraint validation. The exact old branch must occur once or migration aborts. No timing, breaker, pair, pocket or frame identity updates are introduced. No historical/imported amendment permission is introduced.

## Editor

Saved win type, Potted on break and offender populate the existing live-control styling. In correction mode, selecting Golden Break does not silently change the saved winner or pot. The user explicitly resolves dependencies; invalid combinations disable Save changes and display the existing validation message. Switching away from Super Foul explicitly sends null offender. Duration stays fixed and the timer remains stopped. The compatible reason remains `Edited saved frame`, without an input.

Receipt comparison now includes correction details for new intents, retaining old matching behavior for old intents. Pending operations are not rewritten or replayed automatically.

## Verification

- Disposable PostgreSQL 14.8: 23 new assertions. Normal → Golden Break → Normal, Normal ↔ Super Foul, invalid dependent fields/atomic rollback, old and new idempotent calls, authorization, finalized-night rejection, unchanged duration/identity/breaker/pocket and unrelated active frame, no duplicate frames/results, reloaded frame analytics returning the replacement event, one public signature and anonymous denial.
- Existing disposable SQL frame-editing regression: 6 assertions, including finalization from a second connection after the editor captured its revision; both stale and current-revision corrections fail after finalization.
- 50 focused frontend tests passed (editor state/dependencies/payloads, prepopulation, existing live scoring, receipt binding/recovery, analytics and removal UI regressions).
- ESLint and TypeScript/Vite production build passed.

Commands:

```sh
python3 -B scripts/database/run_tests.py --sql-test frame_correction_details.sql
python3 -B scripts/database/run_tests.py --sql-test frame_editing.sql
node --test scripts/frontend/frameEntry.test.mjs scripts/frontend/operations.test.mjs scripts/frontend/frameAnalytics.test.mjs scripts/frontend/matchRemovalUi.test.mjs
npm run lint
npm run build
```

SQL tests use a fresh disposable local database; no real sporting data is used. Frontend tests use synthetic component/receipt fixtures. Real JWT/PostgREST, PostgreSQL 17, hosted old-client rollout, physical-device interaction and production persistence remain untested. The updated editor requires separate approval/application of migration 006 before use against hosted Supabase.
