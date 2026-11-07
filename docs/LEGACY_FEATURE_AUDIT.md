# Pule legacy functional audit

Prepared 3 November 2026. **Read-only source audit; no implementation or redesign performed.**

## 1. Scope, evidence and confidence

Original inspected: `/Users/donalokeeffe/Documents/Life/Coding/Pule/pule_app`.
Audit output: `/Users/donalokeeffe/Documents/Life/Coding/Pule/pule-app/docs/LEGACY_FEATURE_AUDIT.md`.

The original directory is accessible. Its complete file inventory is `index.html` (2,532 lines), `manifest.json`, `sw.js`, `icon.png`, and `pool-cue.png`. HTML, inline JavaScript, manifest and worker were read; both raster assets were inspected and their dimensions read. **No Apps Script implementation, workbook/export, tests, package manifest, or other supporting source is present in this folder.** Directory inventory is the evidence for these availability statements.

No legacy script was executed, no original file was modified, and no production endpoint was requested. The configured endpoint is deliberately not reproduced here. No credentials were fetched or used. No React code or other existing project file is changed by this audit. Findings describe the local source snapshot, not independently tested behavior of the deployed application or its server.

### Source citation convention

- **H** = [original `pule_app/index.html`](/Users/donalokeeffe/Documents/Life/Coding/Pule/pule_app/index.html). `H:680–694` means those original file lines. Every workflow/formula below identifies its function or DOM location as well.
- **M** = [original `pule_app/manifest.json`](/Users/donalokeeffe/Documents/Life/Coding/Pule/pule_app/manifest.json).
- **S** = [original `pule_app/sw.js`](/Users/donalokeeffe/Documents/Life/Coding/Pule/pule_app/sw.js).
- **R** = the current React project, used only for the parity comparison in section 12. React references name the file and function, not the original.

Confidence labels:

- **Confirmed client:** explicitly implemented in the inspected markup/JavaScript. This does not assert a successful production round trip.
- **Server-dependent:** the client sends/consumes a contract, but backend behavior, storage, validation, eligibility or aggregation is unavailable.
- **Static defect / conditional risk:** a source-level inconsistency or failure path; runtime impact is described conditionally where it depends on a response or data shape. No production reproduction is claimed.
- **Proposal:** a future information architecture or prioritization recommendation, not legacy behavior.

### Most important correction to the development model

The legacy client models an **open-ended match-night session containing individually started, timed and logged frames**. It has no setup race target and no client-side automatic match finish at a score threshold. The user finalizes the night manually between frames. Setup accepts two or more players, although active scoring is hard-coded to the first two, so full multiplayer rotation is **not** confirmed. Sources: H:212–243 (`setup-panel`), H:364–389 (`frameGateContainer`), H:1672–1705 (`initiateSession`), H:1844–1965 (`submitIndividualFrame`, `finalizeSessionNow`).

The React prototype's race-to-3/5/7, two fixed participant slots, match-wide timer and immediate frame award are therefore **provisional prototype inventions, not established parity**. Sources: R:`src/features/scoring/Setup.tsx:12–90` (`Setup`), R:`src/features/scoring/useDemoMatch.ts:6–14,58–111` (`DemoMatch`, `demoReducer`, `useDemoMatch`).

## 2. Screens, navigation and all user-facing sections

There are **two navigation tabs, three main panels, and five modal/overlay surfaces**. No separate legacy Home, player-profile, settings or standalone recap page exists in the supplied HTML; all visible sections are accounted for below. Sources: H:64–190 (overlays), H:205–669 (navigation and panels), H:727–744 (`showPanel`).

| Surface | Contents / entry and exit | Original evidence |
| --- | --- | --- |
| Play tab | Opens setup; if an active match ID exists, redirects to scoring. Without one, refetches initial data. | H:206–208; `showPanel`, H:727–744 |
| New Match setup panel | Venue selection/custom venue, selectable roster, add-player input, initial breaker, Start Match. | H:212–243 |
| Live scoring panel | Probability header/drawer, timer, mutually displayed session gate or active frame controls. Play remains its selected tab. | H:247–577; `showPanel`, H:732–734 |
| Session dashboard / between-frame gate | Started/date/venue text, Abandon Match, all selected players ranked by current frame totals, Start Frame N, Finalize Match Night Now. | H:364–389; `lockFrameControlsView`, H:1061–1086 |
| Active frame controls | Two player cards; winner selection; per-player tonight wins, break badge, Hold/Steal/Pot metrics, revealable tips, foul +/- and warnings. Breaker switch, break-pot toggle, six-pocket table, event selector/offender controls, Confirm Frame & Log Score, Abandon. | H:393–574; handlers H:975–1059 |
| Live Insights drawer | “Gemini Live Analysis” narrative; recent form/H2H/break/foul factor grid; past/active/total foul index; H2H catchup narrative and recovery pill; tonight's editable frame timeline. Header click expands/collapses, inner clicks stop propagation. | H:250–344; `toggleWinProbBreakdownDrawer`, H:915–925; `triggerLiveInsightRefresh`, H:1367–1583 |
| Leaderboard tab/panel | Season filter; Overall Standings; Comebacks & Pressure Records; Longest Nightly Frame Streaks; Break & Receiving Stats; Pace Profiles & Frame Duration; featured latest match and scroll history; roster-selected Rivalry Deep Dive. | H:580–630; `buildLeaderboardView`, H:2048–2323 |
| Rivalry chart region | Frame-by-frame cumulative progression, margin-of-victory trend, finish-type breakdown, scratch timeline, six black-pocket percentages. Hidden when no valid selected roster/matches. | H:632–668; `renderRivalryAnalytics`, H:2325–2416 |
| Edit frame modal | Edit a logged active-session frame's winner and each player's foul count. Save or close. Not a complete frame editor. | H:73–111; `openEditFrameModal` through `saveFrameEdits`, H:796–875 |
| Frame celebration overlay | Winner, animated score bump, conditional streak/speed/event/foul highlights, Continue Match dismisses to the between-frame gate. | H:115–146; `triggerFrameWinCelebrationAnimation`, H:1707–1805 |
| Share Match Recap modal | Final result text for manual copy into chats. Copy, close, or View Leaderboard; closing navigates to Leaderboard. It is not an image exporter or direct chat integration. | H:150–175; `openShareModalForMatch`, `closeShareModal`, `copyMatchRecapToClipboard`, H:1807–1842 |
| Historical match scorecard modal | Names/date/venue, each frame's number, special event, potted-on-break marker, duration, winner styling, per-player fouls and running score; or no-individual-frames message. Read-only. | H:179–189; `inspectMatchDetails`, H:1599–1639 |
| Global loading/error states | Blocking action overlay with message; initial-load error in global console; most mutation errors via `alert`, abandon via native `confirm`. | H:65–69,671; `showLoading`/`hideLoading`, H:718–725; handlers H:853–875,1585–1596,2519–2527 |

**Navigation behavior:** switching to Leaderboard rebuilds from in-memory cache, not necessarily a network refresh; switching back to Play with an active ID restores the scoring panel, without starting a new match. Panels are DOM visibility toggles, not URL routes; there is no source handling for browser Back/deep links. Sources: `showPanel`, H:727–744; load event H:2530.

## 3. Complete setup and restoration workflow

1. On window load, call `getLeaderboard`, show loading, pass its response to `processInitialLoad`. Failures clear loading and render a database-load message. Sources: `fetchInitialData`, H:2519–2530.
2. Populate venues from `db.uniqueVenues`; otherwise use `Soho`. Ensure `Soho` is in the list, append `Add New Venue...` with value `CUSTOM`. Selecting it reveals and focuses a text input. Source: `processInitialLoad`, H:2495–2507; `toggleVenueCustomField`, H:878–883.
3. Render player pills from `db.uniquePlayers`, falling back to `Sean`, `Donal`, `Alan` when missing/empty. Existing pills toggle selection and rebuild the breaker dropdown. Source: `renderDynamicRosterSelectionGrid`, H:927–948.
4. Add a new nonblank trimmed name to the setup grid, already selected. It is only local at this step; there is no standalone create-player API call. Source: `addNewPlayerToSetupGrid`, H:960–973; API call sites H:857,1090,1589,1693,1879,1927,1946,2521.
5. Initial-breaker dropdown contains `Auto / First Selected` and selected player names. Rebuilding it resets its options/selection. Selection collection uses DOM order, not order of tapping. Sources: `updateSetupBreakerDropdown`, H:950–958; `initiateSession`, H:1678–1683.
6. Start requires **at least two selected pills**, with no upper bound or duplicate-name check. Venue is trimmed only for custom entry; blank defaults to `Soho`. No date, season, target, discipline, handicap, team or break-rule configuration is requested here. Source: `initiateSession`, H:1672–1693; complete setup DOM H:212–243.
7. Initialize the roster, score map with zeros, winner history and detailed-frame arrays. Set breaker to dropdown choice or first roster item. POST `startNewMatch` with `{venue, players, breaker}`. On success take `matchId` and `date`, set next frame to 1 and inactive, render the gate and scoring panel. On failure alert; no server outcome can be inferred. Source: `initiateSession`, H:1682–1705.
8. When initial data contains `activeSession`, restore its match ID, frame number, active players, score map, frame history/details and current breaker. Enter scoring. A truthy `frameStartTime` or already-active client flag shows active frame controls; otherwise show gate. This is **server-assisted resume**, not evidence of browser-local durable drafts. Sources: `processInitialLoad`, H:2509–2514; `restoreSessionUI`, H:1647–1670.

