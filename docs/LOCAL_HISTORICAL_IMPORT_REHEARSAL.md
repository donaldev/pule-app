# Local historical import rehearsal

Verified using PostgreSQL **14.8 (Homebrew)** and the existing five migrations in a newly created disposable loopback-only database. Database dropped after verification. **No hosted access, QA identity reuse, source edits, migrations, Auth accounts, account links or deployment.**

Input fingerprint remained `97eef9a63e6a9d927a6cf63a153059f8b7f9aff9173d3fbf013cb854ead94538`.

## Implemented and executed

- `scripts/legacy/import_local.py`: schema-mapped rows and transactional SQL generation; no network/database connection code. Explicit columns, deterministic IDs, source/group serialization lock, exact comparison on existing keys, deferred integrity validation before commit. Identical existing rows skip; changed content stops and rolls back. No blind upserts, trigger disablement, cascade or schema changes.
- `scripts/legacy/rehearse_import.py`: creates/drops a uniquely named database on **127.0.0.1** only. Sanitizes inherited PG environment, accepts only a local port, applies existing migrations and minimal empty Auth stand-in, runs import/failure tests and SQL assertions. Does not accept a hosted URL. Generated SQL also requires the disposable database-name prefix.
- Private SQL, diagnostics and machine-readable results: ignored `data/legacy/rehearsal-nov-4/`. SQL may contain sanitized source records and must stay private. No credentials or financial values are extracted.

Repeat with the isolated local PostgreSQL server running on port 55439:

```sh
python3 -B scripts/legacy/rehearse_import.py
python3 -B -m unittest discover -s scripts/legacy/tests -v
```

## Actual committed insertions

| Table / entity | First run | Second run |
| --- | ---: | ---: |
| Historical staging group | 1 | 0 |
| Permanent players / group profiles | 2 / 2 | 0 / 0 |
| Venues / legacy_unknown rule | 4 / 1 | 0 / 0 |
| Source / accepted batch | 1 / 1 | 0 / 0 |
| Private source records | 527 | 0 |
| Match nights / session participants | **37 / 74** | **0 / 0** |
| Authoritative reported results | **74** | **0** |
| Canonical frames / frame participants | **452 / 904** | **0 / 0** |
| Private frame observations | **453** | **0** |
| Stable legacy entity links | 495 | 0 |
| Auth users / player-account links | **0 / 0** | **0 / 0** |

All rows are inserted in one transaction; batch acceptance becomes visible only at commit. A second run compares saved mapped fields and inserts nothing. Source/batch and canonical references remain unchanged. This adapter covers the approved exact snapshot; a future changed snapshot requires reviewed provenance/rebinding logic rather than silently changing existing sporting records.

## SQL standings and head-to-head

| Player | Nights | Night wins | Losses | Draws | Frame wins | Frame losses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Donal | **37** | **19** | 13 | **5** | **407** | 351 |
| Sean | **37** | **13** | 19 | **5** | **351** | 407 |

Independent reported-result H2H query also returned **37 nights, Donal 19 wins, Sean 13 wins, 5 draws, frames 407–351**. Total **758**, counted once from reported results. Operator standings use the existing `private.session_standings` result-authority function used by `get_standings`; raw canonical frame wins are never added to reported wins.

Verified in the actual database:

- 16 score-only nights contribute their reported results and **zero** individual frames.
- All 452 canonical frames are present, but only **436** are detail-eligible. October 28's retained 16 details are all ineligible; approved 12–5 result is preserved.
- Row 420 remains one private `excluded_noncanonical` observation, canonical link null and detail eligibility false. Full private sanitized evidence and provenance retained.
- November 4 Active source ID `m_1793836042786` has **zero imported sessions**.
- Unknown fields remain null: **22 breakers, 75 break-pot values**, all 37 historical seasons/timezones/occurrence instants/start/finalization timestamps. Imported durations keep imported quality; no reconstructed timing.
- No QA identities, Auth users or account ownership links exist in this database.

