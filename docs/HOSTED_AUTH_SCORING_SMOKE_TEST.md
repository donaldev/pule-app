# Hosted Auth/API scoring smoke-test checklist

Prepared 4 November 2026. **The assistant has not run hosted test mutations.** Owner-reported partial live testing and a two-tab timeout are investigated in [TWO_TAB_CONFLICT_INVESTIGATION.md](TWO_TAB_CONFLICT_INVESTIGATION.md); this does not mark the full checklist passed. Implementation uses the existing deployed RPCs; this checklist requires owner approval before the assistant creates any hosted test account, group or scoring record. Do not run fixture/bootstrap SQL or import a workbook. No privileged browser key is needed.

## Proposed test scope for approval

Use two owner-approved test email accounts, A and B, each able to receive confirmation emails. Use separate browser profiles for A and B; Supabase Auth synchronizes sessions across tabs on the same origin. Create clearly labeled isolated test groups, guest identities and venues so test results do not pollute the eventual real group. Retain test records until an authorized cleanup/archive policy exists; the UI intentionally has no destructive session deletion.

Approval would cover: two Auth signups/confirmation emails; group A with three guest players and a venue; group B with two guests and a venue; explicit adoption of reviewed version-1 rules; test nights/frames, corrections and finalization in those groups. No real or historical identities are claimed. Additional hosted changes remain excluded.

Run the app locally:

```sh
npm run dev
```

Use **http://localhost:5173/**. Vite now requires port 5173 rather than silently changing ports, to match the configured Auth redirects. `.env.local` was checked without revealing values; do not print it. If the port is occupied, stop the other local development server or explicitly revise the allowed redirect configuration before testing. No frontend deployment is required.

## Checklist and expected evidence

| Test | Steps | Expected result |
| --- | --- | --- |
| Signup | In profile A, choose Create account and submit the approved email/password | Confirmation guidance appears; no player/group is created by Auth signup. A protected session cannot be used before confirmation under the configured policy. |
| Email confirmation | Follow the email link in the same browser/profile | PKCE code is exchanged once and removed from the URL. The authenticated group-onboarding screen opens. React StrictMode does not perform a second exchange. |
| Confirmation fallback | Confirm from another profile or use an expired link | Safe recovery guidance; after successful email confirmation, ordinary password sign-in works. Resend requests are user-triggered; no tokens/codes are copied into reports. |
| Sign-in/out | Sign out, then sign in with A | Only this browser is signed out; A’s database records remain. Refresh restores Auth using the SDK. Passwords never enter the recovery journal. |
| Group creation | Create the approved test group and time zone | One group and one owner membership are created atomically. The UI advances to setup. Refresh loads the same group from Supabase. |
| Persistent setup | Save three guest names and one venue, then refresh | Same UUID-backed roster and venue load; no hard-coded sample identities. Creating a guest does not claim an Auth account or historical player. Check for existing names before adding duplicates. |
| Rules | Read version-1 semantics, provide label, explicitly check approval and adopt | Owner/admin-only adoption; a verified rule becomes available. No race target or automatic pair/breaker rotation is introduced. |
| Three-player night | Select all three guests, venue, rule and initial breaker; start night | Saved session contains all three. Its hash route includes the server-generated session ID. Every player begins with zero saved wins. |
| Rotating pairs | Frame 1 A-guest/B-guest, frame 2 B-guest/C-guest, frame 3 C-guest/A-guest; explicitly choose breaker each time | Each frame has exactly the selected two; the sitting-out player gains neither a frame win nor loss. No next pair is automatically selected. |
| Frame metadata | Choose winner; adjust both actual players’ fouls; explicitly choose break-pot Yes/No; choose pocket/event as applicable; confirm | All metadata and score are saved together. The UI shows only server-confirmed totals. Invalid special/offender/break relationships are blocked or rejected safely. |
| Stopwatch | Start, pause, wait, resume and complete a frame | Saved clock restores across refresh; paused time is excluded by the server. Running display is an estimate, completed duration is server-derived. |
| Refresh recovery | Refresh during an active frame, then after logging a frame | Active pair, saved timer, revision and acknowledged scores restore from Supabase. Completed metadata is retained. **Unconfirmed form inputs are not checkpointed and reset on refresh**; see limitations below. |
| Correction | Use Correct last logged frame or a timeline correction; change winner/fouls and record reason | Server totals recalculate; reason appears in correction history. Editing an older frame does not reset a different running frame. No original frame deletion occurs. |
| Uncertain write before delivery | Go offline after the app has loaded; submit an allowed action, then reconnect and reload the app | An account/project-scoped IndexedDB intent retains its original UUID, exact payload and expected revision. It is not an accepted score. No automatic resend or new operation is created. |
| Idempotent retry | Choose Retry original request | Same UUID/payload is sent under the same authenticated user. Exactly one intended mutation is represented; journal clears only after acknowledgment and local cleanup. |
| Lost acknowledgment after commit | With separately approved local response interception, drop one RPC response after it reaches the server; inspect saved state from another A tab, then retry original | Existing receipt returns the original saved result; no second frame/guest/night is created. This advanced case needs reliable interception; simply toggling offline does not prove a post-commit response loss. Local coordinator tests cover the model, but real API behavior remains untested. |
| Concurrent/stale submission | Open the same active frame in two A tabs. Save in tab 1. After it acknowledges, submit the stale frame in tab 2 before refreshing it | A received fresh SQLSTATE 40001 is a known conflict; no second win. Tab 2 keeps that rejected intent for review. A timeout instead remains uncertain and must not be discarded as a known rejection. Status-specific guidance appears beside scoring and in the recovery panel; refresh alone does not resolve an uncertain request. The journal may block an overlapping write before it reaches the server; that is expected. Do not bypass it. |
| Cross-group isolation | Sign up/confirm B in its separate profile and create group B. Attempt to open A’s session hash URL while signed in as B | Access denied, no A data displayed and no mutation. B’s selectors/list show only B’s group. Do not bypass RLS or add membership to make this pass. |
| Account-bound recovery | With an unresolved A intent, sign out with the explicit retention prompt and sign in as B in that profile | No A intent is sent as B. Sign back into A to recover the same operation. Request headers freeze the intended actor; passwords/tokens are not stored in intents. |
| Finalization | Between frames, review the displayed saved roster scores and explicitly finalize | Status becomes finalized in Supabase. Further scoring/correction is disabled; history and All-Time standings include the saved result. Multiple top scores remain ties, not an invented multiplayer winner. |
| Sign-out after completion | Sign out, refresh, sign back in | Private screens require Auth; final result is fetched again from the database. No local score fallback is used. |

