# Pule 2.0 — Historical Data Audit and Migration Preparation

> **Updated snapshot — November 4, 2026:** see [HISTORICAL_IMPORT_DRY_RUN_NOV4.md](HISTORICAL_IMPORT_DRY_RUN_NOV4.md). The approved new workbook hash matches. Completed history is now 37 nights, 19 Donal wins / 13 Sean wins / 5 draws, reported frames **407–351 (758)**. November 3 adds a reconciled 16–16 with 32 frames; November 4 Active 0–0 is separately excluded. There are 453 source frame rows, 452 canonical proposals and 436 detail-eligible frames; row 420 remains private excluded evidence. The original-snapshot figures below are retained as historical evidence, not the current baseline. No import performed.


**Latest owner decision (3 November 2026):** exclude the zero-second observation at Frames row 420 from canonical frames and detail analytics, while preserving its complete source observation privately as noncanonical audit evidence. The unchanged source workbook still contains 421 frame rows; migration retains 420, with one explicitly excluded source locator and no quarantined observation. The official latest result remains Donal 12–5 Sean and the All-Time totals remain 391–335. Findings below describe the original source snapshot; earlier quarantine recommendations are superseded. See [MIGRATION_VALIDATION_REPORT.md](MIGRATION_VALIDATION_REPORT.md).

Prepared 3 November 2026. **Read-only workbook audit; no import, migration, database configuration or application changes performed.**

**Owner scope decision:** Total Bill is excluded entirely from the product, database mapping, migration payloads and acceptance calculations. Its source header is documented only to explain column positions. Numeric values in that column will be ignored; later `Completed` tokens in the same position remain relevant solely as status evidence. The original workbook stays untouched.

## 1. Executive summary

The actual source is `data/legacy/historical-scores.xlsx`, a 33,586-byte XLSX workbook with two visible sheets: **Matches** and **Frames**. Its SHA-256 is `baed83ae34b33bf199d5a88a15fa66ae95758dfada90df9b4585a4171d3525c0`.

The source contains **36 match-night/session IDs**, **72 participant-result rows** and **421 individual frame rows**. All results concern **Donal and Sean**. There are 35 distinct calendar dates: two different session IDs/venues occur on 17 October. A “night” in this report means a source Match ID, not a distinct date or a pair of adjacent rows.

| Classification | Nights | Source frame rows | Reported Donal frames | Reported Sean frames |
| --- | ---: | ---: | ---: | ---: |
| Score-only, no frame rows | 16 | 0 | 157 | 148 |
| Fully tracked and final-score/number-sequence reconciled | 19 | 404 | 222 | 182 |
| Tracked but inconsistent frame numbering; final winner counts agree | 1 | 17 | 12 | 5 |
| Partially tracked, fewer frame rows than reported frames | 0 | 0 | 0 | 0 |
| Missing or ambiguous match-result rows | 0 | 0 | 0 | 0 |
| **All source results** | **36** | **421** | **391** | **335** |

**Reported-result All-Time baseline:** Donal **19 wins**, Sean **13 wins**, **4 draws**; frame wins **391–335**, or **726 frames played**. Frame-win percentages are **53.856749% / 46.143251%**; average frame wins per source night are **10.861111 / 9.305556**. These include all 16 older score-only nights exactly once.

This is a **source-reported result baseline**, not a claim that every frame row is a verified distinct physical frame or that a migration has been accepted. The latest session has two different rows labeled frame 14, one with zero duration. Its reported 12–5 agrees with the tally of all 17 rows, but the identity/sequence ambiguity requires owner disposition before canonical frame import. No row has been deleted, deduplicated or renumbered.

Other important findings:

- `Matches` changes apparent layout at row 42: `Completed` moves from column G (`Status`) into F (`Total Bill`), with G absent. This affects 32 participant rows / 16 nights. The interpretation “status moved” is proposed, not silently applied to the workbook. Numeric values under the old header are out of scope.
- Frame metadata is uneven: 22 breakers and 75 break-pot values are absent; eight Super Foul rows lack an offender. Missing metadata does **not** mean a partially recorded score sequence.
- One saved running-score label contradicts the corresponding frame winner and prior sequence. Final scores still reconcile for that night.
- No other players, player aliases, explicit season fields, standalone frame IDs, timezone, exact match start/finalize timestamps or pause intervals are present.

The proposed database supports score-only versus tracked results and unclaimed identities conceptually, but **it cannot accept every row unchanged under its current unique frame-number rule**. Section 12 recommends targeted design/mapping refinements; `DATABASE_DESIGN.md` itself is unchanged.

## 2. Source workbook inventory

### 2.1 Inspection method and evidence

Read [PRODUCT_PLAN.md](PRODUCT_PLAN.md), [LEGACY_FEATURE_AUDIT.md](LEGACY_FEATURE_AUDIT.md) and [DATABASE_DESIGN.md](DATABASE_DESIGN.md). The legacy audit supplies application context; workbook cells are authoritative for this numerical audit. The fictional React fixtures were not used.

The XLSX was opened **as a ZIP archive using Python standard-library `zipfile`, `xml.etree.ElementTree`, `decimal` and `datetime`**. Shared strings, workbook relationships, typed cell values, row numbers and date styles were parsed without opening Excel, running macros, evaluating formulas or using external services. Two separately structured calculations checked the leaderboard and each tracked night's winner tally.

Citation convention: `Matches!A2:G3` or `Frames!A419:N420` identifies the exact worksheet cells/rows in the protected source. Sheet-wide citations mean the specified populated data range; no raw workbook export is copied into this document. The complete 36-night reconciliation fits inline in section 8, so no separate detailed file is needed.

Raw source facts are distinguished from interpretations: “Completed occurs in F” is observed; “F is a shifted status column” is proposed. Outcomes are calculated by comparing reported frame totals because the Matches sheet has no winner/outcome column. Frame completion timestamps, actual playing dates beyond recorded dates and physical-frame identity cannot be reconstructed from filename/ID guesses.

### 2.2 Contents

| Sheet | XML part | Header | Meaningful data | Physical rows including header | Populated range |
| --- | --- | --- | ---: | ---: | --- |
| Matches | `xl/worksheets/sheet1.xml` | Row 1 | 72 participant-result rows | 73 | A1:G73; G absent in rows 42–73 |
| Frames | `xl/worksheets/sheet2.xml` | Row 1 | 421 frame rows | 422 | A1:N422; optional cells absent |
| **Total** | | 2 headers | **493 source rows** | **495** | |

