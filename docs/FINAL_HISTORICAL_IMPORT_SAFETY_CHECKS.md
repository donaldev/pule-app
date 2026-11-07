# Final historical import safety checks — blocked

**Not ready for final hosted import approval.** No hosted write, import, migration, deployment, Auth creation or Local/QA data modification occurred.

## Verified now

Prepared SQL SHA-256 remains exactly:

`8fdc5472840a4c0a13bf2cceadf2f52a2a9ed7ef79160dba00b81f031640ee33`

The existing PostgreSQL 14.8 rehearsal remains valid evidence of its previously reported counts, identical rerun and rollback/conflict behavior. It is not PostgreSQL 17 evidence or authenticated API evidence.

## Uncompleted gates

| Gate | Result / reason |
| --- | --- |
| Supported hosted backup availability | Unknown. Installed CLI supports `supabase backups list --remote=pgljdmevusgvvlplaedt`, but execution permission was denied before the listing ran. No backup result was obtained. |
| Tested restore | Not performed. A listed snapshot alone would not prove restoration works. |
| Exact SQL on PostgreSQL 17 | Not performed. Local Homebrew server installations found were PostgreSQL 13/14/unversioned; no PostgreSQL 17 server was found. Docker Desktop is installed and a launch was attempted, but no daemon socket was available. No image/container was created. |
| Isolated owner/member history and standings | Not performed. Requires the isolated environment and representative local identities. No hosted test accounts or tokens were requested/created. |

## Smallest safe resolution

1. Owner checks the Supabase dashboard's database backup/restore page for a successful current snapshot and supported restore option, or permits the read-only CLI backup listing. Do not send credentials, download URLs, account emails or tokens. Record backup timestamp/status and restore capability only.
2. Start a working existing Docker engine (or supply an existing isolated PostgreSQL 17 server). Then run the exact reviewed SQL in a disposable `postgres` database with migrations and **local-only** representative owner/member identities. This avoids changing the hosted target or installing project dependencies. Test the precise SQL guards unchanged, except that its already-approved target IDs are represented by isolated local fixtures.
3. Check actual first-run and second-run counts, injected transaction rollback, conflicting existing facts and All-Time totals. Exercise authenticated SELECT/RPC permissions under local owner/member and unrelated-account roles; label SQL role/claim emulation separately from signed JWT/PostgREST integration. No Auth users should be added hosted.
4. If supported platform backup is unavailable, the simplest alternative is a private operator PostgreSQL 17 logical backup followed by a restore into that disposable environment. Include data, schema, constraints/grants and required Auth/membership dependencies. An app-only or schema-only dump is not a full-project restore. Managed Supabase services, roles and Auth recovery may require platform-specific steps. Do not call this alternative restorable until its restore and checks succeed.
5. Retain the exact prepared checksum and obtain final explicit hosted-import approval only after the above results are recorded. Do not weaken the existing SQL guard or bypass backup checks to reach approval.

No additional infrastructure or scoring/UI changes were introduced in this check. Backup availability and restore testing are unresolved, not failed backups. The Docker/runtime limitation is an environment blocker, not an import-schema defect.
