# Phase 5 — automatic matchups

Implemented and verified locally, completed 5 November 2026. **Proposed migration not applied to hosted Supabase. No hosted requests/writes, reimport, real account links, new dependencies or deployment.** Original application, source workbook and owner browser storage untouched.

## Architecture

Reuse groups as hidden authorization/data containers. A new private registry maps an immutable sorted, distinct player-UUID set to one container. A FK-backed membership table validates the registered set. Display names and player order never define identity. Existing unregistered/mixed-history containers remain accessible without being incorrectly declared exact matchups.

The proposed authenticated `app.resolve_matchup(p_operation, p_players, p_timezone)` validates current scorer-level access to every selected player profile, locks the canonical set and relies on an exact unique constraint. Existing contexts require their own active membership and scoring permission. New contexts receive existing player UUIDs, creator-only owner membership and the existing automatic standard-scoring default, all atomically. No other participant account is automatically enrolled; no account ownership is inferred.

`app.get_my_matchups()` returns only actively authorized registered contexts and the caller’s existing verified player UUID, or null. It does not expose other Auth IDs or the private account-link table. No account-claiming/linking workflow was added.

## Experience

- Play chooses players across existing profiles the caller is authorized to score for. + Add player is inline and uses the existing journalled guest command. Same-name people remain distinct UUIDs; a warning explains that adding creates another person.
- A new combination uses Continue to resolve its container, then venue/opening-breaker selection and Start playing. Resolution never starts a night. An already selected registered combination goes straight to venue/breaker/start. Registered multiplayer lineups restore as a complete set after refresh.
- First-time Play uses an explicit + Add players action to create a private internal workspace through the existing create_group RPC, without asking for a name. Nothing is created on mount. This workspace holds newly added guest identities until their exact playing combinations resolve.
- Existing matchups suggest their most recent loaded venue. A new matchup has no invented venue/history; add a venue using the existing secondary action. No permanent group venue is assigned and venue names are not identity keys.
- Legacy container names, including the old historical name, are never rendered. Named Group creation/settings, Account switching/creation controls and obsolete management CSS are removed. Old management bookmarks lead to Play. Authentication copy no longer asks users to manage Groups.
- Navigation says Stats. My stats, Rivalries and Leaderboards retain night-win-first ranking and official reported authority. Verified personal views use only the returned UUID and currently authorized saved history; unverified users still see useful match results without a false personal attribution.
- History supports exact participant-set filtering within the existing bounded reader. Saved matches selection outside automatic Play uses participant labels, not legacy container names.
- Before migration availability, a read-only missing-function capability check keeps the existing authorized-context fallback. No nonexistent write RPC is attempted. Full automatic resolution requires separate migration approval/application.

## Historical preservation

The migration binds the reviewed set to existing container `383bd6df-9050-4d1c-b48f-d2a0f3349517` when it exists:

- Donal: `acc51043-01a0-507d-8fdd-ae0729e9fe68`.
- Sean: `5c575a65-aa80-590a-843a-0dfc7d5c1d89`.

It verifies active status, original identity origins, active profiles and every saved night’s complete participant set; contradictions abort the transaction. Only private registry rows are added. No session, result, frame, venue, membership or historical rule is rewritten. If the historical container is absent in a fresh disposable database, it is not fabricated.

The reviewed browser fixture still shows **37 nights, Donal 19W/13L/5D, Sean 13W/19L/5D and official frames 407–351**. No raw-frame addition, score-only frame invention or historical import occurs. These are fixture results, not a fresh hosted audit.

## Proposed migration and authorization

`supabase/migrations/202611040003_automatic_matchups.sql`

SHA-256: `9e3e30bd99154b4bccde19f4218280eecf2c6b4fe43d659703bf219ebf9e2a5f`.

Adds two private tables, canonical-set/integrity helpers, a deferred exact-participant check for new native nights in registered containers, and the two authenticated RPCs above. Existing rotating two-player frame validation remains unchanged. Standard rules initialize through migration 202611040002’s existing trigger; missing standard configuration fails closed. No extra native preset or imported-rule relabeling.

Private tables retain RLS and no client grants; helpers have no client execution. RPCs are SECURITY DEFINER with fixed empty search paths, qualified relations and authenticated-only execution. Anonymous discovery/creation is denied. Selecting matching identities cannot add a caller to a private existing matchup. Concurrent different-account creators produce one container; the account without membership is denied rather than enrolled.

