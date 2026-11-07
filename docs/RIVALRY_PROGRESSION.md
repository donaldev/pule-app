# Interactive Rivalry Progression — local checkpoint

Implemented locally without hosted requests, data writes, query changes or deployment. My Stats SVG trends, pool-table maps, icons and scoring animations remain unchanged.

## Opponent-field visibility follow-up — 6 November 2026

The missing control was caused by the `opponents.length > 1` rendering rule, which hid the whole field for one discovered opponent. Rivalries now always names the selected rival above Head to Head: a “Playing against” dropdown for multiple opponents, or a non-interactive name field without a chevron for one. Zero opponents retains the existing empty state. Selection retention, fallback and chart remount behavior are unchanged.

Discovery review found no omission in the supplied-record path: the uncapped caller-authorized performance API returns approved finalized accessible nights; `rivalryOpponents()` collects every distinct other player UUID from exact two-player records, without name hardcoding. Duplicate night IDs do not inflate opponent counts; multiplayer-only participants, roster-only guests, unfinished/unapproved/inaccessible records and nights not involving the caller are intentionally outside this list. Live account history was not queried in this task, so completeness of a particular account's hosted records is not claimed. No data query or permission changes were made.

27 focused tests, lint and build pass. Mocked Chrome exercised zero/one/two/three eligible opponents at 320/375/390/430px, read-only single-rival display, all dropdown options, distinct pair night/frame metrics, chart dates and text isolation, with no horizontal overflow. Physical-device verification remains outstanding.

Changed: `RivalriesView.tsx`, `RivalriesView.css`, `rivalryProgression.test.mjs`, this report.

## Multi-opponent and chart refinement — 6 November 2026

The existing caller-authorized personal-performance read already discovers multiple opponents and exact two-player results. No queries, access rules, calculations or historical grouping changed. The top opponent selector now has explicit accessible naming and compact styling. Each selected pair is passed consistently to summary calculations and the chart. A module-local UUID-to-UUID preference map retains explicit opponent choices across view remounts during this loaded app session; it stores no records, uses no browser persistence and is isolated by the current player's UUID. Removed/inaccessible opponents fall back to an available option. One-opponent views still avoid an unnecessary selector.

Changing player/opponent remounts the chart and its failure boundary, resetting selected date, same-day match and range. It does not reset the chosen opponent. Both progression lines are continuous and routine dots are removed. Selected points remain brass-filled and ivory-outlined; equal values use an outer ivory ring and smaller brass centre. Lead/tie text concerns cumulative night wins at the selected date. Recent/All now uses one segmented control, with compact inspection/detail spacing. Text and SVG/module-loading fallbacks remain unchanged.

Verification: 27 focused frontend tests, lint and production build pass. Isolated Chrome at 320/375/390/430px exercised repeated selection of opponents with distinct records, exact pair metrics and chart/text isolation, one-night rivals, date reset on switching, grouped same-day draw inspection, Recent/All, keyboard-accessible SVG inspection, 44px controls, concentric tie markers and no overflow. The selected opponent survived actual component unmount/remount; empty state and a vertical touch swipe across the chart also passed. All browser records were mocked and external requests blocked. Physical Pixel performance and real-account verification remain untested.

Fresh production-build comparison with the preceding checkpoint: total JS/CSS gzip 287,873 → 288,405 bytes (**+532 bytes**). Initial HTML entry/preload JavaScript 144,639 → 144,637 bytes; filenames changed but initial download is effectively unchanged. Global CSS is byte-identical, and new opponent CSS stays in a lazy Rivalries asset. No new dependency or Vite configuration change. The existing raw-main-chunk size advisory remains.

Files changed for this phase: `src/features/stats/RivalriesView.tsx`, new `src/features/stats/RivalriesView.css`, `src/features/stats/RivalryProgression.tsx`, `src/features/stats/RivalryProgression.css`, `scripts/frontend/rivalryProgression.test.mjs`, and this report. No hosted operations or deployment performed.

## Original first-visualisation checkpoint

## Feature

Rivalries dynamically loads `RivalryProgression.tsx` and its scoped CSS. Recharts displays the existing cumulative wins for each player using solid brass/filled dots and dashed ivory/open dots. Zero is explicit; an initial Start point is a labelled zero baseline, not an invented match. Recent range retains the earlier cumulative baseline, rather than resetting totals.

