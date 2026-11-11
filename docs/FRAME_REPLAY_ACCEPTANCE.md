# Manual replay acceptance test only

This is a short-lived exception to the Linux/systemd worker hosting steps in
[the deployment runbook](FRAME_REPLAY_DEPLOYMENT_AUDIT.md). The verified backup,
atomic 002→003→004 release, protected historical rows and private Storage policies
remain prerequisites. It is not ongoing production processing.

## GitHub worker

`.github/workflows/replay-acceptance.yml` runs only through **Actions → Replay
acceptance test → Run workflow**, on `main`. There is no schedule, push or PR
trigger. The `replay-acceptance` GitHub environment holds `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; restrict that environment to the `main` branch.
Never place these secrets in the frontend or repository files.

The standard Ubuntu 24.04 runner installs the existing dependencies, validates
FFmpeg rotation support before claiming work, and invokes the unchanged worker.
`check` (the default) verifies tools and credentials with a read-only metadata
request, without claiming a job. Operator SQL postflight must separately verify
that the processing/cleanup RPCs and ACLs are installed correctly.

`process-one` claims the next eligible queued recording, not a user-supplied ID.
Before dispatch, verify that only the intended test recording is queued. The
existing SQL lease/eligibility checks remain authoritative. One worker runs at a
time, with no cancellation of an active run; the whole job has a 30-minute limit
versus the 40-minute processing lease. The processing step is limited to 25 minutes.
One bounded cleanup pass follows even on failure; it only deletes objects assigned
by the existing durable cleanup queue. `cleanup-only` allows another explicit pass
without processing a recording. There are no video artifacts, upload-artifact
steps, dependency caches or credential/video debug logging. Review workflow status
and generic worker results for errors; do not turn on Actions secret/debug logging.

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
