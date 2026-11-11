# Frame Replays Phase 2A — local backend

**Superseded for source uploads by Stage 1:** apply the follow-up processing
migration and use [replay-worker/README.md](../replay-worker/README.md). Uploaded
recordings are now private sources, not directly publishable replays. This document
retains the 2A checkpoint contract; its finalization/cleanup signatures must not be
used as the Stage 1 deployment instructions.

New migration: `supabase/migrations/202611100002_frame_replay_uploads.sql`, after
Phase 1. Previously deployed migrations and existing replay rows remain unchanged.
No upload UI, production migration, worker scheduling or hosted Storage call is
included. A small `replayService.ts` compatibility change accepts both the original
canonical path and server-assigned attempt paths; signed playback is unchanged.

## Prerequisites and limits

Before a separately approved rollout, configure `frame-replays` through Storage
settings: **private**, allowed MIME types exactly `video/mp4`, maximum file size
between 1 byte and **250 MiB (262144000 bytes)**. The migration fails closed if these
settings are absent. Existing MP4s are not modified by this requirement. The global
Supabase upload limit may be lower; review it too. A future client must honor the
actual configured bucket limit, not just the RPC's 250 MiB ceiling.

Hard-coded conservative limits: one active reservation per frame, two simultaneous
reservations per actor, eight retained slots per actor, forty per group, ten new
attempts per actor per rolling 24 hours. Each pending/committed/cleanup attempt is
charged a full 250 MiB slot, regardless of its claimed size. Cleaned attempts free
retained slots but still count toward the daily limit. Legacy replays count as one
group slot each; their existing sizes are not altered or capped retrospectively.
These are conservative slot quotas, not exact byte accounting or a project-wide
spend cap. Arbitrarily many new groups/accounts still require project-level usage
monitoring and, before broad public signup, an overall storage budget/admission
limit. Lost workers intentionally stop budget release rather than permit unbounded
replacement uploads. Review these initial product limits before launch.

## Caller-only RPC contract

- `reserve_frame_replay_upload(p_operation uuid, p_frame uuid, p_bytes bigint,
  p_content_type text default 'video/mp4')`: returns `upload_id`, `frame_id`,
  `session_id`, `storage_path`, `bucket`, `expected_bytes`, `content_type`, `status`,
  `expires_at`. Only a linked participant of the completed frame can reserve it.
  Requires current `session_visible`, frame and session detail eligibility. Status
  means `status='completed'`; historical timestamps are never fabricated.
- A fresh operation UUID reserves a server-generated path
  `<session>/<frame>/<upload UUID>.mp4`. Exact same actor/operation/payload retries
  return the same reservation, including its original six-hour expiry. Reusing the
  UUID with different parameters fails. An expired retry does not extend access.
- Upload directly through Storage/TUS using the current user's JWT and that exact
  path, MP4 content type, and declared byte size. Do not use upsert. The INSERT
  fence rechecks current membership, linked participation, detail eligibility,
  ownership and expiry. Arbitrary paths and another actor's attempt are denied.
  Null initial Storage metadata is allowed; supplied size/MIME must match. UPDATE,
  DELETE and unregistered-object SELECT remain denied even under broader policies.
- `finalize_frame_replay_upload(p_upload uuid)`: rechecks the actor and eligibility,
  then verifies a Storage object record exists in the private bucket with the
  expected owner, exact size and MP4 MIME. Only then registers replay metadata and
  marks the attempt committed in the same database transaction. Concurrent retries
  return the same replay row. Existing replay records are never replaced. Expired,
  incomplete, wrong-sized/type/owner and unauthorized objects cannot finalize.
- `get_my_frame_replay_upload(p_upload uuid)` is a read-only recovery lookup of the
  actor's own reservation, including after removal/expiry. It does not upload,
  renew, finalize or grant access. A reserved status with a past `expires_at` is
  expired even before the next worker sweep changes its stored status.

The private ledger is the recovery/idempotency authority for uploads, separate
from scoring `write_operations` and `OperationCoordinator`. A failed registration
retains the attempt for recovery/expiry. Browser callers get no table DML grants.
A short global control-plane lock serializes quotas/slot claims; lifecycle shared
locks are taken first to agree with `remove_match` lock ordering. Lock waits are
bounded to five seconds. No lock spans the browser's transfer between API calls.

