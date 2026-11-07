# Multiplayer implementation and hosted readiness

3 November 2026. Extended the existing database foundation with **two additive migrations**; migrations 001 and 002 were not rewritten. No hosted project link, migration, configuration change, Auth write, historical import or deployment was performed. No `.env.local` values were read or printed.

## Changed files

| Files | Change |
| --- | --- |
| `supabase/migrations/202611030003_rotating_players.sql` | Positive session roster positions, 2+ distinct session players, exactly two explicitly selected frame players, updated transactional commands/state and frame-based standings |
| `supabase/migrations/202611030004_hosted_onboarding.sql` | Atomic/idempotent initial group ownership, guest/venue creation, explicitly reviewed version-1 rule adoption, private setup audit, tighter Auth-ID reads and default grants |
| `supabase/tests/scoring.sql` | Existing two-player tests call explicit-pair frame-start RPC; original intended coverage retained |
| `supabase/tests/multiplayer.sql` | Three/four-player rotations, pair/winner/breaker validation, sit-outs, fouls, ties, onboarding, privacy and access checks |
| `scripts/database/run_tests.py` | Applies all four migrations, runs multiplayer assertions, tests concurrency within a three-player session, supports original-foundation upgrade testing |
| `src/data/remote/database.types.ts` | 2+ roster tuple, exact frame-pair tuple, per-player win/loss/appearance/rank state, expanded historical-compatible standings, setup RPC contracts |
| `src/data/remote/scoringService.ts`, `setupService.ts` | Explicit-pair start wrapper and typed setup/membership services; current prototype remains disconnected |
| `src/features/auth/services/authService.ts` | Registration service creates Auth identity only; does not claim players or join groups |
| `supabase/verification/hosted_readiness.sql` | Read-only operator inspection of schemas, RLS, function ownership/grants and empty application history after schema deployment |
| `docs/HOSTED_SUPABASE_DEPLOYMENT.md` | Reviewed CLI installation, local rehearsal, target confirmation, link/preview/apply and hosted API/Auth setup procedure with explicit approval stop |
| `docs/DATABASE_DESIGN.md`, `DATABASE_FOUNDATION_REPORT.md` | Current multiplayer requirements supersede earlier two-player-only scope; original design/history retained |

No packages were installed in this task. Existing React screen components were not changed. Existing CLI configuration still exposes only `app` locally and has no historical seed.

## Implemented multiplayer behavior

A night starts with two or more distinct, group-available players. Its ordered roster is independent of frame side. Before each frame, the caller supplies exactly two distinct roster IDs in side-1/side-2 order and chooses the actual breaker from that pair. There is no next-pair algorithm and no fallback to the first two roster players. The old four-argument frame-start signature is removed to prevent accidental implicit pair selection.

Each frame stores those two participants, winner, breaker and separate foul counts. `p_p1_fouls`/`p_p2_fouls` refer to that frame's selected side order, never the full session roster order. Completing or correcting a frame cannot award a sitting-out player. Corrections retain the actual original frame pair and audit trail. One active frame per session, operation receipts, session locks, expected revisions and atomic completion remain intact.

The saved state retains the existing `scores` map for **every** roster player and adds `standings`: frames won, frames lost, frames played and shared rank by wins. Only completed frames actually involving a player contribute losses/appearances. Sitting out contributes neither win nor loss. Zero-appearance roster members remain visible at zero. Equal win counts share a rank; neither UUID order nor losses manufactures a tie-break winner. Unknown imported win counts have no rank.

Group standings retain `nights` as roster-participation nights, not proof a player played a frame. `wins/losses/draws` are explicitly **two-player night outcomes only**; `two_player_nights` and `multiplayer_nights` expose their populations. Multiplayer competition uses frame wins/losses/appearances; no overall night winner is invented, even when two players tie above others. This is a conservative multiplayer outcome definition, not a new rating or inferred skill measure.

For approved two-player historical results, frame wins and frame losses use authoritative own/opponent reported scores once, regardless of canonical frame coverage. There are no fabricated frame records. Imported multiplayer result-only losses/appearances stay unknown if not recoverable, with `unknown_loss_nights` disclosed. All historical result authority, source IDs, private noncanonical evidence and null-metadata behavior remain unchanged.

The roster is selected at session creation; rotation is free among that roster. Adding a late participant to an already-started roster is not implemented by this task.

## Security/dependency review and fixes

