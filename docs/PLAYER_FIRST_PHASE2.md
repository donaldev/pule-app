# Phase 2 — player-first Home, History and Standings

Local frontend work only. No hosted requests/writes, migrations, imports, identity links, dependencies, recovery infrastructure or deployment. Standard scoring migration status is owner-supplied context; no new hosted check was performed.

## Experience

- Home (`#/home`, also the default entry) introduces the signed-in account using an existing account display name where present. It offers Play, personal History and comparison paths without requiring a group or waiting for group loading. It does not display a guest's numbers as personal performance.
- Five destinations: Home, Play, History, Standings, Account. Mobile targets fit 360px; existing group settings stay secondary. Multiple-group Play gets a quiet Change link to Account, not a global selector.
- Personal History (`#/matches`) has a deliberate profile-connection state. Group History (`#/matches/group`) is secondary, preserves its tab through Back/refresh, and provides readable result cards with names, official scores, venue, date and outcome. Unfinished nights are separate; multiplayer uses one score row per participant, with shared/top-score wording rather than a fabricated two-player result.
- Group Standings (`#/standings`) shows rank, night W/L/D, frame wins/losses/difference/rate, and explicitly labeled nights/frames played. An optional head-to-head view uses actual finalized approved two-player outcomes only. The group context switcher appears only when more than one authorized group is available.
- Imported score-only/disputed detail views show the official result without unsupported frame events. The existing SessionView timeline displays imported frames only if both session and frame detail eligibility allow it. Native in-frame cards, timing, metadata, confirmation, corrections and finalization were not redesigned or changed.
- Old App History/Standings presentation components were removed rather than retained as competing views. Shared result/date/ranking helpers serve the new views; no Group dashboard, rule controls or speculative claiming UI added.

## Identity limitation — deliberately enforced

`private.player_account_links` is inaccessible to browser clients, and there is no authorized own-player lookup RPC. Account display names are profile text, not sporting identity evidence. Therefore even an account whose name is Donal does not receive the imported Donal totals on Home. We cannot safely determine a verified sporting link using current APIs. No numerical personal career, recent-opponent or cross-group aggregation is shown.

Home and personal History present this as an unavailable verified connection, not proof that a database link does not exist. A linked-personal test is unsupported by the current read contract. Historical Donal/Sean UUIDs are unchanged; no duplicates, merge or links created.

Smallest future scope: independently verify and manually link existing Auth/player UUIDs through the already-designed trusted operator procedure; separately approve a narrowly authenticated read API returning only the caller's verified player identity. Existing group read APIs could then supply results only across authorized memberships, with defined coverage/deduplication and missing-value rules. Do not expose the private link table or claim by matching names. This follow-up is documented only, not implemented or migrated.

## Accuracy and ordering

- Group aggregate standings still come from existing `get_standings`; approved reported historical scores remain the authority and score-only nights contribute normally.
- Ranking: night wins descending, frame wins descending, frame difference descending; unknown difference last. Equal metric triples share competition ranks (1, 2, 2, 4). Names/UUIDs provide stable display order only, not extra ranking points. Night W/L/D remains a two-player-night measure; multiplayer rows disclose that scope.
- Frame rate is won / (won + lost). Missing losses or zero denominator show —, not fabricated zero performance.
- History requests are sorted by occurrence date descending, then creation time, with a 100-night API limit disclosed when reached. Date-only values display using UTC formatting to preserve the source day. Missing dates say Date not recorded. Same-day precise ordering is not inferred from legacy IDs.
- Existing APIs lack compact participant/score history summaries. Group History fetches saved state with at most four concurrent requests; responses are group-checked and stale-group effects canceled/ignored. Head-to-head uses the same bounded reader only when opened. Partial failures are visible with retry; incomplete H2H totals are not displayed as complete.
- H2H explicitly labels coverage as the latest available nights (maximum 100), not unlimited All-Time. Standings remain the full authoritative group aggregate. No shot, break, foul or timing statistic is inferred from score-only nights.

## Changed files

- New `src/features/results/ResultsViews.tsx`: Home, personal/group History, group Standings and shared result loading/cards.
- New `src/features/results/presentation.ts`: date formatting, rank/tie policy, rate/outcome and H2H helpers.
- `src/app/App.tsx`: player-first entry/navigation, lazy results screens, removal of old History/Standings implementations and human-readable resume dates.
- `src/app/connected.css`: scoped player/results design, five-destination mobile sizing and hidden-unfocused skip-link styling.
- `src/data/remote/scoringService.ts`: occurrence-date ordering on existing session read; no new RPC or mutation.
- `src/features/connected/useConnectedGame.ts`: contextual result-group switching without forced navigation to Play.
- `src/features/connected/SetupViews.tsx`: secondary Change link for multiple-group Play.
- `src/features/connected/SessionView.tsx`: imported timeline eligibility only; approved active-frame scoring preserved.
- New `scripts/frontend/results.test.mjs`: ranking, ties, date/rate, final-only authority, missing/multiplayer exclusion and private reviewed historical baseline.

## Verification

- Frontend **58/58 passed, no skips** in this workspace; TypeScript/Vite build and lint passed.
- Real private reviewed 37-night fixture reconciles to 19 Donal wins, 13 losses, 5 draws and frames 407–351 in H2H. No raw-frame addition. Source workbook/importer unchanged.
- Isolated full React app in headless Chrome with synthetic Auth and mocked reads; all external network blocked. Fixtures include reviewed historical identities/results; fictional multiplayer night explicitly separate.
- Home with zero/single/multiple groups; no automatic personal attribution; personal/group History; all 37 readable cards; November 3 first; score-only detail with zero frame rows; eligible 32-frame detail; three-player shared top score; ranking 407–351 and rates 53.7%/46.3%; H2H 19–13–5.
- Group change clears old rows; no cross-group fixture results shown. Loading, full-read failure and partial-state failure covered. History Back preserves Group History. Keyboard focus checked. Layouts checked at **360/393/412px**, without horizontal overflow.
- No owner-browser session or storage accessed; no hosted mutation invoked. Browser fixtures are not JWT/RLS integration tests, and no physical phone test is claimed.

## Visual review

Local routes: `#/home`, `#/matches`, `#/matches/group`, `#/standings`, existing `#/play`.

Reviewed screenshots remain outside Git: `/private/tmp/pule-home-phase2.png`, `/private/tmp/pule-history-phase2.png`, `/private/tmp/pule-standings-phase2.png`. History screenshots contain private fixture results and should not be committed. The temporary QA harness uses an already-installed external Playwright setup; no project dependency added.

Stopped for review. Main genuine limitations: missing own-identity read API, no personal cross-group aggregation, 100-night H2H/history coverage and state-per-night fetch overhead. No elaborate backend workaround was built.