There are no wholly empty data rows within those ranges, hidden worksheets/rows/columns, formula cells, cached formula results requiring evaluation, or Excel error-type cells in the inspected worksheets. The workbook has shared strings, styles, a theme, two drawing parts and a persons metadata part; these are not additional match-data sheets. `definedNames` is empty. No sheet explicitly stores players, venues, seasons or database IDs separately.

The workbook uses the default **1900 Excel date system** (`date1904` is not set). Date cells are integer numeric serials: styles 7 and 11 use custom `mmm d`; style 12 uses built-in number format 14. Raw serials encode the year even when the display omits it. For these modern dates, conversion is `1899-12-30 + serial days`; all observed date serials have zero fractional day. Do not reinterpret them as UTC instants.

### 2.3 Source protection

Added the exact root ignore rule `/data/legacy/` to `.gitignore`. The source remains in its original location and is read-only for this task. There is no `.git` directory in this project at audit time; the rule protects a future repository, and nothing was committed. No production endpoint or live Sheet was accessed. Only `.gitignore` and this audit document are changed in the project; temporary analysis files stayed outside the project.

## 3. Data structure and column definitions

### 3.1 Matches — participant-result rows, grouped by Match ID

Source: `Matches!A1:G73`.

| Column / exact header | Observed type / populated rows | Meaning and qualification |
| --- | --- | --- |
| A — `Match ID` | 30 numeric cells + 42 text cells; 72/72 populated | 15 distinct numeric IDs and 21 distinct `m_…` IDs, each appearing twice. Preserve as text in migration, with raw type/value in provenance. |
| B — `Date` | Numeric Excel serial, 72/72 | Recorded calendar date, no time fraction or timezone. Each ID's two rows agree. |
| C — `Player` | Text, 72/72 | Exactly Donal and Sean, each 36 times. One row per named participant per ID in this file. |
| D — `Frames Won` | Numeric integral >=0, 72/72; actual range 1–21 | Reported final frames won by that participant. Not a count of nights and not an individual frame row. |
| E — `Venue` | Text, 72/72 | Four exact names; paired rows agree. |
| F — `Total Bill` | Numeric `0.0` in rows 2–41; text `Completed` in rows 42–73 | Excluded from migration as a financial field. Ignore numeric values; inspect later Completed tokens solely for shifted status mapping. |
| G — `Status` | Text `Completed` in rows 2–41; absent in rows 42–73 | Explicit status exists for 20 nights. For 16 later nights, “Completed” is in F instead. No Active/Abandoned labels are present elsewhere in these result rows. |

Grouping was verified rather than assumed: there are 36 distinct A values; **every** group has exactly two rows, exactly one Donal and one Sean, identical date/venue/status-layout, and integral scores. No duplicate `(Match ID, Player)` records exist. The first 15 numeric IDs render as 1–15 under general number formatting; their raw numeric XML values are `1.0`–`15.0`. This report uses the lossless raw strings in its reconciliation table. For migration, a proposed exact-source `legacy_key` is that raw text (`"1.0"`), retaining numeric source type and human display (`1`) separately. If a later export renders the same ID as `"1"`, explicitly map that variant; never allocate a second session or collapse arbitrary strings by floating-point conversion.

An `m_` prefix does **not** establish frame tracking: `m_1783645677378` (9 July, 5–5) has no frame rows. Source: `Matches!A32:G33` and absence of that ID in `Frames!A2:A422`.

### 3.2 Frames — one source observation per row

Source: `Frames!A1:N422`; 421 rows. Every row has Player 1=Donal and Player 2=Sean. The table has **no independent Frame ID column**.

| Column / exact header | Observed type and population | Interpretation / valid handling |
| --- | --- | --- |
| A — `Match ID` | Text, 421/421; 20 IDs | Joins exactly to Matches IDs; no orphan IDs. |
| B — `Frame Number` | Numeric integer 1–33, 421/421 | Ordinal within a session, not a globally unique identity. One `(Match ID, Frame Number)` collision. |
| C — `Player 1` | Text Donal, 421/421 | Resolve permanent player identity; preserve source side. |
| D — `P1 Scratches` | Numeric integer 0–4, 421/421 | Ordinary recorded count; zero is observed, not inferred. Sum 317. |
| E — `Player 2` | Text Sean, 421/421 | Resolve permanent identity; preserve source side. |
| F — `P2 Scratches` | Numeric integer 0–5, 421/421 | Recorded count. Sum 348. |
| G — `Winner` | Text, 421/421 | Donal 234; Sean 187. Always one of that frame's pair. |
| H — `Duration (sec)` | Numeric nonnegative integer, 421/421 | 420 positive values and one zero. Reported range 0–918 seconds; minimum positive 13. No timing intervals or pause evidence. |
| I — `Black Pocket` | Text, 421/421 | 416 recognized pocket codes; 5 literal `None` values. Literal None is not a seventh pocket. |
| J — `Special Event` | Text, 421/421 | 380 `None`, 31 `Super Foul`, 10 `Golden Break`; no Break & Run / Dry Clearance observed. |
| K — `Breaker` | Text, 399/421 | Donal 198, Sean 201. Absent in Frames rows 2–23: first two tracked nights, 22 frames. Do not infer alternation. |
| L — `Super Fouler` | Text, 23/421 | Sean 17; Donal 6. Of 398 blanks, 390 occur on non-Super-Foul rows; **8 are unknown offenders on Super Foul rows**. Distinguish not applicable from unknown. |
| M — `Potted On Break` | Text Yes/No, 346/421 | Yes 140; No 206; absent rows 2–76 (75 frames, first four tracked nights). These are strings, not XLSX Boolean cells; never use generic string truthiness to parse No. |
| N — `Running Score` | Text, 421/421 | Saved display snapshots, not canonical totals. Compare with winner prefixes; preserve original text if stale/inconsistent. |

No negative/fractional scores, frame numbers, scratch counts or durations were found. Player/venue strings have no observed leading/trailing whitespace or case variants. No source formula or hidden calculation supplies missing metadata.

Pocket counts: TL **81**, TM **67**, TR **95**, BL **56**, BM **46**, BR **71**, None **5**. Source: `Frames!I2:I422`. These are observations from all 421 rows, including the unresolved repeated-frame-number night; they are not yet approved production metric denominators.

## 4. Players, venues and date coverage

### 4.1 Player identities

Only **Donal** and **Sean** are present across Matches players, frame participants/winners, breakers and known offenders. No alias variants or other identifiable pair exist. In particular, **Alan has no record in this workbook**; the legacy UI's fallback roster is not source evidence to import him. Source: `Matches!C2:C73`; `Frames!C2:C422,E2:G422,K2:L422`.

