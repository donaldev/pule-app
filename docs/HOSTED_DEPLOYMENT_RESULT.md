# First hosted database deployment result

4 November 2026. **Approved schema deployment and read-only verification completed successfully. Stopped after verification.**

## Target and approved payload

- Project: **Pule_2.0**, `pgljdmevusgvvlplaedt`, `us-east-1`.
- Linked reference was rechecked before preview and apply.
- All four SQL files matched the reviewed SHA-256 fingerprints; the local migration directory contained exactly those four files.
- A fresh dry run again listed exactly migrations 001–004.
- Installed/pinned CLI: **3.0.0**. Its installed command syntax uses `--remote`, replacing `--linked`.

Approved apply command executed successfully (exit 0):

```sh
npx --no-install supabase db push --remote --skip-vault --yes
```

`--yes` confirmed only the explicitly approved schema application. No seed, role bootstrap, include-all, history repair, reset or workaround was used. Vault updates were skipped.

## Migration history

Post-apply remote history matched local versions exactly:

| Migration | Remote version | Result |
| --- | --- | --- |
| `202611030001_foundation.sql` | `202611030001` | Applied |
| `202611030002_scoring_commands.sql` | `202611030002` | Applied |
| `202611030003_rotating_players.sql` | `202611030003` | Applied |
| `202611030004_hosted_onboarding.sql` | `202611030004` | Applied |

No migration failed. No migration source was edited during deployment.

## Read-only verification

The CLI's `db query --read-only --file` rejected the existing script's explicit `BEGIN READ ONLY` wrapper before executing it (`DbQueryReadOnlyStatementError`). This was a verification invocation issue, not a migration failure. The unchanged eight SELECT statements from `supabase/verification/hosted_readiness.sql` were then executed individually, each with `--remote --read-only`; all eight passed. The original SQL file was not modified and no write-capable verification command was substituted.

Hosted server: **PostgreSQL 17.11**. Verification queries executed as Supabase's `supabase_read_only_user`. Because `information_schema.role_table_grants` is filtered for that role and returned no rows, additional read-only `has_schema_privilege`, `has_table_privilege` and `has_column_privilege` predicates were used instead of assuming that empty grant output proved security.

| Check | Hosted result |
| --- | --- |
| RLS on `app` / `private` tables | **22/22 enabled** |
| Application SELECT policies | **11** |
| Anonymous app/private schema usage | **Denied** |
| Authenticated app schema usage | **Allowed** |
| Authenticated private schema usage | **Denied** |
| Client table mutation privileges across both schemas | **0 unexpected grants** |
| Client private-table reads | **0** |
| Anonymous application-table reads | **0** |
| Authenticated application reads | 9 table-level SELECT grants plus permitted session columns, all with RLS |
| Raw membership table SELECT | **Denied** |
| Raw session recorder Auth UUID SELECT | **Denied** |
| Session ID column SELECT | **Allowed**, subject to RLS |
| Anonymous application/private function execution | **None** |
| Authenticated private function execution | **None** |
| Authenticated application RPC execution | All 16 intended RPC/helper functions allowed |
| Function ownership / fixed search paths | Owners `postgres`; definer functions have empty fixed search paths |

These checks verify deployed schema, policies and effective grants. They do not claim that real hosted Auth-token flows, PostgREST exposure or multi-user scoring journeys were tested.

## No match data loaded

Read-only counts were all zero:

- Match-night sessions, canonical frames and private historical observations.
- Historical reported results, import batches and import records.
- Groups and permanent players.

The synthetic `test` schema is absent. No fixture/bootstrap SQL, historical workbook import, Auth-account creation or scoring command was run. The original app and source workbook remain unchanged. No credentials were requested or printed; saved results contain only schema/security metadata and aggregate counts.

Sanitized evidence and reviewed migration hashes: [HOSTED_READINESS_RESULTS.json](HOSTED_READINESS_RESULTS.json).

## Remaining blockers and next approvals

The database schema is deployed and its catalog security checks passed. **Hosted API/Auth settings remain unchanged, and the frontend remains undeployed/disconnected.** Before using the application:

1. Separately approve/review hosted Data API exposure of `app` only, leaving `private` and `auth` unexposed.
2. Review Auth Site URL, redirects, providers and confirmation policy.
3. Authorize initial confirmed-user/group setup, guests, venue and reviewed version-1 rules; none exists yet.
4. Approve a real Auth/SDK integration test plan and any hosted test records before exercising mutations. No synthetic hosted scoring tests were run in this deployment.
5. Retain remaining release gates: invitations/owner transfer, identity claiming, recovery/outbox, finalized amendments, rate limits and backup/restore rehearsal.

No additional hosted action is authorized or required by this report. Historical migration, Auth/API changes and frontend deployment remain separate future work.