**Multiplayer boundary:** setup, score map, share recap and gate can enumerate >2 players, but the two active cards, submitted frame participants, foul inputs, winner buttons, manual breaker switch, edit modal and much of analytics use roster indices 0 and 1. There is no client UI for choosing the pair each frame or winner-stays/player rotation. Treat this as partial/inconsistent support requiring clarification, not as a verified rotation rule. Sources: H:801–802,975–1001,1018–1037,1074–1080,1367–1378,1846–1847,1882–1885,2339–2340.

## 4. Complete live frame-scoring workflow

### 4.1 Start a frame

From the between-frame gate, Start Frame N calls `startFrameTimer` with the active match ID. Only after success set `isFrameInProgress=true`, reset accumulated seconds, start the local wall-clock-based display, hide the gate, reveal controls, hide previously revealed tips, refresh insights and remove loading. The returned `startedEpoch` is not used. There is no client-side rule saying the frame winner must break next. Source: `unlockActiveFrameControls`, H:1088–1108.

### 4.2 During the frame

| Action | Confirmed client behavior | Source |
| --- | --- | --- |
| Pause/resume stopwatch | Only allowed when `isFrameInProgress`. Pause accumulates whole seconds from last resume; resume sets a new local epoch. Interval shows accumulated + current run while unpaused. This is a **frame stopwatch**, reset between frames. No pause API call. | `togglePauseStopwatch`, H:747–769; `resumeAbsoluteClock`, H:771–793; gate reset H:1061–1066 |
| Select winner | Tap player card or WON FRAME button. Sets name and selected styling; does **not** log a frame or immediately commit a score. Can choose the other side before confirmation. | DOM H:407,455–456,461,509–510; `selectCardWinner`, H:975–992 |
| Record ordinary fouls/scratches | +/- separately per side; count clamped at zero, no upper limit. At count >=2 show warning/styling. This does not itself force a loss or Super Foul. Changes refresh live analytics. | `adjustScratch`, H:1040–1059; DOM H:443–451,497–505 |
| Switch breaker | Toggles between first two roster players, updates badges/context and refreshes insights. It does not persist immediately. | `manualToggleBreaker`, `updateBreakerBadges`, H:1018–1038 |
| Ball potted on break | Boolean NO/YES control, attributed through the breaker field when logging. Defaults false. It is not a count, ball identity or shot log. | `togglePottedOnBreak`, H:885–897; DOM H:524–531 |
| Black-ball pocket | Choose exactly one active code: TL, TM, TR, BL, BM, BR. Replacing selection changes code; no deselect-to-unknown control. Default `None` is allowed at submission. | `setPocket`, H:1641–1645; state H:697; table H:534–549 |
| Special event | Single choice, not multiple flags: `None`, `Golden Break`, `Break & Run`, `Dry Clearance`, `Super Foul`. Golden Break/Break & Run force break-pot true on selection; other choices do not reset it. | DOM H:553–561; `handleSpecialEventChange`, H:1003–1016 |
| Super Foul offender | Reveals two offender buttons; choosing one sets `superFouler` and automatically selects the other as winner. Later winner selection can override this. Leaving Super Foul clears offender selection. | `selectSuperFouler`, H:994–1001; `handleSpecialEventChange`, H:1003–1011 |
| Secret Tip | Reveal/hide each side's deterministic historical/generic tip; hidden again when a new frame starts. No model request is made. | `togglePlayerTip`, H:899–913; `generatePersonalizedPlayerTip`, H:1333–1365; H:1097–1100 |
| Live Insights | Open header drawer to view probabilities/factors, foul totals, current streak, deficit recovery narrative and editable logged-frame timeline. | H:250–344; `triggerLiveInsightRefresh`, H:1367–1583 |

Pocket labels map to top left/middle/right and bottom left/middle/right **as drawn**; no orientation-switching or venue-specific pocket coordinate system is implemented. Source: `highlightMostCommonMidFramePocket`, H:1278–1280; DOM H:541–549.

### 4.3 Confirm and log a frame

1. `Confirm Frame & Log Score` checks only that a winner is selected, then reads event and both scratch counts. There is no required pocket/offender check or event-versus-breaker consistency check. Source: `submitIndividualFrame`, H:1844–1859.
2. Compute duration from local accumulated seconds plus whole seconds since `lastResumeTimeMs`; show loading and set frame inactive. Copy old scores, optimistically increment selected winner and append winner to local history. Source: H:1857–1868. The pause-duration defect is documented in section 11.
3. Send the full frame payload listed in section 6 to `logIndividualFrame`. Client sends no operation UUID, expected revision or explicit timestamp. Source: H:1879–1892.
4. On success adopt returned next `frameNumber` and any returned scores, winner history and detailed frames. Reset both foul inputs/warnings, pocket to `None`, winner, offender, break-pot false and special to `None`; clear selection styling. Adopt server-returned `currentBreaker` if truthy. Source: H:1893–1925.
5. Make a second `getLeaderboard` call. On that success replace analytics cache, render gate with `freshDb.activeSession` or fallback, hide loading and show frame celebration. Continue Match just dismisses the overlay. Sources: H:1927–1932; `lockFrameControlsView`, H:1061–1086; `closeCelebrationOverlay`, H:1803–1805.
6. Repeat Start Frame → record metadata → confirm for as long as desired. Finalize is offered at the gate; no client race-target cap is present. Sources: gate H:380–388; H:1844–1965.

### 4.4 Breaker rotation: confirmed versus unknown

- Initial breaker is selectable and sent at session creation; current-frame manual override is available. Sources: H:950–958,1018–1038,1682–1693.
- Automatic next breaker is **consumed from the server response**, not calculated in this client. `standings.currentBreaker` and `session.currentBreaker` update local state. Whether it alternates, follows winner/loser, or implements another policy cannot be recovered without Apps Script. Sources: H:1654,1925.
- Live refresh may substitute the setup breaker/first player if the current breaker is not either of the two displayed players. A >2-player initial breaker can therefore be overwritten. Source: H:1391–1395.

## 5. Completion, correction, abandonment and history

| Workflow | Exact reachable behavior | Source / verification boundary |
| --- | --- | --- |
| Finalize match night | Gate button clears interval, marks frame inactive, calls `closeMatchSession({matchId})`. No client confirm/review, minimum-frame validation, tied-score rejection or target check. Success adopts `res.db || res`, clears active session state; opens share if `res.summary`, otherwise Leaderboard. | `finalizeSessionNow`, H:1939–1965. Winner calculation, empty-match handling and DB transaction are server-dependent. |
| Final result / ties | Share uses `winners.length>1` as Tie Match; otherwise names first winner. Displays every player and score, venue/date and frame count when frame data exists. | `openShareModalForMatch`, H:1807–1825. Server decides `winners`; no calculation is present here. |
| Copy result | Select textarea, `document.execCommand('copy')`, immediately show success for 2.5 seconds; no return-value/error handling. Copy does not send to WhatsApp or create an image/public URL. | `copyMatchRecapToClipboard`, H:1832–1842; modal text H:162–173 |
| Active-session correction | Open Edit on any returned detailed frame in tonight's timeline, choose first/second roster player as winner, adjust both scratch counts >=0, save with `editLoggedFrame`. Adopt returned scores/history/details; close, render gate, refresh insights. | `triggerLiveInsightRefresh`, H:1452–1470; edit handlers H:796–875 |
| Correction limitations | Editor cannot change breaker, break-pot status, pocket, special event, offender, duration, participants, date or venue. No deletion/Undo of a frame and no reason/audit trail shown. It is only wired to the active-session timeline, not completed-match history. | Modal H:73–111; payload H:857–862; historical scorecard H:1599–1639 |
| Abandon/delete active session | Available at gate and during frame; native confirmation says abandon and **completely delete entire session**. Calls `deleteActiveMatch`, adopts returned DB, clears match/roster/score/history state and returns setup. Error alerts. No trash/restore control. | DOM H:370–372,400–402; `confirmDeleteMatch`, H:1585–1596. Actual cascading deletion/retention is server-dependent. |
| Completed match inspection | Featured newest and every history row call `inspectMatchDetails(matchId)` from cached matches. Shows frame summaries or no-frames fallback. No historical edit/delete control. | H:2251–2289; `inspectMatchDetails`, H:1599–1639 |
| Resume after reload | Initial `getLeaderboard` may return one `activeSession`, restored automatically. No session picker or multi-user ownership is shown. Unsaved input restoration is not implemented in client. | H:1647–1670,2495–2530 |