Storage metadata is trusted as Storage's completion record, not as video content
inspection. This SQL does **not** HEAD/download bytes or validate MP4 codecs,
duration, corruption or content safety. `user_metadata` is never trusted. Validate
real Storage/TUS completion metadata/owner behavior before enabling uploads;
stronger media validation would require an additional trusted processing step.
Prefer JWT uploads: signed upload tokens are bearer capabilities and can outlive
membership changes until token expiry; finalization still checks current access.

## Durable cleanup and worker

The private upload ledger and cleanup queue have no cascading parent FK, so they
survive match/account deletion. Frame deletion queues pending attempts; replay
metadata deletion queues both legacy and new objects. No scoring/removal function
is rewritten, and no SQL DELETE against Storage metadata is introduced.

Worker API (EXECUTE granted only to `service_role`):

1. `claim_frame_replay_cleanup(p_limit default 20)` expires reservations, queues
   cleanup, revives tombstones for late objects, and leases at most 100 exact paths.
2. Delete only those paths with `storage.from('frame-replays').remove([path])`.
3. `finish_frame_replay_cleanup(p_path, p_lease, p_success)` checks the lease and
   verifies no registered replay or Storage object remains before acknowledging
   success/releasing the slot. Failed work uses exponential backoff capped at an
   hour. Lost acknowledgments recover through five-minute lease expiry.

`scripts/storage/cleanup-frame-replays.mjs` implements one bounded batch with the
existing Supabase SDK. Run only in a trusted server job, with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` supplied by its secret store. Never expose/import this
worker or credential into browser code. It logs counts only. A scheduler must run
it regularly (e.g. every five minutes) and alert on failures/backlog; it is **not
installed or scheduled by this migration**. Monitor backlog/Storage usage and keep
the ledger and completed queue tombstones for late-object detection. Do not reuse
paths or manually restore a queued path while a worker is active.

For attempt paths, deletion waits until reservation expiry plus a 24-hour TUS
quiescence window. No pending cleanup object is readable through replay policies.
Legacy objects can be queued immediately. Late completed objects revive cleanup
rather than resurrect replay metadata. TUS's internal partial-transfer garbage
collection remains the Storage service's responsibility, not this SQL queue.
Database and object storage are not one atomic transaction: temporary unregistered
objects are expected; the durable queue makes them recoverable. The worker must
be operating before self-service uploads are enabled.

## Local verification

- `python3 -B scripts/database/run_tests.py --sql-test frame_replay_uploads.sql`
- Same command with `--upgrade-foundation`.
- `python3 -B scripts/database/run_tests.py`
- `python3 -B scripts/database/run_tests.py --sql-test match_removal.sql`
- `node --test scripts/frontend/frameReplays.test.mjs scripts/frontend/replayCleanup.test.mjs scripts/frontend/frameEntry.test.mjs scripts/frontend/matchRemovalUi.test.mjs`
- `npm run lint` and `npm run build` (includes TypeScript checks).

The SQL stand-in now includes Storage owner/metadata/bucket-limit columns and a
service-role stand-in. It exercises real PostgreSQL RLS, constraints and concurrent
connections, not GoTrue, Storage HTTP/TUS, file bytes or browser suspension. Tests
cover denied actors/paths/size/type, quotas, expiry, existing replay preservation,
historical null timestamps, duplicate reservations/finalization, competing actors,
removal races, worker permissions, failed/stale leases, backoff and late objects.
Before production, exercise actual JWT TUS uploads, pause/resume and expiry,
revocation, disabled upsert, object metadata, signing, match removal and Storage API
cleanup on a full disposable Supabase stack. No such hosted checks were performed.

References: [TUS resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
[Storage schema](https://supabase.com/docs/guides/storage/schema/design),
[object deletion](https://supabase.com/docs/guides/storage/management/delete-objects).

Results on local PostgreSQL 14.8: **65 upload assertions passed** on fresh and
existing-foundation upgrade runs (including independent-connection races).
The existing full database suite passed **212 assertions and five concurrency
checks**; focused match removal passed **36 assertions**. All **28 selected
frontend/worker tests**, ESLint and the TypeScript/Vite production build passed.

Worker invocation, only after separately approved configuration/scheduling:
`node scripts/storage/cleanup-frame-replays.mjs`.
