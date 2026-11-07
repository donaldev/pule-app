# Guest email policy — focused checkpoint

Product decision: **every NEW guest requires a display name and a distinct normalized email**. Names may repeat. Emails are private contact/claim evidence; immutable player UUIDs remain the sporting identity.

Local implementation only. No hosted migration, guest creation, email association, invitation, claim, Google configuration or deployment performed in this task. Existing Donal account link and historical data remain unchanged.

## Completed at this checkpoint

- Play requires name + email. It first performs an authorized email lookup and offers **Use [existing player]** rather than creating another UUID. Selecting an existing player performs no creation or identity claim.
- Normalize with trim + lowercase only. No Gmail dot removal, plus-address rewriting or name-based matching. Different names cannot bypass email uniqueness; identical names with different emails remain different people.
- Private email registry with a unique normalized-email constraint, source/actor evidence, RLS and no client table access. Existing verified account-linked players also participate in duplicate detection without exposing their Auth records.
- Lookup exposes a player locator only where the caller already has active scoring access. Private collisions return no identity details and grant no access. A conflicting/ambiguous existing email requires review rather than a guessed merge.
- New guest creation and email storage are atomic and use the existing operation journal/cache. Old name-only requests cannot create new guests; exact already-committed old requests can still replay. Original pending intents are not rewritten.
- A **new authorized owner/admin invitation** can associate an email with an existing historical guest such as Sean, retaining his UUID. Existing verified-player participation and the Phase 6 invitation authorization are required; scoring permission alone is insufficient. Old operation replays do not silently backfill email associations.
- No ordinary email reassignment endpoint. Conflicting email changes fail closed. New invitation acceptance checks any recorded canonical email as well as the existing verified-recipient, single-use, expiry and account-link safeguards. No account link is overwritten.
- If the new read RPC is absent, Add player stops before attempting an unsupported mutation. The hosted policy does not change until the proposed migration is separately approved/applied.

## Proposed migration — NOT applied

`supabase/migrations/202611050002_guest_email_required.sql`

SHA-256: `90fef434ba232c7479ab6b4cbc2cf5e2f0ad6fbc005b51557e97850a76243729`.

Adds `private.player_guest_emails`, private email matching, `app.find_guest_by_email(text)` and `app.create_guest_with_email(uuid,uuid,text,text)`. Guards the legacy name-only endpoint and wraps the existing invitation issue/accept functions. No sporting-record or player-UUID rewrite, no historical email guessing/backfill, and no general account-management system.

Historical guests must have their actual email explicitly supplied and verified through the authorized invitation path; an unrecorded address cannot safely be inferred from a name. Existing contact/email corrections and cross-identity conflicts require a separate reviewed action; they are not automatic merges.

## Google discovery and confirmation — implemented locally

After sign-in, `app.get_guest_email_claim()` checks only the caller's live trusted Auth records. The current primary email must match a verified Google identity and the private canonical guest-email association. No email or user ID is accepted from the browser for discovery.

Exactly one unclaimed eligible profile produces **We found your existing games**, its player name and **Claim my games**. Confirmation calls `app.claim_guest_email` using the existing durable-operation mechanism. It revalidates eligibility under the shared identity lock and Auth row locks, then reuses the Phase 6 invitation acceptance helper to consume all currently eligible grants atomically. It preserves the UUID and joins only those specifically authorized matchups, never the whole origin group by virtue of an email match. The first selected history context prefers a context containing completed nights; My Stats retains the complete accessible aggregate.

**Eligibility requires fresh, unconsumed, unrevoked invitations issued by a currently authorized verified owner/admin participant.** The canonical email must match their intended recipient. Verified Google ownership and explicit confirmation allow this path without manually opening the private invitation URL; they do not remove the underlying owner authorization, expiry, revocation, existing-link or scoped-membership checks. Guest email entry alone grants nothing.

No match continues normally. Missing/withdrawn grants ask for a fresh invitation, without returning a name/UUID. Conflicts return a nontechnical message without exposing the other account. Already connected accounts are not offered another identity. Revoked memberships are never reactivated. Secondary Google emails different from the Auth primary email are not guessed.

New read/write RPCs and the existing receipt lookup extension are included in the **same unapplied migration**, with a new checksum above. Private helpers remain inaccessible; both public RPCs require authenticated execution. Existing private-invitation links continue to work. No automatic claim or mutation occurs on sign-in; the user must confirm.

## Verification

- Focused email/receipt frontend tests: **4 passed**.
- Focused disposable PostgreSQL checks: **31 assertions passed**. Covers required email, case/space normalization, duplicate prevention, same-name distinct people, authorized lookup/privacy, replay compatibility, historical association authority and reassignment rejection. Added cases cover verified-Google-only discovery, no match, wrong target, revoked grants, two eligible matchups versus an uninvited private matchup, idempotent confirmation, receipt recovery, no duplicate player and unchanged reported scores.
- TypeScript/Vite build and lint passed. Vite reports a roughly 503 kB main-chunk advisory; bundle optimization is outside this checkpoint.
- No full frontend/database suites or browser automation run, as requested. Existing multiplayer/identity fixture expectations were adjusted for the mandatory-email policy; broad regression validation is still pending.

Reproduce focused checks:

```sh
node --test scripts/frontend/guestEmail.test.mjs
python3 -B scripts/database/run_tests.py --sql-test guest_email.sql
```

Files: new migration, `supabase/tests/guest_email.sql`, `scripts/frontend/guestEmail.test.mjs`; updated the small sign-in discovery/confirmation prompt, Play setup, RPC contracts/dispatch, identity lookup service, receipt matching/reconciliation/presentation, SQL runner focused option and affected SQL fixture expectations. Existing deployed migrations are unchanged.

Google discovery/confirmation is now implemented at the focused local checkpoint. Next: review the updated migration/checksum and separately approve hosted application; real Google/PWA end-to-end testing and broader regression validation remain separate. No hosted action is authorized by this report.
