# R2 temporary frame recordings — local integration, not deployed

Uses the existing private **pule-frame-recordings** Standard bucket and existing
Cloudflare Pages application. No new bucket, standalone Worker, server or paid
service is provisioned. Supabase remains the authority for accounts, participation,
sessions, upload reservations, jobs and published replay metadata. Existing replay
objects, signing, Watch Replay, historical timestamps and shot detection are unchanged.

## Contract

- New migration: `202611110001_r2_frame_recordings.sql`, after the already-deployed
  002→003→004 release. Do not edit/reapply those migrations. Existing reservations
  default to provider `supabase` and remain recoverable through their original TUS
  path and operation UUID; they are never silently converted to R2 reservations.
- `functions/api/recordings.js` is the only Pages Function route. `_routes.json`
  limits execution to `/api/recordings`; static app/assets do not invoke it.
  Explicit origin allowlist, validated Supabase user JWT and caller-scoped RPCs
  enforce linked participation, completed/detail-eligible frame, session visibility,
  one active reservation per frame, quotas and six-hour expiry before any upload.
- R2 sources allow **2 GiB** maximum, within the existing two-hour/resolution limits.
  New source paths are server-assigned immutable `<session>/<frame>/<upload>.mp4`.
  The existing browser journal records provider, actor, operation, file SHA-256 and
  corner geometry before a reservation. Same-file explicit resume reuses that ID.
  Old journals without a provider are treated as Supabase, including lost-ack retries.
- The broker creates/binds one multipart upload. Competing creates bind one winner;
  losers are aborted. It signs only individual 16 MiB PUT parts, for **120 seconds**,
  binding the exact object, upload ID, part number and Content-Length. No browser
  create/complete/delete/list permission or R2 secret is issued. URLs are bearer
  capabilities until expiry; revocation blocks new signing immediately, while an
  already-issued part URL can remain usable for at most two minutes.
- On explicit resume the broker lists server-maintained parts and checks their
  numbers/sizes; the browser sends only missing parts. There are no automatic
  retries, polling or background transfers. File selection/hash/corner mapping,
  including the encoded coordinate space of rotated phone videos, is reused.
- Completion uses the server's part list and a create-only conditional request,
  then independently HEAD-checks length, MIME, upload/actor/hash metadata and ETag.
  Only a service-only, explicitly actor-bound RPC can mark a source uploaded.
  Lost acknowledgments recover through HEAD and the original reservation, without
  overwriting a completed object. Browser-supplied metadata is never completion proof.
- Existing explicit corner submission queues the same processing jobs. Old workers
  claim only Supabase sources; an R2-configured worker claims through the R2-only
  wrapper, falling back to legacy work when the R2 queue is empty. It streams the
  source using an ETag condition, verifies exact length AND full SHA-256, then calls
  the unchanged processor. Published MP4s still use Supabase `frame-replays` and the
  existing verified publication RPC. Source deletion is never inside the uncertain
  publication acknowledgment path.
- Publication atomically queues R2 cleanup. The existing cleanup worker aborts the
  bound multipart ID, checks source identity, deletes the exact source and verifies
  absence before acknowledging its lease. Expired reservations, 48-hour failed/
  unprocessed retention and match removal use that same durable queue; failed
  cleanup retains work/quota for another explicit pass. Incomplete transfers with
  lost create acknowledgments are covered by the bucket's mandatory abort lifecycle.
  No SQL deletion pretends to remove R2 bytes.

## Exact configuration required (do not paste secret values into chat)

Create an **R2 S3 API credential** with **Object Read & Write**, scoped ONLY to
`pule-frame-recordings`. Account-wide admin/API credentials are unnecessary. Keep
public access (`r2.dev` and custom public domains) disabled. This implementation
uses the default-jurisdiction endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
and S3 region `auto`; do not configure arbitrary endpoints.

| Setting | Existing Pages runtime | Trusted processor/cleanup environment |
|---|---|---|
| `R2_ACCOUNT_ID` | Your 32-character Cloudflare account ID | Same |
| `R2_RECORDINGS_BUCKET` | `pule-frame-recordings` | Same |
| `R2_ACCESS_KEY_ID` | Bucket-scoped S3 Access Key ID, server secret | Same credential; never `VITE_` |
| `R2_SECRET_ACCESS_KEY` | Matching Secret Access Key, server secret | Same credential; never `VITE_` |
| `SUPABASE_URL` | Existing HTTPS project URL | Existing value |
| `SUPABASE_PUBLISHABLE_KEY` | Existing public key; actor-JWT RPC requests use it | Not needed |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server secret, for verified attestations only | Existing value |
| `RECORDING_ALLOWED_ORIGINS` | Comma-separated exact approved HTTPS origins; no wildcards | Not needed |

