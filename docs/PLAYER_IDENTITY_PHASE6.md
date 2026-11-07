# Phase 6 — verified identity, Google and invitations

> Current status: Phase 6 was subsequently applied, and the explicitly approved owner account was linked to historical Donal. Sean was left unlinked. The pre-deployment report below is retained as an implementation record. The new mandatory-email decision and incomplete Google discovery follow-up are tracked in [Guest email checkpoint](GUEST_EMAIL_CLAIMING_CHECKPOINT.md).

Implemented locally, 5 November 2026. **Migration not applied. No real account claim, invitation creation/delivery, deployment or historical import.** One hosted read-only inspection checked Auth schema and sanitized verification/link flags. No email address, token, provider secret or candidate Auth UUID was retrieved. Original app/workbook and owner browser storage untouched.

## Implemented

- Google sign-in alongside existing email/password. Account lists the current account’s authentication methods and offers Connect Google through Supabase’s authenticated identity-linking API. This does not claim a sporting identity. The callback checks a connected provider returned to the original Auth UUID; mismatches sign out locally and fail closed.
- Same-origin root PKCE callback, once-only initialization including StrictMode, clean removal of callback errors/codes, allowlisted internal return routes, and private invitation-route restoration. OAuth requires HTTPS except localhost. No session handoff, access token in URL, open redirect, popup dependency or frontend provider secret.
- Operator-only historical Donal link with explicit target account, expected verified email, verified reviewer and independent evidence reference. It never selects an account by name, email similarity or scoring permission. Existing owner membership is an additional target constraint, not ownership proof. Conflicting links are rejected; identical existing links are left unchanged.
- Simple Account invitations for a verified, linked owner/admin participating in the chosen registered matchup. Choose the existing player UUID, verify their email, create a private link and share it yourself. No email/notification service. Guests such as Alan keep the same UUID when invited later; resolve their matchup in Play first, without needing to start a night.
- 256-bit browser-generated tokens, server-side SHA-256 digests, fixed 48-hour expiry, one pending invitation per player/matchup, revocation and single-use redemption. Issuance does not reveal whether a guessed email belongs to an already-linked account. Recipient checks use trusted current Auth records, not JWT email or editable display metadata.
- Acceptance explicitly links the existing player and grants scorer access to that invitation’s one matchup in the same transaction. Existing active roles are preserved; revoked membership is never silently reactivated. Existing user/player links are never overwritten, and losing inviter authority invalidates outstanding invitations.
- My Stats uses a new caller-only aggregate over **all accessible approved finalized nights**, independent of the selected rivalry and without the 100-night cap. Existing result-authority helpers count reported/native results once; sitting-out frames, unknown losses and score-only limitations remain intact. Rivalries and Leaderboards retain their existing scope and behavior.
- Stable root standalone web manifest and mobile metadata. Existing persistent Supabase sessions and hash navigation remain. No service worker, offline Auth cache, native wrapper or broader PWA redesign introduced.

## Migration requiring separate approval

`supabase/migrations/202611050001_player_identity.sql`

SHA-256: `a7d331ae40ada8692af6c10eb5fc8254d9695f36d6b3b86a82669ec5e754b18f`.

Adds one private RLS-protected invitation table and pending-invitation index; private verification/authorization/operation helpers; an operator-only `private.link_historical_owner(uuid,text,uuid,text)` function; authenticated create/preview/accept/revoke/list invitation RPCs; and `app.get_my_player_stats()`. Extends existing receipt lookup for these setup actions, preserving its prior actor/context authorization.

Auth, membership and profile rows are locked before current verification/authorization checks. Link mutations serialize with the operator helper, and unique player/user constraints remain the final collision boundary. All exposed functions use SECURITY DEFINER with empty fixed search paths and qualified relations. Private helpers/tables and the owner-link function have no PUBLIC/anon/authenticated execution/read grants. Anonymous RPC access is denied.

No existing historical sporting table is updated. Phase 5 migration checksum remains `9e3e30bd99154b4bccde19f4218280eecf2c6b4fe43d659703bf219ebf9e2a5f`; its registry/resolver is not reworked. The new actions reuse the existing actor/operation journal and cache. Acceptance evidence stores a digest instead of the raw token, and read-only reconciliation rehashes the retained token before cleanup. An unacknowledged operation retains its original UUID/payload; no automatic retry or discard.

## Donal: exact next action

**Sign in with your existing email/password, open Account → Account verification, copy the Account ID and explicitly approve that exact ID being linked to historical Donal. Confirm the expected account email privately. Do not provide a password, session token or Google secret.** Independently attest that this is your historical Donal record; membership or a matching display name is not that evidence.

The read-only hosted check found one active historical owner with acceptable verified-email evidence and **zero Donal links / zero Sean links**. Required Auth columns exist. These flags establish compatibility, not the person’s historical identity, so no target was automatically chosen and no claim was executed.

After separate migration approval/application and approval of the target, a trusted operator must verify the exact account/email, current owner constraint and absence of conflicting links, then execute one privileged transaction using approved values:

```sql
begin;
select private.link_historical_owner(
  :'approved_account_id'::uuid,
  :'approved_expected_email',
  :'verified_reviewer_id'::uuid,
  :'independent_approval_reference'
);
commit;
```

