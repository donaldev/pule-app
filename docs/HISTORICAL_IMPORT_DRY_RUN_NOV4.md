# Historical import preparation — November 4 snapshot

Offline audit/dry run only. **No hosted reads or writes, database import, migrations, QA-data changes, Auth account creation, dependency installation or original-app edits.**

## Source and verified baseline

Input: `data/legacy/historical-scores-nov-4th.xlsx`, 35,640 bytes. SHA-256 matches the owner-supplied value:

`97eef9a63e6a9d927a6cf63a153059f8b7f9aff9173d3fbf013cb854ead94538`

The workbook contains Matches (76 data rows) and Frames (453 data rows). Completed history covers January 5–November 3, 2026; one additional source session is Active on November 4. All occurrences have date-only precision. Source timezone and seasons remain unknown.

| Completed-history result | Donal | Sean |
| --- | ---: | ---: |
| Nights played | 37 | 37 |
| Night wins | 19 | 13 |
| Night losses | 13 | 19 |
| Drawn nights | 5 | 5 |
| Authoritative reported frame wins | **407** | **351** |
| Frame-win percentage | 53.693931% | 46.306069% |

Total reported frames: **758**. Standings must use the 74 reported result rows exactly once, never add canonical detail wins to them. These are the expected historical-cohort totals, not a claim about current hosted totals. Existing QA/native data, if in the same eventual target group, would remain additional results; choose the correct real target group rather than deleting QA data.

| Classification | Nights | Source frame rows | Canonical proposals | Detail-eligible frames | Reported frame wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Score-only | 16 | 0 | 0 | 0 | 305 |
| Fully reconciled | 20 | 436 | 436 | 436 | 436 |
| October 28 disputed details | 1 | 17 | 16 | 0 | 17 |
| Completed total | **37** | **453** | **452** | **436** | **758** |
| Active, not imported | 1 | 0 | 0 | 0 | Excluded |

## New and excluded records

**November 3:** `m_1793747146794`, Sneaky Pete's, Matches rows 74–75. Donal 16–16 Sean; Frames rows 423–454 contain exactly 32 frames numbered 1–32, 16 wins each. Detailed counts and final result reconcile. This adds one draw and 16 reported frames per player to the previous baseline; no earlier sanitized result/frame facts changed.

**November 4:** `m_1793836042786`, Soho, Matches rows 76–77, Active, Donal 0–0 Sean. No associated frame rows. Retained only in private local `incomplete_results_not_imported` evidence; no completed session, reported results, canonical frame or standings contribution proposed. Future completion requires a fresh export/review, not guessed finalization or a fabricated draw.

**October 28:** `m_1793225336292`. Preserve approved final result Donal 12–5 Sean. Frames row 420 (source frame 14, zero seconds) stays excluded from canonical proposals; its complete observation remains private with `excluded_noncanonical`, null canonical link and false detail eligibility. Row 419 remains frame 14; frames 15 and 16 retain their numbers. Retained detail is 11–5, so all 16 canonical details remain ineligible for detail/sequence statistics. The official result remains eligible. No workbook row is removed or changed.

**Other quality findings:** Frames row 300 still has a contradictory running-score label; keep the actual winner and original text with a quality flag. Among 452 retained observations there are 22 unknown breakers, 75 unknown break-pot values, eight Super Fouls without offenders and six unrecorded pockets. Missing values stay null. Imported durations remain unverified; no start/pause timestamps are reconstructed. Breaker/event rules are not invented. Numeric financial values are never extracted into proposals, evidence or the manifest; shifted F-column status tokens alone remain legitimate status evidence.

## Deterministic private outputs

Reproduce locally, without network/dependencies:

```sh
python3 -B scripts/legacy/validate_history.py --input data/legacy/historical-scores-nov-4th.xlsx --output-dir data/legacy/validation-nov-4
python3 -B scripts/legacy/prepare_import.py
python3 -B -m unittest discover -s scripts/legacy/tests -v
```

`data/legacy/validation-nov-4/` contains `proposed-records.json`, `reconciliation.json` and `import-manifest.json`. The existing `/data/legacy/` ignore rule protects workbook and outputs. Detailed reconciliation belongs here, not in public Git. Old snapshot outputs stay under `data/legacy/validation/` and are independently reproducible using the validator's original default input.

| Proposed entity/evidence | Count |
| --- | ---: |
| Permanent guest/unclaimed players | 2 |
| Group-local player profiles | 2 |
| Venues | 4 |
| Finalized imported sessions | 37 |
| Session participants | 74 |
| Authoritative reported results | 74 |
| Canonical frames | 452 |
| Frame participants | 904 |
| Source provenance records: 74 results + 453 frame rows | 527 |
| Private frame observations, including the excluded row | 453 |
| Auth accounts / account links | 0 / 0 |

The manifest has 2,529 keyed entries across these categories. It is a comparison/planning manifest, **not SQL or a runnable database importer**. Source/batch/group/rule records and legacy links must be bound and emitted by the separately reviewed database adapter. Active source evidence remains in local proposals, not this import manifest.

## Source-to-schema mapping and import procedure

Reviewed actual migrations 001–004, `DATABASE_DESIGN.md`, legacy audit and prior validation report. Existing schema can faithfully represent this snapshot without changes: imported result-only and frame-log sessions, nullable historical metadata, separate reported authority, disputed detail flags, date-only dates, legacy_unknown rules, private excluded observations and unclaimed player identities are supported.

