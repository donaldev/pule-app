# My Stats interactive dashboard — 6 November 2026

Implemented locally without hosted access, sporting-data writes, new dependencies or deployment. Existing queries, permissions, `performance()`, `ratio()`, `frameAnalytics()`, Rivalries source, SVG table geometry, scoring and persistence are unchanged.

## Dashboard organisation

1. Green overview: original W/L/D, nights played, win rate excluding draws and header About disclosure.
2. Performance over time: new lazy Recharts cumulative recorded night-win-rate timeline.
3. Existing winning streaks and six personal record tiles, with their original values/context.
4. Break performance: original three bars, rates/counts, Golden Breaks, Break & Runs and definitions.
5. Frame performance: original frame totals/rate/averages, followed by recorded timing and fouls with the unverified-time qualifier retained.
6. Separate win-type distribution and black-ball pocket sections. The original SVG, percentages, pocket mapping, decorative ball and 44px circular buttons remain intact. Selected-pocket detail contrast is strengthened.
7. Existing interactive recent-night strip. Original cumulative wins/losses progress remains available in an expandable section rather than being removed.

Spacing uses scoped My Stats CSS; global styles are unchanged. No metric was removed to shorten the dashboard. Frame totals remain usable when detailed observations are absent or the frame-summary read fails.

## Performance history semantics

`personalHistoryData()` attaches original dated two-player source nights to the existing `performance().series` calendar-day points. It applies the unchanged `ratio(wins, losses)` to those supplied cumulative counts. It does not recalculate night outcomes, frame scores or streaks.

Draws remain selectable dated observations but change neither numerator nor denominator. Before the first recorded win/loss, the rate remains null/“—”, never an invented zero. Same-day nights use a single existing day-end point; choosing a source night does not create an intermediate cumulative value. Unknown intra-day order is stated where relevant.

Unavailable scores are not treated as losses or zero scores: their missing result is shown, and the rate uses known wins/losses with an explicit unavailable-result count. Undated nights remain in existing totals and records but are omitted from the chronological plot with a concise note. Multiplayer results remain in existing personal totals/recent results; the rate timeline follows the existing head-to-head night-record definition.

Recent/All changes visible date groups without resetting cumulative counts. Tap selection, previous/next, chart left/right keys, date selection, same-day night selection and expandable text history provide persistent inspection. The plot is fixed at 220px with a 0–100% axis, selected marker and no animation. Vertical touch scrolling is preserved. No zero-valued fake match/timestamp is added before the first observation.

The chart module and CSS load dynamically within already-lazy My Stats. Slow loading shows a 220px placeholder. A failed chart chunk exposes cumulative date/rate/count text while all existing statistics remain visible. The existing cumulative wins/losses SVG is also still available.

## Verification

- **44 focused tests passed:** six new personal-history tests plus personal-performance, frame analytics, rivalry and rivalry-progression regressions. Includes historical score-only W/L/D, draws, unknown results, undated/multiplayer exclusion from this timeline, duplicate rejection, same-day groups, one-night/empty states, inspection, ranges and text alternatives.
- Captured the pre-change displayed metrics, rates, denominators and pocket values from an isolated populated fixture, then compared after reorganisation: every captured value remained identical at 320/375/390/430px. This covers the original overview/frame/streak/record/break/style/win-type/pocket values in that fixture, not a live account audit.
- Isolated Chrome with external requests blocked: all four widths; tap/keyboard/date/range selection; grouped draw inspection against existing calculations; historical score-only data; missing-score qualifiers; one observation, draw-only and empty history; circular 44px pocket targets and original 2:1 geometry; pocket and About keyboard interactions; no horizontal overflow.
- A vertical CDP touch swipe across the actual Recharts plot scrolls the page. The expanded legacy progress view is reachable above fixed bottom navigation at page end; existing safe-area shell spacing is preserved.
- Delayed chart-module loading and failed-module text fallback exercised.
- ESLint and fresh TypeScript/Vite production build passed. Existing raw-main-chunk size advisory remains.

Physical Pixel CPU, network timings, native screen-reader/keyboard behavior and real-account data remain untested. No service worker or offline cache was introduced; the first chart visit needs its lazy assets or uses the text fallback on failure.

## Fresh production-build comparison

Identical local Python gzip measurement method before/after, summing emitted assets individually. These are artifact sizes, not measured network transfer or CPU cost.

| Measurement | Before | After |
| --- | ---: | ---: |
| All JS + CSS gzip bytes | 288,499 | 294,370 |
| Initial scoring entry/static-import JS gzip bytes | 144,640 | 144,633 |
| Additional total gzip bytes | — | 5,871 |
| New personal-history module gzip bytes | — | 2,521 |
| New personal-history CSS gzip bytes | — | 718 |

Global CSS remains byte-identical. Recharts moved into a shared lazy LineChart asset (94,764 gzip bytes), reused by My Stats and Rivalries; it is not duplicated in the initial scoring graph. My Stats now downloads that shared chart asset on first use unless already cached from Rivalries. Therefore the ~5.9kB total application increase is not the full first-visit My Stats chart download. Individual chunk filenames/layout changed, with essentially unchanged initial JS.

## Files changed

- `src/features/stats/MyStatsView.tsx`
- `src/features/stats/FrameAnalyticsSections.tsx`
- New `src/features/stats/MyStatsView.css`
- New `src/features/stats/PersonalHistoryChart.tsx`
- New `src/features/stats/PersonalHistoryChart.css`
- New `src/features/stats/personalHistoryData.ts`
- `scripts/frontend/performance.test.mjs`
- `scripts/frontend/frameAnalytics.test.mjs`
- New `scripts/frontend/personalHistory.test.mjs`
- This report.

```sh
node --test scripts/frontend/personalHistory.test.mjs scripts/frontend/performance.test.mjs scripts/frontend/frameAnalytics.test.mjs scripts/frontend/rivalry.test.mjs scripts/frontend/rivalryProgression.test.mjs
npm run lint
npm run build
```
