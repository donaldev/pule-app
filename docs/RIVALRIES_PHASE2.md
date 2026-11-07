# Stats Phase 2 — personal Rivalries

Local frontend implementation only. No hosted access, new migration, sporting-data mutation or deployment. Scoring, notifications, recovery, match removal and Leaderboard behavior unchanged.

## Experience

Stats → Rivalries now compares the signed-in sporting player with individual opponents across all eligible accessible completed nights. Discovery uses immutable UUIDs and the existing caller-only personal-history summary read. Default: most completed shared two-player nights, with UUID order only for deterministic ties. One opponent renders directly; multiple opponents get a compact selector. Identical names remain separate selectable people.

Night wins lead the felt score card: caller wins versus opponent wins (= caller losses), draws, total shared nights and a draws-excluded night win percentage. Official frame wins/losses are secondary. Recent results show W/L/D from the caller's perspective, date and caller-first official score, newest first. Progression reuses the My Stats native SVG with both player names and cumulative night victories. No new chart dependency.

Only exact two-player participant sets count. A three-person night containing both players contributes nothing to their pair record. No frame-event analytics are inferred. Duplicate session IDs count once; conflicting same-ID content fails closed. Missing final scores yield unknown rates/frame totals rather than invented zeroes.

## Ordering

Source date-only results retain calendar-day precision. Nights sharing a date without distinct instants are grouped into a single cumulative chart point after that day; total night count still includes every real night. Recent results use newest date first, without claiming an exact same-day chronology. If the ten-night cutoff splits an unordered day, the whole boundary day is retained and the section says Recent nights. Unknown dates withhold chronological form/chart; totals remain usable.

The reviewed local historical fixture retains **37 nights, 19 wins / 13 losses / 5 draws, official frames 407–351**. Its two October 17 nights share date-only precision, so their chart point is grouped. This is a local fixture regression, not a new hosted audit.

## Read dependency

Reuses `app.get_my_performance()` from the existing Phase 1 proposal `202611050004_personal_performance.sql`. No additional migration or RPC change is needed. If that read migration is not available, Rivalries shows a brief unavailable state; it does not substitute the selected group's 100-night history or another person's identity. Phase 1 API uses current account linking, active access, approved finalized sessions and existing authoritative score helpers. Unfinished, abandoned and physically deleted sessions are absent from this read.

## Files

- `src/features/stats/RivalriesView.tsx`: opponent selection, personal pair dashboard, recent form and chart.
- `src/features/stats/rivalry.ts`: UUID discovery, deduplication, pair aggregates and date-safe progression.
- `src/features/stats/NightTrend.tsx`: extracted existing lightweight chart, labels support both players. My Stats uses the same default appearance.
- `src/features/results/ResultsViews.tsx`: new Rivalries tab target; removes superseded arbitrary-pair/selected-context view.
- `src/features/stats/MyStatsView.tsx`: shared-chart import only.
- `src/app/connected.css`: Rivalries-scoped responsive score/selector styles.
- `scripts/frontend/rivalry.test.mjs`: focused unit and private-fixture regressions.

## Verification

- **21 focused frontend tests passed**, no skips: single/multiple opponents, default choice, identical names, pair/multiplayer/unrelated exclusion, official score-only W/L/D, frame authority, recent ordering, draws/progression, duplicate/conflicting records, empty/unknown data, calendar-day ties and historical baseline. Includes existing performance/result regressions.
- **14 existing focused SQL assertions passed** in a disposable PostgreSQL 14.8 database for the reused personal-history API: native/imported authority, deleted/unfinished/abandoned exclusion, multiple opponents/contexts, multiplayer and access restrictions.
- ESLint and production build passed.
- No hosted reads/writes, physical-device test or browser automation. Existing local test server was stopped and runner-created database dropped. Mobile layout uses fluid columns, wrapping names and the shared SVG; 360–412px visual review remains.

No migration application or deployment. Backend dependency above requires separate approval if not already deployed.
