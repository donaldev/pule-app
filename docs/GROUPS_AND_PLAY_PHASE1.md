# Groups and Play — phase 1

> Superseded UI details: [Play-first cleanup](PLAY_PRIORITY_CLEANUP.md) removes the persistent selector and manual scoring enablement described below. This document records the earlier phase.

Local frontend implementation only. No hosted requests/writes, import changes, migrations, dependencies, deployment or owner-browser storage changes. Owner-reported historical import is treated as supplied context, not independently re-audited here.

## Player-facing changes

Play now opens the compact new-night setup directly, beneath any active-night resume links. The selected Group is prominent. Tonight's players use labeled checkboxes, without UUIDs. Suggestions use up to two known players with the most recorded nights; an exactly-two-player roster also preselects both. The venue suggestion uses the latest available recorded occurrence date and remains editable. These are visible local defaults, not saved selections or an automatic match start. Opening breaker is editable; existing between-frame alternation and multiplayer pair selection remain untouched.

Group settings (`#/group-settings`) holds the roster, add-player flow, venue list and scoring enablement. Case-insensitive trimmed existing names disable accidental duplicate player/venue creation in these forms; no existing identity is changed or merged. Play keeps a secondary Add a new venue interaction; successful creation asks the user to choose it from the refreshed list.

Native scoring still requires a verified rule via the existing owner/admin RPC. The UI replaces rule-version naming/technical validation content with an explicit one-time review of game behavior and an Enable match scoring action in Group settings. The label is fixed to Open match nights; confirmation is required and passed explicitly. This does not happen automatically, relabel legacy_unknown records or weaken server validation. Without an enabled preset, Start is disabled and Play links to the owner setup. Multiple existing verified presets are selectable as Scoring format, not database version administration.

Group creation explains that the group contains people/history and each night chooses its own venue. Timezone remains available in an expandable secondary setting. Auth tabs, feedback and form spacing now use readable cream/forest contrast; controls disable during submission. Account mode changes clear stale feedback, while existing signup/PKCE/email confirmation services and tests remain intact. Account and Group settings are separate from starting a night.

## Files changed

- `src/features/connected/SetupViews.tsx` — setup, Group settings and group creation.
- `src/features/connected/nightSetupDefaults.ts` — pure local suggestions.
- `src/app/App.tsx` — Play layout and Group settings route/account link.
- `src/features/auth/components/AuthScreen.tsx` — feedback, mode handling and busy controls.
- `src/app/connected.css` — scoped setup/onboarding/auth styles; no scoring card redesign.
- `src/features/connected/recoveryPresentation.ts` — presentation routes updated for the new Group settings and Play setup locations. Match-bound recovery still appears only on its own match; coordinator, journal, retry, receipt and mutation services unchanged.
- `scripts/frontend/nightSetupDefaults.test.mjs`, presentation assertions — defaults and route coverage.

## Verification

- Frontend tests **48/48 passed**; TypeScript/Vite build and lint passed.
- Isolated headless Chrome: **18 scenario/viewport overflow checks**, six scenarios at 360/393/412px.
- PonDon fixture uses the known imported Donal/Sean UUIDs, four original venue names and 37-night standings; no duplicate historical identities are generated. Verified lineup defaults, latest recorded venue, manual venue/breaker changes and exact two-player start payload. Three-player fixture adds a clearly fictional third player and verifies all three are sent.
- Empty roster/settings path and disabled Start; no verified-rule path and explicitly confirmed adoption; duplicate Donal addition prevented; group creation callback; Auth mode/autocomplete; keyboard Tab navigation. All mounting/selection checks require zero automatic mutation calls.
- Browser external requests blocked and callbacks mocked. No hosted accounts/groups/rules/nights were created, and no real authenticated PonDon scoring mutation was exercised.
- Screenshots reviewed locally: `/private/tmp/pule-new-night.png`, `/private/tmp/pule-group-settings.png`, `/private/tmp/pule-auth-new.png`. Isolated component shell; complete app navigation was verified by build/source review rather than a live authenticated browser session.
- Main helper/body colors retain cream/forest pairs from the prior contrast check; tabs use cream on forest. This is not a full WCAG audit or physical-device test.

## Backend limits and review notes

- Historical legacy_unknown rules remain unsuitable for new native scoring. An owner/admin must intentionally enable a supported native preset; no hosted adoption was performed in this task.
- Membership invitations, owner transfer and verified account claiming are still unsupported workflows. Guest roster selection does not claim an account.
- Suggestions use existing All-Time standings and the currently loaded newest 100 sessions. They do not infer unrecorded participation or precise same-day chronology; ties are ordinary editable defaults. Suggestions never overwrite an already edited form on background refresh.
- Duplicate-name prevention is a UI guard, not a database uniqueness constraint or identity merge. Same-name distinct people need a clear distinguishable display name and separate authorized management work.
- Existing unresolved-write protections can still block starting a night; no recovery infrastructure or safety lock was changed.

Stopped for visual review. No frontend deployment.
