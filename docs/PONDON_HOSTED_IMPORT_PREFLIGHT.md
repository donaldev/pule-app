# PonDon hosted import preflight

**Prepared only. No hosted inserts, updates, deletes, migrations, imports, account links or deployment executed.** Hosted inspection used enforced read-only SELECTs. No Local/QA sporting data was changed or merged.

## Verified destination

- Supabase: Pule_2.0, project `pgljdmevusgvvlplaedt`, PostgreSQL **17.11**.
- PonDon group: **`383bd6df-9050-4d1c-b48f-d2a0f3349517`**, active.
- Sole active owner membership: **`33251a76-7709-4818-8ed0-01e54d8c54cc`**. Referenced Auth user exists and email is confirmed. This verifies database membership/account status, not independent personal identity. No email, token or password was retrieved.
- All scoped counts are **zero**: permanent originating players, roster profiles, venues, seasons, rules, sessions, frames, reported results, import sources/batches/records, private observations and legacy links.
- Global key-only collision checks for every proposed table returned **zero existing matching keys**. This includes historical player UUIDs, not just PonDon-local names. No QA identity reuse is proposed.

Counts and ownership are point-in-time findings; recheck immediately before any approved import.

## Final proposed payload

Workbook fingerprint remains `97eef9a63e6a9d927a6cf63a153059f8b7f9aff9173d3fbf013cb854ead94538`.

| New records | Count |
| --- | ---: |
| Permanent unclaimed players / active roster profiles | 2 / 2 |
| Venues / historical legacy_unknown rule | 4 / 1 |
| Completed nights / participants / reported results | 37 / 74 / 74 |
| Canonical frames / frame participants | 452 / 904 |
| Source / accepted batch / source records | 1 / 1 / 527 |
| Private frame observations / stable legacy links | 453 / 495 |
| Groups, memberships, Auth accounts, account links | **0** |

| Original venue | Nights |
| --- | ---: |
| Soho | 26 |
| Sneaky Pete's | 9 |
| The Mac | 1 |
| Marstins Kingsway | 1 |

Venues belong to the group and each session references its own original venue. No permanent group venue exists in the schema, and none is added. No seasons or missing timestamps/timezones are assigned.

Expected PonDon All-Time and Donal/Sean H2H:

| Player | Nights | Wins | Losses | Draws | Frames won |
| --- | ---: | ---: | ---: | ---: | ---: |
| Donal | 37 | 19 | 13 | 5 | **407** |
| Sean | 37 | 13 | 19 | 5 | **351** |

Total reported frames **758**, counted once via reported authority. Preserve all 16 score-only nights without frame invention. Of 452 canonical frames, only 436 are detail-eligible. October 28 stays reported 12–5; the 16 retained details stay ineligible, and excluded source row 420 remains complete private noncanonical evidence. November 4 Active 0–0 is absent from the import. Financial values are excluded.

## Guarded preparation entry point

New `scripts/legacy/prepare_pondon_import.py` is a dedicated **prepare-only** entry point. It binds the existing schema adapter to the actual PonDon UUID, omits group creation, retains stable historical player/frame/session IDs and emits private SQL/manifest. It has **no database connection or execution capability**. The disposable rehearsal runner is not repurposed.

```sh
python3 -B scripts/legacy/prepare_pondon_import.py
```

Private ignored artifacts under `data/legacy/pondon-preflight/`:

- `approved-pending-import.sql` — prepared, not executed.
- `final-manifest.json` — bound IDs, counts, venues, expected standings and exclusions.
- `read-only-collision-check.sql` — key-only SELECT; executed successfully.
- `hosted-read-only-evidence.json` — catalog and collision evidence; no credentials.

Prepared SQL SHA-256:

`8fdc5472840a4c0a13bf2cceadf2f52a2a9ed7ef79160dba00b81f031640ee33`

The shared `import_local.import_sql` generator now accepts an explicit guard; its default local database-name guard remains unchanged. The PonDon SQL checks database name/version, exact group/name/active status, confirmed original owner and one-owner invariant. It rejects unrelated additions in PonDon, compares all mapped existing fields and refuses changed content; reruns with the exact same rows skip inserts. No UPDATE to a sporting record is generated.

The future transaction uses short lock/statement timeouts and table write locks while checking/inserting, plus the existing advisory lock. This briefly blocks writes to shared sporting tables—including other groups—so schedule a short maintenance window. No QA row is modified. Locks prevent a concurrent native command from slipping new records into the empty-group preflight. Any timeout/error rolls back. Foreign keys/deferred checks remain enabled. Final cohort count/authority assertions run before commit.

## Hosted compatibility and app visibility

Read-only catalog verification found all proposed table/column names in the deployed schema; all 22 app/private tables retain RLS. Seven deployed functions exactly match their migration bodies: is_member, batch_visible, session_visible, get_session_state, get_standings, private.session_scores and private.session_standings. The five app functions retain authenticated execution; private authority helpers remain inaccessible directly.

Deployed policies permit active PonDon members to read group-local profiles, venues and accepted-batch sessions. Existing history listing uses RLS-filtered match_sessions; get_session_state validates membership/batch visibility; get_standings uses approved reported results for imports. The prepared batch is accepted only when its entire insertion transaction commits. The owner meets the verified membership conditions. Other accounts need their own authorized active membership; player ownership alone does not grant access.

