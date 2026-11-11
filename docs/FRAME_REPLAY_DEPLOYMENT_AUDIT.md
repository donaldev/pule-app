# Frame recording → replay deployment audit

Repository audit only. Production configuration/history were not read; no remote
SQL, deployment, push, scheduler change or feature enablement was performed.
**Do not enable uploads until the ordered gates below pass.** The reference worker
host is Linux/systemd with Docker and Node 22. On another platform reproduce the
same secrets, cadence, singleton behavior, hard timeout and container termination.
The supplied systemd units are local reference artifacts, not installed services.

## Findings and fixes

- `202611100002` creates an intermediate direct-publication API; UI flag-off alone
  does not prevent a caller invoking it. Sequential deployment would expose that
  API between migration commits. **Apply 002, 003 and 004 in ONE transaction** using
  `build_replay_release.py`. Tests force 003 to fail and prove 002 rolls back too.
- `003` rejects a nonempty upload ledger. This is intentional: never reinterpret an
  already-used 2A backend or guess whether an old MP4 is a source or a replay.
- New `004` fixes a quota leak when an abandoned upload loses to a manual legacy
  replay on the same frame: releasing its cleaned slot must not require deleting
  the unrelated replay. The forward patch is baseline-checked; existing migrations
  and legacy metadata remain untouched.
- Worker startup now validates FFmpeg rotation support and ffprobe BEFORE claiming
  a job; Docker builds run the same check. `--check` needs no credentials/network.
  Missing tools/old FFmpeg therefore cannot burn processing attempts.
- No DROP TABLE, historical backfill, score/identity rewrite, SQL Storage-object
  deletion or RLS visibility broadening occurs. 002 replaces a replay-path CHECK;
  003 replaces a new index/cleanup PK and drops the superseded cleanup signature.
  Those are real DDL locks/API changes: use the atomic bundle in a quiet window.
- Existing canonical Phase 1 paths and UUID output paths remain readable only via
  `session_visible`. Completed means frame status, not timestamps. Historical null
  timestamps stay valid. New sources are never registered as playable replays.

## Required configuration and secrets

| Location | Required values |
|---|---|
| Browser build | `VITE_SUPABASE_URL`, public `VITE_SUPABASE_PUBLISHABLE_KEY`; keep `VITE_FRAME_RECORDING_UPLOADS=false` or unset until step 8 |
| Trusted worker secret store | `SUPABASE_URL` (plain HTTPS project URL), legacy JWT `SUPABASE_SERVICE_ROLE_KEY`; never a `VITE_` variable |
| Worker host configuration | `PULE_REPLAY_IMAGE` pinned to the reviewed image tag/digest |
| Release operator only | PostgreSQL service `pule-production`/protected pgpass, and Supabase CLI login or `SUPABASE_ACCESS_TOKEN` authorized for the reviewed project |

Do not pass secret values in command arguments, build args, git files or job JSON.
The worker environment file is root-readable mode 0600, provisioned by the secret
manager at `/etc/pule/replay-workers.env`; it contains ONLY worker environment/config,
not browser variables or the release operator's DB credentials. The service-role
credential bypasses RLS and is intentionally powerful; isolate media processing in
the non-root, read-only, resource-limited container with no host/data mounts. Restrict worker egress to the project HTTPS endpoint and necessary DNS
where the hosting platform supports it.

The installed repository CLI is v3.0.0: remote commands require explicit `--remote`;
its default is LOCAL. Commands below assume that pinned CLI, PostgreSQL client tools,
and a public `PULE_PROJECT_REF` already set to the reviewed production project.
They are instructions for a separately authorized rollout, **not commands run by
this audit**. Do not run `db push` as a substitute for the atomic bundle.

## Exact ordered deployment checklist

