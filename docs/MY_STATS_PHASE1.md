# My Stats — Phase 1

Local implementation only. No hosted access, migration application, identity changes, real match writes or deployment. Rivalries, Leaderboards, scoring and match removal behavior are unchanged.

## Dashboard

My Stats shows complete personal totals from the existing authenticated sporting identity, across eligible contexts with active access: completed nights, night W/L/D, decisive-night win percentage (wins / wins + losses, draws excluded), frame wins/losses/rate and average frame wins/losses per completed night. Unknown losses/rates and zero denominators show —.

New sections: current/longest head-to-head night winning streak; the last 10 completed nights newest-first, with most recent marked, opponents, date and saved scores; native SVG cumulative head-to-head night wins/losses. No chart dependency or manually maintained counter.

A draw or loss ends a streak. Multiplayer nights contribute to nights and authoritative frame totals and appear as M/Multiplayer in form; they do not extend or break a head-to-head streak or count as a two-player W/L/D. Head-to-head chart plateaus on draws. These scope conventions are stated briefly in the dashboard.

Date-only history retains its original calendar day. If missing dates or same-day date-only results cannot establish an order, form/streaks/progress are withheld instead of inventing chronology. Exact native timestamps distinguish same-day native nights. Fewer than two head-to-head results show a chart empty state. No missing historical frame events are inferred.

## Narrow pending read migration

`supabase/migrations/202611050004_personal_performance.sql`

SHA-256: `723346a635dcdbf5dcfff0f96e743cfdff7b0feea6abcccce2834bede115a602`

Adds only `app.get_my_performance()`, a stable authenticated SECURITY DEFINER read with fixed empty search path and qualified relations. No user/player/group argument. Reuses `get_my_player_stats`, `private.session_standings`, current private account link and accepted-batch membership visibility. Returns the existing totals plus compact dated participant/result summaries, no frame logs, private contacts or Auth identifiers. Uses only approved finalized sessions and each unique session once. No changes to existing function bodies, tables, RLS or scoring rules. Anonymous/PUBLIC execution revoked; authenticated execution only.

This migration is needed because the existing personal read returns aggregate totals without dated result summaries; existing History reads are context-specific and limited to 100 nights. Until separately approved/applied, a read-only missing-function fallback shows complete core totals and rates/averages, with unavailable streak/form/progress states. It does not compute career trends from a partial history page. No hosted migration is authorized by this document.

The summary array contains all eligible completed personal nights, so its response size grows with history. This is a compact initial read contract, not a new feed/pagination infrastructure. Very large careers may later need server-computed streak/chart summaries. No real JWT/PostgREST, hosted PostgreSQL 17 or physical Pixel execution was performed.

## Files

- `src/features/stats/MyStatsView.tsx`: dedicated dashboard and accessible native SVG.
- `src/features/stats/performance.ts`: rates, averages, newest-first form and chronological streak/chart helpers.
- `src/data/remote/performanceService.ts`, `database.types.ts`: caller-only read, response validation and aggregate fallback.
- `src/features/results/ResultsViews.tsx`: My Stats lazy-load target only.
- `src/features/identity/IdentityViews.tsx`: removes superseded My Stats component/imports; Account and claim behavior unchanged.
- `src/app/connected.css`: My Stats-scoped felt/walnut cards and responsive lists/metrics.
- New migration and `supabase/tests/personal_performance.sql`, `scripts/frontend/performance.test.mjs`; focused SQL runner option.

## Verification

- **9 focused frontend tests passed**, covering saved score W/L/D, draws-excluded rates, streak reset/current/longest, last-ten newest-first ordering, multiple opponents, multiplayer exclusion from night streaks, empty/limited data, ambiguous dates, unknown losses, caller-only read, duplicate/incomplete-response rejection and missing-migration fallback.
- **14 disposable PostgreSQL 14.8 assertions passed**: score-only and disputed detailed imported authority counted once, native results, unfinished/deleted/abandoned exclusion, multiple contexts/opponents, multiplayer not counted as a pair win, unlinked/anonymous denial and inaccessible context exclusion. Synthetic fixtures only.
- ESLint and production TypeScript/Vite build passed.
- No full suites or browser automation. Mobile layout uses minmax columns, wrapping names, a fluid viewBox SVG and existing safe-area shell; visual review at 360–412px remains.

Review `#/stats/personal`. The new read migration requires separate approval; it has not been applied. No deployment.

Latest refinement: W/L/D are the leading numbers, nights/rate are secondary, recent form is newest first, and the chronological chart labels its first/last dates. Existing read migration 202611050004 remains a separate approval requirement; no new migration was added in this refinement.
