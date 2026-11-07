# Pule 2.0 product and engineering plan

Status: technical architecture approved in principle; expanded experience vision proposed for review. Prepared 3 November 2026. Implementation is not yet authorized.

## 1. Scope and evidence

Build a premium, mobile-first pool scoring and analytics PWA. The first release should make recording a match fast, understandable, recoverable, and trustworthy. Preserve essential scoring rules and historical records while developing a new interface and architecture.

This plan is based on inspecting the local project, not the predecessor. The predecessor HTML, Google Apps Script, and historical workbook have not been supplied or inspected. No scoring format, formula, historical field, or data quality claim is verified. Examples involving frames, racks, players, or teams are provisional vocabulary, not specifications.

Only this document is being added. No application code, dependencies, remote resources, live application, or historical data are changed. Implementation begins after approval; resource creation and deployment require their own authorized scope.

### Current project

| Area | Observed state |
| --- | --- |
| Entry points | `index.html` mounts `src/main.tsx`; React StrictMode renders `src/App.tsx`. |
| UI | Vite starter with a counter, framework artwork, links, and template CSS in `src/index.css` and `src/App.css`. No pool functionality. |
| Runtime dependencies | Manifest declares `react` and `react-dom` at `^19.3.1`. |
| Build tooling | Manifest declares Vite `^8.3.5`, TypeScript `~5.9.3`, React Vite plugin `^6.1.2`, ESLint `^10.13.0`, TypeScript ESLint, React Hooks/Refresh lint plugins, and type packages. These are declared ranges, not an independently verified installed-version inventory. |
| Scripts | `dev`, `build` (`tsc -b && vite build`), `lint`, `preview`. No test script. |
| Type checking | Application config enables unused-code and switch fallthrough checks; `strict` is absent. Recommend enabling it during foundation work. |
| Planned tools absent | No direct Tailwind, ApexCharts, Supabase, routing, test, or PWA dependency/configuration. |
| Assets/docs | Template assets in `src/assets` and `public`; template README. No existing product documentation or repository guidance found. |
| Version control | `git status` reports that this directory is not a Git repository. Establish version control before implementation. |

No build or runtime validation was needed for this documentation-only inspection. Existing dependency compatibility remains to be verified during foundation work.

## 2. Product priorities and release boundary

Priority order: correct scoring → fast input and correction → durable drafts → secure synchronization → trustworthy history → useful analytics.

Initial release: the confirmed primary match format, player selection, live scoring, undo/correction, interrupted-match recovery, explicit completion, authenticated storage, match history, and a small set of explainable statistics. A local prototype may precede authentication but should use synthetic data.

Defer tournaments, payments, chat, social feeds, elaborate rankings, predictive win probabilities, simultaneous collaborative scoring, and detailed shot entry unless discovery establishes them as essential. Do not add mandatory data entry solely to support a future chart.

## 3. Frontend architecture

Use a feature-oriented React/TypeScript application with a small shared component layer and a pure scoring domain. Add dependencies only when their feature is approved and needed; proposed package choices are not installations.

```text
src/
  app/                     # Router, providers, app shell, error boundaries
  features/
    scoring/               # Setup, live match, correction, completion
      components/
      hooks/
      domain/              # Rules, commands, reducer, invariants, selectors
    matches/               # History and match detail
    players/               # Directory and profile
    insights/              # Metric definitions and presentation
    auth/                  # Sign-in, session handling, access states
    settings/              # Preferences, membership, recovery controls
  components/ui/           # Accessible reusable primitives
  data/
    local/                 # IndexedDB drafts, migrations, transactional outbox
    remote/                # Supabase adapters and generated database types
    sync/                  # Retry, acknowledgments, conflict handling
    contracts/             # Validated transport/storage shapes
  styles/                  # Semantic design tokens and Tailwind entry
  test/                    # Shared fixtures and test utilities
docs/                      # Rules, product decisions, metric definitions
```

Keep feature-specific components inside their feature. Route components coordinate workflows; domain functions know nothing about React, IndexedDB, or Supabase. Data adapters implement narrow interfaces so scoring can run against local fixtures before a backend exists. Avoid a universal repository framework or global state store without demonstrated need.

### State and dependencies