1. **Confirm the target and baseline; preserve a recovery point.** Keep the upload
   flag false and all old/new upload workers stopped. Confirm a current platform
   backup/PITR point and a separate Storage object backup/retention plan; database
   backups do not contain video bytes. Configure the named `PGSERVICE` securely
   outside the repository. Review the exact project reference before continuing:

   ```sh
   : "${PULE_PROJECT_REF:?Set and independently verify the production project ref}"
   : "${PULE_BACKUP_DIR:?Set an encrypted backup directory outside this checkout}"
   npm ci
   git status --short
   git rev-parse HEAD
   node_modules/.bin/supabase migration list --remote="$PULE_PROJECT_REF"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "\\conninfo"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by version desc limit 8"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select to_regclass('app.frame_replays') as phase1, to_regclass('private.frame_replay_uploads') as phase2a"
   ```

   Independently verify that `\conninfo` host/pooler user belongs to the SAME
   reviewed project as `PULE_PROJECT_REF`; do not trust an old linked project or
   a similarly named staging DB service.

   Required: Phase 1 (`202611100001`) and its predecessors are applied/history-correct;
   002/003/004 are not applied and the 2A ledger does not exist. If schema/history
   disagree, STOP and reconcile verified facts; do not mark versions applied blindly
   or rerun SQL. Export protected tables/metadata to an encrypted backup directory
   OUTSIDE this checkout (no secrets in argv):

   ```sh
   umask 077
   PGSERVICE=pule-production pg_dump --format=custom --schema=app --schema=private --schema=supabase_migrations --file="$PULE_BACKUP_DIR/pule-before-recordings.dump"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select frame_id,group_id,session_id,storage_path,created_at from app.frame_replays order by frame_id" > "$PULE_BACKUP_DIR/replays-before.txt"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select id,status,started_at,completed_at from app.frames where id='366064c1-d7d3-5bf6-a17b-131fa5cf1fbb'" > "$PULE_BACKUP_DIR/historical-frame-before.txt"
   ```

2. **Verify/configure private Storage through the Dashboard.** `frame-replays` must
   stay private; create private `frame-recordings`. Set allowed MIME types exactly
   `video/mp4`, max new-file size **262144000 bytes (250 MiB)** on BOTH buckets and a
   project global limit at least that high. Disable Storage versioning/lifecycle
   rules on these buckets; this queue expects actual object absence, not delete
   markers/hidden retained versions. Do not delete/re-upload or change permissions
   on the existing MP4. Inspect configuration/policies read-only:

   ```sh
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('frame-replays','frame-recordings') order by id"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname"
   ```

   Both migrations assert private MP4 buckets with limits <=250 MiB; the exact
   250 MiB deployment setting above avoids accepting client files larger than a
   smaller bucket limit. A non-default/versioned Storage setup needs a separate
   compatibility review. Existing broader policies must not override restrictive
   fences; never add blanket authenticated SELECT/INSERT/DELETE to solve a failure.

3. **Prepare and test immutable release artifacts while flag-off.** Run local tests
   against disposable databases, never hosted `supabase test`/remote reset:

   ```sh
   python3 -B -m unittest discover -s scripts/database/tests -v
   python3 -B scripts/database/run_tests.py --sql-test frame_replay_processing.sql --atomic-replay-release
   python3 -B scripts/database/run_tests.py --sql-test frame_replay_processing.sql --atomic-replay-release --upgrade-foundation
   python3 -B scripts/database/run_tests.py
   node --test scripts/frontend/recordingUpload.test.mjs scripts/frontend/frameReplays.test.mjs scripts/frontend/replayCleanup.test.mjs
   # In a virtualenv with replay-worker/requirements.txt installed:
   python -B -m unittest discover -s replay-worker/tests -v
   npm run lint
   npm run build
   docker build -t "pule-replay-worker:$(git rev-parse --short HEAD)" replay-worker
   docker run --rm --network none "pule-replay-worker:$(git rev-parse --short HEAD)" --check
   python3 -B scripts/database/build_replay_release.py --output /tmp/pule-replay-release.sql
   ```

   Review the generated SQL and its source SHA-256 comments. Use an appropriate
   local temp path if needed. The Docker build/`--check`
   must succeed on the actual worker architecture. FFmpeg 6+ with `-display_rotation`,
   ffprobe, OpenCV and NumPy are required. Do not test readiness by claiming a real job.