**Not verified / not found:** finished-match reopening, frame deletion, completed-match deletion, date/venue editing, role-based permissions, rollback or an append-only correction trail. The available mutation call sites and both detail/edit modals above are the evidence for their absence from this client, not proof the missing backend has no such internal functions.

## 6. Complete observable data dictionary

These are **outbound client fields and inbound contracts**, not a recovered spreadsheet schema. Source uses names as keys and participant identity; stable player IDs and rule versions are not present in the inspected payloads. Match IDs exist, but their generation is server-dependent. Sources: `initiateSession`, H:1672–1695; `submitIndividualFrame`, H:1879–1897; `restoreSessionUI`, H:1647–1654.

### 6.1 Session creation and identifiers

| Field | Direction / meaning / default | Source |
| --- | --- | --- |
| `venue` | Create payload; selected/custom name, blank falls back to `Soho`. | H:1674–1676,1693 |
| `players` | Create payload; array of selected pill text in DOM order, minimum length 2. | H:1678–1689,1693 |
| `breaker` | Create payload; dropdown name or first selected-in-DOM player. | H:1682–1693 |
| `matchId` | Response identity; passed on frame start/log/edit/close/delete. | H:1695,1090,858,1589,1880,1946 |
| `date` | Start response / display; generated/formatted server-side, no manual input. | H:1698; `lockFrameControlsView`, H:1069 |

### 6.2 Every field sent when logging a frame

All fields below are explicitly present in `submitIndividualFrame` → `logIndividualFrame`, **H:1879–1892**.

| Field | Meaning / captured value |
| --- | --- |
| `matchId` | Parent active match identity. |
| `frameNum` | Current frame index; initialized 1, later replaced by response `frameNumber`. |
| `p1Name`, `p2Name` | First two session roster names, fallback `Player 1` / `Player 2`. |
| `p1Scratches`, `p2Scratches` | Numeric current-frame foul counters, initial UI zero, floor zero. |
| `winner` | Selected name; required by client validation. |
| `pocketCode` | `None` or one of TL/TM/TR/BL/BM/BR. |
| `special` | `None`, `Golden Break`, `Break & Run`, `Dry Clearance`, or `Super Foul`. |
| `breaker` | Current local breaker name; manual choice or returned/initialized value. |
| `superFouler` | Selected offender name or null. |
| `pottedOnBreak` | Boolean, defaults false; forced true when choosing Golden Break/Break & Run, but can be toggled subsequently. |
| `durationSec` | Computed local frame duration in seconds. See timing defects in section 11. |

No per-shot sequence, pot attempts, visits, balls remaining, ball colors, foul type, shot timestamps, break shot geometry, ruleset ID, scorer ID, or pause-event list is sent. This boundary follows the complete payload above, not an assumption about what Sheets might contain.

### 6.3 Active-session response and transient state

| Contract / state | Fields | Source |
| --- | --- | --- |
| `db.activeSession` consumed | `matchId`, `frameNumber`, `activePlayers`, `scores`, `frameHistory`, `detailedFrames`, `currentBreaker`, `frameStartTime`, `venue`; gate uses `date`. `frameStartTime` is only tested for truthiness. | `restoreSessionUI`, H:1647–1670; `lockFrameControlsView`, H:1068–1070 |
| Frame-log response | `frameNumber`, optional `scores`, `frameHistory`, `detailedFrames`, `currentBreaker`. | H:1893–1897,1925 |
| Frame-edit response | Optional `scores`, `frameHistory`, `detailedFrames`. | H:864–866 |
| Edit request | `matchId`, `frameNum`, `winner`, `p1Scratches`, `p2Scratches`; no other metadata. | H:857–862 |
| Detailed frame properties actually read | `frameNum`, `winner`, `p1Name`, `p2Name`, `p1Scratches`, `p2Scratches`, `duration`, `special`, `pottedOnBreak`, `runningScore`. `durationSec` outbound is called `duration` inbound. Additional returned fields cannot be assumed. | H:797–806,1431–1435,1458–1469,1613–1628 |
| Winner-history array | `frameHistory` / `sessionFrameHistory`: ordered winner-name strings; trailing run drives live streak. | H:700,865,1110–1118,1652,1868,1896 |
| Transient input state | Chosen pocket, selected winner/offender, current breaker, break-pot Boolean, DOM foul counts and special selector. No browser-storage persistence. | H:697–710,975–1059,1641–1645,1901–1925 |
| Transient timer state | `isTimerPaused`, `accumulatedElapsedSec`, `lastResumeTimeMs`, interval ID and `isFrameInProgress`. No pause state sent to server. | H:697,703,707–710,747–793 |
| Chart/modal state | Four chart instances; editing frame number, proposed winner and two scratch counts. Presentation-only. | H:702,712–716 |

### 6.4 Historical database shape consumed

| Object / field | Client use | Source |
| --- | --- | --- |
| `db.uniqueVenues`, `db.uniquePlayers` | Venue and roster lists. How new entries are persisted/deduplicated is unknown. | `processInitialLoad`, H:2502–2509 |
| `db.uniqueSeasons` | Season dropdown, first supplied option selected. `All-Time` is recognized but not inserted by client. Server defines season names/boundaries and list order. | H:2055–2060 |
| `db.allMatches[]` | Cached match collections for standings, history and analytics. Whether active/abandoned records are included depends on server. | H:1136,1188,2060,2333 |
| Match: `matchId`, `date`, `dateMs`, `season`, `venue`, `rosterId`, `players` | Identity/display, date sorting, season filter, roster grouping and participant axes. `rosterId` split on literal ` & ` for graphs. | H:1601–1605,2059–2071,2251–2289,2333–2343 |
| Match: `scores`, `winners` | Per-name frame totals and winner-name array; multiple winners treated as tie in standings/history/share. Production construction is absent. | H:1809–1815,2239–2247,2260–2287 |
| Match: `hasFrameData`, `rawFrames` | Eligibility flag and ordered frame objects; client assumes supplied frame order. | H:1137–1143,1972–1985,2019–2024,2334–2373 |
| Match: `scratches` | Server aggregate count keyed by player, used in scratch chart; missing defaults to zero. | H:2360–2362 |
| Match: `specials` | Per-player count map keyed `Regular`, `Golden Break`, `Break & Run`, `Dry Clearance`, `Super Foul`; used for finish chart. Mapping outbound `None` to `Regular`, and assignment of Super Foul wins, is server-dependent. | H:2345,2376–2390; chart H:2452–2457 |
| Match: `pockets` | Count map TL/TM/TR/BL/BM/BR; combined across players for hints/heatmap. No success-attempt denominator. | H:1278–1325,2346,2392–2408 |
| Match: `totalActivePlaySec` | Displayed match active time; aggregate formula and treatment of missing/paused durations are not recoverable. | H:2262,2280–2284 |
| `db.breakAnalytics[player]` | `totalBreaks`, `breakWins`, `totalReceived`, `receiveWins`, `trackedBreaks`, `pottedOnBreak`. Source of eligible breaks/receives not supplied. | H:1214–1224,1334–1348,1412–1422,2169–2201 |
| `db.paceAnalytics[player]` | `totalWinTime`, `winCount`, `blitzWins`, `marathonWins`. Computation and exclusions are server-dependent. | H:2211–2225 |
| Finalize response | `res.db || res` plus optional `res.summary`, shaped like a historical match for share. Delete returns a DB object directly. | H:1589–1590,1946–1958 |

## 7. Exact recovered statistics, formulas and eligibility

### 7.1 Scope rules and ordering

- Season-filtered client collections use `targetSeason === 'All-Time' || m.season === targetSeason` (strict equality), not a derived date range. Applies to global standings/history, comeback/pressure records, nightly streaks and roster charts. Sources: `buildLeaderboardView`, H:2055–2060,2078,2145,2239; `renderRivalryAnalytics`, H:2333.
- Break/pace panels read `db.breakAnalytics` and `db.paceAnalytics` directly; the selected season is **not** passed to the server or applied to these aggregate maps. Their actual upstream scope is unverified. Sources: H:2169–2174,2211–2215; sole initial fetch H:2521.
- Live H2H/probability/pocket hints scan cached `allMatches` across all supplied seasons, not the selected leaderboard season. H2H qualifies by **containing both names**, not exactly two participants or identical roster ID. Sources: H:1136–1138,1188–1189,1294–1296.
- None of these client filters independently checks a completed/finalized status or a ruleset version; server eligibility is unknown. Evidence: full predicates above, frame guard H:1972/2019, aggregate traversal H:2239–2247.
- Chronology is mixed: history explicitly sorts `dateMs` descending; progression/scratches explicitly sort ascending; recent H2H sorts descending with `dateMs || 0`; global form and margin chart inherit response order; no client sorts `rawFrames` by frame number. Sources: H:1211,2245–2251,2298,2342–2343,2357–2365.

### 7.2 Overall standings and form

For each filtered match and **each key in `m.scores`**:

```text
totalFrames[player] += m.scores[player]        // frames WON, not frames played
outings[player] += 1
if winners exists and winners.length > 1: append D for EVERY score-map player
else if winners includes player: matchWins += 1; append W
else: append L
rank by matchWins descending, then totalFrames descending
average = (totalFrames / outings).toFixed(1)
form ribbon = form.slice(-5), in inherited match order
leader badge = first sorted entry; all other entries get ordinal rank
```

No points system, win percentage, loss/draw count column, minimum outings requirement, shared-rank algorithm or further tie-breaker exists here. Sources: `buildLeaderboardView`, H:2238–2248,2292–2312. Multiwinner draws and uncertain form chronology are material limitations, not proposed scoring rules.

### 7.3 Comebacks and pressure records

Eligible matches require `hasFrameData` and nonempty `rawFrames`. For every `m.players` entry, choose the **first different player** as opponent. Iterate frames in supplied order; increase own or selected opponent tally only when the winner matches that name. `maxDeficit = max(0, opponentRunning - playerRunning)` over the sequence. `isWinner = m.winners && m.winners.includes(player)`.

- **Trailing Wins:** increment only if `isWinner && maxDeficit >= 3`. It does not count every recovery from any deficit.
- **Biggest Comeback:** maximum such qualifying deficit, updated only on strictly larger value; store opponent/date from first encountered best. 1–2-frame recoveries produce no biggest-comeback entry.
- **Decider eligibility:** `rawFrames.length > 1 && abs(playerRunning - opponentRunning) <= 1` **at the end**, not a test that the penultimate score was tied. If `isWinner`, increment decidersWon; else decidersLost.
- **Hill-Hill Win Rate:** `round(100 * decidersWon / (decidersWon + decidersLost))`; no-decider placeholder when denominator zero.
- **Comeback King:** one player with strictly greatest positive maxComeback, first encountered on a tie; everyone else gets Resilient, even with zero qualifying recovery. Cards themselves are not sorted by comeback size. No persistent award is written.

Sources: `calculateComebackAnalytics`, H:1968–2013; badge and percentage rendering H:2078–2138. Labels “pressure,” “resilient” and “hill-hill” are editorial interpretations, not validated skill measures. Tied winners can count as wins in this calculation even though global standings count the same match as a draw.

### 7.4 Nightly and live frame streaks

- **Longest Nightly Frame Streaks:** eligible frame-data matches only; reset run at each match boundary. For every truthy frame winner, extend same-name run or reset to 1. Empty winners are skipped without breaking the run. Store the first encountered strictly best run with match date, venue (`Soho` fallback), and all other player names. Sort displayed players descending by best run. No minimum of 2 or 3 is required for this historical leaderboard. Source: `calculateNightlyFrameStreaks`, H:2015–2045; rendering H:2143–2165.
- **Current live run:** walk backward from last `sessionFrameHistory` winner until it changes. Probability gets run length even at 1; header streak pill appears at >=2; “ON FIRE” styling at >=3; celebration highlights at >=2 if winner is run holder. Sources: `calculateCurrentFrameStreakInfo`, H:1110–1118; H:1485–1494,1536,1573–1578,1721–1727.

These are consecutive **frame** wins within a session, not consecutive match-night wins. No source supports a permanent achievements system, unlock inventory, or player-selected trophy cabinet. Sources: calculations and display-only renderers above; all mutation payloads in section 9.

### 7.5 Break and receiving statistics

With server-provided aggregate values:

| Metric | Exact display formula / eligibility | Source |
| --- | --- | --- |
| Break Pot Success | `round(100 * pottedOnBreak / trackedBreaks)` if trackedBreaks>0, else 0 on leaderboard. Live pill only updates at trackedBreaks>=1. | H:2172,2188–2190; H:1418,1422 |
| Hold Rate | `round(100 * breakWins / totalBreaks)` if totalBreaks>0, else 0. Live pill requires totalBreaks>=1. | H:2173,2193–2195; H:1416,1420 |
| Steal Rate | `round(100 * receiveWins / totalReceived)` if totalReceived>0, else 0. Live pill requires totalReceived>=1. | H:2174,2198–2200; H:1417,1421 |
| Counts/context | Display totalBreaks and pot numerator/denominator. Colors green >50%, red <50%, amber =50%. | H:2176–2190; helper `applyMetricColor`, H:1397–1410 |

**Not recoverable:** what makes a break tracked; whether absent historical break-pot values are excluded; which frames qualify as receives; whether special events/abandoned/active matches are excluded; how server handles multiple participants and corrected breakers. The client has aggregate fields but does not build them. Personalized receiving text says “opponent dry breaks,” whereas leaderboard says “Won opp break”; no client filter proves dry-only eligibility. Source: H:1345–1348 versus H:2197–2200.

### 7.6 Pace, duration and timing achievements

- **Avg Win Time:** `avgSec = round(totalWinTime / winCount)`, formatted `floor(avgSec/60)m avgSec%60s`. No zero-denominator guard in the renderer. `blitzWins` and `marathonWins` displayed unchanged from server. Source: H:2211–2225.
- **Frame duration display:** truthy `f.duration` formats minutes/seconds; zero/missing displays `--` live or Unknown in history. Sources: H:1459,1614.
- **Match active time:** truthy `totalActivePlaySec` displayed as `floor(sec/3600)h floor((sec%3600)/60)m` on latest card; `floor(sec/60)m` in rows; zero treated as unrecorded/omitted. Sources: H:2262,2280–2284.
- **Celebration speed badges:** Lightning Fast if `duration > 0 && duration <= 90`; otherwise Marathon Grind if `duration >= 420`, displaying floor(minutes). These thresholds are confirmed **for celebration only**; it is not proven that server `blitzWins`/`marathonWins` use the same thresholds. Source: H:1730–1745.
- **Other celebration badges:** Super Foul names offender; Golden Break says 8-ball potted on break; Break & Run says perfect clearance. Foul-heavy if `p1Scratches+p2Scratches >= 3` and event is not Super Foul. Dry Clearance has no dedicated celebration branch. Sources: H:1748–1775.

### 7.7 Rivalry charts and pocket analytics

Roster selection comes from distinct nonempty `rosterId` values in the season's matches. Previous selection is retained when possible, otherwise first roster auto-selected. Despite “Specific 1v1 Rivalry” wording, no two-player-only roster validation is performed. Source: H:2062–2074; label H:627; axis extraction H:2339–2340.

| Chart / metric | Exact construction, eligibility and source |
| --- | --- |
| Frame-by-Frame Winner Progression | Selected roster + season + `hasFrameData`; sort matches by `dateMs` ascending; retain raw frame order. Increment cumulative first-axis player's count for their wins and second-axis player's for theirs; add step for every frame labeled F1…Fn. Counts do not reset each night. Two stepline series, not elapsed-time/shot analytics. `renderRivalryAnalytics`, H:2333–2373; `plotFrameProgressionTimeline`, H:2418–2432. |
| Margin of Victory Trend | All selected roster/season matches, including result-only ones. `margin = (scores[p1Axis] || 0) - (scores[p2Axis] || 0)`; response-order date categories, no explicit sort. Positive/zero bars P1 color, negative P2. H:2342–2343,2412; `plotMarginTimeline`, H:2434–2448. |
| Win Type Architecture | Sum server `m.specials[player][type] || 0` for **hasFrameData** matches only; five count series: Regular, Golden Break, Break & Run, Dry Clearance, Super Foul Win. Stacked horizontal bars, raw counts (not normalized percentages). H:2345,2376–2390; `plotFinishBreakdown`, H:2450–2470. |
| Scratch Timeline Index | Same frame-data matches sorted ascending; use match aggregate `m.scratches[player]` or zero, not recomputed frame counts. Paired bars by date. H:2357–2362; `plotScratchBarChart`, H:2472–2493. |
| 8-Ball Pocket Coordinates (%) | Sum six `m.pockets` bins from those frame-data matches, across both players. Denominator is sum of the six bins; each label `round(100*bin/total)`, or 0% when total=0. Rounding need not sum to 100. Missing/None pockets do not contribute to denominator. H:2392–2408; table DOM H:656–665. |
| Most-common live pocket hint | Scan **all** cached matches with `m.pockets` containing both displayed players (not exact roster, no frame-data/season guard). Sum six counts; take first strictly largest in TL,TM,TR,BL,BM,BR insertion order; if max>0, highlight node and `round(100*max/totalTracked)`, else hide hint. `highlightMostCommonMidFramePocket`, H:1278–1331. This is an observed finish location distribution, not success probability. |

All four chart objects are destroyed and recreated on rendering; plots scheduled after 50ms; toolbars/zoom hidden (scratch selection also disabled). Source: H:2410–2415,2418–2493. No client confidence intervals, chart data tables, export controls, missing-data coverage denominator, or minimum sample thresholds appear in these chart functions.

### 7.8 Historical H2H inputs used by the live model

`calculateComprehensiveH2HStats(p1,p2)` traverses all supplied matches containing both names:

1. Append a recent-match record `{date, dateMs: dateMs||0, winner, sc1, sc2, venue}`. `winner = p1` if winners includes p1, otherwise p2 if included, otherwise `'Tie'`. **This prioritizes P1 when both names are winners.** Sort descending dateMs. Scores default zero, venue `Soho`. Source: H:1188–1194,1211.
2. For frame-data matches with rawFrames, count frame winners per named player. Returned `totalFrames = p1FrameWins + p2FrameWins`, excluding other winners. `p1FrameWinRate = p1FrameWins/totalFrames`, otherwise 0.5. Internal `p1FramesTotal`/`p2FramesTotal` increment for every frame but are never used in return values. Source: H:1183–1207,1212,1217–1220.
3. Map each frame's scratches to the named player via its `p1Name`/`p2Name`, else zero. A frame counts as a foul frame if own scratches>0; a foul loss if its winner != that player. If at least **2 foul frames**, `foulLossRate=lostFoulFrames/foulFrames`; otherwise **0.65 prior**. Sources: H:1202–1206,1221–1222.
4. Break-hold rate is taken from **global returned player aggregates**, not matchup-specific raw frames: breakWins/totalBreaks when >0 breaks, else **0.55 prior**. Source: H:1214–1224.
5. Without cache, return zero frames, 0.5 frame-win rate, empty recents, 0.65 foul priors and 0.55 break priors. Source: H:1178–1180.

### 7.9 H2H deficit resilience

`calculateH2HDeficitResilience(p1,p2,c1,c2)`, H:1121–1176:

```text
D = c2 - c1; d = abs(D)
if cache unavailable: return both rates .5 + no-data narrative
if d == 0: return both rates .5 + even-score narrative
for each match with hasFrameData, nonempty rawFrames, and both names:
  track each player's running frame wins; find each max deficit
  for each player with maxDeficit >= d:
    qualifyingTrailingMatches += 1
    if m.winners includes that player: comebackWins += 1
rate[player] = comebackWins / qualifyingTrailingMatches if count > 0 else .25
narrate only the currently trailing player's numerator/denominator,
  or say they never faced/overcame that deficit in logged history
```

No exact-1v1 restriction, completion check, order validation or sample threshold is added. Tied winners can count as comeback wins. The 25% fallback is a model constant, not an observed rate. The separate visual `lblH2HDeficitPill` remains the static “50% H2H Recovery” in markup; only narrative text is updated. Sources: H:331; H:1498–1501; no other reference to that pill in the full source.

### 7.10 Exact live probability model

Source: `triggerLiveInsightRefresh`, **H:1497–1545**. This is a client heuristic; no trained model, calibration evaluation, simulation, race target, or AI API request is present. The target event is not rigorously specified: it mixes current frame scratches/breaker with match-night score and session streak. Do not assume these are calibrated chances of winning a frame or a night.

Let `logit(x) = ln(x/(1-x))`, `w1` = historical H2H P1 frame wins, `N` = P1+P2 historical frame wins, `c1,c2` = tonight's frame scores, `f1,f2` = active scratches, `r1,r2` = H2H deficit recovery rates, `q1,q2` = foul loss rates, and `b1,b2` = break-hold rates.

```text
smoothedRate = (w1 + 2) / (N + 4)
H = .6 * logit(smoothedRate)

R = sum over up to 3 most recent H2H match nights:
    +[.35,.20,.10][i] if winner=P1
    -[.35,.20,.10][i] if winner=P2
    0 if winner='Tie'

B = .5 * logit(b1) if P1 breaks
    -.5 * logit(b2) if P2 breaks
    0 otherwise

F = .8 * (f2*q2 - f1*q1)

s = c1-c2
C = s*.25*max(.3, 1.2-1.5*r1) if s<0
    s*.25*max(.3, 1.2-1.5*r2) if s>0
    0 if s=0

T = .15*currentRunLength if run holder=P1
    -.15*currentRunLength if run holder=P2
    0 otherwise

L = H + R + B + F + C + T
probabilityP1 = 1/(1+exp(-L))
displayedP1 = min(95,max(5,round(100*probabilityP1)))
displayedP2 = 100-displayedP1
```

No minimum historical sample for H2H/recent form. Break prior applies with no break data; foul prior applies with fewer than 2 qualifying foul frames; score recovery prior applies without matching deficit history. Break rates 0 or 1 are not epsilon-clamped before logit, potentially producing infinities/extreme results. Sources: H:1179,1221–1224,1161–1162,1503–1541.

**Narrative and factor display:** despite its name, `generateGeminiProbabilityNarrative` is string-template code. It names the favored player (P1 at 50%), describes most recent match and wins in last up to 3, H2H frame-win ratio, breaker hold rate, active foul “historical” risk and tonight's score. “Gemini Live Analysis” is a label; there is no Gemini network integration in this source. The factor grid shows last winner, unsmoothed career frame rate, current breaker and first applicable foul risk. Sources: H:1228–1276,1543–1555; only fetch implementation H:680–694.

### 7.11 Other live computed context and tips

- **Foul Index:** for each displayed name, sum its mapped scratch counts over `sessionDetailedFrames`; add that side's active DOM count. Render Past / Active / Total. Source: H:1430–1450.
- **Tonight's wins:** read `liveSessionScores[name] || 0`; gate sorts whole selected roster descending by these scores. Sources: H:1425–1428,1074–1080.
- **Tips:** if breaker and trackedBreaks>=1, quote rounded pot and hold rates; otherwise generic controlled-break advice. If receiver and totalReceived>=1, quote rounded steal rate; otherwise generic safety advice. Append warning for active fouls>=2; otherwise score deficit or lead. These are templates and may overstate what data supports. Source: `generatePersonalizedPlayerTip`, H:1333–1365.

## 8. PWA and asset audit

| Finding | Evidence / confidence |
| --- | --- |
| Install metadata exists | M:2–8: name/short name Pule, root start URL, standalone display, portrait orientation, dark background/theme. H:8–13: mobile/Apple standalone meta and root manifest link. **Confirmed declaration**, not proven installed experience. |
| Icon assets | M:9–15 references `/icon.png` with sizes `192x192 512x512`, PNG, any/maskable. Read-only image metadata reports `icon.png` is 512×512; `pool-cue.png` is 192×192. The latter is not referenced by H, M or S. Image contents inspected; no standalone UI behavior inferred. |
| Worker shell caching | S:1–11: `pule-cache-v1`; install cache.addAll of `/`, `/index.html`, `/manifest.json`. S:14–18: cache-match first, otherwise network fetch. Does not write fetched responses into cache. |
| Worker activation/update | Entire S:1–18 has no activate/old-cache cleanup, skipWaiting, client claim, update notification or app-version migration. Fixed cache name risks stale shell if actually registered. **Conditional risk**, not proof of deployed stale content. |
| Registration missing | Full H inline script H:674–2531 has no `navigator.serviceWorker.register` or equivalent. Only window-load listener is initial data fetch (H:2530). Therefore supplied files do not establish worker activation. External hosting could differ; not inspected. |
| Offline boundaries | Worker precache omits Tailwind runtime, ApexCharts, Font Awesome and icon assets; those are external dependencies (H:15–17) or uncached local images. Worker has no API queue/background sync; client has no localStorage/sessionStorage/IndexedDB use in H:674–2531. An installed icon or cached shell would not establish offline scoring/saving. |
| Root-path assumption | M:4,11; H:13; S:2–5 assume root deployment. Subdirectory hosting is not configured in these files. Hosting layout is unknown. |

## 9. Google Apps Script save/load/synchronization contract

### 9.1 Transport

`callGasApi(action,payload)` performs a POST to a configured Apps Script endpoint, with `Content-Type: text/plain;charset=utf-8` and JSON body `{action, payload: payload || {}}`. Non-OK HTTP status throws; response is parsed as JSON; truthy `data.error` throws. No authentication token, credentials option, retry/backoff, abort/timeout, idempotency key or revision is added by this wrapper. Sources: H:680–694 (configuration at H:678; endpoint intentionally omitted).

This establishes client request behavior only. It does not establish whether the endpoint is public, how deployment authorization works, whether the server uses Sheets locks, or whether writes are transactional. Apps Script/Sheets code and settings are unavailable.

### 9.2 Every action and call site

| API action | Payload | Client expects / subsequent action | Source |
| --- | --- | --- | --- |
| `getLeaderboard` | Omitted, wrapper supplies `{}` | Whole DB consumed by `processInitialLoad`. Called on window load and setup re-entry without active ID. | H:2521–2530; H:740–742 |
| `startNewMatch` | `venue`, `players`, `breaker` | `matchId`, `date`; render gate. | H:1693–1699 |
| `startFrameTimer` | `matchId` | Return named `startedEpoch`, unused; local timer starts after response. | H:1089–1095 |
| `logIndividualFrame` | Full 13-key payload in section 6.2 | `frameNumber`, optional scores/history/details/currentBreaker; then separate DB read. | H:1879–1925 |
| `getLeaderboard` (post-frame) | `{}` | Replace cache, gate from activeSession, celebrate. Nested promise is not returned/caught. | H:1927–1932 |
| `editLoggedFrame` | `matchId`, `frameNum`, `winner`, `p1Scratches`, `p2Scratches` | Optional scores/history/details; rerender gate; **no analytics DB reload here**. | H:857–871 |
| `deleteActiveMatch` | `matchId` | Whole updated DB; reset and return setup, which triggers another initial fetch. | H:1589–1591; H:740–742 |
| `closeMatchSession` | `matchId` | `res.db || res`, optional `summary` for share. | H:1946–1961 |