1. **Bind approved destination context.** Confirm a real private target group, authorized import operator, source namespace `pule-original-workbook-v1` and a group-local rule version with `rules_status=legacy_unknown`. Do not label historical rules verified. `season_id`, timezone and unknown instants stay null. No QA group, guest or venue is silently reused by name.
2. **Preflight existing keys and backup.** Before any future write, check stable UUIDs/source links for collisions, duplicates and prior snapshot imports. Stop on changed facts or unexpected existing IDs. A different workbook checksum is new evidence, not permission to recreate the sporting history. A backup/restore and rollback rehearsal remains an import gate.
3. **Create staged provenance.** Use `private.import_sources` for group+namespace, `import_batches` unique on source/checksum/mapping version (staged), `import_records` unique on batch+record key. Store sanitized source fields and extracted hashes only. Preserve legacy match IDs as exact text, including numeric lexical values like `1.0`.
4. **Resolve identity and venue mappings.** Reviewed source-person keys create/reuse permanent `private.players`, then `app.group_players`. Map the four reviewed venue keys to `app.venues`. Persist `private.legacy_entity_links` for player/venue/session/frame keys; unique source+kind+legacy key is the cross-snapshot identity boundary. Never match a global identity by display name.
5. **Stage completed nights and results.** Proposal `sessions` maps to `app.match_sessions`: imported/finalized, approved_historical_reported, approved result quality, date-only occurrence, batch/rule IDs, correct record_kind/sequence_quality and detail eligibility. Expand nested participants into `app.session_participants` with deterministic sides. `historical_reported_results.frames_won` maps to `app.legacy_session_results.reported_frames_won`, one row per session/player, linked to its private source record. Do not copy derived local outcome fields into nonexistent columns.
6. **Stage real frame details only.** `canonical_frames` maps to `app.frames`, `participants` to `app.frame_participants`. Map `detailed_statistics_eligible` to `detail_eligible`; keep sequence status at session level. Translate observation IDs to source_record_id. Map winner/breaker/offender, six pocket codes, event, elapsed_ms, null instants and imported_unverified/unknown duration quality directly. Do not insert local-only planning/provenance fields as database columns. Source score-only nights have no frame rows.
7. **Preserve private evidence.** Raw/private observations map to `private.legacy_frame_observations.full_observation`; retained rows use `canonical_linked`, excluded row uses `excluded_noncanonical`. Keep canonical_frame_id null for row 420. Both provenance and evidence remain append-only. Source observations use checksum/sheet/row identity, while canonical frames use parent legacy ID/frame number. A later snapshot can add provenance without duplicating canonical frames or changing old evidence.
8. **Idempotent acceptance.** Within an authorized transaction, lock source/group import context and compare every existing key/content. Identical rows are skipped; different content stops for review. Never blindly UPSERT scores or ON CONFLICT DO NOTHING around unresolved differences. After reconciliation, accept the batch atomically; batch visibility gates imported history. A second run of the same checksum/mapping is a no-op. New snapshots reuse existing sporting IDs, with explicit reviewed provenance handling. Database-level races, rollback and rerun acceptance must be tested in the future adapter; local manifest simulations do not establish those properties.

Stable IDs retain the existing UUIDv5 namespace `a1212e10-d3e6-51bd-b655-d9f4ff316d57`. Tests prove the old players/venues and all 36 prior session IDs remain identical, all 420 prior canonical frame IDs persist, and the old sanitized evidence—including row 420—matches the new snapshot. No identity key depends on an Auth user or workbook checksum; provenance observation keys deliberately do depend on the snapshot checksum.

## Future Donal/Sean account ownership

Import each person once as an unclaimed permanent player with a group profile and **no Auth link**. Signup later creates an Auth user, not a replacement historical player. An independently verified, authorized claim must link that existing player UUID through `private.player_account_links`, preserving all participant/result/frame references. The schema requires a unique player/user link, verifier and verification reference. There is no reviewed public claim RPC yet; no browser/service-role workaround or name/email matching is authorized. Existing similarly named guests need explicit identity review before any merge; do not automatically merge QA users. Claim execution/races require separate implementation and approval.

## Validation and remaining gates

- Updated snapshot baseline: **40/40 assertions passed**.
- Previous snapshot baseline: **36/36 passed**.
- Regression tests: **33/33 passed, no skips** on this workspace.
- Repeat runs with socket/URL access blocked produce identical bytes; workbook bytes unchanged.
- Active/nonzero/mixed-status records, altered exclusion fingerprint, orphan frames and collisions fail closed.
- Local manifest simulation: initial additions, identical rerun zero additions, changed-key content rejected.
- No historical database import, SQL constraint run with real workbook, hosted standings query, RLS integration test or database importer execution occurred in this task.

Next: review this refreshed baseline, bind destination group/legacy rule/claim policy and authorize an isolated local transactional importer rehearsal. That adapter should prove rollback, FK mapping, actual SQL idempotency and All-Time/season/head-to-head totals on the imported cohort before a separately approved hosted import. The workbook has no season definitions; All-Time includes all 37 completed nights. No season boundaries or same-day ordering are guessed. Stop here pending approval.