These are psql bind placeholders, not filled-in instructions to run now. The reviewer must be an existing verified Auth account, and the evidence reference must identify the reviewed approval. No new reviewer/account is created. The function itself rechecks all constraints and stops on conflict. It changes only the identity link; the owner already has matchup access. Verify the caller’s identity and My Stats read-only afterward. Sean’s UUID remains unclaimed until his own verified, approved invitation acceptance.

## Minimal Google configuration — manual, not performed

1. In Google Cloud / Google Auth Platform, configure the consent audience and a **Web application** OAuth client. During Testing, add the real intended Google test users there. Under Authorized JavaScript origins, add `http://localhost:5173`, `http://127.0.0.1:5173` and the actual HTTPS development/Netlify origins (no paths). The production hostname is not yet supplied here.
2. Register the callback displayed by Supabase’s Google provider. For this standard project domain it is `https://pgljdmevusgvvlplaedt.supabase.co/auth/v1/callback`. Copy the OAuth client ID/secret directly into Supabase → Authentication → Sign In / Providers → Google and enable it. Keep both out of frontend variables, Git and chat. [Supabase Google guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
3. In Supabase → Authentication → URL Configuration, allow exact app roots `http://localhost:5173/`, `http://127.0.0.1:5173/` and your actual HTTPS development/Netlify roots. Use the real Netlify root as Site URL when production is ready. The frontend callback is `/`, with PKCE handled there; no invented production hostname or wildcard production redirect is needed. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
4. Enable **manual identity linking** in Supabase Auth’s security/general configuration if Connect Google is needed. For the existing owner, sign in with email/password first, then Connect Google and verify the Auth UUID stayed the same. Supabase controls any automatic verified-provider linking; Pule never merges Auth users or sporting players by matching email/name. [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
5. Keep Email confirmation enabled. Email/password claim evidence needs a real confirmation-send/confirmation chronology plus trusted email identity evidence; Google needs its verified-email identity matching the account’s current primary email. A client profile flag alone is never sufficient. If evidence is absent, stop for proper verification rather than bypassing checks.

After configuration/approval, test a real callback on localhost, the eventual HTTPS site and the installed Pixel app. PKCE must return to the same origin/storage context where it began. If an OS opens a separate browser storage context, the callback fails safely and asks the user to return to the originating app/browser or use email/password; credentials are not copied between contexts. No physical-device or real Google round-trip is claimed here. Personal History retains the existing scoped, bounded reader; it does not claim a complete career feed. My Stats is the new complete aggregate over accessible approved nights.

## Verification

- **79/79 frontend tests**, TypeScript/Vite build and lint passed.
- Disposable PostgreSQL **14.8**: **184 SQL assertions and five separate-connection concurrency cases**, fresh and upgrade runs. Tests cover operator-only access and evidence, link conflicts/no overwrite, verified/wrong/assumed email, Google evidence, single-use expiry/revocation, revoked membership/inviter, claim rollback, existing receipt integration and digest-only server evidence. Concurrent eligible recipients produce one accepted claim and one denial.
- Synthetic aggregate test uses 102 native nights plus two score-only nights across contexts: all 104 count once, with 57–54 frames; removing membership excludes the inaccessible 102 nights. No individual frames are invented for the two reported results. These are fictional local values, not hosted history.
- The existing reviewed **37-night / 758-frame / 19–13–5 / 407–351** fixture regression still passes. Workbook SHA-256 remains `97eef9a63e6a9d927a6cf63a153059f8b7f9aff9173d3fbf013cb854ead94538`.
- Isolated full React browser, mocked Auth/database services and blocked external requests: Account methods, explicit invitation creation/revocation, no automatic writes, verified acceptance, wrong/expired states, absent-migration guard, cross-context My Stats, Google failure with password retained, keyboard and **360/393/412/1280px** without overflow. OAuth unit tests cover root returns, retained claim route, external-redirect refusal, original-account enforcement and one code exchange.
- SQL Auth identities are minimal synthetic stand-ins, not GoTrue/JWT verification. Hosted inspection was enforced read-only; no PostgreSQL 17 migration execution, real provider round-trip, actual invitation delivery or standalone-device claim was performed.

## Files and review

New: migration above; `src/data/remote/identityService.ts`; `src/features/identity/IdentityViews.tsx`; `supabase/tests/player_identity.sql`; `scripts/frontend/identity.test.mjs`, `identityReceipts.test.mjs`; `public/manifest.webmanifest`; this report.

Updated: existing Auth service/screen/tests, App routes, My Stats branch of ResultsViews, connected CSS, RPC types/dispatch and existing receipt comparison/reconciliation/presentation; local SQL bootstrap/runner. Existing scoring commands, historical importer, Phase 5 migration and Vite configuration unchanged. No dependencies installed.

Local review: `#/account`, `#/stats/personal`; invitation routes require a valid private token. Mock screenshots outside Git: `/private/tmp/pule-account-phase6.png`, `pule-my-stats-phase6.png`, `pule-claim-phase6.png`. The personal-stats screenshot deliberately includes fictional extra matchup results to demonstrate scope; it is not an owner baseline report. Private invite links/recovery exports must stay private.

Stopped for review. Awaiting migration approval, provider configuration and explicit target-account approval before any real owner link or invitation.