The frame-log payload has 13 keys when `matchId`, `frameNum`, both names, both scratch counts and all seven remaining metadata fields are counted individually. No additional API actions were found among the complete call sites above.

### 9.3 What “sync” means in this app

- The browser holds only mutable in-memory cache/session arrays and DOM values (H:696–716). State restoration relies on fetching `activeSession`, not local drafts (H:1647–1670,2519–2530).
- It is request/response refresh, not polling, realtime subscription, background replication or a durable outbox. Window load and explicit action callbacks are the refresh triggers (H:1927–1932,2495–2530; complete listeners H:784,2530).
- Active selections/counters/pause status/manual breaker override are not independently autosaved; only submitted frame data and timer start have write calls (H:975–1059,1879–1892,1090).
- Whether data is saved to specific Sheets/tabs/columns, historical result rows differ from frame rows, aggregates update on edit/delete, or duplicate requests are rejected is **unverified**. No workbook/schema/backend exists locally.

## 10. Function/feature coverage index

All executable inline functions were inspected. This index maps small handlers as well as larger calculations to the audit above; it is included to make omissions reviewable.

| Original source group | Functions | Covered above |
| --- | --- | --- |
| H:680–793 | `callGasApi`, `showLoading`, `hideLoading`, `showPanel`, `togglePauseStopwatch`, `resumeAbsoluteClock` | §§2–4,8–9 |
| H:796–925 | `openEditFrameModal`, `closeEditFrameModal`, `setEditModalWinner`, `adjustEditModalScratch`, `updateEditModalUI`, `saveFrameEdits`, `toggleVenueCustomField`, `togglePottedOnBreak`, `togglePlayerTip`, `toggleWinProbBreakdownDrawer` | §§2–6 |
| H:927–1108 | `renderDynamicRosterSelectionGrid`, `updateSetupBreakerDropdown`, `addNewPlayerToSetupGrid`, `selectCardWinner`, `selectSuperFouler`, `handleSpecialEventChange`, `manualToggleBreaker`, `updateBreakerBadges`, `adjustScratch`, `lockFrameControlsView`, `unlockActiveFrameControls` | §§3–4,6 |
| H:1110–1365 | `calculateCurrentFrameStreakInfo`, `calculateH2HDeficitResilience`, `calculateComprehensiveH2HStats`, `generateGeminiProbabilityNarrative`, `highlightMostCommonMidFramePocket`, `generatePersonalizedPlayerTip` | §7 |
| H:1367–1583 | `triggerLiveInsightRefresh`, nested `applyMetricColor` | §§2,4,7 |
| H:1585–1705 | `confirmDeleteMatch`, `inspectMatchDetails`, `closeMatchDetailsModal`, `setPocket`, `restoreSessionUI`, `initiateSession` | §§3–6,9 |
| H:1707–1965 | `triggerFrameWinCelebrationAnimation`, `closeCelebrationOverlay`, `openShareModalForMatch`, `closeShareModal`, `copyMatchRecapToClipboard`, `submitIndividualFrame`, `finalizeSessionNow` | §§4–7,9 |
| H:1968–2323 | `calculateComebackAnalytics`, `calculateNightlyFrameStreaks`, `buildLeaderboardView` | §7 |
| H:2325–2493 | `renderRivalryAnalytics`, nested `computeRatioString`, `plotFrameProgressionTimeline`, `plotMarginTimeline`, `plotFinishBreakdown`, `plotScratchBarChart` | §7.7 |
| H:2495–2530 | `processInitialLoad`, `fetchInitialData`, window load callback | §§3,8–9 |

## 11. Bugs, inconsistencies and UX/reliability problems

Findings below are **static source observations**, not production test results. Preserve functional intent in a rewrite, not these defects. Severity is a prioritization proposal.