- **Initial onboarding gap closed:** authenticated callers can atomically create a group and its sole owner membership. Setup retries use the existing private operation receipts. They can create unclaimed guests/venues within an authorized group; no automatic identity ownership or cross-group linking occurs.
- **Rule configuration made explicit:** only an admin/owner can adopt the fixed native validation version 1, and must confirm review. Labels are nonblank/bounded and referenced rules remain immutable. No unverified automatic breaker rule or race target is introduced. This version's event/foul semantics still require owner review before real play.
- **Private Auth-ID reads tightened:** raw membership table reads are revoked; `get_my_memberships` returns only the caller's group IDs and roles. Raw `scorer_user_id` reads are excluded from permitted session columns. State RPCs already omit the recorder's Auth UUID.
- **Ordinary writes remain RPC-only:** no anonymous execution, private schema grants, name-based claiming or generic browser DML added. New definer helpers have fixed search paths and revoked browser execution. New private setup events have RLS and append-only protection.
- **Integrity maintained across rotation:** session cardinality is 2+, frame cardinality stays exactly two, winner/breaker/offender reference that actual pair, and group/session containment FKs remain in force. Deferred deletion checks now also protect participant/result integrity on privileged maintenance paths.
- **Hosted exposure identified as a separate gate:** hosted Data API must expose `app` after grants are checked; local config alone does not change it. `private` and `auth` must never be added. No blanket grants from documentation examples are needed.

## Tests actually run

Local SQL execution uses isolated disposable databases on **PostgreSQL 14.8**, with synthetic users and a minimal Supabase Auth stand-in. It does not validate the hosted project's runtime, JWT gateway or Auth email flows.

| Verification | Result |
| --- | --- |
| All four migrations applied to fresh isolated database | Passed |
| SQL assertions, including original two-player/history/security cases | **89 passed** |
| Separate-connection competing completions in a three-player night | Passed: exactly one commit, one conflict and one awarded frame |
| Same-operation concurrent retries in a three-player night | Passed: same saved response, one event |
| Original foundation seeded before additive upgrade, then same full suite | Passed: **89 assertions and both concurrency cases** |
| Historical validator | **36/36 passed**; full reported baseline unchanged |
| Historical regression tests | **24/24 passed** |
| TypeScript/Vite build and ESLint | Passed |

Coverage includes two-, three- and four-player sessions; rotating pairs; exactly two distinct players per frame; non-session/cross-group player rejection; invalid winner/breaker rejection; actual-side foul assignment; sitting-out exclusion; all-player totals; full and partial shared-rank ties; correction validation; retries/concurrency; historical authoritative results without double-counting; null metadata; onboarding role boundaries; private Auth IDs; RLS and explicit grants.

Reproduce locally with the temporary cluster instructions in the foundation report:

```sh
npm run test:db
python3 -B scripts/database/run_tests.py --upgrade-foundation
npm run test:legacy
python3 -B scripts/legacy/validate_history.py
npm run build
npm run lint
```

The runner creates and drops a uniquely named local database. It never accepts a hosted URL. The upgrade variant seeds only synthetic original-foundation evidence before applying migrations 003/004. The initial 001/002 source files remain unchanged.

## Hosted procedure and remaining gates

[HOSTED_SUPABASE_DEPLOYMENT.md](HOSTED_SUPABASE_DEPLOYMENT.md) contains exact commands and post-deployment checks. Neither Docker nor the Supabase CLI is available here; installation steps are supplied, not executed. The chosen CLI version must be pinned and verified. No nonsecret project reference was supplied, so commands use a clearly marked placeholder; the display name alone is insufficient to identify the target safely.

Full local Supabase stack, PostgREST/JWT/SDK smoke tests and hosted runtime verification remain **not run**. Native SQL migration/security behavior is tested; hosted compatibility is reviewed, not yet proven. Do not connect production scoring UI on that basis alone.

Remaining onboarding/release risks: member invitations/role administration and owner transfer; Auth account removal/retention; identity-claim verification; public onboarding quotas/rate limits; scorer handover; historical/finalized amendments; offline draft recovery; backup/restore rehearsal. Initial owner setup now works, but sharing a group with additional authenticated scorers still needs the reviewed membership workflow. Signing up does not confer membership in another group or ownership of any sporting identity.

Ready for owner review of the four-migration payload and local Supabase rehearsal. **Stop for explicit hosted-write approval before applying anything to Pule_2.0 or changing its API/Auth configuration.** Historical import and frontend deployment remain separate approvals.