Propose two permanent guest/unclaimed player IDs plus two group-local profiles in an owner-approved initial group. Names identify the two consistent source labels, not proof of account ownership. No Auth account or ownership link is created. UUID allocation and later verified claiming remain future migration work; existing participant references must not change when a user claims a profile.

### 4.2 Venue coverage

| Exact source venue | Nights | Donal wins | Sean wins | Draws | Reported frames D–S |
| --- | ---: | ---: | ---: | ---: | --- |
| Soho | 26 | 15 | 9 | 2 | 306–254 |
| Sneaky Pete's | 8 | 2 | 4 | 2 | 69–72 |
| The Mac | 1 | 1 | 0 | 0 | 10–5 |
| Marstins Kingsway | 1 | 1 | 0 | 0 | 6–4 |
| **Total** | **36** | **19** | **13** | **4** | **391–335** |

Source: grouped `Matches!A2:E73`. Preserve `Marstins Kingsway` exactly; no evidence authorizes spelling correction, geolocation or venue merging.

### 4.3 Dates and seasons

Recorded date range: **5 January–28 October 2026**, serials **46027–46323**. Source: `Matches!B2:B73`. Score-only history spans 5 January–9 July; frame records join to nights dated 13 July–28 October.

There is **no explicit season column, season worksheet or season definition**. All rows fall in calendar 2026; a calendar-year filter is supportable, but declaring the original app's season to be 2026 is not. Proposed migration keeps `season_id` unassigned until owner confirmation or an inspected Apps Script season definition. All-Time includes all source dates regardless.

Two IDs share **17 October 2026**: `m_1792274197917` at Marstins Kingsway (6–4), and `m_1792290945209` at Sneaky Pete's (5–3). They are separate source sessions, not duplicate rows to merge by date/pair. Neither time-of-day nor their true order is recorded in the Date cells. Numeric-looking ID suffixes are not used to fabricate timestamps or confirm chronology.

## 5. Match-night and frame classification

| Class | Evidence criterion | Result statistics | Detailed statistics |
| --- | --- | --- | --- |
| Score-only | Reported paired scores; zero rows joining on Match ID | Include night outcome, frame wins, total frames, averages, H2H, margins and any approved season filter | Zero individual frames; no breaker, streak, foul, pocket or timing contribution |
| Fully tracked and reconciled | Winner tally equals each reported score; unique frame numbers 1…N and N equals sum of scores | Include once | Use actual available fields; missing metadata remains unknown |
| Partially tracked | Some joined frame evidence but fewer rows/wins than reported result, without excess/identity contradiction | Preserve reported result separately; require explicit result-authority policy | Only supported observations; never claim complete sequence |
| Tracked but inconsistent | Conflicting/duplicate numbering, excess counts or totals disagreement | Source result retained; independent eligibility decision required | Quarantine ambiguous identity/sequence, retain every source row |
| Missing/ambiguous result | Missing participants/scores or conflicting rows prevent a unique result | Do not guess; report exclusion | Preserve any available evidence separately |

Observed counts are **16 / 19 / 0 / 1 / 0** in the order above. “Fully tracked” here means **score and sequence coverage**, not “every metadata field recorded” or “every saved label valid.” For example, the first two fully tracked nights have no breaker values, and the first four have no break-pot values.

All **20** IDs with frame rows have final winner counts agreeing with Matches: **234–187 across 421 source rows**. Nineteen also pass unique-number sequence checks; the final night does not. The only identified frame-number collision is discussed in §9.1. There is no observed partial-score-coverage night to silently fill with manufactured frames.

## 6. Donal vs Sean historical leaderboard baseline

### 6.1 All reported source results, including older score-only history

Source: group `Matches!A2:G73` by original A value, verify exactly one C=Donal and one C=Sean, compare D totals, then sum each participant's reported D value **once per ID**.

| Measure | Donal | Sean | Combined / scope |
| --- | ---: | ---: | --- |
| Match-night/session IDs | 36 | 36 | **36 distinct IDs**, not 72 |
| Match wins | **19** | **13** | 32 outright decisions |
| Match losses | 13 | 19 | Opponent's outright wins |
| Drawn match nights | 4 | 4 | **4 distinct draws**, not 8 |
| Frames won | **391** | **335** | **726** reported total frames played |
| Frame-win percentage | **53.856749%** | **46.143251%** | Respective frame wins / 726 × 100 |
| Average frames won/night | **10.861111** | **9.305556** | Respective frame wins / 36 |
| Fully tracked/sequence-reconciled nights | 19 | 19 | 404 joined frame rows |
| Score-only nights | 16 | 16 | 305 reported frames, no frame rows |
| Partially tracked nights | 0 | 0 | None observed |
| Tracked, numbering-disputed night | 1 | 1 | 17 source rows; reported 12–5 |
| Entire nights excluded from this reported-result baseline | 0 | 0 | Numbering dispute included transparently as reported result |

Example calculations: `391 / 726 × 100 = 53.856749…%`; `391 / 36 = 10.861111…`. Display rounding can use 53.86% / 46.14% and 10.86 / 9.31 without changing integer baselines.

Draw IDs: `9.0` (7–7), `10.0` (8–8), `m_1783645677378` (5–5), `m_1788822384100` (11–11). Source: `Matches!A18:D21,A32:D33,A54:D55`. There is no stored Matches winner column; these draw/outcome labels are derived comparisons, not source text.

### 6.2 Contribution breakdown — do not lose Type A or count Type B twice

| Population | Nights | Donal wins | Sean wins | Draws | Frames D–S | Reported total frames | Frame rows |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Type A / score-only | 16 | 6 | 7 | 3 | **157–148** | **305** | **0** |
| Type B / all nights with frame rows | 20 | 13 | 6 | 1 | **234–187** | **421** | **421** |
| **Both, counted once** | **36** | **19** | **13** | **4** | **391–335** | **726** | **421** |

A frame-only leaderboard would incorrectly omit 16 nights and 305 frames. Adding both Matches scores and the joined frame winners would incorrectly produce **1,147** frames (**625–522**). Neither is an acceptable All-Time result. The source score-only total is a count of recorded results, not 305 missing frame rows to synthesize.

### 6.3 Alternative quarantine scope — explicit, not the primary baseline

If the owner chooses to exclude the entire latest night (`m_1793225336292`) until resolving its duplicate number, the **separate** 35-night baseline is Donal **18 wins**, Sean **13 wins**, **4 draws**, frames **379–330**, total **709**, frame rates **53.455571% / 46.544429%**, averages **10.828571 / 9.428571**. It contains 404 actual frame rows and all 16 score-only nights.