| ID / priority | Finding and consequence | Source / confidence |
| --- | --- | --- |
| B01 / high | **Submitting while paused overcounts duration.** Pause adds elapsed time into accumulated seconds but leaves lastResumeTimeMs unchanged. Submit always adds now-lastResumeTimeMs again, regardless of paused state. Example: run 60s, pause 30s, submit → 60+90=150s instead of 60s. | H:754–758 versus H:1857–1859. Confirmed arithmetic defect. |
| B02 / high | **Reloaded active frame loses elapsed origin and pause state.** restore tests frameStartTime but never uses its value; resumeAbsoluteClock starts from current time and clears pause. Returned startedEpoch also ignored. An in-memory accumulated value may survive some transitions, but reload starts at zero. | H:771–774,1090–1093,1647–1664. Confirmed client restoration limitation. |
| B03 / high | **Failed frame submission leaves optimistic score/history and inactive flag.** Increment occurs before request; catch does not roll back, restore timer, or reconcile. Retrying can increment local score again; actual server duplicate behavior unknown. | H:1861–1868,1933–1936. Confirmed failure-path defect; remote duplication conditional. |
| B04 / high | **Post-save refresh failure is uncaught.** Nested getLeaderboard promise is not returned from log success. Its rejection bypasses outer catch, leaving loading visible even after a frame may have been saved. | H:1927–1936. Confirmed promise-chain defect. |
| B05 / high | **Editing can interrupt an active frame.** Edit timeline is available while scoring; save calls lockFrameControlsView, clears interval/accumulated seconds and hides controls, without persisting active inputs or consistently setting isFrameInProgress false. | H:1452–1470,853–871,1061–1085. Conditional on editing during a running frame. |
| B06 / medium | **Edit changes venue display to fallback and cache may stay stale.** Gate receives only date Tonight and scores, so venue becomes Soho; edit does not reload full historical DB. Server may update aggregates, but browser's localStatsDbCache is not replaced. | H:863–870,1068–1070. Confirmed client behavior. |
| B07 / high | **>=2 roster selection is inconsistent with fixed two-player scorer.** Extra participants can appear in totals/share and initial-breaker options yet cannot win via cards; no pairing/rotation controls. A third-player breaker can be replaced during refresh. | H:1680,975–1001,1391–1395,1846–1847,1882–1885. Confirmed client mismatch; intended multiplayer rules unknown. |
| B08 / medium | **New player pills cannot be toggled off.** Creation omits onclick assignment that existing pills receive. Duplicate names/case variants are not checked; names key score maps, so duplicate entries can conflate identities. | Compare H:936–944 with H:960–972; H:1689. Confirmed omission; downstream data damage server-dependent. |
| B09 / medium | **Initial breaker choice resets while editing lineup.** Rebuilding dropdown discards selection. “First selected” means first selected pill in DOM order. Live refresh may retain a previously valid currentBreaker rather than newly selected setup value until match start. | H:950–958,1391–1395,1679–1683. Confirmed source behavior. |
| B10 / high | **Special-event contradictions not validated.** Super Foul can be submitted without offender, or winner manually changed back to offender. Golden Break/Break & Run can be paired with break-pot NO or a nonbreaker winner. Switching event away does not clear forced pot true. Pocket is optional None. | H:975–1016,885–897,1849–1892. Confirmed client checks absent; server enforcement unknown. |
| B11 / medium | **Abandon/new-session lifecycle leaves inputs and timer residue.** Delete resets major session arrays but not selected winner/offender, foul DOM counts, pocket, special, break-pot or all timing variables, and does not clear interval. New-match creation also does not comprehensively reset those controls. Risk of stale input after abandon/failure; callback's inactive guard limits ticking but interval remains. | H:1585–1596,1672–1705 versus reset after successful log H:1901–1925. Conditional stale-state risk. |
| B12 / medium | **Finalize failure leaves timer/active flags stopped.** Client stops before server acknowledgment; catch only alerts. Empty-session finalization has no local validation and no confirmation. Actual acceptance is server-dependent. | H:1939–1965. Confirmed failure behavior. |
| B13 / high | **Draw handling conflicts across features.** Global standings treats every participant as D if multiple winners; H2H recent winner chooses P1 first; comeback/decider logic treats membership in tied winners as a win. Three-player nonwinning participants could also be labeled D. | H:2245–2247 versus H:1192,1980–2007. Confirmed inconsistency. |
| B14 / medium | **“Hill-hill” is not detected as a deciding frame.** Final margin<=1 and >1 total frames includes ties and does not verify tied score before last frame. | H:2004–2007,2114–2117. Confirmed eligibility/label mismatch. |
| B15 / medium | **Comeback multi-player calculation picks one opponent**, while H2H totals may include all frames from sessions containing both names. No exact-pair restriction. | H:1979–1987,1188–1206. Confirmed algorithm; impact conditional on >2-player data. |
| B16 / medium | **Season filter does not scope break/pace data** and uniqueSeasons dropdown populates only once. A later DB refresh introducing a season does not rebuild existing season options. All-Time must already be supplied. | H:2055–2060,2169–2174,2211–2215. Confirmed client limitation; aggregate origin unknown. |
| B17 / medium | **Recent form / margin chronology depends on server order.** Standings slice last five without sorting; margin uses inherited order; records on equal best keep first encountered. History/progression use separate sorts. | H:2239–2247,2298,2342–2343,1997,2033,2251,2357. Ordering risk, not proof response is incorrectly ordered. |
| B18 / medium | **Empty-season early return can leave stale history.** When no filtered matches, global standings/graphs updated but function returns before history containers are cleared at H:2255–2256. | H:2233–2236 versus H:2251–2256. Confirmed path. |
| B19 / high | **Probability prior constants presented as empirical history.** 55% hold and 65% foul-loss fallbacks can be narrated as career/historical observations; 25% recovery prior feeds model without matching deficit history. No calibration or defined predicted outcome. | H:1161–1162,1179,1221–1224,1250–1257,1497–1541. Confirmed presentation/model limitation. |
| B20 / medium | **Unbounded break-logit inputs** at rate 0 or 1 produce infinities; final 5–95 display clamp hides extremity but is not uncertainty estimation. Invalid aggregates can yield NaN. | H:1223–1224,1515–1520,1538–1541. Conditional numerical risk. |
| B21 / medium | **Recovery pill never updates** from hard-coded 50%, while narrative does. Live metric pills update only when eligible and are not hidden/reset when switching to a player with insufficient data, so stale metrics can persist. | H:331,1498–1501; H:1397–1423. Confirmed missing reset/update paths. |
| B22 / medium | **Steal-tip claim says dry breaks without supporting filter.** Other stats and prose use nonuniform foul/scratch terms and “2 FOULS” remains fixed at counts>2. No third-foul rule is implemented. | H:1348,2199–2200,443–451,1049–1054. Confirmed wording mismatch. |
| B23 / medium | **Pace zero denominator not guarded; unknowns become zero.** Avg win time can be NaN/Infinity if winCount=0. Pocket 0% with no tracked pockets, absent scratches=0, and duration zero=unknown blur missingness. | H:2214–2215,2397–2400,2361–2362,1459,1614. Conditional numerical/data interpretation risk. |
| B24 / high | **Unescaped values inserted into HTML/inline handlers.** Player names, venue, dates, IDs and other returned strings interpolated via innerHTML; IDs also enter onclick strings. User-entered names are initially innerText but later reused in templates. Escaping/sanitization is absent here; backend guarantees unknown. | H:969,1077–1080,1265–1273,1460–1469,1619–1630,2264–2288. Conditional injection risk; no exploit attempted. |
| B25 / high | **No client auth/ownership/revision/idempotency contract.** Concurrent tabs/users can send writes to same match without a client revision. Wrapper and all payloads lack these controls; backend protections cannot be judged. | H:680–694; API table §9.2. Confirmed client absence, not proof endpoint permits unauthorized writes. |
| B26 / high | **No durable drafts, outbox, retries or actual registered offline workflow in supplied source.** Network gates frame start/save; unsaved fields lost on reload; API requests have no timeout. | H:680–694,696–716,1088–1108,1844–1936,2495–2530; S:1–18. Confirmed source limitation. |
| B27 / medium | **Dense controls and repeated blocking steps.** Start Match → Start Frame → winner/metadata selection → Confirm → network refresh → celebration Continue → Start next frame. Dense Insights above inputs and nested scroll areas add reach/navigation cost. | DOM H:239–241,250–344,339,381–388,572–574; callbacks H:1927–1932; Continue H:143–145. UX assessment from source, not usability study. |
| B28 / medium | **Keyboard/accessibility limitations.** Zoom disabled; clickable divs for timer, player cards, tips, drawer and history lack keyboard semantics; pocket buttons lack names; many controls remove focus outlines, use ~28px targets; modals lack dialog/focus-trap/Escape handling; no reduced-motion branch. | H:6,30,49–59,73–77,250,354,407,433,449–451,461,542–547,2265,2282. Confirmed markup/CSS limitations; no conformance audit performed. |
| B29 / low | **Clipboard reports success unconditionally** with deprecated-style execCommand; missing winners array/empty winners can produce an error or undefined result string. | H:1809,1832–1841. Conditional data/browser failures. |
| B30 / medium | **PWA source incomplete and cache update fragile.** No registration in supplied HTML, fixed cache name, omitted external/local dependencies, no activation cleanup, root deployment assumptions. | H:13–17,674–2531; M:4,11; S:1–18. See §8; installation not tested. |
| B31 / low | **Duplicated logic and coupled state.** Two copied player-card trees; percentages repeated in live pills, tips, H2H and leaderboard; pocket sums and deficit traversal duplicated; separate winner/history/score/detail representations and DOM state can diverge. Internal frame-total variables unused. | H:407–512,1214–1224,1337–1348,1412–1422,2172–2174,1136–1158,1979–1993,1294–1302,2392–2408,696–716,1183–1198. Maintainability assessment. |

## 12. Feature parity checklist and current prototype gaps

**Classification proposal:** E = essential existing functional intent to preserve; V = existing value-added capability to retain in the parity backlog, with priority/semantics reviewed; N = optional new enhancement, not verified legacy capability. A checkmark means confirmed in original client source, **not implemented in React**. Backend-dependent behavior must be verified before claiming end-to-end parity.

React comparison is read-only: R:`src/features/scoring/Setup.tsx` (`Setup`), `useDemoMatch.ts` (`DemoMatch`, `demoReducer`), `LiveScoring.tsx` (`LiveScoring`), `src/features/matches/Recap.tsx` (`Recap`), `src/features/players/Profile.tsx` (`Profile`), `src/features/insights/Insights.tsx` (`Insights`), `src/data/fixtures.ts`, and `src/app/App.tsx`. Supporting prototype limitations are already described in R:`docs/PROTOTYPE_NOTES.md` (“Local behavior”) and R:`README.md` (“Boundaries and placeholders”).

| Existing functionality | Legacy | Tier | Current React prototype | Original citation |
| --- | --- | --- | --- | --- |
| Open-ended match night / explicit finalization | ✓ | E | **Missing model**: target-capped race match instead. | H:364–389,1939–1965 |
| Existing/custom venue and new roster profile | ✓ | E | Fixed fictional choices only; no create-player/custom-venue flow. | H:878–883,927–973,2499–2509 |
| Select lineup / initialize scores | ✓, >2 support inconsistent | E, clarify >2 | Two fixed slots; no roster-night workflow. Do not silently promise rotation. | H:1678–1693,975–1001 |
| Select initial breaker | ✓ | E | Missing. | H:231–235,950–958,1682–1693 |
| Between-frame gate and explicitly start frame | ✓ | E | Missing; award happens directly. | H:364–389,1088–1108 |
| Frame-specific stopwatch/pause/resume | ✓, timing defects | E | Match-wide illustrative timer only; no duration per logged frame. | H:747–793,1061–1066,1871–1892 |
| Winner selection then metadata confirmation | ✓ | E | Immediate award only; no full frame confirmation flow. | H:975–992,1844–1892 |
| Per-player foul increment/decrement and past/active/total | ✓ | E | Missing. | H:1040–1059,1430–1450 |
| Current breaker and manual switch / next server breaker | ✓ / server-dependent policy | E | Missing. Automatic policy needs Apps Script discovery. | H:1018–1038,1654,1925 |
| Potted-on-break Boolean | ✓ | E | Missing. | H:885–897,1891 |
| Six-pocket black-ball selection | ✓ | E | Missing. | H:534–549,1641–1645,1887 |
| None / Golden Break / Break & Run / Dry Clearance / Super Foul | ✓ | E | Missing. | H:553–568,1003–1016,1888 |
| Super Foul offender / auto-opponent winner intent | ✓, validation incomplete | E | Missing. | H:994–1016,1890 |
| Full frame journal / running score / individual duration | ✓ via response | E | Side-only frame/Undo journal, no legacy metadata/running-score record per frame. | H:1458–1469,1613–1628 |
| Correct earlier logged frame's winner and fouls | ✓ active-session only | E | Missing; newest-frame Undo does not replace this. | H:796–875 |
| Confirm abandonment / active-session deletion | ✓ client request | E | New-demo replacement only; no analogous abandon lifecycle. | H:1585–1596 |
| Load real historical results, result-only fallback, resume active session | ✓ client contracts | E | Static fixture history; in-memory navigation resume only, refresh resets. | H:1599–1670,2495–2530 |
| Save/load backend integration | ✓ client API, server missing | E intent, not permission to connect | None, intentionally. Future replacement need not use GAS but must preserve semantics. | H:680–694; §9.2 |
| Final recap text and manual clipboard sharing | ✓ | E | Partial: fictional text share exists; no real finalized-night summary. | H:1807–1842,1946–1958 |
| Season / All-Time filter and roster rivalry selection | ✓ server season definitions | E | No season/roster equivalent; only fixture period/opponent filters. | H:2055–2074,2333–2340 |
| Overall standings: wins, frame wins, average/night, last-five form, rank | ✓ | E | Missing global standings; one fictional player profile is not equivalent. | H:2238–2248,2292–2319 |
| Frame-level rivalry cumulative progression | ✓ | E | No across-night progression; one sample recap sequence only. | H:2357–2373,2418–2432 |
| Margin of victory chart | ✓ | E | Missing. | H:2342–2343,2434–2448 |
| Finish-type breakdown | ✓ aggregate consumption | E | Missing. | H:2376–2390,2450–2470 |
| Scratch timeline | ✓ aggregate consumption | E | Missing. | H:2360–2362,2472–2493 |
| Pocket distribution | ✓ aggregate consumption | E | Missing. | H:2392–2408 |
| Break pot, hold, receiving steal metrics | ✓ aggregate consumption | E | Missing. | H:2167–2207 |
| Pace: average winning duration, Blitz/Marathon totals, active play time | ✓ aggregate consumption | E | Missing. | H:2209–2231,2262,2280 |
| Biggest 3+ comeback / trailing wins / deciders | ✓, semantics flawed | V | Single sample comeback only; no original record calculations. Preserve inquiry, review definitions. | H:1968–2013,2078–2138 |
| Longest single-night frame streak / live streak | ✓ | V | Profile shows a fixture match-win streak, a different measure. | H:1110–1118,2015–2045,2143–2165 |
| Celebration event/speed/foul/streak highlights | ✓ | V | Styled recap only, no equivalent frame highlights. | H:1707–1805 |
| Live H2H frame rate / historical deficit recovery / common pocket hints | ✓ | V | Missing. | H:1121–1225,1278–1331 |
| Live Hold/Steal/Pot pills and revealable tips | ✓ | V | Missing. Review placement and claims; preserve data access. | H:1333–1365,1397–1423 |
| Heuristic probability + factor narrative | ✓, uncalibrated | V, explicit approval before reuse | Missing. Do not recreate misleading “Gemini” or confidence claims by default. | H:1228–1276,1503–1555 |
| PWA install declarations / shell caching intent | ✓ declarations; activation unverified | E intent | Missing service worker/install behavior; offline selector is visual only. | M:1–17; S:1–18; H:8–17 |