Record each case as **passed / failed / not run**, with the relevant operation UUID, saved revision, session ID and visible result. These are recovery references, not credentials. Never include passwords, tokens, API keys, email confirmation codes or raw authorization headers in evidence.

## Recovery rules during the test

- Do not edit an unresolved intent’s UUID, payload, actor or revision. Do not clear browser storage while resolving it.
- A fresh explicit SQL rejection/conflict can be reviewed and discarded locally. A request that was ever uncertain stays uncertain even if a later retry is denied; a prior commit may still exist.
- Uncertain operations cannot be discarded through the UI. Restore the original account/permissions and retry identically, or export the private intent for authorized operator review. There is no public receipt-administration RPC yet.
- Group data and scores always come from Supabase. IndexedDB stores only one unresolved write intent per account/project, not a replacement scoring database or an offline queue. New writes require that recovery journal to commit before sending.
- If storage is unavailable, fail visibly and do not send a new mutation. If acknowledgment succeeds but local cleanup fails, retry the same request to recover its receipt.

## Known limitations to assess

Unconfirmed winner/foul/pocket inputs are currently component-local and not durably checkpointed. A refresh restores the server’s active frame and accepted state, not those unsubmitted edits. No full offline scoring, service worker caching, automatic background sync, invitation/member management, identity claiming, scorer takeover or finalized amendments is implemented. History shows the newest 100 nights; standings are All-Time for the selected group. A scorer role still needs the backend’s assigned-scorer authorization for a particular night. Group invitation and transfer workflows remain future work.

Auth email delivery, exact redirect allow-list behavior, PKCE completion, real RLS responses and live SDK/RPC response shapes require this approved test; build and mocked tests do not establish them. User-supplied hosted configuration is treated as confirmed input, not independently changed or audited in this task.