This is not an instruction to drop the night: the primary source-reported baseline remains **36 nights / 391–335**. A frame identity dispute and a trustworthy reported night result should be independently reviewable. No alternate deduplication, frame renumbering or corrected final score has been adopted.

## 7. Other player and head-to-head results

No other named player or player pair is identifiable. Donal–Sean is the **only** recorded pair in all 36 result groups and 421 frame rows. There are no Alan matches, mixed-player nights, teams or rotation data to calculate. Do not import fictional prototype participants or infer fallback-roster members.

The venue breakdown in §4.2 is supported. The following calendar-month breakdown is also supportable, **not a recovered season definition**:

| Recorded month | Nights | Donal wins | Sean wins | Draws | Reported frames D–S |
| --- | ---: | ---: | ---: | ---: | --- |
| 2026-01 | 2 | 1 | 1 | 0 | 20–14 |
| 2026-02 | 3 | 1 | 2 | 0 | 43–44 |
| 2026-03 | 4 | 1 | 2 | 1 | 38–35 |
| 2026-04 | 2 | 1 | 0 | 1 | 16–13 |
| 2026-06 | 3 | 2 | 1 | 0 | 27–26 |
| 2026-07 | 5 | 2 | 2 | 1 | 40–36 |
| 2026-08 | 7 | 5 | 2 | 0 | 108–84 |
| 2026-09 | 3 | 1 | 1 | 1 | 28–29 |
| 2026-10 | 7 | 5 | 2 | 0 | 71–54 |

Source: paired Matches A/B/C/D values, grouped by decoded B calendar month. No May date is present; this means no recorded May result, not proof no pool was played. All calendar-2026 records equal All-Time **for this export only**. A future calendar-year season can use these baselines only after owner approval.

## 8. Match-to-frame reconciliation

Each row below represents one verified source Match ID group. Scores are always **Donal–Sean**, independent of worksheet participant order. “Observed” counts Winner cells; a dash means no frame rows, not an inferred 0–0 result. `rN–rM` are actual worksheet row numbers, inclusive.

Codes: **A** score-only; **R** fully tracked/final-score and frame-number reconciled; **I** tracked but inconsistent numbering. `R` does not certify all metadata/timing/auxiliary labels. All 20 tracked totals agree with the reported final score; **none has a winner-count mismatch**. The separate numbering collision must not be concealed by that numerical agreement.

| Legacy Match ID (text) | Date | Matches rows | Reported D–S | Frames rows | N | Observed D–S | Class / sequence |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| `1.0` | 2026-01-05 | r2–r3 | 10–3 | — | 0 | — | A / no frames |
| `2.0` | 2026-01-19 | r4–r5 | 10–11 | — | 0 | — | A / no frames |
| `3.0` | 2026-02-04 | r6–r7 | 12–14 | — | 0 | — | A / no frames |
| `4.0` | 2026-02-18 | r8–r9 | 16–17 | — | 0 | — | A / no frames |
| `5.0` | 2026-02-20 | r10–r11 | 15–13 | — | 0 | — | A / no frames |
| `6.0` | 2026-03-09 | r12–r13 | 14–7 | — | 0 | — | A / no frames |
| `7.0` | 2026-03-14 | r14–r15 | 8–10 | — | 0 | — | A / no frames |
| `8.0` | 2026-03-25 | r16–r17 | 9–11 | — | 0 | — | A / no frames |
| `9.0` | 2026-03-28 | r18–r19 | 7–7 | — | 0 | — | A / no frames |
| `10.0` | 2026-04-07 | r20–r21 | 8–8 | — | 0 | — | A / no frames |
| `11.0` | 2026-04-20 | r22–r23 | 8–5 | — | 0 | — | A / no frames |
| `12.0` | 2026-06-23 | r24–r25 | 12–6 | — | 0 | — | A / no frames |
| `13.0` | 2026-06-26 | r26–r27 | 4–10 | — | 0 | — | A / no frames |
| `14.0` | 2026-06-29 | r28–r29 | 11–10 | — | 0 | — | A / no frames |
| `15.0` | 2026-07-08 | r30–r31 | 8–11 | — | 0 | — | A / no frames |
| `m_1783645677378` | 2026-07-09 | r32–r33 | 5–5 | — | 0 | — | A / no frames |
| `m_1783984994828` | 2026-07-13 | r34–r35 | 7–9 | r2–r17 | 16 | 7–9 | R / 1–16 |
| `m_1784244078862` | 2026-07-16 | r36–r37 | 5–1 | r18–r23 | 6 | 5–1 | R / 1–6 |
| `m_1785191699214` | 2026-07-27 | r38–r39 | 15–10 | r24–r48 | 25 | 15–10 | R / 1–25 |
| `m_1785795964966` | 2026-08-03 | r40–r41 | 13–15 | r49–r76 | 28 | 13–15 | R / 1–28 |
| `m_1786401739960` | 2026-08-10 | r42–r43 | 19–10 | r77–r105 | 29 | 19–10 | R / 1–29 |
| `m_1786574067042` | 2026-08-12 | r44–r45 | 21–12 | r106–r138 | 33 | 21–12 | R / 1–33 |
| `m_1787422000214` | 2026-08-22 | r46–r47 | 10–5 | r139–r153 | 15 | 10–5 | R / 1–15 |
| `m_1787612612208` | 2026-08-24 | r48–r49 | 11–16 | r154–r180 | 27 | 11–16 | R / 1–27 |
| `m_1787872444208` | 2026-08-27 | r50–r51 | 17–14 | r181–r211 | 31 | 17–14 | R / 1–31 |
| `m_1788218846670` | 2026-08-31 | r52–r53 | 17–12 | r212–r240 | 29 | 17–12 | R / 1–29 |
| `m_1788822384100` | 2026-09-07 | r54–r55 | 11–11 | r241–r262 | 22 | 11–11 | R / 1–22 |
| `m_1789423615010` | 2026-09-14 | r56–r57 | 11–9 | r263–r282 | 20 | 11–9 | R / 1–20 |
| `m_1790724242882` | 2026-09-29 | r58–r59 | 6–9 | r283–r297 | 15 | 6–9 | R / 1–15 |
| `m_1791240551123` | 2026-10-05 | r60–r61 | 16–11 | r298–r324 | 27 | 16–11 | R / 1–27 |
| `m_1792274197917` | 2026-10-17 | r62–r63 | 6–4 | r325–r334 | 10 | 6–4 | R / 1–10 |
| `m_1792290945209` | 2026-10-17 | r64–r65 | 5–3 | r335–r342 | 8 | 5–3 | R / 1–8 |
| `m_1792537739397` | 2026-10-20 | r66–r67 | 11–14 | r343–r367 | 25 | 11–14 | R / 1–25 |
| `m_1792796397887` | 2026-10-23 | r68–r69 | 11–6 | r368–r384 | 17 | 11–6 | R / 1–17 |
| `m_1792957047881` | 2026-10-25 | r70–r71 | 10–11 | r385–r405 | 21 | 10–11 | R / 1–21 |
| `m_1793225336292` | 2026-10-28 | r72–r73 | 12–5 | r406–r422 | 17 | 12–5 | I / 1–16, number 14 twice |

