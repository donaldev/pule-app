# Focused scoring UI pass

4 November 2026. Local frontend changes only; no hosted requests, deployment, database changes or browser recovery-storage access.

The duplicate scoring recovery panel is removed. One compact save-status panel now offers **Refresh scores**. Unknown outcomes say the save cannot yet be confirmed; known conflicts say the scores changed elsewhere. Raw errors, operation IDs, manual resend/check/export and rejected-action removal remain behind collapsed **Advanced help**. They are never triggered by refresh. The top toolbar's refresh action is hidden while the recovery panel supplies it.

Live scoring no longer displays revision numbers or database confirmation jargon. Buttons use shorter labels; scores and winner controls have larger mobile treatments. Frame history is expandable; corrections, metadata, standings and finishing remain available. Modal recovery links close the modal and return to the one existing status panel.

Refresh still calls the existing read-only state-loading function. It does not check receipts, retry a mutation, change operation IDs, remove journal entries or unblock uncertain scoring. A pending save can therefore remain blocked after refresh; Advanced help retains the existing explicit recovery options. No new recovery mechanism was added.

Verification: 38/38 frontend tests passed, TypeScript/Vite build and lint passed. Existing recovery tests protect unknown-outcome retention, account isolation, no implicit replay, matching evidence and safe cleanup; presentation assertions now check the plain-English copy. Real-phone visual review and the owner's live recovery remain untested. Unsubmitted frame form inputs still do not survive a full page reload (unchanged).

## Match-scoped warning correction

The existing status component now shows a match save warning only on the exact `/session/<p_session>` route from the retained intent. Home, history, standings, account and unrelated nights no longer show it or receive its automatic focus/scroll. The match message uses a compact left-border treatment; technical tools remain collapsed under Advanced help. Setup/creation actions without a session ID retain recovery on their setup route rather than guessing an affected match. Group switching is no longer disabled merely because an intent exists, so read-only browsing remains available.

**Architecture limitation:** the existing account/project journal admits one unresolved operation. Coordinator submission and shared storage prevent a second mutation from overwriting it. Starting or scoring an unrelated night therefore remains blocked. No claim of safe per-match write isolation is made, and no lock was bypassed. Supporting parallel unresolved writes would require a separately scoped journal/coordinator change, explicitly excluded from this UI correction. Original UUID/payload/retry safeguards and browser storage are untouched.

Verification after this correction: 40/40 frontend tests, build and lint passed. Two additional presentation tests cover exact affected-match scope and creation/setup fallback. No hosted request or deployment performed.
