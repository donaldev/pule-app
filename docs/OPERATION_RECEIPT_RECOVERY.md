# Read-only operation receipt recovery

4 November 2026. **The approved receipt-lookup migration is now deployed to Pule_2.0 (`pgljdmevusgvvlplaedt`). Catalog-only hosted security verification passed.** No lookup invocation, mutation replay, owner-browser IndexedDB access, historical import or frontend deployment was performed. Local synthetic test results below remain distinct from hosted catalog verification. The existing Tab 2 operation `2bed6a55-a746-4aad-b0f9-bbb4e613efed` remains untouched. Its present outcome is not established by this implementation.

## Database contract and security

Proposed migration: `supabase/migrations/202611040001_operation_receipt_lookup.sql`.
SHA-256: `89c06f897c14a86a69ddc1c3b5ebff91aa158b5fb1c09a5a51d5056314f1e09d`.
Previously reviewed migrations 001–004 retain their documented fingerprints. No receipt schema change was needed.

RPC: `app.lookup_operation_receipt(p_operation uuid) → jsonb`.

- `{"status":"not_confirmed"}` means no matching currently authorized receipt was found. Unknown UUIDs, another actor's UUIDs, inactive/revoked memberships and insufficient permissions share this response. It does **not** prove failure or nondelivery.
- `confirmed_committed` returns `operation_id`, the caller's `actor_id`, `group_id`, `committed_at`, the exact original `command`, and a small `saved` locator. Scoring locators contain `kind: scoring`, `session_id` and the originally saved `revision`. Setup locators contain `kind: setup` and `entity_id`. No full old score snapshot is returned.
- Authentication/transport/API errors are lookup failures, not a negative receipt result.

The function is STABLE SECURITY DEFINER, has an empty fixed search path and qualified relations, and performs SELECTs only. PUBLIC/anon execution is revoked; only authenticated execution is granted. Private tables remain inaccessible through the Data API. Actor filtering precedes context inspection: even an owner cannot inspect another actor's receipt. Active group and active current scorer/admin/owner membership are required. Scoring additionally requires an accessible native session and current assignment to the original scorer, or current admin/owner privileges. Group creation/rule adoption receipts require current admin/owner privileges. Null Auth identity is rejected. No service-role key is introduced.

The own-request object is returned so the client can compare every original parameter without ambiguous hash serialization. It can include the caller's original setup names/correction reason, so it remains private and must not be logged publicly. This is a uniform response contract, not a claim of constant-time protection against timing analysis.

## Frontend flow

An explicit **Check saved operation · read only** action appears in the recovery panel and beside blocked scoring. It sends only the lookup RPC and subsequent authorized SELECT/state RPCs; it never calls a scoring mutation or generates a replacement operation ID.

The coordinator verifies UUID (including original `p_operation`), actor, complete canonical command payload, expected revision, group context where supplied, saved session/entity and saved revision. A confirmed scoring receipt must represent expected revision + 1 (revision 1 for session creation). It then fetches current authorized session state, checks group/session identity and a revision at least as recent as the receipt, and rechecks the authenticated actor. Later corrections are preserved by using current state rather than the old receipt response. Setup receipts similarly require an accessible current group/entity.

Only successful matching evidence and reconciliation permit transactional removal of that exact journal entry. A missing entry is an idempotent no-op for two tabs; a different newer entry is preserved and reported as cleanup failure. Local cleanup failure retains the original in-memory recovery request and permits another explicit read-only check. Negative lookup, lookup failure, context mismatch or reconciliation failure do not rewrite the stored intent's UUID, payload, actor, revision or status. Scoring stays locked. No automatic retry, discard, rebase or merge occurs.

## Files changed

- New migration above; new `supabase/tests/receipt_lookup.sql`; database runner extended in `scripts/database/run_tests.py`.
- New `src/data/local/receiptRecovery.ts` (evidence matching/contracts); `operationCoordinator.ts` (read-only recovery orchestration).
- New `src/data/remote/receiptService.ts` (lookup/current-state reconciliation); `database.types.ts` (RPC type).
- `useConnectedGame.ts`, `App.tsx`, `SessionView.tsx` (explicit action, outcomes and read-only progress wording).
- `scripts/frontend/operations.test.mjs` (mock regressions); this report.

## Verification executed

| Check | Result |
| --- | --- |
| Fresh disposable PostgreSQL database, all five migrations | 106 SQL assertions; 2 separate-connection concurrency cases passed |
| Upgrade with existing synthetic foundation/history | Same 106 assertions and 2 concurrency cases passed |
| Actual BEGIN READ ONLY lookup | Passed on both runs |
| Frontend coordinator/auth/presentation tests | 38/38 passed, including 10 new receipt-recovery regressions |
| TypeScript/Vite build | Passed |
| ESLint | Passed |
| Original four migration fingerprints | Unchanged |

