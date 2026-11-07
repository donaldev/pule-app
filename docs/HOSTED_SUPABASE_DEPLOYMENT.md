# Reviewed hosted Supabase deployment procedure

**Approved schema deployment completed 4 November 2026:** linked reference `pgljdmevusgvvlplaedt` and all four reviewed fingerprints were reconfirmed; a fresh dry run listed exactly the four approved files. CLI 3.0.0 applied them successfully using `db push --remote --skip-vault --yes` (`--remote` replaces the older `--linked` syntax). All four remote migration versions match local history. The existing readiness SELECTs and supplemental read-only privilege checks passed on PostgreSQL **17.11**. RLS is enabled on all 22 tables; application history and provenance are empty. **No fixtures, historical import, Vault updates, frontend deployment or hosted API/Auth-setting changes occurred. Verification is complete; stop before further hosted changes.** See [HOSTED_DEPLOYMENT_RESULT.md](HOSTED_DEPLOYMENT_RESULT.md).


Prepared 3 November 2026 for the owner-confirmed blank **Pule_2.0** project. **The owner subsequently approved schema application, completed as recorded above. Auth/API configuration and further hosted changes remain unperformed and require their own scope.** This is a deployment procedure, not permission to execute it.

## Reviewed payload and local gate

Apply the existing migrations in order, without rewriting the first two:

1. `202611030001_foundation.sql`
2. `202611030002_scoring_commands.sql`
3. `202611030003_rotating_players.sql`
4. `202611030004_hosted_onboarding.sql`


Reviewed SHA-256 fingerprints (verify before approval/application):

| Migration | SHA-256 |
| --- | --- |
| `202611030001_foundation.sql` | `27add753bf3aa7ae4c8f2cb32ebf5a512fdbe96a50eb098e5afd4ff0988c4c13` |
| `202611030002_scoring_commands.sql` | `a9c5ab9a065e05eef5af9ca2db20d4a14a78b9b8f99939e96e6811c985c75805` |
| `202611030003_rotating_players.sql` | `1a6e9e80fab2c1eed5b3f7a6ffad89d0ae6721bffcfe102ca09f70aa4f9c2d7b` |
| `202611030004_hosted_onboarding.sql` | `4fefd54dc466c80b3b66e7473623ea2274d9f8db780735e42fe2b2d4216d2143` |

The last two extend the existing foundation. No seed, fixture, workbook import, role-bootstrap SQL or production UI connection belongs in hosted deployment. No extension outside standard Supabase PostgreSQL is required. Migrations depend on Supabase-managed `auth.users`, `auth.uid()`, `anon` and `authenticated`; these exist in a standard hosted Supabase project. SECURITY DEFINER functions require the trusted migration owner to retain access to private tables and bypass ordinary RLS as Supabase's normal migration role does. Every such function uses a fixed search path and explicit caller checks.

Local verification uses real PostgreSQL 14.8 with a minimal Auth stand-in. It does not prove the target project's actual PostgreSQL version, PostgREST, JWT verification or Auth configuration. The CLI is now pinned to 3.0.0; Docker/full-stack local rehearsal remains unverified here. A full local Supabase rehearsal on the selected CLI version remains recommended before hosted application; the SQL assertions and concurrency tests run on a fresh isolated database, not the hosted project.

## Install the missing CLI and rehearse locally

These commands are provided for the owner/operator; they were not run during preparation. Install Docker Desktop/Engine separately and start it for the local stack. The CLI can be a pinned project dependency:

```sh
cd /Users/donalokeeffe/Documents/Life/Coding/Pule/pule-app
npm install --save-dev --save-exact supabase@3.0.0
npx supabase --version
npx supabase start
npx supabase db reset --local
```

