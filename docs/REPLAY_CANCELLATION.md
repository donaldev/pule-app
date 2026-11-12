# Replay cancellation and deletion

Apply `202611120001_replay_cancellation.sql` before releasing this frontend. No existing rows are backfilled or rewritten by the migration. It adds caller-bound status/removal RPCs and rechecks upload state after the queue lock.

Unfinished cancellation requires the original uploading account, still linked to a participant with session visibility/detail eligibility. Completed deletion requires a linked eligible participant. View-only access does not grant deletion. The RPC targets an exact upload UUID/operation or published path; a repeated request cannot target a replacement attempt. Legacy Phase 1 replays need no upload ledger.

Cancellation atomically frees the active frame slot, invalidates the lease, blocks further signing/queueing/finalization, and records durable bucket-qualified cleanup. Old upload/job rows remain as tombstones for idempotency, quotas and cleanup accounting; they are not blindly deleted. The browser pauses its active transfer and waits for its local upload lock before cancellation, retaining recovery data on any unconfirmed response. An unknown in-flight reservation is not acknowledged as cancelled; repeat Cancel when its result is available.

Physical deletion is asynchronous. Continue running the existing `scripts/storage/cleanup-frame-replays.mjs` with its existing server-side Supabase/R2 credentials (the existing replay-acceptance `cleanup-only` operation is sufficient). No new secrets are required. R2 cleanup aborts multipart state, deletes the source, verifies absence, then acknowledges cleanup. Failures remain queued with bounded retry backoff. Quota is retained until cleanup is acknowledged.

R2 cleanup waits at least five minutes for already issued part URLs/broker requests; legacy Supabase uploads retain their existing expiry-plus-24-hour quiescence barrier. Running worker output cleanup waits until the old 40-minute lease plus five minutes. Preserve the existing worker runtime shorter than its lease. Late Supabase objects are rediscovered by the existing cleanup pass. Cleanup scheduling remains operationally required; no new scheduler is introduced here.

Deleting metadata prevents new playback signing immediately. Previously issued signed links may remain valid for their remaining 60-second lifetime, and previously downloaded/cached video cannot be revoked. The UI reports removal with cleanup pending, never confirmed physical deletion.

Focused verification only:

```
python3 -B scripts/database/run_tests.py --sql-test replay_cancellation.sql
node_modules/.bin/tsc -b
```
