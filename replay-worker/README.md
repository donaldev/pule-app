# Pule Stage 1 replay processor and worker

Local integration only. Watch Replay and historical data are preserved. No remote
migrations, Storage operations, scheduling or deployment have been performed.

`replay_processor.py` is the supplied extraction of the existing OpenCV detector
and FFmpeg renderer. Its thresholds, 15 fps sampling, table masking, padding and
960px H.264/AAC rendering are preserved. The sole processor integration fix is
fixed-decimal FFmpeg seek/duration formatting: scientific-notation timestamps
produced by OpenCV floating-point rounding are rejected by FFmpeg. A source is ONE complete pool frame.
The worker does not treat the uploaded recording as the finished replay, and it
does not detect/select a table automatically. Threshold accuracy on real matches
still requires acceptance testing; synthetic tests do not establish shot accuracy.

## Backend and storage contract

Apply the new `202611100003_frame_replay_processing.sql` after undeployed
`202611100002_frame_replay_uploads.sql`, before enabling any upload endpoints.
Do not release the intermediate 2A direct-publication contract as the final API.
The follow-up migration refuses to apply if the 2A ledger already has attempts;
reconcile any unexpected usage separately rather than guessing how to reinterpret
published videos. Existing Phase 1 replay rows/objects are never rewritten.

Two buckets must already exist and be private, allow exactly `video/mp4`, and cap
new objects at no more than 250 MiB (review the project-wide limit too):

- `frame-recordings`: temporary full-frame sources. No browser SELECT, UPDATE or
  DELETE. Only the actor's exact active reservation authorizes INSERT.
- `frame-replays`: existing generated replay bucket. Browser INSERT is denied
  again; authenticated viewing remains registered-object/session-scoped only.

The migration only reads bucket configuration; it does not create/configure them.
Phase 1 legacy `<session>/<frame>.mp4` paths and new UUID attempt replay paths stay
compatible with `replayService.ts` and the existing Watch Replay modal.

### Upload and human table coordinates

The existing reservation RPC still checks the caller's linked frame participation,
session visibility, detail eligibility, completion status, quotas and expiry. Its
response now names `frame-recordings`. Upload using the user's JWT, without upsert.
`finalize_frame_replay_upload(upload_id)` verifies source owner/size/MIME, marks the
source uploaded, and returns `processing_status='uploaded'`. **It never inserts
`app.frame_replays`.** Repeating it returns the same job state.

A human must then call the authenticated owner-only RPC:

`queue_frame_replay_processing(p_upload, p_corners, p_width, p_height)`

`p_corners` must be four finite `[x,y]` points, clockwise or counterclockwise around
the table, in the ORIGINAL encoded (unrotated) recording's pixels. Supply the matching width
and height; values are not normalized coordinates, a preset from another camera,
or positions in a resized preview. SQL rejects crossed/degenerate/out-of-bounds
polygons. The worker opens that exact source and checks dimensions, convexity,
bounds, minimum area and crop memory limits again before calling the detector.
The mobile UI reads the MP4 display matrix and inverts preview taps into these
encoded pixels. The worker losslessly remuxes the source with zero display rotation
for analysis, then restores the original display rotation on the generated replay.
This avoids differences between OpenCV decoder backends without changing shot
detection or re-encoding the recording. FFmpeg 6+ with `-display_rotation` is required.
Confirm the real mobile capture path before rollout. Do not infer corners automatically.

Without coordinates, the job remains uploaded and cannot be claimed. The optional
[mobile recording UI](../docs/FRAME_RECORDING_UI.md) now collects these coordinates
explicitly; keep its feature flag disabled until this backend and updated worker
are deployed.
The original offline processor can still be used with a human-created `.npy` file
for unrotated recordings. For rotated recordings use the worker path, which applies
the new encoded-coordinate convention; the standalone detector retains its original
OpenCV decoder behavior:

```sh
python replay-worker/replay_processor.py --input recording.mp4 \
  --corners table_corners.npy --output replay.mp4 --workdir /tmp/pule-offline
```

### Leased processing and publication

Lifecycle: `uploaded -> queued -> processing -> completed/failed`.

- Service-only `claim_frame_replay_processing()` atomically leases one eligible
  queued job for 40 minutes and assigns an immutable output UUID path. Eligibility
  rechecks the original uploader, not the worker's identity. Three attempts max.
- The worker downloads only the leased key from the configured HTTPS project's
  `frame-recordings` bucket. No caller-controlled signed URLs or redirects are
  accepted. Downloads and uploads stream in bounded chunks; credentials and paths
  are not logged. `x-upsert=false` prevents replacing any existing output.
- The supplied detector/renderer runs in an isolated temporary directory. It has
  a 20-minute subprocess limit; timeout kills its process group including FFmpeg.
  Sources are capped at 250 MiB, 2 hours, 8192px edges and 32 megapixels. Crop memory
  is bounded. No-motion, bad coordinates or invalid video fail rather than publish.