- Use component state for temporary presentation, forms, filters, and dialogs. Keep live match transitions in a typed reducer with explicit commands and validated preconditions.
- Treat the persisted event journal as the canonical record for new matches, with a derived score projection. Include a rule version, event schema version, stable IDs, and replay tests. Imported result-only matches use a separate documented representation; never invent missing events.
- Use a router for URL-based screens and refresh/deep-link recovery. Prefer a dedicated server-query cache once remote history and profiles arrive; it must not become the offline scoring journal.
- Use Tailwind with semantic CSS variables rather than scattered color values. Start with semantic HTML and accessible controls; adopt a small accessible primitive library only if complex dialogs/selectors justify it.
- Use a lightweight IndexedDB adapter and explicit schema migrations for durable drafts. Runtime-validate stored/imported/network data; TypeScript types alone do not validate it.
- Lazy-load analytics and chart code. Use ApexCharts only for questions better answered visually, after reviewing its applicable license and bundle impact. Its license options require review for the intended use: [official licensing](https://apexcharts.com/license/).
- Introduce unit tests for rules and sync behavior, component tests for scoring interaction, and browser tests for recovery and critical journeys. Choose exact tools/versions during foundation work, checking compatibility then.

### Scoring and integrity model

Proposed lifecycle: `draft → in progress → completed locally → synchronized/finalized`; abandoned drafts remain recoverable until explicitly discarded. Lifecycle and synchronization are separate state fields. A locally completed offline match must never appear server-confirmed.

Each command yields a typed event with client-generated operation ID, match ID, rule version, actor, and expected server revision where applicable. Validate transitions, derive totals, and persist the event plus outbox operation in one local transaction. Give immediate pressed feedback; show “Saved on this device” only after that transaction succeeds. If saving fails, show a persistent failure and stop accepting further scoring until recovery is understood.

Undo and correction must preserve an audit trail. Undo creates a compensating operation rather than silently deleting accepted history. Offer a persistent event timeline so recovery does not depend on a disappearing toast. Completion validates the match and shows a review step; later amendments require explicit permission and a recorded reason.

Proposed first-release model: one active scorer per match, spectators read-only. Use local multi-tab coordination and server revision checks. No silent last-write-wins merges. If two devices score offline, preserve both journals, stop automatic submission on conflict, and offer review or recovery export. A scorer lock alone cannot prevent offline divergence.

### Offline and synchronization

- Persist every accepted action locally; resume from storage after refresh, browser termination, or app restart. Partition local data by user/workspace and retain IDs through retries.
- Outbox states: pending, sending, acknowledged, retryable failure, auth required, conflict. Use bounded backoff and explicit retry; remove pending status only after server acknowledgment.
- Server writes must validate membership, scorer permissions, rule invariants, and expected revision transactionally. Enforce operation ID uniqueness so replaying an acknowledged request cannot duplicate a result. Finalization should atomically accept the validated result and revision.
- Sync on app open, foreground return, reconnect, and explicit retry. Background Sync is an optional enhancement; baseline correctness must not depend on it. See [MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API).
- Cache the application shell and versioned static assets with a service worker. Keep authenticated API responses out of generic shared caches. Explain that a first-ever visit needs connectivity; offline new-match setup requires cached players and rules.
- Surface “Saved on this device,” “Waiting to sync,” “Synced,” and actionable failure/conflict states. Connectivity alone is not proof of synchronization.
- Browser storage is not a backup: handle quota/write failure, request persistent storage where appropriate, and offer draft export/recovery. Test browser eviction behavior. A cloud backup exists only after acknowledgment.
- Defer application updates during a live match. Version and migrate local schemas with recovery paths; never automatically reload mid-score.
- If authentication expires offline, preserve the existing draft and queue, then require reauthentication before remote writes. Warn before sign-out with unsynced work; offer sync/export, then clear private caches on confirmed sign-out. Never submit one user's draft under another account.

### Backend boundaries proposed for later implementation

Provisional entities: profiles, workspaces, memberships, players, versioned rule sets, matches, participants, match events, and import batches/source mappings. A player is not necessarily an authenticated user. Confirm whether workspaces represent clubs, groups, or a single private community before fixing the schema.

Every tenant-owned row needs an explicit ownership path, foreign keys, appropriate constraints, and row-level security. Define viewer/scorer/admin capabilities and test cross-workspace reads and writes, role changes, membership revocation, nested queries, and functions. Client UI permissions are convenience, not enforcement. Aggregates and views must preserve the same isolation.

Use a browser publishable key with RLS; never place secret/service-role keys in the client bundle. Supabase documents that secret and service-role keys bypass RLS: [securing data](https://supabase.com/docs/guides/database/secure-data). Privileged imports and membership changes belong behind authenticated server-side authorization. Keep development, staging, and production separate, including preview environment variables.

Use reviewed database migrations, transactional write APIs, and server-side validation. Keep browser and server rule validation aligned with shared fixtures. Add backup/restore rehearsal and privacy-conscious error reporting before release; avoid player names or tokens in diagnostics.

## 4. Mobile-first navigation and screens

Use four labeled bottom destinations: **Play**, **Matches**, **Insights**, **Players**. Put account, workspace, preferences, and sync/recovery details behind the avatar/settings entry. Play is the default landing screen. On larger screens, adapt navigation to a compact rail and use extra space for timelines and comparisons.

| Screen / proposed route | Main job and structure |
| --- | --- |
| Play `/play` | Prominent Resume card when a draft exists, Start match action, recent players, concise sync status. Avoid a wall of statistics. |
| Setup `/play/new` | Select players, confirmed rule preset and target, then review/start. Reuse recent choices; explain rule settings. Do not require typing during normal repeated setup. |
| Live `/play/:draftId` | Player identities and score dominate; rule context and active participant remain visible. Large primary scoring controls, persistent Undo and timeline access, local-save/sync status, secondary finish/pause menu. Exact scoring controls await rule discovery. |
| Review | Result, participants, timeline, unresolved issues, explicit Complete action. Completing offline clearly says it is waiting to sync. |
| Matches `/matches` | Search/filter by participant, date, format and status; distinguish drafts, pending results, confirmed results, and imported records. |
| Match `/matches/:matchId` | Result, rule context, timeline where available, provenance and authorized amendment. Result-only imports explain absent detail. |
| Insights `/insights` | Answer a few selected questions; show period, eligible sample, limitations, and links to contributing matches. |
| Players `/players`, `/players/:playerId` | Quick search, identity, recent results, head-to-head and supported statistics. Separate aliases from identity merges. |
| Settings `/settings` | Account, memberships, accessibility/preferences, draft recovery, sync diagnostics, app version, sign-out. |

The live scorer uses a focused shell, replacing the bottom navigation with persistent scoring actions. Leaving the screen preserves the draft; route return resumes it. Browser Back must not discard a match. Explicit discard requires confirmation. Reaching a winning condition leads to review rather than an irreversible automatic submission.

Design for narrow 320–430px layouts, safe-area insets, long names, text zoom, keyboard appearance, and landscape. At wider sizes, keep primary controls within comfortable reach and use a second column for optional context. Do not require horizontal scrolling to score.

## 5. Initial design system

### Visual direction

An understated sports instrument: deep ink surfaces, felt-inspired green, warm white typography, strong numeric hierarchy, precise separators, and restrained motion. Use whitespace and scale to create quality. Avoid decorative gradients, dense dashboard card grids, and charts on the live scorer. Prototype a dark scoring theme first and a high-contrast light alternative for bright venues; validate both before release.

### Tokens

| Token group | Starting recommendation |
| --- | --- |
| Typography | System sans initially; optionally evaluate a self-hosted licensed sans later. Tabular numerals for scores and tables. Body 16px/1.5; labels 14px/1.4; headings 24–32px; live score 64–96px responsive with accessible fallback at zoom. Weights 400/500/600/700. |
| Spacing | 4px base scale: 4, 8, 12, 16, 24, 32, 48. Mobile gutters 16px, wide gutters 24–32px. |
| Dark surfaces | Canvas `#0B1417`, surface `#142328`, raised `#1C3036`. |
| Text | Primary `#F4F7F5`, secondary `#B3C3BE`. |
| Actions | Green `#69E0A3` with ink text. Selected/active participant also uses a label or shape. |
| Feedback | Informational blue `#8CC8FF`, warning amber `#F2C66D`, destructive red `#FF9A9A`; pair each with text/icon. |
| Borders/focus | Decorative divider `#34494F`; interactive boundaries need separately verified contrast. Visible 3px blue focus ring with offset. |
| Shape | 12px controls, 16px panels, pills only for concise status/filter elements. Subtle elevation reserved for overlays. |
| Motion | 120–180ms feedback; respect reduced motion. Avoid score-counting animations that delay reading. |

These colors are candidate tokens, not a claim of audited contrast. Validate actual text/background pairs, disabled states, focus, and light equivalents against WCAG 2.2 AA targets: 4.5:1 normal text, 3:1 large text and essential non-text controls.

### Component and interaction contracts

- Buttons: primary, secondary, quiet, destructive; minimum 48px touch target, main live actions at least 64px high. At least 8px separation between adjacent actions. Labels name the scoring action explicitly after rules are confirmed.
- Scoreboard: stable player positions, large score, active participant marker, format/target context. Never swap physical button positions automatically after a score.
- Event row and timeline: human-readable action, participant, effect, correction state, and accessible edit action.
- Draft card and sync badge: distinguish local durability from server acknowledgment; critical states persist until resolved.
- Forms: persistent labels, inline validation, useful defaults, searchable player selection. No placeholder-only labels.
- Bottom sheets/dialogs: focus management, Escape/dismiss behavior, keyboard support and readable full-screen fallback on small devices. Use for occasional choices, not every normal score.
- Undo: always reachable, clear description of what will reverse, timeline correction for older actions. Optional haptics supplement visible feedback when supported.
- Input handling: one semantic action per activation; prevent accidental double submission while preserving intentional repeated actions. Validate behavior with the actual scoring model rather than applying a blanket debounce.
- Accessibility: semantic buttons, keyboard operation, named icon controls, polite score announcements, reduced motion, readable error messages, and no color-only status. Touch gestures are optional shortcuts with visible alternatives.
- Shared states: intentional empty, loading, offline, no-access, error, conflict, and recovery presentations. Never show an empty history while silently failing to load it.

## 6. Experience Design and Product Differentiation

### Product idea: the table, the contest, the story

Pule should feel like a companion to a night at the table: calm and decisive during play, competitive and reflective afterward. Its distinctive promise is continuity between the next match and the history that gives that match meaning. A familiar opponent, a closely balanced series, or a verified personal milestone can make opening Pule worthwhile without adding work during play.

The product has two complementary rhythms. **At the table**, information stays stable and scoring takes priority. **Between matches**, the same results become an editorial account of rivalries and progress, with evidence one tap away. There is no engagement feed competing with an active match, no artificial urgency, and no reward for recording more detail than players want to provide.

All concepts below are proposals. Required data describes future capture contracts, not fields known to exist in the unavailable predecessor or workbook. Vocabulary and scoring controls must follow discovery. Never infer shot accuracy, safety quality, break quality, positional play, or pressure-handling ability from match results or a score sequence.

### A visual identity rooted in pool

- **Table geometry:** use the long rectangle of a table as a compositional cue, generous dark margins like rails, fine inset rules, and a single green playing plane for the central score. These are layout motifs, not a literal table illustration or a ball-based control scheme.
- **Light and material:** deep petrol/ink, desaturated felt green, chalk white, and a restrained brass accent for verified milestones. Reserve subtle felt texture and overhead-light effects for Home, recap artwork, and share cards; keep scoring surfaces flat and exceptionally readable. Any texture must remain decorative and optional under contrast preferences.
- **Typography:** pair a compact, assertive display treatment for names/headlines with the existing readable body sans and tabular score numerals. Prototype a system-font treatment first; evaluate a licensed display face later. Use uppercase sparingly for small competition labels, never for long instructions.
- **Ownable signature:** a fine paired line framing a large score, a small chronological result ribbon, and a consistent Pule wordmark placement can connect the live board, recap, and exported result. Do not assume a final logo exists; test wordmark directions in the visual milestone.
- **Player identity:** stable initials or optional portraits, names, and labeled markers distinguish sides. Avoid relying on red/green, pool-ball colors, or automatic position swaps to identify players.
- **Motion and sound:** short, precise feedback while scoring; a restrained result reveal only after completion. Optional haptics or sound must be user-controlled and supplementary. Celebrate an earned result without delaying review, correction, or the next match.

Extend the candidate tokens in section 5 with a provisional brass accent `#D9B66F` for milestone decoration; it is not a new primary action color. Validate all actual contrast pairs. The visual system should remain recognizable in a bright, high-contrast light theme through geometry, typography, and hierarchy rather than depending on dark surfaces alone.

### Six mobile-first screen concepts

#### Play / Home — an invitation back to the table

**Hierarchy:** a compact Pule header and account control; one dominant Resume or Start match panel; then a small “Your last match” result strip and at most one optional rivalry/progress story. Place the primary action comfortably within thumb reach. A draft takes precedence over every story, with participants, recorded score, last local save, and honest sync status.

**Interactions:** Resume opens the existing draft directly. A “Play again” action from a completed match prefills setup for a new match with a new ID; it never carries over score or silently starts. Recent players are shortcuts, not a mandatory selection carousel. First-use Home offers Start match and explains draft recovery without an empty analytics dashboard.

**Data/state:** Resume needs a validated local draft and save/sync metadata; recent-player shortcuts need permitted participation history or device preferences. Last result and rivalry modules require the result contracts in the feature matrix below. With no eligible data, omit stories and show useful setup guidance. Pending results remain visibly provisional and do not advance verified records.

#### Match Setup — make the next contest obvious

**Hierarchy:** “Who’s playing?” with two stable participant slots if the confirmed format is singles; a searchable recent-player picker; a compact, readable rule summary; one Start match action. Adapt participant layout after discovering teams/doubles requirements rather than assuming every match has two people.

**Interactions:** selecting a participant fills that slot and advances focus; avoid duplicate selection where rules prohibit it. Keep all required choices on one screen when practical. Put rare rule adjustments behind “Change,” while always exposing the current preset, target, and handicap summary if applicable. Defaults come from explicit preferences or the previous compatible setup, remain visible, and are editable. Starting creates a durable new draft before navigating to live scoring.

**Data/state:** requires participant identities, confirmed rule definitions and required setup values. Offline setup uses cached eligible identities and rule versions; clearly explain unavailable choices. A repeat-opponent context line is optional and needs verified head-to-head results; it never blocks Start. New player creation and unknown rules need explicit resolution rather than guessed identities or defaults.

#### Live Scoring — a clear instrument under pressure

**Hierarchy:** a narrow match/rule context line; dominant player names and score; compact last-action description; large, stable scoring controls in the lower portion; persistent Undo and timeline access; a quiet but legible durability/sync indicator. Keep finish/pause in a secondary position away from the most frequent action.

**Interactions:** the exact primary control must reflect the actual recording unit. If input records a unit winner, prototype one labeled action per side. If input records points or visits, prototype the corresponding minimal entry pattern. These are alternative designs to test, not invented scoring rules. Record the action directly without an intervening confirmation; show its meaning immediately and keep Undo available. Put rare penalties/adjustments behind a labeled secondary action only if discovery requires them. Do not make a swipe, long press, or tiny icon the sole route to any required action.

**Data/state:** the board derives from the versioned event journal and confirmed rules. Only show an active participant, next breaker, or target progress if the rules and captured state determine it. Pending saves, write failures, offline status, and conflicts use the existing reliability contracts. A failed local save cannot look like an accepted score. End conditions open review; corrections remain accessible.

**Restraint:** no rivalry statistics, animated charts, achievement pop-ups, share prompts, or predictive win chances over the scoring controls. Longer names wrap or truncate with accessible full names without moving action positions. Test right- and left-handed reach, text enlargement, glare, and scoring while standing.

#### Match Recap — give the result a lasting shape

**Hierarchy:** participant names and final result in a distinctive score composition; a plain-language outcome; rule context and confirmation status; then one evidence-backed story, optional score progression, and clear “Play again” / “Share result” actions. Completion review remains a distinct step before the celebratory recap.

**Interactions:** every story opens the relevant timeline or contributing results. Offer correction through an explicit authorized amendment route. Sharing opens a preview with name/privacy controls; generating a card never publishes it. Locally completed matches can have a recap labeled provisional, but verified records and official share cards wait for server confirmation. An intentionally shared provisional card must visibly say it is provisional.

**Data/state:** basic recap needs a validated result, participants, rule version/context, and confirmation status. Comeback and lead-change stories require a complete eligible score sequence; historical result-only matches get a result recap without invented progression. Personal records and rivalry updates require comparison history and coverage definitions from the matrix. If evidence supports no special story, a strong result composition is enough.

#### Player Profile — a player's competitive identity

**Hierarchy:** name/optional portrait; concise verified record with scope and sample; recent result ribbon; selected rivals; then a small personal-record cabinet. Prefer a curated vertical narrative over a grid of disconnected totals. Clearly distinguish “your profile” from a player record someone else can view.

**Interactions:** tap any ribbon item to open its match; tap a rival to filter head-to-head history; tap a record to inspect the qualifying run or match. Let users choose which eligible milestones to feature. Identity edits and player merges require appropriate permissions and must not silently rewrite provenance.

**Data/state:** stable player identity is fundamental. Results ribbon, form, rivals, and records require their matrix contracts, including compatible formats and known coverage. Limited history shows “From recorded matches” rather than career claims. An unclaimed player profile must not imply that person has an account or has consented to public sharing. Visibility follows workspace permissions; there is no public profile by default.

#### Insights — answer one worthwhile question at a time

**Hierarchy:** a clear question such as “How have my results changed?”; participant, period, and format filters; one headline answer; supporting chart/table; sample, coverage, freshness and caveat immediately adjacent; then a link to contributing matches. Offer a few question tabs instead of a customizable dashboard at launch.

**Interactions:** make changing the period or opponent easy and reversible. Carry filters into the supporting match list and preserve them on Back. Show counts as well as percentages. A chart selection can reveal a match or period summary but cannot be the only access path. Avoid chart gestures that interfere with normal page scrolling.

**Data/state:** result trends and head-to-head use the contracts below; consistency requires an explicitly defined, comparable per-match measure. Where compatible data is missing, explain which capture would be required without inviting users to reconstruct shots. Small samples retain visible counts and restrained descriptions. Never turn “won three recently” into “your technique improved.”

### Engagement features and explicit evidence contracts

The names below are product concepts, not promises about existing data. Verified stories exclude drafts, abandoned matches, and unconfirmed results. Corrections must recompute affected stories and records; they are derived views, not independent facts. Every aggregate includes eligible count, scope, format, period, and historical coverage. If required inputs are absent, omit the claim or explain its unavailability.

| Feature / proposed tier | Experience | Required underlying data | Limits and missing-data behavior |
| --- | --- | --- | --- |
| Recent results and basic record — launch | Result ribbon and a concise wins/losses summary, each opening a match | Stable participant IDs, confirmed outcomes, match occurrence ordering/date, compatible rule/format identity, void/amendment status, and authorized visibility | Show ties only if confirmed rules support them; exclude unresolved results. Never infer chronology from import order. Date-only ties cannot establish a precise sequence. |
| Rivalry series — near term | An opponent page with series score, last meeting and optional “series level” context before a rematch | Stable identities, confirmed pairwise participation/outcomes, match dates/order, comparable formats, source coverage; explicit grouping rules for teams | Mutual match counts describe recorded history, not personal sentiment. Suggest opponents by transparent repeat-play criteria and allow dismissal. No claim of dominance or psychological advantage from a small sample. |
| Comeback story — near term, conditional on event capture | “Recovered from [recorded deficit] to win,” linked to progression | Complete ordered score-changing events, initial state, correction-aware replay, valid scoring semantics, final confirmed outcome and participant mapping | Define a comeback for each supported format. A final score alone cannot prove one. Do not call it clutch play, pressure resistance, or shot quality. Do not claim a largest comeback across incomplete event history. |
| Score progression and lead changes — near term, conditional on event capture | A simple chronological score strip with supported lead-change annotations | Same complete event/replay contract as comeback stories; rule-specific definition of a lead and ties | This shows the score, not momentum or win probability. Event order does not establish elapsed time; no time-scaled graph without reliable event timing. Unsupported formats use a timeline without lead claims. |
| Personal records — near term | Best verified winning streak, most matches in a defined period, or largest eligible comeback | For streaks: complete known ordered outcomes within the declared scope and inclusion policy, with tie rules. For activity: deduplicated confirmed participation and occurrence dates/time zone. For comeback: complete eligible event sequences as above | Label “Best in recorded history” with coverage and format. Unknown intervening results/order break verification. Avoid largest winning margin across unequal targets/handicaps. Activity is participation, not skill. |
| Form trends — launch basic; near term comparisons | Last N eligible results, optionally compared with a preceding non-overlapping window | Confirmed comparable outcomes, reliable ordering, declared N/window and tie policy, dates for time windows, opponent identities and sample counts | Show actual counts and available N. Do not frame a changed win rate as improved ability; opponent mix and missing history matter. Use uncertainty presentation from section 7 for rate comparisons. |
| Meaningful achievements — near term | Optional understated milestones such as first confirmed match, a documented activity milestone, or a verified streak | Versioned achievement definitions, deduplicated confirmed results, participant identity, scope/coverage; reliable order for first/streak claims and dates for period claims | “First recorded match” is not a player's first-ever match. No accuracy, break, safety, or technique badges without explicit validated capture. Revoke/recompute when corrections invalidate a milestone. No daily attendance pressure or reward for inflated data entry. |
| Shareable result — near term | A branded result card with optional verified story and user-selected names | Confirmed result, allowed display identities, rule context, match date if displayed, visibility permission and explicit user sharing choice; story-specific evidence if included | Default to minimal names, no venue/private identifiers, and no public link. Preview redaction. Exported images are snapshots and cannot be revoked; show generation/result revision context. Public URLs would need a separate access/privacy design. |
| Consistency insight — near term only after measure discovery | Distribution of a defined result-level measure with links to matches | An approved per-match measure actually captured, compatible rules/targets/handicaps or documented stratification, complete eligible values and sample count | Do not substitute score margin for shot consistency. If no meaningful comparable measure exists, defer the feature. |
| Season rivalry stories / editorial digest — experiment | An optional periodic summary of verified changes and notable meetings | All supporting feature contracts, explicit season boundaries, comparable coverage and user notification preferences if delivered | Every sentence must have a deterministic, inspectable source. Start with templates; no unsupported emotional or causal claims. In-app first; no messaging delivery implied. |
| Opponent-adjusted rating — experiment | A separately explained competitive estimate, only if it answers a real player need | Sufficient connected opponent/result history, stable identities, rule/handicap context, reliable ordering, a published model/version and validation dataset | No launch ranking promise; show uncertainty, cold-start limitations and model behavior. Ratings cannot reveal unrecorded shot-level strengths. |

### Fewer taps and decisions during play

Optimize the complete action path, not just button count. A one-tap ambiguous action can cost more than a clearly labeled two-step rare correction. Measure the following in the prototype using the confirmed input unit when available:

| Action | Proposed interaction budget | Safeguard |
| --- | --- | --- |
| Resume an existing draft | One tap from Home | Resume the exact saved match; expose save/sync state. |
| Repeat the previous setup | “Play again,” then Start after reviewing visible participants/rules | New match ID and zero carried score; changes remain available. |
| Record the common scoring unit | One deliberate activation where rules permit | Stable action locations, immediate feedback, persistent Undo; no per-action confirmation. |
| Reverse the latest action | One tap | Show what Undo reverses and preserve compensating history. |
| Correct an earlier event | Open timeline, choose event, make an explicit correction | Revalidate dependent state; do not silently rewrite downstream events. |
| Finish a match | Open/reach review, then explicit Complete | Validate result; no accidental submission from a scoring tap. |

Derive next state only where confirmed rules make it deterministic; never ask users to restate it. Keep rule selection and identity work in setup. Preserve keyboard-free common flows, remembered visible defaults, and reachable controls without mandatory scrolling. After each action, use a small “last recorded” line to reduce memory load. Keep infrequent actions available through one consistently labeled menu. Avoid mandatory note-taking, achievement acknowledgments, and post-score prompts.

Count taps, time, wrong-side entries, Undo use, and successful recovery during observed sessions. A reduction in taps is acceptable only if errors and uncertainty do not rise. Local persistence, idempotency, correction history, and conflict handling remain required regardless of interaction shortcuts.

### Release tiers

**Essential launch:** the recognizable visual foundation; Home/resume, setup, focused scoring, review and a strong basic recap; correction and recovery; secure history and a simple player profile; basic recent results and form counts where eligible data exists. All six screen concepts should be represented in the design prototype, but launch Insights can be a small set of honest summaries. No launch feature depends on discovering event-level history in the workbook.

**Valuable near-term enhancements:** rivalry pages, privacy-aware share cards, user-selected personal records, meaningful achievements, richer form comparisons, and conditional comeback/progression stories. Release each only after its evidence contract and correction behavior pass validation. Data sufficiency, not visual appeal, determines availability.

**Longer-term experiments:** season narratives, opponent-adjusted ratings, and optional low-friction structured event capture if players explicitly value it. Test demand and burden before expanding the scorer. Shot-level capture, public sharing, notifications, and competition formats would each need separate product/privacy decisions; none is implied by this plan.

### Visual prototype milestone — before backend implementation

Add **Phase 0V: experience prototype and review** after initial discovery begins and before application/backend implementation is approved. This request authorizes planning only: no prototype code, packages, hosted artifact, or backend resources are created now. A later approved milestone should produce a clickable design artifact in an agreed design medium, plus annotated screens and interaction specifications.

Deliverables: two visual identity studies, one selected direction expanded across all six screens, dark and bright-venue light treatments for scoring, a reusable component/token sheet, an annotated primary scoring flow, a privacy-aware share-card concept, and responsive narrow-phone/large-text examples. Use synthetic participants and unmistakably labeled fictional results throughout. Include empty history, limited sample, result-only import, offline draft, saving failure, conflict, and corrected-result states.

If predecessor materials remain unavailable, prototype alternative scoring controls and label them **unvalidated interaction hypotheses**. Visual approval can proceed; rule parity and final scoring interaction approval cannot. Do not build a synthetic rules engine merely to make a mockup appear realistic.

Review with the owner and, when available, a small representative group of players in standing/one-handed and bright/dim contexts. Ask participants to start a familiar match, record a sequence, correct a mistake, leave/resume, review an offline completion, inspect a rivalry's evidence, and prepare a redacted share preview. Record task time, taps, errors, comprehension and recovery. Treat small-group results as usability findings, not statistical proof.

Exit gates: choose a coherent identity; demonstrate clear score/participant recognition and persistent Undo; meet the provisional interaction budgets where confirmed rules allow; distinguish local save from cloud confirmation; ensure users understand sample/coverage and do not read score progression as shot quality. Document remaining issues and approve revised screen specifications before advancing. Static visual review does not prove persistence, RLS, accessibility conformance, or runtime performance; subsequent phases retain those engineering gates.

## 7. Analytics that earn trust

Begin with questions that require minimal confirmed data:

| Question | Proposed presentation | Caveat |
| --- | --- | --- |
| How have I performed recently? | Wins/losses and win rate by period, simple trend | Show completed eligible match count and format; exclude drafts/abandoned matches. |
| How do I fare against this opponent? | Head-to-head record and score distribution | State sample size; allow period and rules filters. |
| Am I playing more consistently? | Distribution of a confirmed per-match measure | Define the measure and comparable cohort first. |
| What should I improve? | Only metrics backed by captured events | Do not infer shot accuracy, break quality, or safety success from result-only records. |

Every metric needs a written numerator, denominator, eligible population, time zone/date policy, rule-version compatibility, missing-data handling, and example fixture. Show `n`, period, filters, coverage, and data freshness alongside the value. Use “not recorded” separately from zero. Split incompatible formats; disclose when historical data cannot contribute.

For win rates, consider a documented Wilson interval once appropriate; explain that the interval does not correct opponent selection bias or dependence between matches. Avoid precise predictive claims, significance claims, or rankings from tiny samples. Mark small samples with a configurable, documented threshold rather than presenting an arbitrary cutoff as statistical truth. All charts need an accessible text summary/table; chart tooltips cannot be the only way to access values.

## 8. Historical migration without touching the live system

1. Obtain authorized copies/exports of predecessor HTML, Apps Script, and workbook, including formulas, sheet schema, representative anonymized rows, and known edge cases. Do not access or alter the live system as part of planning.
2. Document the actual rules and calculation behavior. Separate essential rules from UI workarounds and suspected defects; resolve differences with the owner before coding.
3. Preserve an immutable source export, export date, checksum, source row identifiers, formula/value distinctions, and a field dictionary. Keep personal data out of public source control.
4. Profile duplicate names, aliases, missing IDs, invalid dates, time zones, incomplete matches, formula errors, and changed formats. Maintain explicit mapping and exception reports; never silently repair ambiguity.
5. Import only into a separate staging database after authorization. Preserve raw provenance, assign import batch IDs, and make repeat imports idempotent. Keep result-only history result-only.
6. Reconcile counts, totals, player-level aggregates, date ranges, and representative matches with the export. Quarantine invalid records and obtain owner sign-off on reconciliation and exclusions.
7. Rehearse backup, rollback, and production import in the new environment. Any future cutover/delta import needs a separately approved ownership and overlap plan so the same match is not counted twice.

The predecessor remains available and unchanged throughout. A new-system rollback must not require modifying its data.

## 9. Phased implementation roadmap

Order is deliberate; estimates should follow rule discovery and asset inspection rather than guessed calendar commitments.

| Phase | Deliverables | Exit criteria |
| --- | --- | --- |
| 0 — Discovery and agreement | Predecessor/export review, rulebook, edge-case fixtures, identity/privacy decisions, scoring workflow sketches | Owner confirms primary format, outcomes, correction rules, and representative historical calculations. Unavailable source material blocks rule-parity claims, not visual exploration. |
| 0V — Experience prototype and review | Two identity studies; six-screen clickable design; dark/light scoring, component specifications, fictional stories with evidence annotations, recovery and limited-data states | Owner approves the selected direction and primary interactions against section 6's review gates. Can overlap discovery using labeled hypotheses; unresolved rules block final scoring approval. No backend implementation precedes this milestone. |
| 1 — Foundation and scoring prototype | Version control, strict typing, design tokens, responsive shell, route structure, synthetic-data scoring reducer, setup/live/review screens | Rule fixtures pass; typical score entry is one deliberate tap where the rules permit; Undo is always reachable. Test long names, 320px width, zoom, keyboard and screen-reader flow. No backend needed. |
| 2 — Durable local scoring | Transactional draft/outbox storage, event timeline and corrections, restart recovery, storage migrations, offline shell, safe update behavior | Mid-match refresh/termination restores every acknowledged local action; storage failures are visible; offline match can complete and resume without network. Airplane-mode walkthrough on target phones passes. |
| 3 — Secure shared persistence | Separate Supabase environments, Auth, reviewed schema/migrations/RLS, membership model, idempotent writes, revision conflicts, history | No cross-workspace access in policy tests; duplicate/out-of-order requests do not corrupt scores; auth expiry/revocation and two-device conflicts preserve local work. Completed result is server-validated. |
| 4 — History and migration rehearsal | Match/player screens, authorized amendments, staging import, provenance and reconciliation report | Historical totals and sampled records match approved expectations; ambiguities are explicit; repeat import is safe; backup/restore rehearsal succeeds. |
| 5 — Useful insights | Metric dictionary, accessible summaries, a few lazy-loaded charts, filters, uncertainty/sample and coverage labels | Each metric reconciles to fixtures and contributing records; absent event data never becomes invented precision. License and performance review completed. |
| 6 — Pilot and release readiness | Device testing, usability sessions during real play, monitoring, install/update UX, Netlify routing/headers/env checks, recovery guide | Scoring/recovery/security gates pass on agreed devices; pilot issues resolved; deployment and any production import separately approved. |

Provisional acceptance targets to validate in the pilot:

- Returning users can start a familiar match within 30 seconds, with no required typing when participants are known.
- Common scoring actions give visible feedback within 100ms on agreed representative hardware; local persistence latency is measured separately from server latency.
- Accidental latest action can be reversed in one tap; older mistakes are recoverable through the timeline.
- No acknowledged local action is lost in tested reload, termination, retry, duplicate-request, and reconnect scenarios. Browser data deletion/eviction remains a separately communicated recovery limitation.
- Every completed result identifies rules, participants, source, and sync state. Imported gaps are visible.
- Core scoring works without charts loading and without an active network after required assets/data are cached.

Use targeted rule/replay tests, persistence failure injection, sync integration tests, database permission tests, and end-to-end journeys for setup → score → undo → restart → complete → reconnect. Test rapid taps, interrupted finalization, lost acknowledgments, stale revisions, service-worker upgrades, expired sessions, and account switching. Include current iOS Safari/installed PWA, Android Chrome, and desktop keyboard/screen-reader checks; confirm exact device matrix during discovery.

## 10. Decisions and open questions

### Needed before rule implementation

1. Which pool disciplines and scoring formats does the predecessor support? What exactly does one normal input record: rack winner, points, visit, shot, or something else?
2. What are the break/turn rules, winning conditions, handicaps, penalties, ties, abandonment rules, and correction permissions? Which predecessor behaviors are intentional?
3. Is the primary workflow singles, doubles, teams, or rotating players? Who scores, and is one active match per device a reasonable default?
4. Can we obtain the predecessor source and an authorized workbook export, plus representative edge cases and expected results?

### Needed before schema and Auth are fixed

5. Is Pule for one private group or multiple independent clubs/groups? Who may view history and analytics, create players, amend results, and invite members?
6. Must players have accounts? How should duplicate names, guests, aliases, and ownership claims be resolved?
7. Which sign-in method is appropriate? Must a first-time user start offline, or is offline continuation for previously signed-in users sufficient?
8. What are the retention, export, deletion, and shared-device requirements? How should sign-out handle unsynced private drafts?
9. Are spectators or simultaneous scorers essential at launch? Default recommendation: one scorer and read-only viewers.

### Needed before analytics and release

10. Which three questions matter most to players? What event detail are they willing to record without slowing play?
11. Which date/time zone defines a match day and reporting period? Have rules or player identities changed historically?
12. What devices, lighting conditions, connection quality, accessibility needs, and expected group/data sizes should guide validation?
13. What is the budget, licensing context, release ownership, and preferred pilot group? Who approves historical reconciliation and future cutover?
14. Which parts of competition feel meaningful to this group: recurring opponents, verified records, progress, or sharing? Which should stay private or be dismissible?
15. Which visual direction best represents Pule, and which design medium and participants should be used for the pre-backend prototype review?

## 11. Main risks and responses

| Risk | Response / decision gate |
| --- | --- |
| Unknown rules or hidden spreadsheet formulas | Obtain source/export and approved fixtures before committing to domain behavior. |
| Accidental scoring or ambiguous controls | Prototype with actual players, stable action positions, explicit labels, persistent Undo and timeline. |
| Local loss or misleading save claims | Transactional persistence, honest status labels, storage failure handling, export, and recovery testing. |
| Duplicate submission or divergent devices | Stable operation IDs, server uniqueness/revision checks, one-scorer model, explicit conflict recovery. |
| Unauthorized access | Workspace-scoped RLS and server validation; test denied cases and revoked access. Never rely on hidden buttons. |
| Historical duplicates or invented detail | Provenance, idempotent import, identity review, reconciliation, result-only representation. |
| Incompatible schema/app updates | Versioned events, local migrations, deferred reload during play, recovery rehearsal. |
| Dependency compatibility and chart cost | Verify declared toolchain before additions; review chart licensing and load charts outside the scoring bundle. |
| Scope expands before scoring is excellent | Gate analytics and broader competition features behind scoring usability and recovery acceptance. |
| Unsafe release configuration | Separate environments, preview isolation, deep-link checks, approved deployment and new-system rollback plan. |

## 12. Approval requested

The technical architecture is approved in principle. Review the expanded experience direction, six-screen concepts, evidence contracts, release tiers, and proposed Phase 0V visual prototype milestone. The next proposed work is discovery and the separately authorized visual prototype, using supplied predecessor materials when available and labeled synthetic hypotheses where they are not. This plan update does not authorize prototype or application implementation, installations, Supabase resource creation, imports, or deployment. All existing reliability, security, historical preservation, and validation requirements remain in force.
