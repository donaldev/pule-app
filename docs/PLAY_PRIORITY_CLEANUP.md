# Play-first UX cleanup

Implemented locally. No hosted requests/writes, database migrations, imports, deployments, dependencies or recovery-infrastructure changes. Approved in-frame cards, timer, confirmation, correction and finalization components were not changed.

## Removed and simplified

- Removed the persistent Group dropdown/toolbar from Play, History, Standings and scoring.
- Group switching appears only in Account and Group settings, and only when more than one authorized group exists. Single-group accounts enter directly; no-group accounts use the existing first-time group form.
- Play retains a quiet group name, editable suggested players/venue/breaker, active-night resume links and a clear Start match night button. Group settings remains available through Account.
- Removed scoring enablement, rule review checkbox/text, rule-version naming and scoring-format selection from normal Play and Group settings. Removed obsolete toolbar/setup/rule-review CSS.
- Group settings now contains the group name, players, venues and optional switcher. No permanent venue association is introduced.
- Simplified History/Standings helper copy; a failed read retains a simple Try again action without the removed toolbar.

## Last-used group and isolation

A small localStorage preference stores **only the group UUID**, scoped by project URL and Auth user. It is UI preference storage, not scoring persistence. On load/refresh, groups are intersected with the server-returned current memberships before choosing the existing selection, remembered selection or first available authorized group. Neither names nor stored values grant access. Invalid/revoked/forged IDs are ignored. Explicit switching validates the current allowed list. Active session reads can select their server-authorized group as before.

Switching clears old setup/history/standings lists; existing optionsGroup guards and canceled-effect protection prevent displaying one group's responses as another group's data. Server RLS and RPC checks remain authoritative. Preference storage failure does not block browsing; refresh then falls back to an authorized group. This-device memory is not cross-device group synchronization. Recovery journal and mutation guards remain unchanged.

## Standard scoring: frontend safe, backend proposal pending

Existing create_group does not initialize a verified rule; existing adopt_rule_version requires explicit owner/admin confirmation. No hidden adoption call was added. Existing verified presets remain usable (prefer Pule standard when present; otherwise existing verified version-1 preset). Historical legacy_unknown presets are never selected by the setup API.

A group without a verified preset displays a short unavailable message and cannot start a night; it can still view history and standings. The removed enablement UI is not replaced with misleading success. New groups therefore still need the proposed backend default before the intended no-configuration scoring experience is complete.

[STANDARD_SCORING_DEFAULT_PROPOSAL.md](STANDARD_SCORING_DEFAULT_PROPOSAL.md) specifies the minimal future change: insert one fixed verified standard rule inside the existing create_group transaction, preserving authorization, receipts and native validation. Existing PonDon initialization remains a separately approved use of the existing adoption mechanism. No migration file, new RPC or hosted adoption was created in this pass.

## Changed files

- `src/app/App.tsx`: removed global selector, secondary Account switcher, simpler copy/read retry.
- `src/features/connected/SetupViews.tsx`: removed scoring configuration, Group settings switcher, compact Play context.
- `src/features/connected/useConnectedGame.ts`: server-validated preferred group selection and switch guard.
- New `src/features/connected/groupPreference.ts`: UI-only choice/read/write helpers with storage-failure fallback.
- `src/app/connected.css`: removed obsolete selectors and added compact Play/account preference styling.
- New `scripts/frontend/groupPreference.test.mjs`: single/no/multiple groups, refresh choice, invalid preferences and storage/account separation.
- This report and the backend proposal. Importer and approved scoring components unchanged.

## Verification

- **52/52 frontend tests passed**; TypeScript/Vite build and ESLint passed.
- Isolated headless Chrome tested the **full React app** with mock Auth and data services; external requests blocked. **15 scenario/viewport checks** at 360/393/412px, no horizontal overflow.
- Covered single/multiple/no groups, existing/missing verified rules, populated/empty roster; no switcher on main screens; switch in Account; selected group survives History/Standings navigation and reload; another group's player names replace the old roster; a forged stored UUID falls back safely; no group/rule/scoring mutation is invoked automatically.
- Local screenshot inspected: `/private/tmp/pule-play-priority.png`. Mock browser has fresh isolated storage and no owner credentials. Tests simulate authorization lists; they are not new hosted RLS/JWT tests.
- Existing setup/defaults and recovery/auth tests remain passing. No physical phone or real authenticated hosted save was performed.

Stopped for review. Backend automatic rule initialization remains the explicit remaining blocker; no deployment performed.
