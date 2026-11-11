# Automatic player identity — local checkpoint, 10 November 2026

Local implementation only. No hosted migration, Auth configuration, production data write, push or deployment was performed. Frame Replays work is separate and unchanged.

## Behavior

Authenticated app startup checks the caller's linked sporting identity. Already-linked accounts retain their exact player UUID, names, memberships and sporting history. Confirmed unlinked Google/email accounts initialize automatically from a usable Auth display_name, full_name or name. If none exists, one “What should we call you?” field supplies the name; no separate sporting-identity setup is exposed.

The new caller-only RPC creates one player, its own minimal origin group and owner membership. It creates no matchup, session or historical result. Existing account-link uniqueness constraints remain unchanged. The existing global identity lock, actor-operation lock and Auth row locks serialize initialization against other initialization/claim operations. Identical operation retries return the original receipt; different initialization operations resolve to the same linked UUID. Profile metadata supplies display text only, never claiming authority.

This establishes the rule on authenticated app startup, not through an Auth registration trigger. Unconfirmed accounts and unresolved guest claims intentionally defer creation. Direct database/Auth-only registration without opening the app does not create a player.

## Guest protection

Verified email evidence uses the existing trusted Auth verification function. A matching guest association or unresolved recipient invitation blocks creation, including expired unresolved invitations that need a fresh authorized link. Neither email nor name grants ownership of a player. The existing Google guest-claim prompt and token invitation route remain available, along with Account/recovery and sign-out. Authorized acceptance retains the guest UUID and history. There is no merge, automatic claim, invitation acceptance or membership grant to an existing group.

The intentional limitation is that an unresolved association can require the original inviter's help. A revoked invitation with no remaining association does not itself block creation. No new identity-resolution or support workflow is introduced.

## Write recovery

Initialization uses the existing durable operation journal, actor-bound RPC authorization and receipt matching. A lost acknowledgment keeps the original operation UUID/payload. Account permits explicit read-only receipt confirmation; startup does not resend or silently discard initialization. Own-link receipt reconciliation requires the current player and origin group to match. Pending actions and unreadable recovery storage block initialization. Offline writes retain the existing blocking behavior.

## Migration and rollout

New local migration: `supabase/migrations/202611080001_automatic_player_identity.sql`.

SHA-256: `1deafc8580203f018c09baf19274ba6fd23eb5c4b7065d02524398cfb5e5ae61`.

It adds two authenticated RPCs and a private state helper, and narrowly extends the existing receipt lookup for the caller's own initialization acknowledgment. It does not backfill existing accounts, alter RLS policies, change identity uniqueness, scoring, matchup rules, History or Stats. Its receipt-function patch aborts if the expected baseline is not present exactly once.

After separate approval: review/apply this migration after the existing frame-correction migration; verify authenticated-only RPC permissions and caller isolation; then release the frontend. No hosted Auth setting change is required. The separate Frame Replays migration has its own prerequisites and approval; do not include it incidentally in this rollout.

On the real Auth/hosting stack, verify new Google/email sign-ins, a name-less account, an established linked account, an authorized guest invitation and interrupted initialization using explicitly approved disposable accounts. Local tests emulate Auth evidence, not GoTrue/JWT/PostgREST or physical PWA handoffs.

## Verification

- 72 focused frontend tests: startup gate, Google/email authentication regressions, minimal name state, confirmation/claim blocking, linked/claim-route bypass, effect cleanup/replay, actor-bound state reads, receipt identity/group/account matching, operation recovery and existing scoring operation tests.
- Focused disposable PostgreSQL 14.8 initialization suite: 31 assertions passed on both fresh and existing-foundation upgrade paths, including independent-connection concurrent requests, confirmed/unconfirmed evidence, missing/invalid names, repeat operations, payload mismatch, anonymous/private denial, existing UUID/name/membership/history preservation, unresolved/expired invitations and authorized guest acceptance.
- Existing focused guest-email suite: 31 assertions passed.
- ESLint and TypeScript/Vite production build passed. No new dependencies.

```sh
python3 -B scripts/database/run_tests.py --sql-test automatic_player_identity.sql
python3 -B scripts/database/run_tests.py --sql-test automatic_player_identity.sql --upgrade-foundation
python3 -B scripts/database/run_tests.py --sql-test guest_email.sql
node --test scripts/frontend/playerInitialization.test.mjs scripts/frontend/identityReceipts.test.mjs scripts/frontend/auth.test.mjs scripts/frontend/operations.test.mjs scripts/frontend/startupRecovery.test.mjs
npm run lint
npm run build
```

## Files

- Migration above; `supabase/tests/automatic_player_identity.sql`; Auth metadata column in the disposable `bootstrap_postgres.sql`; focused/concurrent runner support in `scripts/database/run_tests.py`.
- `src/features/identity/PlayerInitialization.tsx`, `src/data/remote/playerInitializationService.ts`, `src/app/App.tsx`.
- Existing operation plumbing: `database.types.ts`, `setupService.ts`, `receiptService.ts`, `intentValidation.ts`, `receiptRecovery.ts`, `useConnectedGame.ts`.
- Frontend tests: `playerInitialization.test.mjs`, `identityReceipts.test.mjs`, `startupRecovery.test.mjs`; this report.