Set the four R2 values in the existing `replay-acceptance` GitHub environment when
that workflow is eventually updated. The local workflow change passes them only to
trusted processing/cleanup steps. Never put secret values in committed files,
command arguments, build-time browser variables, logs, video artifacts or caches.
The Pages function uses S3 credentials directly; **no R2 binding is required**.

R2 bucket CORS (substitute ONLY the exact active test origin; retain production
origin only if its future use is approved):

```json
[
  {
    "AllowedOrigins": ["https://pule-app.pages.dev", "https://EXACT-ACCEPTANCE-ORIGIN"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-length", "content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Bucket lifecycle rules, applying only to this dedicated temporary-source bucket:

1. **Abort incomplete multipart uploads after 1 day.** Required even with the
   database queue: a network failure can lose the create response before the ID
   reaches the ledger. Six-hour reservations cannot legitimately use those parts.
2. **Expire completed source objects after 7 days** as a backstop for a stopped
   cleanup worker. Active jobs have at most 48 hours after finalization (within a
   six-hour upload reservation), so this does not truncate a valid processing lease.
   This lifecycle is intentionally limited to temporary sources, never replay outputs.

Lifecycle rules delete data: review the bucket is dedicated to disposable source
recordings before configuring them. No rules or credentials were configured by
this local task. Keep durable cleanup running/manual passes monitored even with
these backstops. R2 storage/operations above its free allowance can incur charges;
2 GiB × retained slots is materially larger than the old 25 MiB pilot. Existing
concurrent/retained/daily quotas remain; monitor bytes, failed jobs and oldest due
cleanup. Do not promise this backend is unconditionally free at arbitrary usage.

## Browser configuration and rollout prerequisites

Only the public URL below belongs in a browser build:

```text
VITE_RECORDING_UPLOAD_API_URL=https://pule-app.pages.dev/api/recordings
```

Leave this unset and keep `VITE_FRAME_RECORDING_UPLOADS=false` in the public build
until separate rollout approval. Do not update the currently running phone preview
or discard its saved reservation as part of this code change. The existing enabled
acceptance preview can later point to the broker cross-origin if its exact origin
is included in both the broker allowlist and R2 CORS. Supabase Auth still needs
that exact callback origin when Google/PKCE is used.

Future authorized rollout: verify fresh manual backups; review/apply only the new
migration and record its version; configure the existing bucket/settings/secrets;
update the existing workers/Pages function with uploads still disabled; verify the
function bundle and allowed-origin denial; then use a separate controlled preview
for a real Android multipart interruption/resume test. Do not switch an active
legacy reservation's protocol, expected bytes, UUID or source key. Explicitly finish
or expire it normally before starting a new R2 reservation for the same frame.

Install the existing Python requirements (now including boto3). A large source is
losslessly remuxed to a second file during analysis, so allow **at least 8 GiB free
scratch space** per 2 GiB recording; the old 2 GiB `/tmp` container setting is not
suitable. Retain the existing hard runtime limit shorter than the 40-minute lease.
Larger/high-resolution recordings can still exceed the unchanged 20-minute detector
timeout; failed recordings remain recoverable until retention expires. No detector
thresholds, shot selection or rendering behavior was changed.

Finished replay limits are still enforced by Supabase: R2 solves the source limit,
not the private `frame-replays` bucket's existing 25 MiB limit or the Free-plan
50 MB ceiling. An oversized generated replay will fail publication and retain its
source; there is no silent output truncation or source-as-replay fallback.

## Local verification

```sh
python3 -B scripts/database/run_tests.py --sql-test r2_frame_recordings.sql
python3 -B scripts/database/run_tests.py --sql-test r2_frame_recordings.sql --upgrade-foundation
python3 -B scripts/database/run_tests.py --sql-test frame_replay_processing.sql
node --test scripts/frontend/r2Recording.test.mjs scripts/frontend/recordingUpload.test.mjs scripts/frontend/replayCleanup.test.mjs scripts/frontend/frameReplays.test.mjs
python -B -m unittest discover -s replay-worker/tests -v
npm run lint
npm run build
```

SQL tests are disposable/synthetic; broker, browser HTTP and Python R2 tests use
controlled adapters, with real SigV4 URL signing and existing FFmpeg media tests.
No live R2 multipart upload, actual Chrome Content-Length/CORS behavior, lifecycle
execution or Pages deployment is claimed by these checks. They remain mandatory
acceptance gates with separately approved credentials/deployment.

References: [R2 multipart](https://developers.cloudflare.com/r2/objects/upload-objects/),
[presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
