# Historical migration validation report

> **Updated snapshot — November 4, 2026:** see [HISTORICAL_IMPORT_DRY_RUN_NOV4.md](HISTORICAL_IMPORT_DRY_RUN_NOV4.md). The approved new workbook hash matches. Completed history is now 37 nights, 19 Donal wins / 13 Sean wins / 5 draws, reported frames **407–351 (758)**. November 3 adds a reconciled 16–16 with 32 frames; November 4 Active 0–0 is separately excluded. There are 453 source frame rows, 452 canonical proposals and 436 detail-eligible frames; row 420 remains private excluded evidence. The original-snapshot figures below are retained as historical evidence, not the current baseline. No import performed.


Updated 3 November 2026. Offline dry run passed. **Latest owner instruction: preserve the complete zero-second observation privately, excluding it from canonical frames and detail analytics.** No database import performed.

## 1. Validator implementation summary

[Validator](../scripts/legacy/validate_history.py) and [tests](../scripts/legacy/tests/test_validate_history.py) use Python 3.10+ standard-library tools only. No network or database calls, dependency installation, React changes or original-app changes.

```sh
python3 -B scripts/legacy/validate_history.py
python3 -B -m unittest discover -s scripts/legacy/tests -v
```

Private outputs are `data/legacy/validation/proposed-records.json` and `reconciliation.json`, beneath the existing `/data/legacy/` ignore rule. Outputs are deterministic proposals, not SQL. Unexpected input contracts fail validation. Workbook bytes are rehashed before output; output paths outside the private directory are rejected.

## 2. Input file fingerprint

Input: `data/legacy/historical-scores.xlsx`, 33,586 bytes.

SHA-256: `baed83ae34b33bf199d5a88a15fa66ae95758dfada90df9b4585a4171d3525c0`.

Source unchanged: Matches has 72 participant-result rows; Frames has 421 source observations. Dates cover 2026-01-05 through 2026-10-28 with date-only precision. Exclusion policy: `owner-2026-11-03-private-evidence-exclude-canonical-zero-frame14-v3`, tied to this exact fingerprint and reviewed source row evidence.

## 3. Reconciliation results

| Population | Nights | Workbook frame rows | Retained observations / canonical proposals | Reported frame wins |
| --- | ---: | ---: | ---: | ---: |
| Score-only | 16 | 0 | 0 | 305 |
| Fully reconciled | 19 | 404 | 404 | 404 |
| Result/detail discrepancy | 1 | 17 | 16 | 17 |
| Total | **36** | **421** | **420** | **726** |

Exactly one source observation is excluded from the 420 retained scoring observations and preserved separately as private noncanonical evidence; none is assigned a quarantined canonical identity. All 20 frame-observed nights remain represented. The affected night's retained frames total 11–5, compared with the approved reported 12–5. This remaining discrepancy is visible, not repaired with invented frames or a changed result. Its detail stays excluded from aggregates, leaving 404 detail-eligible frames across 19 nights. Field-specific metrics further require their own known inputs.

## 4. Historical leaderboard baseline

| Player | Nights | Wins | Losses | Draws | Reported frames won |
| --- | ---: | ---: | ---: | ---: | ---: |
| Donal | 36 | 19 | 13 | 4 | 391 |
| Sean | 36 | 13 | 19 | 4 | 335 |

All 16 score-only nights contribute. Use reported results once per session/participant; never add observed frame counts to them. Canonical frame proposals contain 233 Donal / 187 Sean wins, a different population from the official reported 391 / 335. No reported win is subtracted because of the excluded row.

## 5. Zero-second row exclusion

For `m_1793225336292`, exclude **Frames row 420**, source frame 14, duration zero, from scored observation and canonical-frame payloads. Preserve all original extracted fields, normalized metadata and provenance separately in `private_noncanonical_observations`, with disposition `excluded_noncanonical`, no canonical ID and no detail eligibility. Retain the exclusion ledger as well. A future authorized importer maps this full evidence into private import/observation tables; this is not a scored frame.

