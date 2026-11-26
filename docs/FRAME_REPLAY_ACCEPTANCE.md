# Replay worker and acceptance

The verified backup, atomic 002→003→004 release, protected historical rows and
private Storage policies in the [deployment runbook](FRAME_REPLAY_DEPLOYMENT_AUDIT.md)
remain prerequisites.

## GitHub worker

The **Replay acceptance test** workflow requests a run every five minutes on
`main`. GitHub can delay or skip scheduled runs. The workflow also supports
manual dispatch from **Actions → Replay acceptance test → Run workflow**.
Keep the `replay-acceptance` environment restricted to `main` and keep credentials
out of frontend builds and logs.

- **check** verifies the toolchain and credentials with a read-only metadata request.
- **process-one** claims at most one eligible job.
- **process-queue** uses the scheduled batch path and claims up to five jobs sequentially.
- **cleanup-only** runs one bounded cleanup pass without claiming processing work.

The processing job has a 53-minute timeout, including setup. Its processing step
has a 50-minute hard timeout. A single claim and its work have a 35-minute watchdog,
including download, processing, publication and enqueueing cleanup. Before each
claim the worker requires 36 minutes of remaining budget. A watchdog expiry
stops the batch and leaves any unconfirmed work for SQL lease recovery.
The processing concurrency group serializes scheduled and manual runs. The
existing SQL leases govern claims and fence publication. The worker reports
counts, elapsed time and its stop reason in the Actions summary.

Publication enqueues source cleanup. The separate cleanup job consumes the
durable queue and handles expired work under the existing safeguards. It can run
independently of processing, so recently published work may be cleaned by a
later pass.

For this Free-plan pilot, retain the existing private `frame-replays` bucket's
**26214400-byte (25 MiB)** limit and configure private `frame-recordings` identically,
with allowed MIME types exactly `video/mp4`. This satisfies the migrations' bounded
bucket checks and stays below the Free-plan 50 MB global ceiling. The unchanged
UI's 250 MiB ceiling is not a promise of the deployed bucket limit: the pilot source
AND generated replay must each fit 25 MiB. No paid upgrade is required.

## Controlled Android Chrome UI

Keep the public deployment's `VITE_FRAME_RECORDING_UPLOADS=false` (or unset).
Build the existing app separately into a private directory outside Git:

```sh
VITE_FRAME_RECORDING_UPLOADS=true NETLIFY=true npm run build -- --outDir /private/tmp/pule-replay-acceptance/dist
```

The build uses the existing public production Supabase URL/key only. Never publish
that directory to the public production site. Serve only these built static files
through the already installed ngrok agent, with Basic Auth and inspection disabled:

```sh
ngrok http file:///private/tmp/pule-replay-acceptance/dist --inspect=false --traffic-policy-file /private/tmp/pule-replay-acceptance/access.private.json
```

The mode-0600 policy is outside Git and contains one random test-only Basic Auth
credential. Do not put the credential in arguments, chat, logs or artifacts. Confirm
unauthenticated requests receive HTTP 401 before sharing the HTTPS origin with the
tester. The policy must fail closed; do not remove authentication to fix a tunnel
failure. Only compiled files are served, not the checkout, secrets or backups.

Open the protected origin in Android Chrome, authenticate at the tunnel prompt,
then sign into Pule using an existing authorized test account. If Google/PKCE is
needed, add ONLY this exact origin plus `/` to Supabase's redirect allowlist,
preserving the production Site URL and all existing entries. Remove the temporary
entry afterward. Confirm a secure context and Web Locks support.

Use a disposable, detail-eligible completed test frame in which the signed-in
linked player participated, with no existing replay. Do not attach a source to the
historical frame already holding the Phase 1 replay; do not edit historical data.

Phone flow: **Frame History → Upload / recording status → Choose MP4 recording →
Use this view to mark corners → tap four corners cyclically → Upload full frame →
Create replay**. Dispatch `process-one`, then tap **Check status → Watch Replay**.
No automatic polling is added. Verify original Phase 1 playback separately.

Keep the original browser/file for recovery. Failed sources remain retained by the
existing expiry rules; later dispatch `cleanup-only` after they become due. There
is no unattended cleanup scheduler in this acceptance-only setup, so record any
remaining due times and run explicit cleanup passes until the test queue is clear.
Do not advertise general upload availability or leave failed test data unattended.

## End the test

Stop the ngrok agent and delete the temporary enabled build/access policy after
pending upload recovery is resolved. Leave the public upload flag disabled. Run
any outstanding manual cleanup passes; inspect job/cleanup state without deleting
queue rows. Remove the GitHub environment service-role secret when testing ends
to disable future processing until explicitly reprovisioned. Preserve published
replays and historical data. For an incident, use the runbook's server admission
fence and forward-only rollback; flag-off alone does not block direct RPC callers.

## Deployment checkpoint — 11 November 2026

- Manual full-database backup restored successfully in isolated PostgreSQL 17.11;
  all 72 table counts/content fingerprints matched the source snapshot. Existing
  replay bytes were separately backed up, checksum-verified and fully decoded.
- Atomic 002→003→004 committed; migration history now records all three versions.
  The existing replay metadata and historical null timestamps compared unchanged.
- Private source bucket created at 25 MiB; the existing private replay bucket and
  its 25 MiB cap were preserved. Client private-ledger access remains denied.
- Main-only GitHub environment/secrets configured. Readiness run
  [43071996456](https://github.com/donaldev/pule-app/actions/runs/43071996456) and
  empty-queue worker/cleanup smoke run
  [43072983029](https://github.com/donaldev/pule-app/actions/runs/43072983029) passed.
  No real recording has been processed by these runs; device acceptance is pending.
- The existing Git-connected production host is **Cloudflare Pages**, at
  `https://pule-app.pages.dev/`, rather than Netlify. Its deployed entry bundle was
  checked and does not contain the upload selector. `netlify.toml` additionally
  keeps the upload flag false if that documented host is used again. Only the
  separate password-protected acceptance build enables the selector.
- Temporary HTTPS origin authenticated with HTTP 401 for unauthenticated requests;
  compiled app and recording download passed authenticated checks. Only its exact
  callback URL was added to Supabase Auth; production Site URL, providers and all
  previous redirects were preserved. Remove that temporary entry after testing,
  preserving any redirects added by others since the test began.
- A 20,863,780-byte copy of the supplied complete recording is available only
  through the protected acceptance endpoint. Duration and phone rotation were
  retained; the original file was not changed. The existing mobile metadata parser
  accepts its 1280×720 encoded dimensions and rotation. It is not a generated replay.

Local validation: manual-only workflow YAML/security checks, 11 PWA/cleanup tests,
16 existing Python/media tests, lint and production/acceptance TypeScript/Vite
builds passed. No changes to shot detection, Watch Replay or historical data.
