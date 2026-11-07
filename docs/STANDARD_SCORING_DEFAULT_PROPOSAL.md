# One standard scoring format — minimal pending migration

Pule has one native scoring format. Rules are internal validation metadata, never a player feature. Players choose people, venue and breaker, then start.

Prepared `supabase/migrations/202611040002_standard_scoring_default.sql`; **not applied to hosted Supabase**.

The smallest backend change needs no new RPC, table, column or rules-management system:

- An AFTER INSERT trigger adds the existing verified version-1 default inside the group-creation transaction. If creation fails, both roll back. Existing RPC authorization, operation receipts and retries stay unchanged.
- One migration statement gives each existing active group without a verified version-1 row the same internal default. PonDon becomes ready without owner administration. Existing verified rows are reused.
- No historical legacy_unknown row, frame, result, participant, membership or Auth record is updated. Referenced-rule immutability and scoring validation remain intact.
- Trigger function is private SECURITY DEFINER with an empty search path; direct client execution revoked. Browser table writes remain forbidden. No read-effect or frontend automatic adoption call.

The frontend rule-review/configuration controls are already gone. The new-UI setup command type also excludes adoption. Old intent dispatch, receipt matching and contracts remain deliberately compatible so an existing saved request is not made unrecoverable; these are not player features.

Approval/testing gate: exercise group creation, operation replay, existing-group backfill, historical invariance and role isolation in a disposable database before hosted application. The SQL is prepared but has not been executed in this pass. If an unverified historical row already uses the unique label `Pule standard`, the migration fails and rolls back rather than renaming it. No such collision has been checked hosted in this task. Archived groups are not backfilled; new groups receive a default atomically.

**Remaining blocker:** reviewed migration application, not user configuration. Until then, groups without a verified row keep a plain unavailable message and disabled Start; history remains accessible. No user should be asked to enable or name anything. No extra native format or manual configuration workflow is proposed.