- ffprobe checks generated H.264, positive duration, byte limits and clip count.
  `complete_frame_replay_processing` is service-only and checks lease freshness,
  current frame/uploader authority, output Storage metadata, size/MIME and replay
  uniqueness. Only this generated output is registered for playback. Duplicate
  completion with the same lease returns the same saved replay.
- SQL queues source deletion atomically AFTER publication. The Python worker never
  deletes a source itself, including after an ambiguous/lost publication response.
  The cleanup worker performs Storage API deletion, not SQL Storage-row deletion.

Failures call `fail_frame_replay_processing`, retire any partial output into cleanup
and retain the source for up to 48 hours after upload finalization. The actor can
explicitly submit corrected corners/requeue before expiry (maximum three claimed
attempts). Each retry gets a fresh lease/output path. Crashed/expired leases become
failed on the next processing claim; stale workers cannot publish. Failed/unclaimed
sources expire into cleanup even if the Python worker is stopped, provided the
separate cleanup scheduler runs. Match removal invalidates jobs and queues both
source/output paths; it cannot resurrect a removed match. Cleanup tombstones catch
late outputs from abandoned workers.

The 2A coarse slot/daily quotas remain conservative. An attempt may temporarily
store a 250 MiB source plus up to three 250 MiB output attempts until cleanup; budget
up to 1 GiB per slot and
monitor actual project bytes, cleanup backlog, compute and egress. Per-group slot
accounting may count a published output separately from its source attempt; this
is deliberately conservative, not exact billing. Do not erase ledger/tombstone
rows to free space. Do not manually replace or restore queued object paths.

## Trusted deployment and operation (not performed)

Build with `docker build -t pule-replay-worker replay-worker`. It installs FFmpeg
and the supplied NumPy/OpenCV dependencies and runs as a non-root user. Keep
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the worker secret store only;
never browser bundles, job JSON, image build args or committed `.env` files.

Run `python replay-worker/replay_worker.py` for one database job (or start the image
with those runtime environment variables). Schedule short-lived runs, one active
worker initially. Set a scheduler/container hard runtime cap below the 40-minute
lease (e.g. 30 minutes), plus CPU, memory, PID and temporary-disk limits. Example
resource envelope: two CPUs, 3 GiB memory, 128 PIDs, read-only root filesystem and
2 GiB writable `/tmp` (including the lossless orientation copy); adjust only after real-video measurements. A hard-killed job
recovers through lease expiry. Do not run media decoding on the web/API host.

Also schedule `node scripts/storage/cleanup-frame-replays.mjs` regularly with trusted
credentials. This worker now accepts bucket-qualified leases from the two exact
buckets and acknowledges absence using the NEW `p_bucket` parameter. Deploy the
updated cleanup worker together with the migration, not its earlier 2A version.
Alert on failed/stuck jobs, retention expiry, exhausted quotas and cleanup backlog.

All claims/publication/cleanup functions are service-only. Browser callers can only
reserve, finalize their source, inspect their own state and explicitly queue/retry
with corners. Neither processor nor worker merges identities or changes scoring.

Before production: verify real JWT TUS upload metadata/ownership, manually chosen
corners from mobile recordings, representative shot accuracy, FFmpeg audio/rotation,
output playback, lost acknowledgments, worker termination, revocation, match removal
and actual Storage API cleanup on a disposable full Supabase stack. A MIME label
alone does not validate media; decoding runs only in the constrained worker.

## Local verification

```sh
python3 -m venv /tmp/pule-worker-venv
/tmp/pule-worker-venv/bin/pip install -r replay-worker/requirements.txt
/tmp/pule-worker-venv/bin/python -B -m unittest discover -s replay-worker/tests -v
python3 -B scripts/database/run_tests.py --sql-test frame_replay_processing.sql
python3 -B scripts/database/run_tests.py --sql-test frame_replay_processing.sql --upgrade-foundation
python3 -B scripts/database/run_tests.py
node --test scripts/frontend/frameReplays.test.mjs scripts/frontend/replayCleanup.test.mjs
npm run lint
npm run build
```

SQL tests use synthetic Storage metadata in disposable local PostgreSQL, not remote
Storage. Worker tests include actual local OpenCV/FFmpeg/ffprobe fixtures plus
mocked API orchestration. The old `frame_replay_uploads.sql` suite is intentionally
run only through migration 2A as a checkpoint regression; its direct publication
behavior is superseded by the Stage 1 security suite. No hosted end-to-end or Docker
image test is claimed.

Verified locally: **42 processing assertions** on fresh and existing-foundation
upgrade paths, including competing worker claims, duplicate publication and match
removal races; **212 existing database assertions plus five concurrency checks**;
**36 focused removal assertions** and the **65-assertion 2A checkpoint**. All **30
selected frontend/cleanup tests**, **12 Python processor/worker tests**, ESLint and
TypeScript/Vite build passed. The Python suite includes the actual supplied
detector plus FFmpeg rendering on a synthetic moving-ball recording, real H.264
probing, no-motion rejection, coordinate rejection and lost-publication recovery.
These results do not establish shot accuracy on real recordings.
