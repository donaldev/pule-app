# Approved two-stage scoring layout

Implemented locally. Reference supplied as `design/pule-scoring-design.png` was absent; used the reviewed `design/scoring-mockup.png` (the available two-screen reference). No database/services/recovery changes, dependencies, hosted requests, imports or deployment.

## Changed files

- `src/features/connected/SessionView.tsx`: existing frame form now owns the timer, break strip, two player score/foul/winner cards and conditional confirmation section. Duplicate active-frame scoreboard removed. Venue heads the screen; history precedes secondary standings.
- `src/app/connected.css`: mockup-inspired forest cards, cream controls, brass selection, timer strip, segmented break-pot control, six-pocket table and compact confirmation card.

## Behavior

New active-frame forms initialize break-pot to No (explicit `false` in the existing completion RPC), and win type to Normal (`regular`). Winner selection changes only form state. Only Confirm frame submits completion; submission also checks validity, scoring permission and the existing blocked state. Changing winner or returning to playing does not alter saved totals. Each frame ID mounts a fresh form; saved historical values are not rewritten.

The active pair alone appears in the cards. Scores remain saved session frame-win totals. Rotating-pair selection and explicit breaker selection before frame start remain unchanged. Pause/resume uses the existing transactional command and server-derived timer fields. No active-frame breaker mutation was added (the existing backend only selects the breaker at frame start). Golden Break/Break & Run still require the breaker winner and break-pot Yes; Super Foul requires an offender different from the winner. Pocket stays optional, with explicit Clear pocket; no fictional pocket is preselected. Correction stays a separate modal with winner/fouls/reason only, preserving existing metadata. History, standings and finalization remain reachable below scoring.

## Verification

- Existing frontend suite: 40/40 passed.
- TypeScript/Vite build and ESLint: passed.
- Isolated headless Chrome with fictional participants and mocked scoring callback; external requests blocked; ephemeral browser context, no owner Auth or browser storage access.
- In-progress and confirmation checked at 360, 393 and 412px: no horizontal overflow; in-progress cards share a row.
- Browser assertions: no confirmation before selection; winner selection makes no call and leaves scores 3–2; initial No and Normal; confirming sends one mocked complete_frame with explicit false and selected TR pocket; Golden Break remains blocked until Yes; Super Foul remains blocked until valid offender; Back to playing hides confirmation.
- Full-page screenshots inspected: `/private/tmp/pule-frame-playing.png`, `/private/tmp/pule-frame-confirm.png`. Temporary QA harness uses existing external-to-project Playwright installation; no project dependency added.

## Differences for review

Confirmation scrolls rather than reducing controls below usable touch sizes. Names may wrap. The app retains its real shared navigation/group context; the synthetic screenshot harness used a simplified shell. The pocket remains unrecorded until selected, and no timer auto-pause occurs on winner selection—both preserve existing semantics. Break-pot No default is the explicitly approved behavior change, not a claim about legacy defaults. No live scoring save or actual phone hardware test performed.

## Targeted UX refinements

Updated `SessionView.tsx`, `connected.css`; added pure presentation helper `frameDefaults.ts` and `scripts/frontend/frameDefaults.test.mjs`.

Server review: migration 003 stores `initial_breaker_id`, accepts explicit pair/breaker in start_frame, and returns saved frame numbers/breakers. correct_frame updates winner and foul counts, not breaker. Therefore no database change or corrected-winner ambiguity is introduced.

Exactly-two-player nights preselect both saved participants. Frame 1 uses the opening breaker already chosen during night setup. Later frames suggest the other player from the latest completed frame's actual saved breaker, ordered by frame_number regardless of response order or winner. Manual overrides remain explicit before Start frame. Missing/unrecognized breaker data falls back to manual choice. Voided frames are excluded. Three-or-more-player setup remains manual. No active-frame breaker changes or browser-only alternation counter. Refresh/revision changes remount only the between-frame picker from authoritative state.

Strengthened helper text, dropdown outlines and secondary buttons. Calculated core contrast pairs: helper #405346 on cream #F7F4EA 7.50:1; forest #09251C on cream 14.76:1; cream on card #092F21 13.25:1. This is a targeted contrast check, not full WCAG certification.

Playing surface uses CSS aspect-ratio 2/1 without an inset border affecting its ratio; the rail is an external outline. Six unchanged pocket identifiers retain 48px targets; table width scales with its container. Existing completion flow, No/Normal defaults, timer, validation and corrections are unchanged.

Verification: 45/45 frontend tests, TypeScript/Vite build and lint passed. Five new tests cover opening defaults, actual-breaker alternation, ordering/winner corrections, manual-override history, missing/voided data and multiplayer manual setup. No new real-phone or hosted test performed in this refinement pass. Local only; no database, migration, recovery or dependency changes.