4. **Apply the single atomic bundle, then reconcile history.** Use the already
   reviewed artifact, not separately selected SQL fragments. The five-second DDL
   lock timeout fails closed; investigate lock contention rather than disabling
   guards. This is the ONLY schema-application step:

   ```sh
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -f /tmp/pule-replay-release.sql
   ```

   On ANY SQL error: stop, verify rollback and leave the flag off; DO NOT repair
   history as applied. On confirmed COMMIT and verified schema only:

   ```sh
   node_modules/.bin/supabase migration repair --remote="$PULE_PROJECT_REF" --status applied 202611100002 202611100003 202611100004
   node_modules/.bin/supabase migration list --remote="$PULE_PROJECT_REF"
   ```

   SQL Editor alternative: execute the WHOLE generated bundle in one run, including
   BEGIN/COMMIT; then perform the same verified history repair. SQL Editor does not
   record CLI migration history. Repair changes history only, not schema. If history
   repair fails after a successful COMMIT, do not rerun the bundle: verify schema,
   then retry history repair. Do not mark 001 or earlier applied unless independently
   verified. Never use `--include-all`, `db reset`, or unreviewed pending migrations.

5. **Postflight before allowing uploads.** Repeat/export the two protected-data
   queries from step 1 to `*-after.txt` and compare them before any canary changes.
   Check original Watch Replay as its authorized user and deny it to an unrelated
   account. Compare the protected rows before opening the pilot:

   ```sh
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select frame_id,group_id,session_id,storage_path,created_at from app.frame_replays order by frame_id" > "$PULE_BACKUP_DIR/replays-after.txt"
   PGSERVICE=pule-production psql -X -v ON_ERROR_STOP=1 -c "select id,status,started_at,completed_at from app.frames where id='366064c1-d7d3-5bf6-a17b-131fa5cf1fbb'" > "$PULE_BACKUP_DIR/historical-frame-after.txt"
   diff -u "$PULE_BACKUP_DIR/replays-before.txt" "$PULE_BACKUP_DIR/replays-after.txt"
   diff -u "$PULE_BACKUP_DIR/historical-frame-before.txt" "$PULE_BACKUP_DIR/historical-frame-after.txt"
   ```

   Check RLS and function ACLs using the queries below. All private ledger/
   job/queue tables must have RLS and no client DML. PostgREST must expose `app`
   (already needed for scoring); `private` must remain unexposed. Do not grant
   service-role credentials to the browser to work around schema-cache/ACL errors.

6. **Install the updated workers, flag still off.** Prepare a reviewed checkout at
   `/opt/pule/current` on the trusted worker host and its production dependencies
   (`npm ci --omit=dev --ignore-scripts`). Transfer the tested Docker artifact through
   the approved artifact channel and set `PULE_REPLAY_IMAGE` to its immutable tag or
   digest. Provision `/etc/pule/replay-workers.env` from the secret store, mode 0600.
   Review Node/Docker executable paths in the reference units, then:

   ```sh
   sudo install -m 0644 replay-worker/deploy/pule-replay-process.service /etc/systemd/system/
   sudo install -m 0644 replay-worker/deploy/pule-replay-process.timer /etc/systemd/system/
   sudo install -m 0644 replay-worker/deploy/pule-replay-cleanup.service /etc/systemd/system/
   sudo install -m 0644 replay-worker/deploy/pule-replay-cleanup.timer /etc/systemd/system/
   sudo systemd-analyze verify /etc/systemd/system/pule-replay-process.service /etc/systemd/system/pule-replay-process.timer /etc/systemd/system/pule-replay-cleanup.service /etc/systemd/system/pule-replay-cleanup.timer
   sudo systemctl daemon-reload
   sudo systemctl enable --now pule-replay-cleanup.timer pule-replay-process.timer
   sudo systemctl list-timers 'pule-replay-*'
   ```

   Processing: one singleton job per run, every minute; hard stop 30 minutes, below
   the 40-minute lease; force-remove its named container on exit. Media container:
   non-root, read-only, 2 CPUs, 3 GiB RAM, 128 PIDs, 2 GiB temporary disk, no host data
   mounts. Cleanup: every five minutes, four-minute hard timeout vs five-minute
   leases, exact bucket/path deletion only. Connect existing monitoring to failed
   services, stale queued jobs, failed leases, old due cleanup and actual usage.
   Configure alerts before enabling the flag; these units do not create an alerting
   integration automatically. No credential values should appear in logs. Do not deploy the old 3-argument
   cleanup script against the new bucket-qualified RPC.