### Reconciliation conclusions

- **20/20** IDs with frame records reproduce the reported Donal and Sean final totals. No reported-score-versus-Winner-count disagreement was found.
- **19/20** also have unique contiguous frame numbers 1 through their row count. These contain **404** source frame rows.
- `m_1793225336292` contains **17** rows but only **16** distinct numbers, with 14 repeated. Its 12–5 total agrees only when both source rows are included; source agreement alone cannot prove both are distinct physical frames.
- All **421** frame rows have a parent Match ID. All **36** result groups have two distinct named participants; all frame pairs match that group. No result-only night was inferred from missing metadata or the age/prefix of its ID.

## 9. Missing, duplicate and inconsistent data

### 9.1 Repeated frame number and zero duration — unresolved physical-frame identity

Source: `Frames!A406:N422`, especially **rows 419–420**, for `m_1793225336292`; reported result `Matches!A72:G73`.

| Source row | Frame Number | Winner | P1 / P2 scratches | Duration seconds | Breaker | Pocket | Saved running score |
| --- | ---: | --- | --- | ---: | --- | --- | --- |
| Frames 419 | 14 | Donal | 1 / 0 | 565 | Sean | TM | Donal 9 - 5 Sean |
| Frames 420 | 14 | Donal | 1 / 1 | **0** | Sean | TM | Donal 10 - 5 Sean |
| Frames 421 | 15 | Donal | 0 / 2 | 424 | Donal | BR | Donal 11 - 5 Sean |
| Frames 422 | 16 | Donal | 2 / 0 | 289 | Sean | BL | Donal 12 - 5 Sean |

These are **not exact duplicate rows**: at least scratches, duration and running score differ. Potential explanations include repeated submission or mistaken numbering; neither is confirmed. A zero-duration row is suspicious evidence, not authorization to delete a win. Do not deduplicate on `(Match ID, Frame Number)`, keep only the “latest” row, renumber 14–16, or change the final score automatically.

There are **420 distinct `(Match ID, Frame Number)` keys but 421 rows**. Exact duplicate full frame rows: **0**. Retain both rows with distinct frozen-source locators and content hashes until the owner decides their relationship. The current database unique `(session_id, frame_number)` and a legacy frame key based only on parent+number cannot represent both as-is; see §12.

### 9.2 Matches column drift — completion status

- `Matches!F2:F41` has 40 numeric zero cells; `G2:G41` has 40 `Completed` strings. These are 20 nights.
- `Matches!F42:F73` has 32 `Completed` strings; `G42:G73` has no cells. These are 16 later nights.
- First affected ID: **`m_1786401739960`**, 10 August 2026, rows 42–43, 19–10.

**Proposed row-version mapping:** use G=Completed where present; if G is absent and F is exactly Completed, retain a shifted-status interpretation. Ignore numeric F values entirely. Preserve the status token and its source cell location, and record this status mapping decision for owner approval. Do not silently drop 16 results because G is blank. No financial data will be extracted, mapped or imported.

### 9.3 Missing metadata and interpretation

| Evidence gap | Exact population / source | Consequence |
| --- | --- | --- |
| No frame tracking | 16 IDs listed A in §8, 305 reported frames | Result-level stats eligible; zero detailed frame observations. |
| No breaker | **22** blanks, `Frames!K2:K23` | No break-hold/receiving attribution for those frames. Do not derive breaker from alternation, winner or row side. |
| No break-pot value | **75** blanks, `Frames!M2:M76` | Exclude these from pot-rate denominator; never default false. They belong to first four tracked nights and do not invalidate their final-score coverage. |
| Missing Super Foul offender | **8/31** Super Foul rows below | Preserve event/winner but offender unknown; do not infer offender from the other player. Additional event-consistency review needed. |
| Literal None pocket | **5** rows: 40, 45, 290, 297, 329 | Three are Super Foul, two Regular/None events. Not all can be assumed not-applicable; retain source None and mark not_recorded/unknown unless approved mapping says otherwise. |
| Missing exact timing | All 36 nights / 421 frames lack actual start, pause, resume, completion instants and timezone | Store date-only occurrence and reported duration quality; do not synthesize timestamps or claim trustworthy stopwatch records. |
| No season field | Both sheets | All-Time inclusion is known; actual season membership needs a rule/owner decision. |

Missing-offender records:

| Match ID | Frame Number | Frames row | Winner |
| --- | ---: | ---: | --- |
| `m_1789423615010` | 5 | 267 | Donal |
| `m_1789423615010` | 16 | 278 | Sean |
| `m_1791240551123` | 3 | 300 | Sean |
| `m_1791240551123` | 5 | 302 | Donal |
| `m_1791240551123` | 7 | 304 | Donal |
| `m_1792274197917` | 5 | 329 | Sean |
| `m_1792957047881` | 16 | 400 | Donal |
| `m_1793225336292` | 13 | 418 | Sean |

The 23 known Super Fouler values are members of the pair and opposite the Winner. All ten Golden Break rows have known breaker=winner and Potted On Break=Yes. This supports those **observed combinations only**, not a recovered universal ruleset or confirmation of legal real-world play.

### 9.4 Stale running-score label

`Frames!A300:N300`: `m_1791240551123`, frame 3. Winner=Sean but saved Running Score=`Donal 2 - 1 Sean`. The first two Winner rows (298–299) give 1–1, so the winner-prefix count at row 300 is **Donal 1 - 2 Sean**. The next row's label is Donal 1 - 3 Sean. The final night totals, **16–11**, agree with all 27 Winner cells and the reported result.

This is one saved display-string inconsistency, not evidence to replace Winner or alter match scores. Preserve the original label and recompute display strings from accepted winner sequence. Using physical worksheet order as a comparison, **420/421** saved running-score labels match their preceding Winner prefixes; this comparison does not establish true chronology for the duplicated-number night.

### 9.5 Duplicate and validity checks

