# My Stats — detailed frame analytics checkpoint

Implemented locally. No hosted access, migrations applied, scoring/identity/history mutations, new dependencies or deployment. Phase 1 night summary migration is preserved unchanged; Rivalries and Leaderboards are not redesigned.

## Visible sections

Night W/L/D retains the primary hierarchy. Added compact walnut sections:

- **My records:** most official frames won in a completed night (including score-only and multiplayer), biggest winning margin/closest victory (two-player victories only), longest verified consecutive played-frame winning run, biggest deficit recovered in a winning two-player night, and number of wins after trailing.
- **Break performance:** recorded own breaks; break-pot, hold and steal percentages with numerator/denominator; recorded Golden Breaks and Break & Runs. Hold means win on your own break; steal means win on the other player's break. Unknown breaker, pot or winner observations are excluded from the rate that needs them. Win-type counts concern the selected player's wins only.
- **Playing style:** average winning-frame time, fastest win, longest played frame, summed recorded personal fouls, own-win type counts and black-ball pocket distribution. Timing, foul, event and pocket samples are shown. Imported-unverified timing is explicitly identified; unknown durations and zero imported/unverified durations do not contribute. A genuine server-measured zero remains a recorded measurement.

Unavailable metrics are omitted rather than rendered as invented zeros. One coverage note states the eligible played-frame count. A missing new RPC leaves score-based records usable once the Phase 1 night read exists and shows one concise unavailable note instead of a placeholder Break/Style dashboard. A genuine read failure offers an inline retry without hiding existing core totals.

## Accuracy and reuse

`frameAnalytics(nights, frameNights, playerId)` is one pure calculation shared-ready for personal and exact two-player scopes. Later Rivalries can filter the nights/details and call the same function; no second engine exists.

Official saved per-night scores, not canonical-detail sums, define night records. Score-only nights contribute to those records and existing overall totals. Detailed metrics use only completed, session- and frame-detail-eligible observations from the authorized frame read. Sitting out a multiplayer frame contributes nothing to personal breaks, fouls or timings. Multiplayer is not an ordinary comeback or pair victory.

Frame runs and comebacks require reconciled, complete, gapless frame numbers with known winners and detail-win totals matching the official result for every participant. Partial/disputed/ineligible logs cannot establish a sequence. Missing-detail nights break cross-night runs; missing dates or unordered same-day dates prevent joining runs across nights, while known order within a complete night can still establish its own run. Losses reset frame runs; sitting out a known multiplayer frame does not manufacture a loss.

Duplicate night/frame IDs fail closed. Only IDs present in the supplied completed-night summaries contribute, so a separate frame response cannot introduce an unrelated night. Independent night/frame reads are snapshots and are refreshed normally; no continuously synchronized counter is maintained. Recorded metadata, including unverified historical timing, is not a claim of measurement precision.

## Pending read migration

`supabase/migrations/202611050005_frame_performance.sql` adds only:

`app.get_my_frame_summary(p_opponent uuid default null)`

The function derives the caller's player from the existing private account link. No caller-supplied own-player UUID. It requires approved finalized nights, current active membership/accepted-batch visibility and caller participation. Optional opponent scope requires exactly two session participants including that UUID, not a multiplayer roster containing the pair.

Returns night ID/date, sequence/detail quality, canonical frame count, and eligible frames ordered by frame number: pair UUIDs, winner, breaker, pot observation, personal foul counts, event, pocket, elapsed duration and duration quality. Other-pair frames in the same authorized multiplayer night support complete-sequence checks; personal calculations exclude sitting-out frames. It exposes no private import evidence, contacts, account links or unrelated nights. Unknown values stay null. Score-only/disputed nights return coverage metadata with no eligible frame observations.

Stable SECURITY DEFINER, empty fixed search path, qualified relations, authenticated execution only; PUBLIC/anon execution revoked. No tables, policies, counters or existing function bodies changed. Unfinished/abandoned/deleted sessions are excluded naturally. SQL is independently reviewable and not applied hosted.

Requires separate approval/application of existing `202611050004_personal_performance.sql` for night-level summaries and this new `005` for detailed metrics. Neither is applied by this checkpoint. No edit to `004` or historical records.

## Changed files

- `src/features/stats/frameAnalytics.ts`: typed, pure per-player calculations.
- `src/features/stats/FrameAnalyticsSections.tsx`: Records, Break Performance and Playing Style rendering/coverage.
- `src/data/remote/framePerformanceService.ts`, `database.types.ts`: read contract and fail-closed parsing, missing-migration handling.
- `src/features/stats/MyStatsView.tsx`, `src/app/connected.css`: insert scoped responsive sections without changing core night hierarchy.
- New SQL migration and `supabase/tests/frame_performance.sql`.
- `scripts/frontend/frameAnalytics.test.mjs`; focused SQL runner option.

## Verification

- **24 focused frontend tests passed**, no skips, including My Stats/Rivalries regressions. New tests cover score-only records, rate denominators, holds/steals, comebacks/runs, missing/disputed/partial/gapped observations, measured versus unknown durations, foul/pocket samples, multiplayer sitting out, duplicate rejection, read identity/pair scope and populated rendering of all three visible sections.
- **17 SQL assertions passed** in disposable PostgreSQL 14.8: completed/approved caller scope, score-only/disputed exclusion, observation fields/quality, native completed records, exact pair versus multiplayer, deleted/abandoned/unfinished exclusion, unlinked/anonymous denial and inactive access.
- ESLint and production TypeScript/Vite build passed. No full suites or browser automation. Physical Pixel layout, real JWT/PostgREST and PostgreSQL 17 execution remain untested. Uses existing responsive cards, minmax columns, wrapping labels and safe-area shell.

This is a populated local implementation, not a live My Stats completion claim. Backend approval/application and frontend deployment are still outstanding; no real account's detailed metrics were fetched or modified here.