7. **Complete full-stack/device acceptance on a disposable environment.** Use an
   approved test account/frame and real JWT TUS: upload, pause/reselect/resume, lost
   acknowledgment, revoked membership, competing attempts, source SELECT denial,
   direct output upload/upsert/DELETE denial, all four phone rotations, explicit
   corners, queued/failed/retry/completed, private signed playback, match removal,
   source deletion after publication and failed-source expiry cleanup. Verify no raw
   source ever enters `app.frame_replays`. Local stand-ins/mocks do not prove Storage
   HTTP/JWT/TUS or physical iOS Safari/PWA/Android behavior. Production stays flag-off
   until these pass. Do not change real users' history to create a canary.

8. **Separately authorize activation, then monitor.** The flag is build-time:
   changing a runtime environment without rebuilding does nothing. Only after all
   gates pass set `VITE_FRAME_RECORDING_UPLOADS=true` in the approved frontend build
   environment. On that approved build host, with its public URL/key configured:

   ```sh
   VITE_FRAME_RECORDING_UPLOADS=true NETLIFY=true npm run build
   ```

   Release the complete `dist` artifact through the existing Netlify/PWA workflow
   in [NETLIFY_PWA.md](NETLIFY_PWA.md); the final site identifier is not inferred here.
   Do not force-refresh/reload an active scoring session; let the existing update
   prompt protect saves. Verify original playback before/after and start with limited
   usage. This audit has NOT set the flag or performed that release.

## Postflight/readiness queries (read-only)

```sql
select relrowsecurity from pg_class where oid='storage.objects'::regclass;

select c.relname,c.relrowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in
 ('frame_replay_uploads','frame_replay_jobs','frame_replay_cleanup');

select p.oid::regprocedure as function,
 has_function_privilege('anon',p.oid,'execute') as anon,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated,
 has_function_privilege('service_role',p.oid,'execute') as service,
 p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='app' and p.proname in
 ('reserve_frame_replay_upload','finalize_frame_replay_upload',
  'get_my_frame_replay_upload','queue_frame_replay_processing',
  'can_upload_frame_replay','claim_frame_replay_processing',
  'complete_frame_replay_processing','fail_frame_replay_processing',
  'claim_frame_replay_cleanup','finish_frame_replay_cleanup')
order by p.proname;
```

Caller RPCs: authenticated only; processing/cleanup RPCs: service only. Exception:
`can_upload_frame_replay` is intentionally callable by anon for the PUBLIC fence,
but returns false without the matching authenticated actor/reservation. Its presence
is not anonymous upload permission. No PUBLIC execute should broaden other RPCs.
Finalizer must reference `frame-recordings` and jobs, not insert replay metadata;
only service `complete_frame_replay_processing` publishes generated output.

```sql
select state,count(*),min(uploaded_at),min(retain_until)
from private.frame_replay_jobs group by state;
select bucket_id,count(*),min(due_at)
from private.frame_replay_cleanup where completed_at is null group by bucket_id;
select status,count(*) from private.frame_replay_uploads group by status;
```

Sources: six-hour reservation; unprocessed/failed retention 48 hours; abandoned
transfer cleanup waits reservation expiry plus 24 hours; completed sources queue
cleanup only with successful publication. A confirmed match removal is an additional
cleanup cause. There are at most three processing attempts, immutable output names,
per-actor/group/day slot limits and exact owner/size/MIME checks. These are NOT a
project-wide spend cap: use provider budget controls/alerts and limit admission to
match the single worker's throughput before broad rollout. Monitor actual retained
bytes including failed output attempts and Storage partial-transfer expiry. Keep
cleanup tombstones/attempt identities; do not delete queue rows to free quotas.

## Exact ordered rollback / incident checklist

1. **Disable admission at the server, not just the UI.** Keep/read playback/status;
   stop new reservations/queue submissions and fence all source writes in one
   privileged transaction (instructions only, not executed):

   ```sql
   begin;
   revoke execute on function app.reserve_frame_replay_upload(uuid,uuid,bigint,text),
     app.queue_frame_replay_processing(uuid,jsonb,integer,integer) from authenticated;
   drop policy frame_recordings_insert_fence on storage.objects;
   create policy frame_recordings_insert_fence on storage.objects as restrictive
     for insert to public with check(bucket_id<>'frame-recordings');
   commit;
   ```

   Existing fully stored sources may still finalize safely; that does not publish
   raw videos. Cached PWAs/direct callers cannot bypass this server fence. Then set
   the frontend build flag false, rebuild/release the current playback-compatible
   code (on the approved build host):

   ```sh
   VITE_FRAME_RECORDING_UPLOADS=false NETLIFY=true npm run build
   ```

   Release that `dist` using the existing site workflow. Do NOT roll the frontend
   back to a pre-Watch-Replay version.