| Check | Finding |
| --- | --- |
| Exact full participant-result rows duplicated | 0 |
| Duplicate `(Match ID, Player)` result keys | 0 |
| Exact full frame rows duplicated | 0 |
| Duplicate frame-number key groups | 1, containing 2 nonidentical rows (Frames 419–420) |
| Orphan frame parent IDs | 0 |
| Conflicting dates/venues within a result group | 0 |
| Missing result score/name/date/venue | 0 |
| Negative or fractional frame wins, frame numbers, scratches or duration | 0 |
| Unknown frame winner / winner outside pair | 0 |
| Nonblank breaker/offender outside pair | 0 |
| Invalid non-None pocket code | 0 |
| Date-only same-day multiple sessions | 1 date, 2 distinct IDs/venues, not duplicates |
| Excel formula / error cells | 0 / 0 |
| Source zero duration | 1: `Frames!H420`, not a missing cell |

All source duration values sum to **162,205 seconds** (45h 3m 25s); this is a **reported-duration sum**, not verified active playing time. Source minimum positive is 13 seconds (`Frames!H56`), maximum 918 seconds; the legacy audit's known pause arithmetic/reload defects prevent certifying fastest/slowest actual frames from these values alone. Missing pause histories cannot be repaired retrospectively by applying a formula to the final duration.

No entire match is excluded from the **reported-result** baseline. One night has unresolved frame identity/sequence; five nights have missing-offender events; sixteen nights need explicit status-layout interpretation. These flags overlap and are not mutually exclusive “extra excluded matches.” None authorizes modifying source data or discarding older results.

## 10. Exact source-to-Supabase field mapping

This is a **proposed mapping**, not code or an executed import. It uses [DATABASE_DESIGN.md](DATABASE_DESIGN.md) entities, with refinements in §12. The target group, stable UUID mapping manifest and verification decisions have not been created. No Auth account is created.

### 10.1 Match rows and identity context

| Actual source | Proposed destination | Conversion, identity and unknown rules |
| --- | --- | --- |
| `Matches!A` Match ID | `private.legacy_entity_links` session link → `app.match_sessions.id` | Preserve original ID as text with raw source type/value and source namespace. Numeric XML 1.0–15.0 are never lossy floats/assumed timestamps. Stable UUID allocated once per source session identity, reused across reruns. |
| `Matches!B` Date | `match_sessions.occurred_on`, `date_precision='date_only'`; source serial/style in import evidence | Decode 1900-date serial to date only. `occurred_at`, actual started/finalized instants and source timezone remain null/unknown. No time fabricated from ID suffixes. |
| `Matches!C` Player | `private.players` + `app.group_players`; `app.session_participants.player_id`, name snapshot | Reviewed source labels Donal/Sean map to two permanent guest UUIDs in one approved group. Exactly 72 session-participant links across 36 IDs. No player-account link/registration. |
| `Matches!D` Frames Won | `app.legacy_session_results.reported_frames_won` for every participant, plus immutable import evidence | Preserve all 72 integral scores. For score-only authoritative result facts; for tracked nights compare with actual frames and avoid additive double counting. Disputed sequence does not automatically invalidate otherwise consistent reported result. |
| Derived comparison of paired D values | `legacy_session_results.reported_outcome` / canonical result projection with derivation provenance | 19 D wins, 13 S wins, 4 draws. This outcome is computed, not a stored winner column. Never make Donal winner merely because he is P1 in a draw. |
| `Matches!E` Venue | `app.venues`, same-group session venue FK | Four exact venue identities/labels; no spelling repair. Permanent source links/UUIDs, group-scoped selection. |
| `Matches!F` Total Bill, numeric variant | **Excluded by owner decision** | Ignore; no target field, normalized financial evidence or migration payload. Original values remain only in the untouched source workbook. |
| `Matches!F` text Completed, shifted variant | Proposed interpreted session status + source quality/mapping decision | G absent + F exactly Completed suggests finalized historical result; require approved row-version mapping. Extract only the status token and source locator; ignore numeric F values. No financial target field is created. |
| `Matches!G` Status | Source status evidence; proposed `match_sessions.status='finalized'` for Completed | 40 explicit tokens/20 nights. New status/finalized-time CHECKs must allow historical completion with unknown exact instant. No abandoned/active status inferred. |
| No source group | Owner-approved `app.groups`, same group FK on all rows | Group assignment is migration configuration, not a recovered worksheet value. Do not attach import to arbitrary public group. |
| No source season | `match_sessions.season_id=NULL` initially | All-Time always includes eligible results; calendar-2026 assignment only after approved season definition. |
| No source rules version | Imported `rule_versions` with legacy_unknown + coverage/quality | Do not claim these nights followed prototype race rules or an unverified automatic breaker policy. |

### 10.2 Frame rows

| Actual source | Proposed destination | Conversion / limits |
| --- | --- | --- |
| `Frames!A` Match ID | Same-group `frames.session_id` resolved via preserved parent legacy ID | No orphan parents observed. Matching is by source identity, never date/venue alone. |
| `Frames!B` Frame Number | `frames.frame_number` **where unique/verified**; raw source number separately retained | Normal nights map 1…N. The final collision cannot pass unchanged unique-number constraints. Keep source number and source locator separate from canonical identity/chronology; no silent renumbering. |
| No standalone frame ID | New stable `frames.id`, `legacy_entity_links` plus `import_records` locator | For frozen source, preserve `(checksum, sheet, source row)` + row hash and parent ID. Do not rely solely on parent+frame number. A new/reordered export needs reviewed cross-snapshot mapping; row position is not a permanent physical-frame ID. |
| `Frames!C` Player 1, `E` Player 2 | `frame_participants` sides 1/2 with permanent player IDs | 421 observations ×2 = 842 participant observations before ambiguity disposition. New UUID linkage does not change on future claiming. |
| `Frames!D` P1 Scratches, `F` P2 Scratches | Participant `foul_count`, preserved side/quality | All values known integral; zero retained as zero. If a future source blank occurs, null, not zero. Source sums 317/348 include all observations. |
| `Frames!G` Winner | `frames.winner_id` | Resolve actual source name; 234 Donal and 187 Sean observations. This is the only per-frame win fact counted, never added again to the parent's result totals. |
| `Frames!H` Duration (sec) | `frames.elapsed_ms` via exact integer seconds ×1000; `duration_quality='imported_unverified'` | Preserve zero H420 as reported zero plus explicit suspicious/duplicate flag; it is neither invented positive time nor automatically missing. No start/pause timestamps invented. |
| `Frames!I` Black Pocket | `black_pocket_code`, `pocket_state`, original value in evidence | Map six exact codes; literal None → null code + not_recorded/unknown until semantics approved. Do not infer pocket from hint frequency or special event. |
| `Frames!J` Special Event | Canonical `special_event`: None→regular, Super Foul→super_foul, Golden Break→golden_break | Preserve raw enum string. All 421 present; no Break & Run/Dry Clearance manufactured. Imported events with missing offender need field-level flags/exception path, not native validation bypass. |
| `Frames!K` Breaker | `frames.breaker_id` | 399 known name references; 22 null. Unknown initial/next breaker cannot be inferred for early nights. An earliest actual known breaker may be retained as evidence, not automatically a complete session policy. |
| `Frames!L` Super Fouler | `frames.offender_id` + applicability/quality evidence | Map 23 known; retain eight unknown-on-Super-Foul as null, distinct from non-applicable blanks. Never infer loser/offender solely from winner. |
| `Frames!M` Potted On Break | Nullable `frames.potted_on_break` | Exact Yes→true, No→false, absent→null. Expected **140 true, 206 false, 75 null** over all source observations. |
| `Frames!N` Running Score | Private source snapshot/provenance; optional source-display observation | Not an independently writable score column. Canonical running score derives from approved frame sequence. Keep row 300 contradiction and repeated-number context visible. |

