# Phase 4 — Pool Hall Energy

Implemented locally for visual review. No hosted access, migrations, imports, identity links, dependencies or deployment. Scoring services, authorization, recovery and persistence remain unchanged.

## Visual and interaction changes

Cream, forest and felt surfaces now use consistent rounded tokens, heavier sans-serif headings and score numerals, selective lime highlights and restrained elevation. The Pule wordmark remains unchanged. Home rivalry emphasizes night wins; History uses compact outcome pills and static winner emphasis; Standings retains night-first ranking and subordinate frame statistics. Setup retains editable suggestions and multiplayer support, with tactile checked player cards and a Start playing action.

Mobile navigation has rounded active states, stronger icons, 56px targets and safe-area padding. The duplicate mobile Account header link is hidden. Buttons press briefly, selections transition immediately, page surfaces reveal once per mount, and expandable content/confirmation reveal gently. No count-ups, scrolling-list stagger or looping effects. Reduced motion disables animations/transitions while retaining text, checks and selected states.

## Durable feedback

Only a successful direct completion callback can request feedback. The displayed acknowledged state must also contain the completed frame, matching winner and expected saved score. Finalization requires the acknowledged finalized status and expected revision. Component-local event deduplication prevents repeat feedback from the same callback. No score-watching effect triggers celebrations on load or refresh; recovery, corrections and winner selection do not request them.

A confirmed frame briefly emphasizes the saved score/card and shows a nonblocking frame-saved badge. A finalized night receives a slightly longer winner emphasis; a draw gets neutral text without an individual winner highlight. Feedback disappears automatically in a reserved space. Next-frame controls stay usable. Haptics intentionally omitted as optional; no settings or browser vibration dependency added.

## Changed files

- `src/app/connected.css`: visual tokens, typography, rounded surfaces, navigation and reduced-motion-aware interactions.
- `src/app/App.tsx`: class for suppressing duplicate mobile Account link.
- `src/features/results/ResultsViews.tsx`: redundant Home label removal and static result winner styling.
- `src/features/connected/SetupViews.tsx`: Start playing label.
- `src/features/connected/SessionView.tsx`: acknowledged-action-only feedback presentation, without changing commands or scoring decisions.
- This report.

## Verification

- Existing frontend tests: **59/59 passed**, no skips. TypeScript/Vite build and lint passed.
- Isolated full React app: mocked Auth/read services, reviewed historical fixtures, all external requests blocked. Checked Home, History, Standings, empty/multiple groups, loading/errors, multiplayer, keyboard focus, mobile navigation and 37-night/19–13–5/407–351 accuracy.
- Separate isolated scoring fixture: mocked asynchronous callbacks; checked active frame, winner selection, confirmation, saved frame, finalization, neutral draw and existing finalized state. Pending, failed and uncertain operations never celebrate. Rerenders do not replay feedback. Reduced-motion checks passed.
- Layout checks at **360/393/412/1280px** without horizontal overflow; confirmation also checked at all three phone widths. Screenshots inspected. No owner session/storage or hosted account used.

## Visual review

Screenshots outside Git:

- `/private/tmp/pule-home-phase4.png`
- `/private/tmp/pule-history-phase4.png`
- `/private/tmp/pule-standings-phase4.png`
- `/private/tmp/pule-play-phase4.png`
- `/private/tmp/pule-confirm-phase4.png`
- `/private/tmp/pule-frame-saved-phase4.png`
- `/private/tmp/pule-night-saved-phase4.png`
- Desktop History/Standings: corresponding `phase4-desktop.png` files.

Routes: `#/home`, `#/matches`, `#/standings`, `#/play`. Feedback screenshots use fictional local scoring state; result screenshots contain private historical fixtures. Temporary browser harnesses reuse the existing external Playwright installation, with no project dependency.

Limits: no physical-device/performance or JWT/RLS integration audit. Native disclosure closing remains immediate rather than adding height-measurement infrastructure. Personal identity and bounded history/H2H coverage limits from Phase 3 remain unchanged. No historical score animations or success feedback for uncertain/recovered operations were introduced. Stopped for review; not deployed.