## Failure and rerun tests

All passed against PostgreSQL, not dictionary simulations:

1. Inject failure after result insertion during first import: all preceding inserts roll back to empty tables.
2. Seed a conflicting group ID inside the test transaction: importer rejects it; entire transaction rolls back.
3. Import the valid snapshot twice: second run inserts zero rows in every mapped table; saved counts unchanged.
4. Change a historical reported result under its existing key: content-conflict rejection (`23514`); database unchanged.
5. Change private observation evidence: content-conflict rejection (`23514`); saved evidence unchanged.
6. Insert a participant referencing an absent frame: FK rejection (`23503`); transaction rolls back.
7. Add a frame and pair to a score-only night: deferred integrity rejection (`23514`); transaction rolls back.

Existing validator regression suite: **33/33 passed, no skips**. SQL runner asserts insertion counts, unchanged counts after failures, unknown values, private exclusion, All-Time totals and independently computed H2H. Workbook rehashed after execution. No frontend/scoring changes; frontend build/lint unrelated and not rerun.

## Schema limitation and honest test boundary

An **active** group must have one Auth-backed owner. To honor the prohibition on creating Auth accounts, the dedicated local group is **archived staging**, requiring no membership. Imported players are permanent guest identities with no ownership link. The required group configuration timezone is UTC as an operational schema value, **not** a claim about legacy timing: every imported `timezone_snapshot` is null.

This requires no schema change and fully represents the sporting records. It does mean authenticated `app.get_standings`, RLS visibility through active membership, JWT/PostgREST and UI history were **not exercised** for this ownerless archived group. Operator-only SQL verifies the same authority helpers and arithmetic. Do not treat archived staging as player-accessible deployment readiness. PostgreSQL 17/Supabase integration, concurrent import execution, backup restoration and multi-snapshot updates remain outside this successful local rehearsal.

## Minimum later account-link procedure

1. Donal and Sean register/confirm their own Auth accounts separately. Registration must not create replacement historical player identities.
2. A trusted reviewer independently verifies each person and records a verification reference. Resolve any existing guest/account links explicitly; never match by display name alone.
3. In a separately approved privileged transaction, lock the existing historical `private.players` row and the verified existing `auth.users` row. Check neither that player nor user is already linked to someone else. Stop on disagreement; never overwrite a prior link.
4. Insert exactly one `private.player_account_links` row containing the existing player_id, verified user_id, verified_by reviewer Auth UUID and verification_reference. Preserve all group/session/frame/result references. Existing unique constraints prevent a competing duplicate claim; rollback on a race.
5. Group membership is separate from identity ownership. Assign the reviewed existing owner/member accounts with appropriate roles. Activate a staging group only in the same transaction that establishes its required owner. Verify access with real Auth tokens before use. No browser service-role access or public claiming flow is needed or implemented here.

## Before any hosted import

1. Review/approve these actual SQL results and the adapter. Confirm target real group and an already verified owner; explicitly bind IDs and legacy_unknown rule. The local archived staging group is not an instruction to create an ownerless active hosted group.
2. Inspect the target **only after authorization**, reconcile prior imports/name collisions without merging QA identities, and take/rehearse a restorable backup.
3. Adapt the local-only guarded runner into a separately reviewed authorized import entry point; do not remove the guard and point this test runner at hosted Supabase. Prove actual API/RLS visibility, PostgreSQL 17 compatibility, rerun/no-overwrite behavior and rollback in the approved staging environment.
4. Review exact SQL/checksum and approval scope. Preserve null seasons/timezone and all private evidence; exclude Active record and financial data. Establish append-only handling for a later workbook snapshot before attempting one.
5. Obtain **explicit hosted-import approval**. Execute the reviewed transaction only, verify imported-cohort and total group standings separately, and retain sanitized reconciliation. No fixtures/bootstrap or QA edits belong in that step.

Stopped after local verification. No hosted import is authorized or performed.
