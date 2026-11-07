# Database foundation implementation

**Current extension:** the foundation below is preserved and extended by migrations `003`/`004` for rotating 2+ player nights, explicit frame pairs, private Auth-ID reads and initial owner onboarding. See [MULTIPLAYER_READINESS_REPORT.md](MULTIPLAYER_READINESS_REPORT.md) for current tests, implemented scope and deployment approval gate. Two-player-only descriptions and 51-test counts below record the initial foundation, not current limitations.

3 November 2026. Actual migrations, scoring commands, RLS, synthetic database tests and an unused typed client/service layer are implemented. No historical data was imported; no hosted Supabase resources or production endpoints were used. Existing prototype screens remain intact and disconnected.

## Implemented files

| Files | Purpose |
| --- | --- |
| `supabase/migrations/202611030001_foundation.sql` | Group/membership, permanent private identities, group-local roster, venues, seasons/rule versions, sessions/participants, frames/participants, authoritative historical results, provenance/import links, private noncanonical observations, operation receipts and correction/review journals; relational checks, indexes, deferred integrity checks and RLS |
| `supabase/migrations/202611030002_scoring_commands.sql` | Transactional scoring RPCs, authoritative state and standings; pause/resume included |
| `supabase/config.toml` | Local Supabase configuration, exposed `app` schema, private schema not exposed, no seed/import |
| `supabase/tests/bootstrap_postgres.sql` | Minimal Auth stand-in for a disposable plain PostgreSQL database only; never apply to Supabase |
| `supabase/tests/fixtures.sql`, `scoring.sql` | Synthetic fixtures and SQL assertion suite; not application migrations or seed data |
| `scripts/database/run_tests.py` | Creates a uniquely named loopback-only test database, applies both migrations, runs assertions and parallel-connection tests, then drops that database |
| `src/data/remote/database.types.ts` | Hand-maintained read/RPC contract, historical nullability and session-state types |
| `src/data/remote/supabase.ts`, `scoringService.ts` | Lazy browser client, typed scoring/state/standings/setup operations and structured error codes |
| `src/features/auth/services/authService.ts` | Sign-in/out, user/session lookup and subscription; no player creation or claiming |
| `.env.example`, `.gitignore` | Placeholder local browser configuration; secret/local-runtime ignore rules |
| `package.json`, `package-lock.json` | Supabase JS 2.118.0 dependency, `test:db` and `test:legacy` scripts |
| `scripts/legacy/validate_history.py`, its tests | Full private evidence preservation for the excluded source observation; no canonical score or detail eligibility |
| Existing database/historical/validation documents | Updated to reflect the latest private-evidence instruction; this report records implementation status |

## Database and security behavior

Ordinary authenticated clients receive group-scoped SELECT access only. Every exposed table has RLS. Anonymous users have neither schema access nor history reads. Browser INSERT/UPDATE/DELETE/TRUNCATE and private-schema access are not granted. Member predicates check live membership and group status; imported sessions remain hidden until their batch is accepted. Sequence-disputed approved results remain readable and eligible for result-level standings.

Composite foreign keys bind venues, rules, seasons, participants, frames, results and provenance to the owning group. Frame winner/breaker/offender must belong to that frame. Native and imported validation are separate: native sessions require verified rule versions, actual occurrence/start instants, exactly two participants and server-measured frame clocks. Completed native frames require known winner, break-pot status, event, foul counts and valid event relationships. Unknown historical fields stay null. Score-only sessions cannot contain frames. Approved imports require two reported result rows.

Active groups require one owner; referenced rule versions are immutable. Completed records use restrictive foreign keys rather than destructive cascades. Private source evidence, receipts and correction journals reject UPDATE/DELETE. Future observation resolution is an append-only review decision, not a source rewrite. No browser claim API exists: same display name never transfers a permanent player identity or creates an account link.