SQL cases include original actor, unknown UUID, another same-group owner, cross-group actor, revocation, viewer downgrade, scorer reassignment, admin authorization, anonymous denial, setup receipt, original saved revision, unchanged event/receipt counts and fixed function security attributes. Mock cases cover negative/failed lookup retention, full-context mismatches, successful reconciliation before cleanup, failed reconciliation/cleanup, concurrent checks, wrong account and a different newer journal intent. Existing mutation concurrency tests still pass; the frontend concurrent checks use mocks, not live browser tabs.

Runtime: PostgreSQL 14.8 with the existing minimal Auth stand-in. Full Supabase JWT/PostgREST integration, hosted PostgreSQL 17, real IndexedDB transactions across tabs and a live owner-operation lookup remain **untested**. Local stand-ins do not validate JWT issuance/signatures or gateway behavior. No database fixtures were run against hosted Supabase.

## Limitations and approval-only deployment procedure

Revocation, scorer reassignment or loss of sufficient role deliberately prevents confirmation, even for one's own old receipt. A negative response may reflect this rather than receipt absence. No public operator escalation/receipt administration workflow is added. A negative snapshot cannot exclude an original request committing later. Checking again is a separate user action; retrying a mutation remains a separate decision. The original timeout's cause remains unknown.

The RPC is now deployed; live Auth/API recovery remains untested. A missing-RPC or other lookup failure safely retains the intent. Do not use the owner's live operation to test this implementation before deployment and explicit recovery authorization.

After owner approval of this exact migration and confirmed target `pgljdmevusgvvlplaedt`, verify hashes and local linking metadata, then use installed CLI 3.0.0:

```sh
npx --no-install supabase migration list --remote
npx --no-install supabase db push --remote --skip-vault --dry-run
```

Preview must show **only** `202611040001_operation_receipt_lookup.sql`; remote 001–004 must already match. Stop on differences. The following apply command was run with explicit owner approval on 4 November 2026 (with `--yes` confirming that approved migration only); the subsequent history read also passed:

```sh
npx --no-install supabase db push --remote --skip-vault
npx --no-install supabase migration list --remote
```

Stop on any failure; no resets, history repairs or schema deletion. Do not include seeds/roles/fixtures. Verify deployed function definition, `provolatile = 's'`, SECURITY DEFINER, empty search path, postgres ownership, authenticated-only execution and unchanged private table grants using read-only catalog queries. Repeat existing read-only readiness checks. No API/Auth configuration change is needed because `app` is already exposed.

After separately approving the owner-triggered live read-only recovery check, use the original account and **Check saved operation** without Retry. Record only sanitized status/revision. Negative/failed lookup must retain the original; confirmed evidence must reconcile before cleanup. A successful check intentionally changes only the corresponding local recovery journal, so this is not part of the current no-IndexedDB-change verification. Hosted test-account/record creation, historical import and frontend deployment remain excluded.


## Approved hosted deployment result — 4 November 2026

Rechecked linked reference, all five fingerprints and a fresh dry run. Only `202611040001_operation_receipt_lookup.sql` was pending; remote 001–004 matched local history. Applied using installed CLI:

```sh
npx --no-install supabase db push --remote --skip-vault --yes
```

Exit 0. CLI reported exactly the approved single migration, `seeds: []`, `roles: []`. Post-apply history lists all five matching local/remote versions, including `202611040001`. No reset, manual history change, fixture, historical import, API/Auth setting change or unrelated migration was performed. CLI identifies this confirmed project as its production environment; target identity matched the approved reference.

Read-only catalog query (`db query --remote --read-only --file`) passed:

| Verification | Result |
| --- | --- |
| RPC in app schema / uuid argument | Present |
| Authenticated execution | Allowed |
| Anonymous / PUBLIC execution | Denied / denied |
| Owner / SECURITY DEFINER / volatility | postgres / true / STABLE (`s`) |
| Fixed search path | Empty |
| Deployed function body | MD5 `dd6955f069c98ba919dbd8ad0624cb67`, matches approved local body |
| RLS | Enabled on all 22 app/private tables |
| App policies | 11 remain present |
| Unexpected client table grants | 0 (mutations, private reads, anonymous reads) |
| Private schema usage / private helper execution | Denied for anon and authenticated |
| Raw membership / session scorer Auth-ID reads | Denied for authenticated |
| Existing app functions, including scoring RPCs | Present with postgres ownership, empty fixed paths and authenticated-only client execution |

This was catalog verification, not an invocation of scoring or receipt lookup. Existing scoring behavior was not exercised against hosted data. No account, player, match or receipt was created by testing. The unresolved owner operation was neither inspected through the new RPC nor retried, and browser storage was untouched. No frontend deployment occurred. Stop here for review before any separately approved live recovery test.