Tap anywhere in the plot to inspect the nearest recorded point. Native date selection and previous/next buttons provide keyboard/touch alternatives; chart left/right keys also update selection. The persistent panel shows saved date, both names and score, result and cumulative wins. When the existing calculation groups several unordered same-day nights, the chart retains one date-end point and lets the user select each source match below it. It never invents intermediate wins for that day. Recent preserves whole grouped points. Unknown chronology/scores retain the existing unavailable behavior.

The existing `rivalryRecord()` is unchanged. `progressionData.ts` attaches original nights to its cumulative points using the same source ordering and exact two-player scope; it does not calculate new results. Draws leave both win lines unchanged. No frame-level history is fabricated.

The plot is 240 CSS pixels tall. All chart animation is disabled, including under reduced motion. Vertical touch scrolling is retained. Expandable text progression and native inspection controls provide a chart-independent alternative. A delayed module shows a fixed-height loading state. Failed chart loading falls back to the existing SVG summary; other rivalry results remain available.

## Dependencies

Pinned `recharts@3.10.1` and `react-is@19.3.1`, matching installed React/React DOM 19.3.1. `npm ls` confirms one deduplicated React and matching react-is. No other proposed UI library installed. Recharts adds its required transitive dependencies.

Installation reported 10 moderate development-tool advisories. `npm audit --omit=dev` reports zero runtime vulnerabilities. No unrelated dependency fixes were attempted.

## Measured production bundles

Fresh production builds before and after installation/integration; gzip sizes measured with the same local Python gzip method, summing each emitted asset separately. These are build-artifact measurements, not production transfer or Pixel CPU measurements.

| Measurement | Before | After |
| --- | ---: | ---: |
| All JS + CSS, gzip bytes | 181,920 | 287,873 |
| Initial HTML entry/preload JS, gzip bytes | 144,642 | 144,639 |
| Additional total gzip bytes | — | 105,953 |
| Lazy chart JS gzip bytes | — | 104,988 |
| Lazy chart CSS gzip bytes | — | 585 |

Initial global CSS is byte-identical. Vite repacked main/shared modules: the former main + scoringService chunks became main + jsx-runtime chunks. Their combined initial compressed JS decreased by 3 bytes; individual filenames and chunk boundaries did change. Static import-graph inspection places Recharts implementation only in the dynamic chart module, outside the live-scoring entry graph. No build configuration was changed to force these results.

Vite now warns about the repacked ~505 kB raw main chunk. Its old main + preloaded shared JS total was ~513 kB raw; this is not an added 505 kB download. First-use chart download remains ~105 kB gzip extra and should be measured on a physical Pixel before further chart expansion.

## Verification

- 25 focused tests pass: existing rivalry and personal-performance regressions plus seven progression tests covering empty/one-night history, official score-only W/L/D, same-day groups, verified same-day ordering, exact pair scope, duplicate exclusion, selection, ranges, fixed plot height, animation disabled and text alternative.
- Isolated Chrome with synthetic records and external requests blocked: 320/375/390/430px, no horizontal overflow, 44px controls, touch point selection, native date/match selection, asserted keyboard selection, persistent result/cumulative detail, same-day draw inspection, Recent/All, text alternative, one-night/empty states and reduced-motion rendering.
- CDP vertical touch swipe across the actual chart scrolls the page normally.
- Delayed module shows a 240px loader then renders. Aborted module invokes the SVG fallback while rivalry results remain visible.
- ESLint and TypeScript/Vite production build pass.

No physical-device CPU, cold-network timing, real account/browser or offline-first navigation was verified. No service worker was added; a never-loaded chart chunk needs network access, with the existing summary fallback on failure.

## Files

Updated `package.json`, `package-lock.json`, `src/features/stats/RivalriesView.tsx`.
Added `src/features/stats/RivalryProgression.tsx`, `RivalryProgression.css`, `progressionData.ts`, `scripts/frontend/rivalryProgression.test.mjs`, and this report.

Reproduce focused checks:

```sh
node --test scripts/frontend/rivalryProgression.test.mjs scripts/frontend/rivalry.test.mjs scripts/frontend/performance.test.mjs
npm run lint
npm run build
```