This establishes schema/authorization compatibility from deployed code and catalogs. **No actual owner JWT/PostgREST call or PostgreSQL 17 import was executed.** The earlier transactional rehearsal ran on PostgreSQL 14.8. A 17.x write rehearsal/backup restore and real authenticated visibility test remain gates; do not claim build/schema inspection proves end-to-end hosted behavior.

## Historical identity and future scoring

- Donal: `acc51043-01a0-507d-8fdd-ae0729e9fe68`.
- Sean: `5c575a65-aa80-590a-843a-0dfc7d5c1d89`.

These same permanent UUIDs acquire active PonDon roster profiles. The existing player picker loads those profiles, so future nights can select them directly without creating duplicate guests or requiring an account claim. Preserve all historical references.

**Native scoring rule prerequisite:** the importer creates only `legacy_unknown` rules. The existing setup API intentionally lists verified rules for new nights, and native commands require them. After import, the owner must separately review/adopt a native rule preset via the existing app; do not relabel historical rules or invent legacy semantics. Venues will already be selectable. No claim or verified rule is created during preflight/import.

Later account linking remains a separate verified operator transaction: validate existing Auth identities independently, lock player/user rows, reject prior inconsistent links, insert player_account_links with verifier/reference, and retain permanent UUIDs. No name matching, replacement player, QA merge or public claiming system.

## Restorable backup and rollback plan — not executed

Before approval/application:

1. Take a current Supabase-supported project backup or snapshot with a verified restore path. Confirm plan/retention support in the dashboard; none is assumed or configured here. Preserve a private operator logical export of app/private plus the existing target owner/membership references and required role/grant definitions. A schema-only dump is insufficient.
2. Use a password-protected operator connection stored locally (e.g. libpq service/password files with restrictive permissions), never command-line passwords, browser keys or chat. `pg_dump --format=custom --file <private-encrypted-location>` through that reviewed connection can create a logical snapshot. Use tools compatible with PostgreSQL 17. Keep Auth backup under the project's supported restore procedure, not a casually copied Auth table.
3. Restore the backup into a separate isolated PostgreSQL 17/Supabase rehearsal environment. Verify pre-import group counts, owner/membership, constraints, RLS/grants and representative unrelated data before calling it restorable. Hash and retain the dump with its tool/version and restore record. This has not been performed in preflight.
4. **Before commit:** ON_ERROR_STOP plus transaction/deferred checks rolls back all inserts automatically. Never repair history or retry blindly on an uncertain connection outcome; inspect batch/key status first.
5. **After commit:** do not attempt ad hoc deletes. Private provenance is append-only and FKs restrictive. If a serious issue appears, halt use and approve a visibility-only rejection of the exact import batch while retaining evidence; roster entries would still exist and may need separately reviewed containment. Full reversal requires the tested project restore procedure in a maintenance window, after accounting for any later writes. A full restore can lose later QA/other-group changes; never perform it automatically or as an unreviewed rollback.

## Precise future import procedure — requires explicit approval

1. Complete the backup/restore and PostgreSQL 17/API gates above. Confirm reviewed target owner, manifest, SQL checksum and maintenance window. No import approval is implied by this document.
2. Reconfirm CLI link `pgljdmevusgvvlplaedt`; run read-only PonDon counts/owner and key collision checks again. Abort on any changed scope, unexpected data, schema drift or ID collision.
3. Configure a private libpq service named `pule_pondon_import` pointing only to the confirmed project database (`postgres`) as an authorized operator. Validate its target read-only. Do not expose its credentials. The existing group/owner guard is defense in depth, not a replacement for connection identity verification.
4. After explicit approval of the exact reviewed SQL, execute **once** with the operator's PostgreSQL 17 client:

```sh
PGSERVICE=pule_pondon_import psql -X --set ON_ERROR_STOP=1 --file data/legacy/pondon-preflight/approved-pending-import.sql
```

This command has **NOT** been run. No seeds, fixtures, bootstrap, migrations, Auth creation or membership updates are included.

5. On failure stop; on connection ambiguity inspect the immutable imported keys/batch before deciding whether an exact rerun is appropriate. Do not modify the payload or bypass a conflict.
6. Read-only verify 37 finalized nights, 74 reported results summing 758, 452 frames/436 eligible, one private excluded observation, no Active source session, unchanged PonDon owner and unrelated-data counts. Verify actual owner Auth/API history, frame details, 407–351 standings and H2H. No new scoring writes are necessary for this verification.
7. Save sanitized evidence privately. Any rule adoption, account linking, further workbook snapshot or frontend deployment is separately authorized work.

## Tests and remaining blockers

**36/36 local Python tests passed** (33 existing plus three PonDon binding/guard tests). All mapped columns exist hosted; all proposed-key collision counts are zero. No SQL containing INSERT has been sent to hosted Supabase. Source workbook bytes unchanged; no source/application/scoring/recovery changes.

Before import: restorable backup rehearsal, PostgreSQL 17 execution rehearsal, authenticated API checks and explicit approval of exact SQL remain outstanding. Future scoring additionally needs a reviewed verified rule preset. No record-representation schema blocker was found. Stop here for approval; historical import remains unperformed.
