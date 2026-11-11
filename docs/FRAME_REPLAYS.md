# Frame replays — Phase 1

Local implementation only. Database foundation and connected Frame History playback are included. No hosted migration, production Storage operation, commit or deployment was performed.

## Schema and authorization

`app.frame_replays` uses `frame_id` as its primary key (one replay per frame),
with `group_id`, `session_id`, a unique `storage_path`, and `created_at`.
The composite FK references `app.frames(group_id,session_id,id)` with
`ON DELETE CASCADE`. Paths must equal `<session UUID>/<frame UUID>.mp4`;
the bucket is always `frame-replays`. No URLs or tokens are persisted.
A trigger requires a completed frame when privileged operators attach metadata.

Authenticated clients have SELECT only, through the unchanged
`app.session_visible(group_id,session_id)` predicate: active group membership,
active group, non-abandoned session, and accepted import batch where relevant.
Identity linking is not a separate playback permission. Existing claiming and
matchup membership rules continue to determine group membership.

Storage SELECT requires an exact path registered in visible replay metadata.
Restrictive policies also fence this bucket against unrelated permissive policies:
anonymous reads and client INSERT/UPDATE/DELETE are blocked. Other buckets retain
their existing policies. Dashboard/service operations must use their usual trusted
RLS-bypassing role; no service credentials belong in the browser.

## Migration prerequisites and seed

Apply after `202611080001_automatic_player_identity.sql`. The migration requires
Supabase Storage and an existing private `frame-replays` bucket; it aborts if the
bucket is absent or public. It does not create or alter buckets or Storage objects.
Use a migration role permitted to create policies on `storage.objects`.

The supplied session `8926207a-9936-5762-a991-492b45ef7e50` and frame
`366064c1-d7d3-5bf6-a17b-131fa5cf1fbb` are registered with the supplied path,
deriving the group from the completed frame. The insert does nothing if the parent
is absent or incomplete (including fresh databases) or metadata already exists;
it never manufactures history or overwrites an attachment. After a future approved
deployment, verify that exactly one matching row exists and that its MP4 is present.
The migration does not prove the uploaded bytes exist or are a valid MP4.

## Connected Frame History playback

Expanding connected SessionView Frame History reads replay metadata through the
existing authenticated Supabase client and session-scoped RLS query. Only completed
frames with matching registered metadata show Watch Replay. Tapping it calls
`supabase.storage.from('frame-replays').createSignedUrl(storage_path, 60)`.
Storage checks the caller's JWT and SELECT policies before issuing the temporary
URL. Use it transiently for playback, handle expiry by requesting a fresh URL,
and never persist it in match history or logs. The dismissible modal uses a mobile
inline video player with native controls. Availability, signing and playback failures
show local messages; fresh links and availability checks require explicit user
action. There is no polling, automatic replay retry or scoring RPC. Closing history,
changing account/session or dismissing the modal discards pending playback results.
This SELECT permission also permits
authenticated downloads; it is not a signing-only permission.

Signed URLs are bearer links: anyone holding an issued URL can use it until expiry.
Revoking membership or removing metadata prevents new URLs, but does not revoke
already issued links. Keep expirations short. Confirm playback and range requests
against a full Supabase Storage service before production release.

## Removal and outstanding cleanup

`app.remove_match` already deletes frames for both abandon and permanent deletion.
The FK atomically cascades replay metadata without changing the removal command,
audit, scoring, correction, or receipt functions. The Storage read policy then
denies new access because no registered metadata remains.

**Database deletion does not delete Storage bytes.** Phase 1 deliberately leaves
the private object for trusted manual cleanup. Before removing a match, an operator
should record its registered object paths; afterward verify the match and replay
metadata are gone, then delete those exact objects through the Supabase dashboard
or trusted Storage API. For an already removed match, inspect its session UUID
prefix and confirm removal before deleting any file. Never delete rows directly
from `storage.objects`: that removes metadata without deleting the underlying file.
No cleanup trigger, network call, browser control, or automatic prefix deletion is
introduced. Automatic durable cleanup remains future work; orphaned private files
consume storage until an operator removes them.

## Verification

Run `python3 -B scripts/database/run_tests.py --sql-test frame_replays.sql` and
`python3 -B scripts/database/run_tests.py`. The runner uses a new disposable local
PostgreSQL database, synthetic identities, and a minimal Storage schema stand-in.
Replay tests cover viewer/isolation/revocation/import visibility, exact-object
reads, restrictive fences under a deliberately broad policy, denied client writes,
completed-frame attachment, composite FK, correction preservation, and actual
match removal cascading metadata while retaining inaccessible Storage metadata.

Also run the focused `match_removal.sql` and `frame_correction_details.sql` suites
using `--sql-test`. The full suite includes `player_identity.sql`. The pre-existing
`automatic_player_identity.sql` test file is now present; the earlier missing-file
warning from the database-only checkpoint is obsolete. The harness does not test
GoTrue, PostgREST, actual signing, public endpoints or bytes. On a disposable full
Supabase stack, verify authorized signing/download succeeds, unrelated/revoked/anon
signing fails, unregistered paths fail, uploads/replacement/deletion fail, the public
object URL fails, and removal blocks new signed URLs. Review deployed bucket privacy
and policies before rollout; this task does not inspect or modify remote state.

Local verification on 2026-11-10: replay suite 27 assertions; full suite 212
assertions plus five concurrency checks on both fresh and existing-foundation
upgrade runs; focused removal 36 assertions; focused
correction details 23 assertions. All passed against PostgreSQL 14.8.

References: [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[signed URLs](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl),
and [Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects).

## Frontend verification

`node --test scripts/frontend/frameReplays.test.mjs scripts/frontend/frameEntry.test.mjs scripts/frontend/matchRemovalUi.test.mjs scripts/frontend/playerInitialization.test.mjs scripts/frontend/identityReceipts.test.mjs scripts/frontend/startupRecovery.test.mjs`
passed all 46 tests, including 12 replay tests covering availability, authenticated
metadata/signing, private bucket and 60-second expiry, account changes, loading,
failures, explicit renewal, dismissal and stale-result suppression. These use
mocked clients/component hooks, not a live Storage service or browser media decoder.
`npm run lint` and `npm run build` (including TypeScript project checks) passed.

Frontend files: `src/data/remote/replayService.ts`, `database.types.ts`,
`src/features/connected/FrameReplays.tsx`, `SessionView.tsx`,
`src/app/connected.css`, `scripts/frontend/frameReplays.test.mjs` and the existing
`matchRemovalUi.test.mjs` harness. Both migration files remain unchanged.
Deployment still requires the reviewed migrations in order, private bucket/seed
verification and real-stack authorized/unauthorized playback checks.
