# React authentication and database scoring integration

4 November 2026. **Implemented locally; no hosted test accounts or scoring data created. No migration, RLS, hosted configuration, historical import or frontend deployment performed.**

## Implemented

- Checked `.env.local` presence, approved project hostname and browser-key class without printing values. The key is publishable/legacy anon, not service-role/secret. The browser client rejects privileged keys and credential-bearing URLs.
- Reused the typed Supabase client and transactional service layer. Fixed its read-table typing to support the session row interface, and added explicit permitted-column session lists and RLS-filtered group lists.
- Added email/password signup/sign-in, confirmation resend, one-time PKCE callback handling, safe URL cleanup and browser-scoped sign-out. Registration never creates/claims a player or joins a group. Confirmation defaults to the configured local root URL.
- Connected private group creation, guest/venue creation, explicit owner/admin review and adoption of validation version 1, and database-loaded roster/rules/venue/season selection.
- Match nights select 2+ players. Each new frame explicitly selects exactly two players and its actual breaker; no automatic pair or race target exists.
- Connected frame start, server-backed pause/resume, winner/fouls/break-pot/pocket/special/offender confirmation, audited winner/foul corrections and explicit night finalization. The review dialog shows saved standings before closing scoring.
- Active session routes reload authoritative state from Supabase; Home lists saved active nights. History and All-Time standings use database reads, not fictional records. Refresh failures retain the last acknowledged display rather than manufacturing empty scores.
- Preserved the existing mobile shell, felt/chalk/brass tokens, score geometry, touch controls and reusable accessible dialog. The earlier presentation-only application is retained as `src/app/PrototypeApp.tsx` for reference, but is not routed or used to score. No fictional results are shown in the connected app.

## Write/recovery behavior

Every mutation gets one operation UUID and exact typed RPC payload. An IndexedDB intent transaction must commit before any write is sent. One unresolved operation per account/project prevents a second write replacing it; competing tabs cannot overwrite the stored intent. Passwords and Auth tokens are never journaled. Supabase remains the only source of saved scores; the journal is not a local scoring app.

During a write, controls lock and pending status remains visible. No optimistic score award occurs. Network/API failures and the 20-second RPC timeout retain the original intent across refresh. DOM timeout codes are not mistaken for five-character SQLSTATE rejections. Retry reuses its UUID, payload and expected revision. Application-level automatic write retries and SDK request retries are disabled. A captured same-user Auth token binds the RPC to the original actor; a different account cannot submit the intent.

Fresh SQL validation failures/revision conflicts are kept for explicit review and may be discarded locally before a newly chosen action. Uncertain retries remain uncertain even if later denied, because an earlier commit may exist. They cannot be cleared through the UI; identical retry or authorized operator review is required. Lost acknowledgment and local cleanup failure both preserve safe receipt-retry behavior. A private JSON export is user-triggered and contains no Auth credentials.

Sign-out is blocked while a request is actively sending. If an unresolved intent remains, the account screen explains that it will remain on this device for that account and asks before signing out. Another account gets its own journal and group reads. No automatic cross-account replay occurs.

## Main files

| Files | Purpose |
| --- | --- |
| `src/app/App.tsx`, `connected.css` | Connected Auth/group shell, navigation, history/standings/account screens and visible operation recovery |
| `src/features/auth/components/AuthScreen.tsx` | Signup/sign-in/resend UI |
| `src/features/auth/services/authService.ts` | Auth initialization, PKCE exchange/cleanup, resend, scoped sign-out |
| `src/features/connected/useConnectedGame.ts` | Account-scoped reads, authoritative state, setup/scoring coordination and conflicts |
| `src/features/connected/SetupViews.tsx`, `SessionView.tsx` | Group/player/venue/rules setup, rotating pair selection, scoring, timeline/corrections and finalization |
| `src/data/local/operationCoordinator.ts`, `intentStore.ts` | Durable single-intent recovery, failure classification, identical retries, project/account partition and cross-tab serialization |
| `src/data/remote/*` | Existing typed client/services extended for safe connected UI reads and actor-bound mutations |
| `src/components/ui/Primitives.tsx` | Shared dialog accessible naming and controlled Escape behavior |
| `vite.config.ts` | Port 5173 enforced to match Auth callbacks |
| `scripts/frontend/*.test.mjs`, `package.json` | Local mocked Auth/recovery tests, no new dependencies |

## Verification and limits

- `npm run build`: TypeScript and production build passed.
- `npm run lint`: passed.
- `npm run test:frontend`: **20/20 tests passed** using mocked Auth and storage/transport; no live Supabase requests.
- `.env.local`: expected project/key presence and safe key type verified, values not printed or modified.

Tests cover one-time confirmation exchange under concurrent initialization, redirect cleanup/fallback, resend/signup redirect shape, browser-scoped sign-out, persist-before-send, storage-failure blocking, duplicate submissions, lost acknowledgment with stable UUID/payload across restore, account partitioning, conflict handling, cleanup failure and permission failures after an uncertain save. These validate implementation logic; they do not claim a real hosted Auth/API journey passed.

No browser automation, real email delivery, hosted account creation, live group/scoring mutation, real SDK/RPC response shape or hosted concurrent-user flow was tested. The deployed database’s earlier catalog checks and synthetic SQL suite remain separate evidence; they do not substitute for this integration smoke test. The user-confirmed Data API/Auth settings were not changed.

**Known limitations:** unconfirmed form inputs are not durably saved; only submitted intents and server-confirmed state recover. Full offline scoring/outbox synchronization, invitations, claiming, scorer takeover, finalized amendments and PWA caching remain absent. An unresolved request blocked by revoked permissions may require authorized operator review. History is limited to 100 recent nights. Server checks remain authoritative even if a visible role permits requesting a write.

## Launch and next step

```sh
npm run dev
```

Open **http://localhost:5173/**. If another server occupies that port, stop it rather than silently using a non-allow-listed callback origin. No hosted resource creation happens merely by viewing the signed-out screen. Existing authenticated sessions perform authorized reads on opening the app; user-triggered signup/setup/scoring actions write to the configured project.

Use [HOSTED_AUTH_SCORING_SMOKE_TEST.md](HOSTED_AUTH_SCORING_SMOKE_TEST.md) as the next approval gate. It explicitly scopes two test accounts and isolated groups before any assistant-run hosted mutation. The implementation is ready for that review and hands-on testing, not a claim of production readiness.

Auth flow implementation was checked against the [official password-auth guide](https://supabase.com/docs/guides/auth/passwords) and [PKCE guide](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