### 10.3 Coverage, provenance and result authority

- `record_kind=result_only`, coverage none for **16** IDs, with **zero frames**. Preserve all reported outcomes/totals; do not set their detail-dependent metrics to zero as if played without fouls or breaks.
- `record_kind=frame_log` for **20** IDs. Nineteen have complete score/number coverage. The last has all 17 reported winners but unresolved numbering/physical-frame identity; record sequence validity separately from result evidence.
- Store `import_sources`, immutable `import_batches` checksum/mapping version and every logical source record's original sheet/row/column references. For this export, record-level evidence is **72 result rows +421 frame rows =493**, plus header/schema metadata. One result group does not delete either participant's source observation.
- Stable UUID maps are future artifacts, not generated from names on each run. Exact-source repeats reuse IDs; changed/ambiguous rows return explicit conflicts. Keep claim links empty on initial import, and never place personal source exports or raw rows into Git.

## 11. Migration acceptance tests

The following are **future importer/database acceptance specifications** grounded in this source. Only read-only source computations and hashes were checked now; no importer, tables or RLS have been implemented/tested.

| Test | Required expected result / failure condition |
| --- | --- |
| T01 — Source fingerprint and immutability | Input is 33,586 bytes with SHA-256 `baed83ae34b33bf199d5a88a15fa66ae95758dfada90df9b4585a4171d3525c0`; same checksum after analysis/import. Workbook untouched. |
| T02 — Inventory accounting | Exactly Matches 72 + Frames 421 =493 logical source rows, 36 parent IDs, 72 distinct `(ID,Player)` links, 20 parents with frame rows. Every source row has a retained locator/disposition; headers not imported as records. |
| T03 — All-Time result preservation | Under the explicitly stated reported-result authority/mapping, all **36** sessions represented once; Donal **19 W / 13 L / 4 D**, Sean **13 W / 19 L / 4 D**, frames **391/335**, total **726**. No silent exclusion of source-only or shifted-status rows. |
| T04 — Older score-only inclusion | **16** result-only parents, **157/148** frame wins, **6/7** outright wins and **3 draws**. Example numeric ID `1.0` retains 10–3 on 2026-01-05; `m_1783645677378` retains 5–5 despite app-style ID. |
| T05 — No artificial frames | Those 16 parents produce **0 frame rows/participants/events implying played frames**, not 305. Import session snapshots are permitted; fake individual frame snapshots are not. |
| T06 — No double count | Type B contribution is **234/187 once**, added to Type A **157/148**. Reject result **625/522** or total **1,147**. Match count is 36, not 72 participant rows or 56 from adding tracked parents again. |
| T07 — Score reconciliation | **20/20** tracked raw winner tallies equal respective reported scores; **19** pass unique contiguous sequence and contain 404 rows. No post-import change to any reported score is permitted without a separate reviewed correction. |
| T08 — Collision preservation and stop gate | `m_1793225336292` retains both source frame 14 rows 419/420, 17 observations, reported 12–5. Exactly 420 distinct `(parent,number)` keys; no exact row duplicates. Canonical frame count/number assignment for this night is **blocked pending disposition**, not silently expected to become 16. If all 17 are approved distinct, preserve 17 with an explicit approved canonical-sequence mapping and both original 14 labels. |
| T09 — Explicit dispute/exclusion reporting | One sequence-disputed night; no whole night excluded from primary reported baseline. If owner elects whole-night quarantine, separately reconcile **35 nights, 18/13 wins, 4 draws, 379/330 frames, total 709** and explain the change. Do not confuse eight missing-offender events with eight extra nights. |
| T10 — Null and Boolean preservation | All raw frame observations: breaker **399 known /22 null**; break-pot **140 true /206 false /75 null**. No becomes false, not truthy string; absent remains null. Score-only nights contribute no denominator to any of these rates. |
| T11 — Other metadata preservation | **31 Super Foul**, **10 Golden Break**, **380 Regular/None**; 23 known offenders  + 8 unknown Super Foul offenders; 416 known pocket codes  + 5 None; scratches 317/348; 420 positive durations  + one zero at H420. No event/known zero silently dropped. Coverage counts recalculated for any approved canonical dispute disposition. |
| T12 — Stale display isolation | Original `Frames!N300` preserved as evidence; canonical score after its winner prefix is 1–2, not saved 2–1. Final reported 16–11 unchanged. Applying this display correction never changes a Winner field. |
| T13 — Dates and separate sessions | Date-only range **2026-01-05…2026-10-28**; **35** distinct dates but **36** source sessions. Both Oct 17 IDs remain distinct with their own venues/results; no invented time order. |
| T14 — Season and H2H scope | Only supported pair is Donal–Sean and all source dates fall in calendar 2026. All-Time includes 36 sessions. Until a season definition is approved, no original season label is invented. If owner chooses calendar 2026, its totals must equal this export's All-Time totals; month filters must match §7. Score-only nights remain included. |
| T15 — Permanent identities / no accounts | Exactly two reviewed guest/unclaimed identities and group-local profiles; no Alan or prototype names imported. All participant references resolve to these identities; no Auth accounts/ownership links created. Future verified claiming changes links only, leaving 391/335 and all original IDs intact. |
| T16 — Stable source IDs / rerun | Every source Match ID text maps to the same UUID across repeats, including numeric-looking 1.0–15.0. Repeating exact checksum/mapping/import version yields **0 additional canonical sessions, players, venues, frames or result rows** and 0 new ownership links. Changed source content is reported, not overwritten. |
| T17 — Status mapping and excluded field | Rows 2–41 map explicit G Completed; rows 42–73 require approved shifted F status mapping. All 36 results remain accounted for. No financial field or numeric F value appears in normalized records, migration payloads or analytics. Preserve only relevant status tokens and cell locators. |
| T18 — Detail eligibility / no false completeness | **0** partial-score-coverage nights detected. Missing breaker/pot/offender alone does not convert complete sequences into fabricated partial scores. The number 14 dispute prevents claiming complete sequence identity for the last night; low-quality duration does not erase a trustworthy reported final result. |
| T19 — Isolated dry-run/recovery | Dry run makes **0 database writes**, contacts no production source and reports pending decisions. Later authorized staging rerun/rollback must preserve source, guest IDs and approved result totals; rollback never deletes source data or a later claimed identity as collateral damage. |