Frames row 419 remains frame 14; source frames 15 and 16 retain their numbers. No source row is deleted or edited in the workbook. The official result stays **Donal 12–5 Sean**. Exclusion is an owner decision, not a claim that duplication was conclusively proven. Any later reversal or reported-result correction requires a separate audited decision.

## 6. Data-quality exceptions

Among the 420 retained observations: 22 unknown breakers, 75 unknown break-pot values, 8 Super Fouls without offenders and 5 unrecorded pockets remain unknown. Explicit break-pot values are 140 Yes and 205 No. Missing values do not become false or zero.

Frames row 300 retains its conflicting running-score string and Sean winner, with a quality flag; no winner is inferred from that text. Imported durations remain unverified, with no reconstructed start/pause timestamps. All 36 occurrence dates remain date-only; seasons and source timezone remain unknown.

Status mapping `completed-column-g-or-absent-g-exact-f-v1` accepts G exactly Completed for 40 result rows, or F exactly Completed only when G is absent for 32 rows. Numeric financial values are excluded from normalized evidence and payloads.

## 7. Proposed import record structure

The payload proposes 2 permanent guest/unclaimed players, 2 group-local profiles, 4 venues, 36 sessions with 72 participant links, 72 authoritative reported results, 420 retained scoring observations, 420 canonical frame proposals, 1 complete private noncanonical observation and 1 excluded-source locator. Auth users and account links remain empty. Nested participants must be translated into junction rows by a future reviewed importer; this is not a database-ready bulk insert.

Stable UUIDv5 namespace: `a1212e10-d3e6-51bd-b655-d9f4ff316d57`; source namespace `pule-original-workbook-v1`. Session keys preserve exact textual legacy IDs, including numeric lexical strings such as `1.0`. Player keys are reviewed source-person identifiers independent of Auth or display names. Retained observation IDs include snapshot checksum, sheet and row; canonical frame IDs use parent legacy ID and source frame number. The private evidence retains its source observation UUID, but no canonical frame identity is assigned to row 420.

[DATABASE_DESIGN.md](DATABASE_DESIGN.md) separates approved result authority from frame quality, preserves strict native scoring constraints and allows trusted imported date-only/null metadata. Exclusion does not weaken production validation.

## 8. Test results

**36/36 baseline assertions and 24/24 regression tests passed, no skips.** Complete private evidence preservation is explicitly tested alongside canonical exclusion. These cover historical totals, exclusion rather than quarantine, source accounting, unknown values, status mapping, no financial extraction, stable IDs, no synthetic frames, invalid/orphan/colliding input rejection and deterministic reruns. Repeated runs with socket/URL access patched to fail passed; workbook fingerprint was unchanged.

Not yet tested: actual SQL constraints, RLS, claim races, transactional imports, database rerun idempotency and rollback/restore. Deterministic files do not prove database behavior. On checkouts without the private workbook, integration tests skip and cannot establish historical acceptance. Frontend build/lint are unrelated to these changes.

## 9. Remaining owner decisions

Exclusion, latest reported result, complete All-Time result history, status mapping and financial-data exclusion are settled. Remaining decisions concern the retained 11–5 versus reported 12–5 detail discrepancy, season boundaries, same-day chronology, server breaker/event rules and production identity/role procedures. The affected night's detail remains conservatively excluded pending a separate decision; no quarantine review is required for row 420.

## 10. Recommended next implementation milestone

The design can represent this workbook. Local schema-and-security implementation with synthetic fixtures is now recorded in [DATABASE_FOUNDATION_REPORT.md](DATABASE_FOUNDATION_REPORT.md). Production migration remains unauthorized. Prove source/result separation, group isolation, strict native validation and database idempotency before a separately approved private staging import. No historical database import or hosted Supabase resource changes have been performed. Synthetic local database migration tests are documented separately in the foundation report.