Historical standings choose exactly one authority per session: approved reported results for imports, completed frames for native sessions. Frame detail is never added to a reported result. All-Time applies no season predicate; explicit season filters apply to the same result population. Imported approval is independent of sequence quality. The suspected duplicate can be stored privately with `excluded_noncanonical`, a null canonical link and false detail eligibility.

Definer functions use fixed empty search paths, qualified relations and explicit caller checks. Public/anonymous execution is revoked; private helpers are not callable by authenticated clients. These choices follow the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). The lazy typed client follows the [official client initialization contract](https://supabase.com/docs/reference/javascript/initializing).

## Transaction contract

| RPC | Behavior |
| --- | --- |
| `start_session` | Validates scoring role, available pair, same-group venue/rules/optional season and initial breaker; atomically creates session, participants, receipt and event |
| `start_frame` | Locks the active session, checks revision, rejects another active frame, records explicit breaker and server timer anchor |
| `set_frame_paused` | Saves accumulated active milliseconds on pause and a new server anchor on resume; cannot pause/resume an invalid state |
| `complete_frame` | Validates winner/metadata, freezes server-derived active duration, saves frame/participant fouls and returns recomputed score atomically |
| `correct_frame` | Corrects winner/fouls on a logged frame in an active native night, requires reason, preserves any different running frame, journals before/after state and recalculates score |
| `finalize_session` | Explicitly finalizes a nonempty night with no running/paused frame; future scoring rejected |
| `get_session_state` | Membership/batch-checked saved session, participants, scores, frames and sanitized correction history |
| `get_standings` | Group/optional-season result-level standings, including score-only and sequence-disputed approved historical results |

Each mutation requires an operation UUID. Receipts are keyed by actor + operation UUID and store the full typed request and original saved response. Exact retries return that response, even after later revisions; changing the payload with the same key fails. A session lock serializes scoring; a transaction advisory lock serializes operation-key reuse. Expected revision is compared with the locked server revision. Different competing operations cannot award the same frame twice. Only the assigned scorer or an admin/owner can mutate a night; viewers cannot score. Membership authorization holds shared locks through commit, so revocation cannot interleave halfway through acceptance.

The service deliberately performs no automatic write retry or revision rebasing. Retain the original operation ID and payload for uncertain outcomes; retry identical intent or refetch to recover conflicts. Receipts are authoritative saved snapshots, not necessarily the latest state. Corrections and all related records commit together. Failure rolls back score, frame metadata, revision and receipt/event writes.

## Tests actually executed

| Check | Result |
| --- | --- |
| Apply both migrations to a new disposable PostgreSQL database | Passed |
| SQL assertions | **51 passed** |
| Real separate-connection competing submissions | **Passed:** one commit, one revision conflict; one awarded win |
| Real separate-connection same-operation retries | **Passed:** identical responses, one journal entry |
| Historical validator baseline | **36/36 passed** |
| Historical regression tests | **24/24 passed**, including complete excluded evidence preservation |
| `npm run build` | Passed, TypeScript and Vite |
| `npm run lint` | Passed |
| `npm audit` | Reports 12 moderate advisory entries in the ESLint/minimatch development-tool chain; no forced dependency downgrade applied |

SQL assertions cover cross-group reads/RPCs/FKs, anonymous access, private evidence and ownership links, viewer/scorer permissions, direct-write denial, exactly-two-player creation, operation-key misuse, native rule validation, start/pause/resume/paused completion, duplicate completion, stale revisions, correction recalculation/audit, correction without interrupting a running frame, finalization constraints, post-finalization rejection, reported-score authority with tracked detail, score-only history, season filtering, historical nulls, append-only journal, referenced rules and RLS/grant coverage.

Executed on **PostgreSQL 14.8 (Homebrew)** in an isolated temporary cluster, using a minimal synthetic `auth.users`/`auth.uid()` stand-in. Each suite run created and dropped its own database. This is real PostgreSQL migration/RLS/transaction testing, **not** a full Supabase test. Test roles and request claim settings simulate database identities; they do not validate JWT signatures, Auth enrollment or the API gateway.

**Not executed:** Docker/Supabase stack startup, Supabase's configured PostgreSQL 15 runtime, GoTrue/JWT and PostgREST calls, generated live schema types, browser-to-database smoke tests, database restore rehearsal, finalized/historical amendment workflows and account-claim races. No historical database import or real-data database acceptance test occurred.

## Run the standalone database suite

The runner needs `python3`, `psql`, `createdb`, `dropdb` and a running local PostgreSQL server owned by your OS user. It connects only to `127.0.0.1` and creates a randomized disposable database; it does not use a hosted URL or inherited PG credentials.

For a new isolated temporary cluster with Homebrew PostgreSQL tools:

```sh
initdb -D /private/tmp/pule-foundation-pg -A trust --no-locale -E UTF8
pg_ctl -D /private/tmp/pule-foundation-pg -l /private/tmp/pule-foundation-pg.log -o '-k /private/tmp -p 55439 -h 127.0.0.1' start
npm run test:db
pg_ctl -D /private/tmp/pule-foundation-pg stop
```

Initialize only a new directory. If this task's temporary cluster directory already exists, reuse it with `pg_ctl ... start` instead of rerunning `initdb`. Use `python3 -B scripts/database/run_tests.py --port OTHER_LOCAL_PORT` for a separate local server. The trust-auth cluster must remain loopback-only and temporary.

## Run the full local Supabase stack next

**Missing here:** Docker Engine/Desktop and the Supabase CLI (`docker` and `supabase` are absent). Install those separately, start Docker, then in this project:

```sh
supabase start
supabase db reset --local
supabase status
cp .env.example .env.local
```

`db reset --local` resets the local Supabase database; run it only for the new disposable development stack. No historical seed is configured. Place only the local API URL and publishable/anon key from `supabase status` in `.env.local`; never a service-role or secret key. Browser configuration rejects secret keys and non-anon legacy JWT keys. No hosted link/project creation is needed.

Run the SQL assertions against that disposable local database without the stand-in bootstrap:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f supabase/tests/fixtures.sql -f supabase/tests/scoring.sql
supabase gen types typescript --local --schema app > /private/tmp/pule-local.types.ts
```

Fixtures are single-use synthetic data; reset the disposable stack before rerunning them. Never run fixture/bootstrap SQL on hosted/production databases. Compare generated types with the checked-in RPC contracts; do not overwrite their domain aliases blindly. Then verify real local Auth sign-in, gateway permissions, all RPC payloads and error responses through Supabase JS before connecting scoring UI. The parallel-connection test runner currently tests a fresh standalone cluster; repeat equivalent concurrency tests on the local Supabase database before deployment approval.

## Readiness and remaining scope

**Ready for review and full local Supabase verification. Not yet ready to connect production scoring UI.** Scoring storage and transactions are implemented rather than replaced with localStorage. Auth storage is handled by the SDK; it is not a scoring persistence substitute. Existing prototype screens import none of the new services and make no new network calls.

This foundation intentionally leaves group onboarding/invites, guest/venue creation RPCs, membership administration/owner transfer, claim verification, scorer takeover, historical/finalized amendments, abandonment, broader analytics, recovery outbox and final rules/season configuration for later reviewed work. Initial local test setup is synthetic operator SQL. No user-facing setup or claim flow is being implied by the schema alone. Season assignment is explicit; there is no guessed legacy season or breaker rotation policy.

The zero-second observation is now retained completely in the private proposed evidence output, as requested by the latest task, while canonical frames remain 420 and the full reported baseline remains 36 nights / Donal 19 wins / Sean 13 wins / 4 draws / 391–335 reported frame wins. The workbook fingerprint is unchanged. Numeric financial information remains excluded.

Next gate: review these migrations, run the full local Supabase integration checks and resolve native rule settings; then authorize wiring setup/live scoring to verified services. Hosted resources, historical import and deployment still need separate approval.