The new setup command uses the existing operation journal, actor/UUID request cache and setup events. Existing receipt lookup/comparison/reconciliation is extended for that command only. Full original payload matching and a current authorized registered-set read precede cleanup. No automatic retries, replacement IDs, discard bypass or second recovery system. Existing saved operations and coordinator machinery remain intact.

## Changed files

Frontend/services:

- `src/app/App.tsx`, `src/app/connected.css`.
- `src/features/auth/components/AuthScreen.tsx`.
- `src/features/connected/SetupViews.tsx`, `useConnectedGame.ts`, `recoveryPresentation.ts`.
- New `src/features/connected/MatchContext.tsx`, `matchupPresentation.ts`.
- `src/features/results/ResultsViews.tsx`.
- `src/data/remote/database.types.ts`, `scoringService.ts`, `setupService.ts`, `receiptService.ts`.
- `src/data/local/receiptRecovery.ts` (command evidence extension only).

SQL/tests:

- Proposed migration above.
- New `supabase/tests/matchup_binding_fixture.sql`, `automatic_matchups.sql`.
- `scripts/database/run_tests.py`; existing `supabase/tests/fixtures.sql` scopes its synthetic roster insert to its own fixture groups.
- New `scripts/frontend/matchupPresentation.test.mjs`; resolver receipt regression in `operations.test.mjs`.
- This report. Existing Vite configuration was left unchanged.

## Verification

- **64/64 frontend tests passed**, no skips; TypeScript/Vite build and lint passed.
- Disposable PostgreSQL **14.8**: **140 SQL assertions and four separate-connection concurrency cases passed**, both fresh and upgrade-with-existing-synthetic-history runs. Existing actual READ ONLY receipt test passed.
- SQL verifies historical-contract binding/reversed order, distinct opponents/multiplayer, repeated operation and combination reuse, duplicate UUID/name handling, creator-only membership, unknown/cross-context/viewer/anonymous/revoked denial, own verified identity visibility, rollback, receipt support, and a registered night’s real start/frame completion/finalization. Preexisting frame rows and reported totals remain unchanged.
- Concurrency covers existing scoring revision conflicts, same-operation scoring replay, different-operation same-set creation, and two-account same-set creation. One created matchup in both creation cases; the second account is denied access rather than gaining membership.
- Full React app with isolated mocked Auth/services and all external requests blocked: reversed historical pair reuses its context, a new opponent resolves once before venue/start, three-player resolution remains distinct, registered multiplayer restores after refresh, verified personal History/Stats scopes correctly, and no automatic mutation occurs on mount.
- Fallback browser suite also covers absent RPC/no/single/multiple authorized contexts, 37-night official totals, exact pair/multiplayer history filters, inline player creation, name warnings, Account/name removal, keyboard, reduced motion and mobile navigation. Layouts checked at **360/393/412/1280px** without horizontal overflow.
- Existing installed local PostgreSQL cluster was temporarily started; runner-created disposable databases were dropped. No Docker, dependency installation or backup system. Browser harnesses reuse the existing external Playwright installation and ephemeral contexts.

## Review and remaining limits

Screenshots outside Git: `/private/tmp/pule-play-phase5-auto.png`, `pule-home-phase5.png`, `pule-history-phase5.png`, `pule-standings-phase5.png`. Routes: `#/home`, `#/play`, `#/matches`, `#/stats`. Screenshots use private reviewed fixtures, not a real owner session.

No PostgreSQL 17, real JWT/PostgREST or physical-phone execution is claimed. History/H2H and personal history retain latest-100-night coverage and bounded state reads; Stats aggregates the selected authorized context, not a claimed complete cross-matchup career. Personal ranking retains its context’s real rank. The existing table API’s roster limits still apply.

Verified identity is not required for an authorized scorer to select guest records. It is required for personal attribution; ownership alone never grants private-matchup membership. A linked user without appropriate membership still cannot inspect or join that history. Sharing/invitation and account linking remain separate work. Existing broad/mixed-history groups are not automatically rewritten into several new containers; only the explicitly reviewed historical rivalry is bound in this migration.

Before hosted use: separately approve the exact migration, recheck linked project/pending migration scope and historical binding assumptions, then apply only the approved migration. Verify deployed grants/definition and authorized API behavior read-only. No rule adoption, Auth links, historical reimport or frontend deployment is included in that approval. Stopped for review; no hosted change performed.