### Optional enhancements, not verified legacy features

- **N:** real multi-participant rotation with per-frame pair selection; must clarify original user intent because only lineup enumeration is supported consistently in supplied source (H:1680 versus H:1846–1885).
- **N:** durable offline drafts/outbox, secure multi-user ownership, conflict resolution, idempotent writes and audit-preserving amendments. These address gaps in H:680–716,857–862,1879–1892; no legacy implementation is established.
- **N:** complete frame-metadata editing, historical amendments/deletion with permissions and recovery. Existing modal only covers winner/fouls for active session (H:73–111,857–862; history H:1599–1639).
- **N:** share images/public links, user-selected achievements, dedicated player profiles, additional race formats, ratings, shot/visit logging or predictive models with validation. None is established by the complete original UI and action inventory (§§2,9). Existing plain-text sharing, template badges and break metadata must not be mistaken for these features.

Essential means required to account for existing capabilities in a parity specification, not a directive to implement everything immediately or copy bugs. V features remain explicitly listed even if redesigned, deferred or removed by later owner decision.

## 13. Proposed improved information architecture — retain capabilities first

**Proposal only; no screens/code redesigned in this audit.** Start from the actual session/frame model. Keep data capture at the table; place historical exploration and optional narratives in discoverable dedicated destinations. The table maps each proposal to retained original capabilities, rather than introducing another unsupported scoring model.

| Destination / child workflow | Retained functionality and suggested organization | Original capability anchors |
| --- | --- | --- |
| **Play / Session** | Resume known active night or create a new one. Setup includes existing/custom venue, player roster/new names and initial breaker. Explicitly resolve >2-player semantics before exposing it as supported rotation. Do not require race target for the legacy session format. | H:212–243,1647–1705,2495–2514 |
| **Between frames** | Tonight's standings, next frame number/breaker, Start Frame, timeline and corrections, Finalize Night; move destructive Abandon behind a clearly labeled secondary action. | H:364–389,1061–1108,1452–1470 |
| **Active frame** | Dominant two players/score, frame stopwatch and pause, foul controls; readable current breaker and break-pot toggle. A short frame-completion sheet collects winner, pocket, special event and offender before logging. Preserve all capture fields; minimize repeated choices with explicit rules after discovery. | H:350–574,975–1059,1844–1892 |
| **Session timeline / correction** | Accessible from both gate and active scorer without destroying the current draft. Show frame number, winner, running score, duration, fouls, breaker, break-pot, pocket and event when available. Preserve winner/foul editing; broader editing is separately approved enhancement. | H:796–875,1458–1469,1599–1639; additional capture H:1879–1892 |
| **History** | Season/All-Time + venue/participant filtering where data supports it; latest and all match nights; result-only records clearly distinguished. Detail exposes frame scorecard and total active time. Finalized-night recap and manual sharing live here as well as at completion. New filters beyond season/roster need separate approval. | H:1807–1842,2055–2074,2251–2289 |
| **Standings & Records** | Season-scoped global rank, match wins, frame wins, average/night, form; tabs/sections for biggest comeback, trailing wins, deciders and longest nightly frame run. Preserve inquiries while fixing eligibility and tie definitions explicitly. | H:1968–2165,2238–2248,2292–2319 |
| **Insights / Rivalries** | Select roster + season once. Offer Progression, Margin, Finish types, Fouls, Pockets. Place Break/Receiving and Pace summaries here with honest scope and eligible sample counts, also reachable from player context. | H:2167–2231,2325–2493 |
| **Optional live context drawer** | Retain access to H2H frame record, break stats, foul index, deficit history, current streak and historical pocket tendency. Keep template tips optional. Probability modeling requires a separate decision about target, priors, validation and labeling. | H:250–344,1110–1583 |

Suggested mobile top-level destinations: **Play, History, Standings, Insights**. Player-specific views can be filters/drill-downs first; a standalone player-profile feature should not displace missing scoring/leaderboard functionality. This is an organizational proposal based on legacy panels H:205–669 and data access in H:2048–2493, not a change to the app.

Cross-cutting requirement proposal: retain the new project's reliability/accessibility intentions while completing the parity specification. Correct pause arithmetic, save-failure reconciliation, safe special-event validation and historical uncertainty before polishing more storytelling. Each proposed change must distinguish intended legacy rules from defects (section 11).

## 14. What cannot yet be verified and approval gate

The next discovery inputs needed are **copies**, not live access:

1. Apps Script source for `getLeaderboard`, `startNewMatch`, `startFrameTimer`, `logIndividualFrame`, `editLoggedFrame`, `deleteActiveMatch`, `closeMatchSession`. This is necessary to verify write semantics, automatic breaker policy, active-session ownership and error/idempotency handling. Source of requirement: complete client call table §9.2.
2. Workbook schema and an authorized export, including old result-only records and newer frame records. Required to verify date/season/time-zone rules, score/winner construction, raw-frame ordering, blank/zero tracking and aggregate coverage. Source of requirement: consumed DB contracts in §6.4 and unresolved inputs to §7.
3. Owner decisions on >2-player nights, meaning of ordinary foul versus scratch/Super Foul, legal event combinations, breaker rotation, what counts as a decider, whether ties count toward comebacks, and which model-derived live claims should remain. Source of requirement: contradictions B07, B10, B13–B15, B19–B22.

No claim of complete backend parity is justified from this folder alone. **Approve the functional inventory and resolve these uncertainties before React changes resume.** The implementation priorities should be session/frame parity and data integrity, then historical analytics, with presentation supporting those workflows.

## 15. Read-only verification record

Original source SHA-256 snapshot (content hashes only; no endpoint or credentials reproduced):

| File | SHA-256 |
| --- | --- |
| `index.html` | `992969c9709e2332d6d28336add3d7005978723b4a8d31d603061d405b82b0cb` |
| `manifest.json` | `cc0a1d086aa8515fc62863222fde2657d4a9d04d66beddc4a494ab924575c9ce` |
| `sw.js` | `3a5751891e53787ffecf0cec125a7aefc77666013462d83b35cc124281bb9626` |
| `icon.png` | `b52f6f55174dc52ef428bee03596a8e27fbd7353abd3682e6466a7363f1d0725` |
| `pool-cue.png` | `563d67de9acb290edbab3bf4c8b88ab0314e6f4cb6c1349d41ccdf0fbb567242` |

Only this audit document was written. No runtime or production tests were run; build/lint were unnecessary for the documentation-only audit. Original file content hashes were checked again after writing the audit.
