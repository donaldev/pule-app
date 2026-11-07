# Mobile recovery startup — focused fix

Latest UI cleanup: Home and Play no longer show Review saved action, the Check match removal panel, or global Saved/error banners. Action gating remains server/journal-safe: a genuinely unresolved request produces a concise message only when a write is attempted. Recovery controls stay collapsed in Account → Local save recovery. Startup may acknowledge the exact removed outcome using an authorized target/mode acknowledgment when the original receipt is absent; no destructive replay is involved. Resume lists refresh read-only on tab focus/visibility and route changes, suppress stale rows while refreshing, and Home requires a saved active session response.

Latest focused verification: **53 frontend tests and production build passed**. No hosted changes, browser-data wipe or deployment.

Local frontend changes only. No hosted requests, migrations, deployments, real browser storage access or match deletion performed.

## Root cause

`intentStore.ts` still used the original command-name allowlist, excluding `remove_match`, `create_guest_with_email`, matchup resolution and invitation/claim commands. These commands could be durably saved and sent, then incorrectly classified as unreadable on reload. An interrupted removal or a pre-migration API rejection leaves precisely such an intent. IndexedDB is shared across tabs and persists across sign-out, so the same parser failure reappears at login.

The startup catch wrote the error into a generic global action banner, never made recovery ready and offered Refresh scores, which did not retry journal initialization. A separate not-ready message incorrectly attributed the parser failure to storage permissions. Ordinary notices/errors also had no dismissal/expiry or route scoping.

This identifies the defect in code; the actual Pixel record was not read. If the phone still reports malformed data after the updated frontend loads, export that private record for review rather than assuming all corruption is this known-command issue.

## Fix

- Pure validated command/kind allowlist includes every currently supported operation. Removal retains its original UUID, account, target, mode, revision and payload. Unknown/malformed records are not discarded.
- Startup performs the existing actor-scoped, exact-command read-only receipt lookup/reconciliation for a restored removal. Confirmed receipt plus authorized removal acknowledgment clears only that exact journal entry. It never tries to load the deleted session and never replays a write. A shared startup promise prevents StrictMode initiating competing startup recoveries.
- If the original attempt predates the migration and another operation later removed the match, its original operation receipt may legitimately be absent. **Match already removed? Check and clear** is an explicit alternative: current owner/admin-authorized `get_match_removal` must confirm the exact session and mode, then only the original local request is cleared. This is acknowledgment of the removed outcome, not a fabricated receipt for the original operation.
- Negative, failed or mismatched checks keep the pending request and scoring lock. Explicit resend preserves the UUID/payload and requires a fresh destructive confirmation. No automatic resend.
- Journal cleanup/update also compares actor, operation kind/name and args; a stale tab cannot clear an entry whose payload changed under the same ID.
- Malformed data and genuine unavailable/blocked IndexedDB receive distinct errors and a working Check recovery again action. Failed opens can retry; blocked requests do not leak a late-opened database handle.
- For genuinely unreadable records, a private export and review/reset disclosure are available. No automatic reset. The user must first save the file and confirm that server status was reviewed and no unacknowledged action can be lost, then approve resetting the one record. The readwrite transaction rechecks that the account's record is still malformed and byte-identical to the exported JSON; an intervening valid/new request is rejected. Other accounts and browser storage are untouched.
- The browser cannot independently prove the status of an arbitrary malformed request. If its operation context cannot be verified, preserve the file and seek review; do not confirm reset. A download prompt alone is not evidence of server acknowledgment.
- Success notices expire after 4.5 seconds or can be dismissed. Normal errors can be dismissed and clear on route change. These actions never clear the journal. Unresolved recovery retains its own panel, with a compact Review saved action link on unrelated routes instead of repeated generic error banners.

## Verification

**43 focused tests passed; ESLint and production TypeScript/Vite build passed.** Checks cover known-command reload, malformed export/reset guards, actual IndexedDB read error classification using an isolated model, storage retry, exact removal receipt with a nonexistent session, a different acknowledged removal, negative/failed receipt preservation, cross-tab journal guards and notification dismissal/expiry. Existing coordinator and recovery-presentation tests remain included. No actual phone storage, hosted RPC, full suite or browser automation used.

## Pixel check

1. Close older Pule tabs and open the updated local/frontend build in the same Chrome origin where the error occurred. Do not clear site data or reinstall.
2. Sign in. A normal stored removal should now parse. If the exact operation is acknowledged, startup clears only that matching entry read-only and scoring unlocks.
3. If a removal remains, open Review saved action → Advanced help → Check whether this action was saved. If another request already removed it, use Match already removed? Check and clear. These checks do not delete a match.
4. If the record is truly unreadable, download the private recovery file and review its operation/server status before approving any reset. Do not share the file publicly or reset merely because the banner is inconvenient.
5. Confirm a normal success notice disappears after a few seconds and normal errors dismiss/clear when navigating. An unresolved request remains accessible until genuinely resolved.

No migration or deployment is part of this fix.
