# Phase 3 — sports-app visual redesign

Implemented locally. No hosted reads/writes, migrations, import changes, player links, dependencies or deployment. Approved in-frame scoring components and all scoring/recovery services remain unchanged.

## Experience

- Home is now compact: account display name, Start playing/Resume match, latest official group result and a forest-green night-win head-to-head panel. Group context is explicit. Personal stats availability is one small secondary sentence; group numbers are never attributed to the signed-in account.
- History defaults to authorized group results (`#/matches`); My history remains at `#/matches/personal`. No identity explanation blocks existing results. Two-player cards lead with bold names/scores, winner/draw, venue and readable date. Multiplayer keeps all score rows. Unfinished nights remain separate. Score-only and eligible frame-detail behavior is preserved.
- Leaderboard (`#/standings`) leads with **night wins**, then W/L/D. Frame totals/difference/rate are supporting expandable details. Head-to-head remains a count of night victories, with draws separately shown.
- Removed shared-header/sidebar/footer slogans and footer decoration. Replaced the Phase 2 editorial result styles rather than layering over them; reduced desktop sidebar width, heading size and page padding. Wordmark and cream/forest/brass palette retained. No global group selector or rule UI introduced.

## Competitive conventions

A night win always counts once; no score margin, points or weighted victory affects the night-win count. Presentation ranking is now: **night wins descending, night losses ascending, frame wins descending, frame difference descending** (unknown difference last). This puts the decisive night record before frame-based tie-breaks. Equal metric tuples share competition ranks; name/UUID stabilize display order only. No persisted result or backend calculation was changed.

Decisive-night win rate is wins / (wins + losses); draws are shown separately and a zero denominator is not rendered as 0%. PonDon: Donal **19W / 13L / 5D**, 59.4%; Sean **13W / 19L / 5D**, 40.6%. Supporting official frames remain **407–351**, rates 53.7% / 46.3%. Night W/L/D remains a two-player-night measure; multiplayer scope is disclosed.

## Changed files

- `src/features/results/ResultsViews.tsx`: compact activity Home, default group History, sports result cards and night-first Standings.
- `src/features/results/presentation.ts`: night-loss secondary ranking tie-break; authoritative result/H2H calculation unchanged.
- `src/app/App.tsx`: default History context, slogan/footer removal, simple Account title.
- `src/app/connected.css`: replaced superseded editorial result styles with compact sports layouts and responsive hierarchy.
- `src/index.css`: removed old slogan/footer shell styling.
- `scripts/frontend/results.test.mjs`: night-win precedence, loss tie-break and decisive-night percentage regressions.

## Verification

**59/59 frontend tests passed**, no skips in this workspace. TypeScript/Vite build and lint passed.

Isolated full React app in headless Chrome with mocked Auth/read services and all external network blocked:

- PonDon Home shows November 3's 16–16 and group rivalry **19–13, 5 draws**.
- All 37 historical cards remain visible by default. Supporting official totals remain 407–351. Score-only and detail eligibility helpers/views unchanged.
- Standings headline is 19 / 13 night wins, never 407 / 351; frame details remain available. Decisive-night rates verified.
- No-group/no-result, multiple groups and contextual switching, unavailable personal-history path, loading/error/partial-failure states, three-player shared-top-score cards and keyboard focus.
- Home, History and Standings checked at **360, 393, 412 and 1280px**, no horizontal overflow. Desktop two-column results/leaderboard and compact sidebar inspected.
- Screenshots visually reviewed; no owner browser storage or real hosted account accessed. Tests are not a physical-device or JWT/RLS integration audit.

## Review screenshots and routes

Mobile screenshots (outside Git, private historical fixtures):

- `/private/tmp/pule-home-phase3.png`
- `/private/tmp/pule-history-phase3.png`
- `/private/tmp/pule-standings-phase3.png`

Desktop: `/private/tmp/pule-history-phase3-desktop.png`, `/private/tmp/pule-standings-phase3-desktop.png`.

Local routes: `#/home`, `#/matches`, `#/matches/personal`, `#/standings`.

Remaining limits are unchanged: own-player identity read API unavailable, so no fabricated personal metrics; Home/H2H covers the latest available up-to-100 nights and labels its scope. Standings are full All-Time server aggregates. Existing per-night state reads are bounded to four concurrent requests. No advanced frame events are inferred from official final scores. No backend workaround added.

Stopped for visual review; not deployed.