Record the installed version and commit the resulting package/lockfile changes after review. Do not run `supabase init` over the existing configuration. The local reset is destructive to that disposable local stack only. Run the synthetic SQL suite there WITHOUT `bootstrap_postgres.sql`:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f supabase/tests/fixtures.sql -f supabase/tests/scoring.sql -f supabase/tests/multiplayer.sql
npx supabase gen types typescript --local --schema app > /private/tmp/pule-local.types.ts
```

Reconcile generated types with the hand-maintained service contracts; do not blindly replace their domain aliases. Reset the disposable local stack before repeating single-use fixtures. Never apply these fixture files to Pule_2.0. Repeat the separate-connection concurrency cases and a real Auth/SDK smoke test on this stack; the standalone runner uses a separate new test database and its own Auth stand-in.

## Confirm the exact hosted target

The project display name is not a unique project reference. Obtain the **nonsecret project reference** from Pule_2.0's dashboard settings. Do not derive it by printing `.env.local`. Confirm project owner/organization, region and PostgreSQL version. Reconfirm there are no application tables or prior application migrations; stop if it is not blank.

Read-only dashboard SQL for a blank-target preflight:

```sql
select current_user, current_setting('server_version');
select schemaname, tablename from pg_tables
where schemaname in ('app', 'private') order by 1, 2;
select nspname from pg_namespace where nspname='supabase_migrations';
```

If the migration schema exists, inspect its history before proceeding. Do not repair history or reset a remote database to make a mismatch disappear. Supabase's own Auth/Storage/system tables are expected even in a blank application project.

## Link and preview — after approving hosted preparation

Use the CLI's interactive login/password handling locally. Never put passwords, access tokens or service-role keys in commands, source, terminal output pasted into chat, or Vite variables. No secrets need to be sent to this assistant.

```sh
npx supabase login
npx supabase link --project-ref pgljdmevusgvvlplaedt
npx supabase migration list --remote
npx supabase db push --remote --skip-vault --dry-run
```

Check the linked project reference and ensure the preview lists precisely the four reviewed files above. Local `supabase/.temp/` linking metadata is ignored. Do not use `--include-seed`, `--include-roles`, remote reset, history repair or `--include-all`. A preview is not proof the SQL will compile against the hosted runtime; that proof comes from the actual approved migration application and subsequent checks.

**STOP HERE until explicit approval of the hosted migration writes and target reference.** Link, preview and the subsequently approved schema apply completed on 4 November 2026. This approval gate is retained as the original procedure, not an outstanding request to reapply migrations.

## Apply — only after explicit hosted-write approval

```sh
npx supabase db push --remote --skip-vault
npx supabase migration list --remote
```

Each migration is transactional. If a later migration fails, earlier committed migrations remain; stop and inspect rather than deleting schemas or editing already-applied files. Use a new corrective migration where required. The CLI records successful versions; do not also paste the files into SQL Editor, which would bypass that migration history. No data import is part of this application.

Run `supabase/verification/hosted_readiness.sql` through the authenticated operator's dashboard SQL Editor. It is read-only. Confirm:

- RLS enabled for every `app` and `private` table.
- `anon` has no application/private RPC execution or history read access.
- `authenticated` has only the explicit application RPC grants and permitted RLS-filtered reads; no table writes or private helpers.
- No raw membership/Auth recorder IDs exposed to ordinary clients.
- Zero sessions, frames and private historical observations immediately after schema-only application.
- All four migration versions recorded, with no copied synthetic fixtures.

## Expose the API and configure Auth — separate approved configuration changes

`supabase/config.toml` configures local development; pushing migrations does **not** update hosted Data API exposure.

After the SQL and grants are verified, add **`app`** to the hosted project's Data API **Exposed schemas** setting. **Never add `private` or `auth`.** Do not copy broad `GRANT ALL` examples; the migrations already provide intentionally narrower grants. Keeping an unused `public` schema exposed is not required by these services; review any existing public objects before changing that setting.

Configure Auth Site URL and allowed redirect URLs for the intended environment, email confirmation and supported providers. Keep anonymous sign-in disabled unless separately approved. User registration/Auth sign-in is distinct from player identity creation and claiming. Use an owner-approved confirmed account for initial onboarding through `create_group`; it atomically assigns that authenticated user as owner. No manual service-role browser workflow or name-based identity claim is needed.

The owner can then use the reviewed setup services to create unclaimed guests and venues and explicitly adopt **validation version 1**. That version requires an explicit breaker selected from each frame pair, known native foul counts and event/breaker/offender consistency. Review these semantics against intended play before marking rules verified; the function does not claim parity with unavailable Apps Script logic. Rule versions cannot change once referenced by history.

Do not overwrite an existing `.env.local`. Configure only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with the public URL and publishable/legacy anon key. Never use a service-role/secret key. The lazy client does not connect until called, and prototype screens remain disconnected.

## Hosted smoke test and operational gates

After a separately approved test-account/data plan, use real Auth tokens through Supabase JS to verify onboarding, membership isolation, anonymous denials, explicit pairs, completion/retry/conflict, correction and finalization. A second account must not read or mutate the first group's data. Run this first locally; do not create hosted test records without authorization. Delete no historical records as part of testing.

Remaining pre-release review: onboarding quotas/rate limits; secure member invitations and owner transfer; account claiming and appeals; scorer takeover; recovery/uncertain-outcome UX; finalized/historical amendments; backup and restore rehearsal. Initial group creation works, but adding other authenticated members still needs a reviewed invitation/admin workflow. Anyone authenticated can currently create their own isolated group; this is not permission to join another group or claim players by name.

For a failed first deployment, retain the project and migration history and review a forward fix. There is no destructive rollback script in this repository. Hosted import, historical cutover and frontend deployment remain separate future approvals.

CLI procedures and exposure checks were verified against the [official CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push), [CLI setup guide](https://supabase.com/docs/guides/local-development/cli/getting-started), and [custom schema guide](https://supabase.com/docs/guides/api/using-custom-schemas). CLI/API behavior still needs verification on the chosen installed version and actual project.
