# Standard scoring default migration review

Reviewed `202611040002_standard_scoring_default.sql`; SHA-256 `e8f7a37dc45c1b663c16f537c0dcb41ec4923a2132cba02dc2a6adca865355e3`. Migration SQL unchanged in this review. **No hosted access or application.**

Local execution: existing PostgreSQL 14.8 cluster, new disposable database, existing migrations 001–005 and synthetic fixture data; database dropped afterward. Runner: `python3 -B scripts/database/review_standard_defaults.py`.

Passed nine migration checks:

1. Existing active legacy-only group receives exactly one verified version-1 default.
2. Existing verified rule rows remain byte-for-byte unchanged; no extra rule added to those groups.
3. Imported fixture sessions, frames, results, participants, provenance, Auth users and memberships remain unchanged across migration.
4. Authenticated create_group creates group, owner and standard default in one transaction.
5. Exact operation receipt retry returns the same group and leaves one default.
6. Repeating the backfill inserts nothing.
7. Injected failure during default insertion leaves no group or operation receipt committed.
8. Private trigger function retains SECURITY DEFINER, empty search path and no direct anon/authenticated execution.
9. Reapplying the entire DDL fails at the existing function and makes no changes. This is a once-only, migration-history-managed migration, not a manually rerunnable SQL script.

**106 existing SQL assertions passed**, including authorization/RLS, historical reported-result authority, native validation, multiplayer scoring, correction, finalization and receipt security. All tests synthetic/local; this is not a real hosted PostgreSQL 17 or JWT/PostgREST test.

The migration inserts only rule_versions rows and creates its private trigger/function. It does not update historical legacy_unknown records, assign rules to old sessions, overwrite existing verified configurations, or change scoring RPCs/RLS.

Limits: backfill targets active groups; archived groups are intentionally not initialized. An existing nonverified row named exactly `Pule standard` conflicts with the group's unique label and causes a full rollback, not a silent rename/overwrite. Check such collisions read-only before applying if group contents have changed. No live PonDon inspection was performed in this review.

For the confirmed linked target, inspect the dry run and ensure only this pending file is listed:

```sh
npx --no-install supabase db push --remote --skip-vault --dry-run
```

Only after hosted application approval, apply through CLI migration history (not pasted SQL):

```sh
npx --no-install supabase db push --remote --skip-vault
```

Neither command was run during this review. Stop on unexpected pending migrations, collision, or any failure; do not reset or repair history to force success.