An accepted canonical migration must account for every valid historical night exactly once **and** explain any unresolved detail quarantine. At present, the reported baseline is verified arithmetically, but import acceptance remains blocked by owner decisions below. Frame-number repair, automatic deduplication and season selection were not performed.

## 12. Recommended corrections to the database design

**Recommendations only; `docs/DATABASE_DESIGN.md` is not changed by this task.** Its overall guest/group/session/frame structure fits the workbook. The following refinements are necessary before treating it as a complete import specification:

1. **Separate reported-result authority from detail quality/sequence validity.** A result can be consistent while numbering or metadata is defective. The design's blanket exclusion of disputed/partial nights from result aggregates risks losing supported reported history. Add an explicit reviewed result-authority/eligibility decision distinct from frame coverage, sequence validity and per-field flags. Preserve raw scores for every night, and the 36-night reported baseline; quarantine ambiguous frame sequence without automatically erasing its result. This is not permission to trust conflicting final scores indiscriminately.
2. **Preserve original frame ordinal separately from canonical frame identity/sequence.** Existing unique `(session_id,frame_number)` cannot hold both frame 14 observations unchanged. Add a source ordinal/locator and sequence-quality concept, or keep both privately staged until an approved interpretation. Do not weaken native frame uniqueness to permit duplicate submissions. A legacy source key of just `match ID + frame number` is demonstrably insufficient. Stable imported UUIDs require a reviewed observation map, especially across reordered exports.
3. **Add explicit versioned mapping for the F/G status drift.** Use the actual completion-status token and source cell location for each layout. Total Bill is excluded by owner decision: no database field, financial evidence extraction, migration payload or metric. The original workbook remains the source archive.
4. **Support historical known completion with unknown exact timestamps.** Native lifecycle CHECKs should remain strict, but imported finalized results may have only a date and a completion label. Do not invent finalized_at, started_at, timer anchors, timezone or season dates to satisfy native constraints. Prefer an explicit source-completion evidence flag.
5. **Retain nullability/field-level exceptions for imports.** Breaker/pot fields were introduced at different points. Native Super Foul offender requirements cannot reject or fabricate the eight historical unknown offenders. Preserve known event/winner facts and mark the unresolved relation. Literal pocket None needs an approved missing/applicability mapping, not a seventh code.
6. **Keep reported zero duration plus quality.** Zero is observed at the numbering-collision row, not a blank to silently coerce. Exclude unverified/nonpositive values from trustworthy speed records while retaining source duration and row identity. Do not repair old pause defects without interval evidence.
7. **Keep season membership and guest ownership unresolved until evidence/approval.** All rows are calendar 2026 but no source season exists. Donal and Sean remain unclaimed identities, not inferred Auth users; the correct prior condition for claiming is stable player references, not precreated accounts.

Thus the answer to “does the design support the data without changes?” is **not completely as written**. It supports the main two result types and permanent identity lifecycle, but duplicate numbering and independent result/detail eligibility need explicit refinement; status-layout and date/missingness rules require a concrete importer contract. No redesign of the React UI is part of this task.

## 13. Open questions requiring owner confirmation

1. **Repeated frame 14:** Are rows 419/420 in `m_1793225336292` two physical frames with a numbering error, a repeated submission, an amendment, or something else? Which final score and sequence should be authoritative? Current source says 12–5 and contains 17 winner observations; no repair is assumed.
2. **Status/layout drift:** May the importer interpret F=Completed/G blank in Matches rows 42–73 as shifted completion status? Was this a deliberate old six-column layout under a later seven-column header? Only raw values are confirmed.
3. **Result eligibility while detail is disputed:** Approve preserving all 36 reported results in leaderboard baselines while resolving frame identity independently, or explicitly choose and explain a different quarantine baseline. Never silently omit score-only history.
4. **Running-score contradiction:** Confirm that row 300's saved display text is stale relative to the Winner sequence; should canonical display derive from Winner while the original string remains provenance? No source edit is needed.
5. **Missing metadata:** Can any copied source recover the 22 unknown breakers, 75 unknown break-pot values or 8 offenders? Otherwise retain nulls. No retrospective inference should be used merely to complete charts.
6. **Season/date/timezone:** What are the actual legacy season boundaries and source timezone? Confirm the recorded 2026 dates. Two Oct 17 sessions must remain distinct; actual time/order is unrecorded unless independently evidenced.
7. **Venue spelling and identity:** Is `Marstins Kingsway` the intended historical label? Preserve source text unless a separately approved alias map identifies a correction. Also approve the initial owning group and the two guest identities before UUID allocation.
8. **Copied Apps Script availability:** Source code could establish original season/breaker/metric rules and explain row-layout changes; this audit did not contact the endpoint. A copy is sufficient—no live access is required.
9. **Timing trust:** Should all imported durations remain descriptive only given known legacy stopwatch defects, with fastest/slowest records restricted to future reliable measurements? The present export cannot verify actual active time.

## 14. Recommended next implementation step

Review this baseline and decide the repeated-number and shifted-status interpretations first. Then separately authorize a small **offline, dry-run-only importer/validator** using the copied workbook, with a reviewed source-to-UUID manifest and the acceptance baselines in §11. It should emit proposed canonical facts, preserved source observations and explicit exceptions without database writes. Refine the database design as approved before authorizing schema work or a staging import.

Do not proceed straight to Supabase insertion: the original frame-number uniqueness would collide, and an unreviewed status parser could omit 16 nights. Preserve the whole Donal–Sean rivalry at the result level—**36 source sessions, 19/13 wins, 4 draws and 391/335 frames**—while keeping unresolved detail honest.

No workbook values, legacy application files, React code, database resources or existing design documents were changed. No dependencies installed, live endpoints contacted, migrations run, data imported, deployments or commits performed. The source checksum was checked again after writing this audit.