2. **Pause processing if publication/processor correctness is suspect:**

   ```sh
   sudo systemctl stop pule-replay-process.timer pule-replay-process.service
   ```

   The service removes its active container; pending SQL leases expire. Already
   running database transactions can still commit: record the incident time and
   inspect publications rather than guessing that a process stop undid a COMMIT. Do not
   fabricate completions, reuse output paths or delete sources manually. Keep the
   UPDATED cleanup timer running for ordinary UI rollback. If cleanup itself is
   suspect or forensic retention is needed, stop it BEFORE further deletions:

   ```sh
   sudo systemctl stop pule-replay-cleanup.timer pule-replay-cleanup.service
   ```

   In that case monitor storage costs and backlog; retain the durable queue intact.
   If credentials leaked, stop both workers and rotate the service-role credential
   through the provider/secret store; it is broader than this feature.

3. **Preserve data and schema/history.** No automatic down migration: leave 002/003/
   004 recorded as applied if their schema remains. Do not drop replay/ledger/job
   tables, change historical timestamps, make buckets public, reinstall old 2A
   publication functions or mark versions reverted just to silence CLI errors.
   Database restore cannot recover deleted Storage bytes. Use object backups and
   reviewed forward corrections for data recovery, never restore old metadata over
   live scoring. Compare the protected Phase 1 rows and verify Watch Replay.

4. **Resume only after a tested forward fix and separate authorization.** Restore
   the source INSERT fence exactly to the reservation predicate from 003, regrant
   only the two caller RPC signatures above to authenticated, and restart the
   updated timers. Let expired leases become failed/retryable; preserve original
   upload/operation IDs. Restore admission only with this reviewed transaction:

   ```sql
   begin;
   grant execute on function app.reserve_frame_replay_upload(uuid,uuid,bigint,text),
     app.queue_frame_replay_processing(uuid,jsonb,integer,integer) to authenticated;
   drop policy frame_recordings_insert_fence on storage.objects;
   create policy frame_recordings_insert_fence on storage.objects as restrictive
     for insert to public with check(bucket_id<>'frame-recordings'
       or app.can_upload_frame_replay(name,owner_id,metadata));
   commit;
   ```

   ```sh
   sudo systemctl start pule-replay-cleanup.timer pule-replay-process.timer
   ```

   Repeat the canary gates before rebuilding with flag true.
   If the atomic bundle never committed, leave history unchanged and remain on
   Phase 1; if COMMIT succeeded but history repair failed, repair verified history
   rather than rerunning migrations.

References: [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control),
[TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
[Storage metadata vs bytes](https://supabase.com/docs/guides/storage/schema/design),
[migration history](https://supabase.com/docs/guides/deployment/database-migrations).
CLI flags above were also checked against the installed v3.0.0 `--help` output.

## Local audit validation and remaining gates

Passed: 44 processing assertions using the exact atomic bundle on fresh and
existing-foundation upgrade paths, including rollback of 002 when 003 fails;
212 existing database assertions plus five concurrency checks; 27 Phase 1 replay
assertions; 36 match-removal assertions; four release-bundle unit tests;
37 selected frontend tests; 16 Python/media tests; toolchain `--check`; ESLint and
TypeScript/Vite build. Previously committed migrations 002/003 and shot detection
were not edited. New 004 and release packaging are the only SQL changes.

This workstation has neither Docker nor systemd tooling, so the actual image build,
unit installation/syntax checks on Linux, production bucket/history/ACL queries,
secrets, schedules, full-stack TUS/device canary, backup availability and provider
budget controls remain UNVERIFIED deployment gates. Repository tests pass; this is
not certification that production is configured or ready to activate. The upload
flag remains false/unset and no remote migration has been executed.
