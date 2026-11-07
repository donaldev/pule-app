#!/usr/bin/env python3
"""Offline, read-only XLSX normalization. Proposals only; no database/network code."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
from typing import Any
from uuid import UUID, uuid5
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data/legacy/historical-scores.xlsx"
OUTPUT = ROOT / "data/legacy/validation"
VERSION = "pule-legacy-dry-run-v1"
STATUS_VERSION = "completed-column-g-or-absent-g-exact-f-v1"
REVIEW_VERSION = "owner-2026-11-03-private-evidence-exclude-canonical-zero-frame14-v3"
EXPECTED_SHA256 = "baed83ae34b33bf199d5a88a15fa66ae95758dfada90df9b4585a4171d3525c0"
UPDATED_INPUT = ROOT / "data/legacy/historical-scores-nov-4th.xlsx"
UPDATED_SHA256 = "97eef9a63e6a9d927a6cf63a153059f8b7f9aff9173d3fbf013cb854ead94538"
DISPUTED_MATCH = "m_1793225336292"
NAMESPACE = UUID("a1212e10-d3e6-51bd-b655-d9f4ff316d57")
SOURCE_KEY = "pule-original-workbook-v1"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
MATCH_HEADERS = ["Match ID", "Date", "Player", "Frames Won", "Venue", "Total Bill", "Status"]
FRAME_HEADERS = ["Match ID", "Frame Number", "Player 1", "P1 Scratches", "Player 2", "P2 Scratches", "Winner", "Duration (sec)", "Black Pocket", "Special Event", "Breaker", "Super Fouler", "Potted On Break", "Running Score"]
# Reviewed source identity keys, not general name-based global identity matching.
PEOPLE = {"Donal": "source-person-001", "Sean": "source-person-002"}
VENUES = {"Soho": "source-venue-001", "Sneaky Pete's": "source-venue-002", "The Mac": "source-venue-003", "Marstins Kingsway": "source-venue-004"}
SPECIALS = {"None": "regular", "Super Foul": "super_foul", "Golden Break": "golden_break", "Break & Run": "break_and_run", "Dry Clearance": "dry_clearance"}
POCKETS = {"TL", "TM", "TR", "BL", "BM", "BR"}


class ValidationError(ValueError):
    """Input is outside the reviewed source contract; never repair it silently."""


def stable_id(kind: str, key: str) -> str:
    return str(uuid5(NAMESPACE, f"{SOURCE_KEY}/{kind}/{key}"))


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


@dataclass(frozen=True)
class Cell:
    value: str | None
    kind: str = "n"


@dataclass(frozen=True)
class Row:
    number: int
    cells: dict[str, Cell]

    def get(self, column: str) -> str | None:
        cell = self.cells.get(column)
        return cell.value if cell else None


@dataclass(frozen=True)
class Workbook:
    sha256: str
    size_bytes: int
    sheets: dict[str, list[Row]]


def read_xlsx(path: Path) -> Workbook:
    """Read bytes once; no workbook save, formula evaluation or external access."""
    data = path.read_bytes()
    from io import BytesIO
    try:
        with ZipFile(BytesIO(data)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 50_000_000:
                raise ValidationError("Workbook exceeds the reviewed uncompressed size limit")

            def xml(name: str) -> ET.Element:
                raw = archive.read(name)
                if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                    raise ValidationError("DTD/entity declarations are unsupported")
                return ET.fromstring(raw)

            workbook = xml("xl/workbook.xml")
            props = workbook.find("s:workbookPr", NS)
            if props is not None and props.get("date1904") in {"1", "true"}:
                raise ValidationError("1904 date system is outside this reviewed mapping")
            relationships = {}
            for rel in xml("xl/_rels/workbook.xml.rels"):
                if rel.get("TargetMode") == "External":
                    raise ValidationError("External workbook relationships are unsupported")
                relationships[rel.get("Id")] = rel.get("Target")
            strings = []
            if "xl/sharedStrings.xml" in archive.namelist():
                for item in xml("xl/sharedStrings.xml").findall("s:si", NS):
                    strings.append("".join(t.text or "" for t in item.findall(".//s:t", NS)))
            sheets = {}
            for sheet in workbook.findall("s:sheets/s:sheet", NS):
                name = sheet.get("name")
                if name in sheets:
                    raise ValidationError("Duplicate worksheet name")
                target = relationships[sheet.get(REL_ID)]
                part = PurePosixPath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
                if ".." in part.parts:
                    raise ValidationError("Unexpected worksheet relationship path")
                rows = []
                seen_rows = set()
                for element in xml(str(part)).findall("s:sheetData/s:row", NS):
                    number = int(element.get("r"))
                    if number in seen_rows:
                        raise ValidationError("Duplicate XML row number")
                    seen_rows.add(number)
                    cells = {}
                    for c in element.findall("s:c", NS):
                        ref = c.get("r", "")
                        column = ref.rstrip("0123456789")
                        if not column or ref != f"{column}{number}" or column in cells:
                            raise ValidationError("Invalid or duplicated cell coordinate")
                        if c.find("s:f", NS) is not None:
                            raise ValidationError(f"Formula unsupported at {name}!{ref}; cached results not trusted")
                        kind = c.get("t", "n")
                        value = c.findtext("s:v", None, NS)
                        if kind == "s":
                            value = strings[int(value)] if value is not None else None
                        elif kind == "inlineStr":
                            value = "".join(t.text or "" for t in c.findall(".//s:t", NS))
                        elif kind == "e":
                            raise ValidationError(f"Excel error cell at {name}!{ref}")
                        cells[column] = Cell(value, kind)
                    if any(c.value not in (None, "") for c in cells.values()):
                        rows.append(Row(number, cells))
                sheets[name] = rows
    except (BadZipFile, ET.ParseError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise ValidationError(f"Unsupported or malformed XLSX: {exc}") from exc
    return Workbook(hashlib.sha256(data).hexdigest(), len(data), sheets)


def integer(row: Row, column: str, sheet: str, *, optional: bool = False) -> int | None:
    value = row.get(column)
    if value is None and optional:
        return None
    try:
        number = Decimal(value or "NaN")
        if not number.is_finite() or number < 0 or number % 1:
            raise InvalidOperation
    except InvalidOperation as exc:
        raise ValidationError(f"Expected nonnegative integer at {sheet}!{column}{row.number}") from exc
    return int(number)


def required(row: Row, column: str, sheet: str) -> str:
    value = row.get(column)
    if value is None or not value.strip() or value != value.strip():
        raise ValidationError(f"Missing or whitespace-padded value at {sheet}!{column}{row.number}")
    return value


def person(value: str | None) -> str | None:
    if value is None:
        return None
    if value not in PEOPLE:
        raise ValidationError("Unknown player label; identity map review required")
    return stable_id("player", PEOPLE[value])


def source_ref(wb: Workbook, sheet: str, row: Row, fields: dict) -> dict:
    # Financial cells are deliberately absent from fields and this extracted-fact hash.
    return {"source_checksum": wb.sha256, "sheet": sheet, "row": row.number,
            "observation_id": stable_id("observation", f"{wb.sha256}/{sheet}/{row.number}"),
            "extracted_facts_sha256": digest(fields), "fields": fields}


def status_mapping(row: Row) -> dict:
    if row.get("G") == "Completed":
        column, rule = "G", "status_g_completed"
    elif "G" not in row.cells and row.get("F") == "Completed":
        column, rule = "F", "status_f_completed_when_g_absent"
    else:
        raise ValidationError(f"Unapproved completion-status layout at Matches row {row.number}")
    return {"value": "Completed", "cell": f"{column}{row.number}", "rule": rule,
            "mapping_version": STATUS_VERSION}


def normalize(wb: Workbook) -> tuple[dict, dict]:
    if set(wb.sheets) != {"Matches", "Frames"}:
        raise ValidationError("Expected exactly Matches and Frames worksheets")
    for sheet, headers in [("Matches", MATCH_HEADERS), ("Frames", FRAME_HEADERS)]:
        rows = wb.sheets[sheet]
        if not rows or rows[0].number != 1 or [rows[0].get(chr(65 + i)) for i in range(len(headers))] != headers:
            raise ValidationError(f"Unexpected {sheet} headers")
        if any(set(r.cells) - set(chr(65 + i) for i in range(len(headers))) for r in rows):
            raise ValidationError(f"Unmapped extra columns in {sheet}")

    group_id = stable_id("group", "proposed-legacy-group")
    players = [{"id": person(name), "source_identity_key": key, "source_label": name,
                "ownership_state": "unclaimed", "account_user_id": None} for name, key in PEOPLE.items()]
    venues = [{"id": stable_id("venue", key), "group_id": group_id, "display_name": name}
              for name, key in VENUES.items()]
    groups = defaultdict(list)
    results = []
    incomplete = []
    for row in wb.sheets["Matches"][1:]:
        legacy_id = required(row, "A", "Matches")
        name = required(row, "C", "Matches")
        player_id = person(name)
        score = integer(row, "D", "Matches")
        serial = integer(row, "B", "Matches")
        if serial < 61 or row.cells["B"].kind != "n":
            raise ValidationError("Date requires reviewed numeric modern 1900-system serial")
        try:
            occurred_on = (date(1899, 12, 30) + timedelta(days=serial)).isoformat()
        except (OverflowError, ValueError) as exc:
            raise ValidationError("Date outside supported range") from exc
        venue = required(row, "E", "Matches")
        if venue not in VENUES:
            raise ValidationError("Unknown venue; source map review required")
        active_column = "G" if row.get("G") == "Active" else "F" if "G" not in row.cells and row.get("F") == "Active" else None
        if active_column:
            if score != 0:
                raise ValidationError("Active result has nonzero score; review required")
            fields = {c: row.get(c) for c in "ABCDE"}
            fields[active_column] = "Active"
            incomplete.append({"legacy_match_id": legacy_id, "player_id": player_id, "frames_won": score,
                               "occurred_on": occurred_on, "venue_id": stable_id("venue", VENUES[venue]),
                               "classification": "active_not_imported", "provenance": source_ref(wb, "Matches", row, fields)})
            continue
        status = status_mapping(row)
        # Numeric F is discarded. Only a meaningful completion status token is extracted.
        fields = {c: row.get(c) for c in "ABCDE"}
        fields[status["cell"].rstrip("0123456789")] = "Completed"
        result = {"session_id": stable_id("session", legacy_id), "legacy_match_id": legacy_id,
                  "legacy_id_source_type": row.cells["A"].kind, "player_id": player_id,
                  "frames_won": score, "occurred_on": occurred_on,
                  "venue_id": stable_id("venue", VENUES[venue]), "status_evidence": status,
                  "provenance": source_ref(wb, "Matches", row, fields)}
        groups[legacy_id].append(result)
        results.append(result)

    for mid in {r["legacy_match_id"] for r in incomplete}:
        rr = [r for r in incomplete if r["legacy_match_id"] == mid]
        if mid in groups or len(rr) != 2 or len({r["player_id"] for r in rr}) != 2 or any(len({r[k] for r in rr}) != 1 for k in ("occurred_on", "venue_id")):
            raise ValidationError("Inconsistent Active record; review required")

    raw_frames = []
    private_noncanonical = []
    by_session = defaultdict(list)
    exceptions = []
    for row in wb.sheets["Frames"][1:]:
        mid = required(row, "A", "Frames")
        if mid not in groups:
            raise ValidationError(f"Orphan frame at Frames row {row.number}")
        p1, p2 = person(required(row, "C", "Frames")), person(required(row, "E", "Frames"))
        if p1 == p2:
            raise ValidationError("Frame requires distinct participants")
        number = integer(row, "B", "Frames")
        if number < 1:
            raise ValidationError("Frame number must be positive")
        winner = person(required(row, "G", "Frames"))
        breaker, offender = person(row.get("K")), person(row.get("L"))
        if any(p not in (p1, p2) for p in (winner, breaker, offender) if p is not None):
            raise ValidationError("Frame subject outside its pair")
        pocket = row.get("I")
        if pocket not in POCKETS | {None, "None"}:
            raise ValidationError("Unmapped pocket code")
        special = row.get("J")
        if special is not None and special not in SPECIALS:
            raise ValidationError("Unmapped special event")
        pot = row.get("M")
        if pot not in {None, "Yes", "No"}:
            raise ValidationError("Unmapped break-pot value")
        duration = integer(row, "H", "Frames", optional=True)
        flags = []
        if breaker is None:
            flags.append("breaker_unknown")
        if pot is None:
            flags.append("break_pot_unknown")
        if special == "Super Foul" and offender is None:
            flags.append("super_foul_offender_unknown")
        if offender is not None and (special != "Super Foul" or offender == winner):
            flags.append("special_offender_conflict")
        if special in ("Golden Break", "Break & Run") and (breaker != winner or pot != "Yes"):
            flags.append("special_break_metadata_conflict")
        if duration == 0:
            flags.append("reported_zero_duration")
        fields = {c: row.get(c) for c in "ABCDEFGHIJKLMN"}
        raw = {"legacy_match_id": mid, "session_id": stable_id("session", mid),
               "source_frame_number": number, "winner_id": winner, "breaker_id": breaker,
               "offender_id": offender, "potted_on_break": {"Yes": True, "No": False, None: None}[pot],
               "black_pocket_code": pocket if pocket in POCKETS else None,
               "pocket_state": "recorded" if pocket in POCKETS else "not_recorded",
               "special_event": SPECIALS.get(special), "elapsed_ms": duration * 1000 if duration is not None else None,
               "duration_quality": "imported_unverified" if duration is not None else "unknown",
               "started_at": None, "completed_at": None,
               "participants": [{"player_id": p1, "side": 1, "foul_count": integer(row, "D", "Frames", optional=True)},
                                {"player_id": p2, "side": 2, "foul_count": integer(row, "F", "Frames", optional=True)}],
               "source_running_score": row.get("N"), "quality_flags": flags,
               "canonical_disposition": "accepted_proposal", "canonical_frame_id": None,
               "provenance": source_ref(wb, "Frames", row, fields)}
        raw_frames.append(raw)
        by_session[mid].append(raw)

    if DISPUTED_MATCH in by_session:
        if wb.sha256 not in (EXPECTED_SHA256, UPDATED_SHA256):
            raise ValidationError("Reviewed exclusion requires the exact approved workbook fingerprint")
        pair = [f for f in by_session[DISPUTED_MATCH] if f["source_frame_number"] == 14]
        if [(f["provenance"]["row"], f["elapsed_ms"]) for f in pair] != [(419, 565000), (420, 0)]:
            raise ValidationError("Reviewed frame14 evidence does not match")
        # Latest owner instruction: keep complete PRIVATE evidence, never a scored frame.
        private_noncanonical.append({**pair[1], "canonical_frame_id": None,
                                     "canonical_disposition": "excluded_noncanonical",
                                     "detailed_statistics_eligible": False,
                                     "sequence_statistics_eligible": False})
        raw_frames.remove(pair[1])
        by_session[DISPUTED_MATCH].remove(pair[1])

    sessions, canonical, reconciliation = [], [], []
    names = {person(name): name for name in PEOPLE}
    for mid, rr in groups.items():
        if len(rr) != 2 or {r["player_id"] for r in rr} != set(names):
            raise ValidationError("Each reviewed session needs exactly the two distinct source participants")
        if any(len({r[k] for r in rr}) != 1 for k in ("occurred_on", "venue_id", "legacy_id_source_type")):
            raise ValidationError("Conflicting session context")
        scores = {r["player_id"]: r["frames_won"] for r in rr}
        total = sum(scores.values())
        for r in rr:
            other = next(v for p, v in scores.items() if p != r["player_id"])
            r["outcome"] = "draw" if r["frames_won"] == other else "win" if r["frames_won"] > other else "loss"
        ff = by_session[mid]
        counts = Counter(f["winner_id"] for f in ff)
        nums = [f["source_frame_number"] for f in ff]
        duplicate_numbers = sorted(n for n, count in Counter(nums).items() if count > 1)
        mismatch = any(counts[p] != score for p, score in scores.items())
        sequence_ok = bool(ff) and not mismatch and nums == list(range(1, total + 1))
        if not ff:
            classification = "score_only"
        elif sequence_ok:
            classification = "fully_tracked_reconciled"
        elif mid == DISPUTED_MATCH:
            classification = "sequence_disputed"
        else:
            raise ValidationError("Unreviewed score/sequence conflict; explicit source review required")
        seen = set()
        tally = Counter()
        for f in ff:
            if {p["player_id"] for p in f["participants"]} != set(scores):
                raise ValidationError("Frame pair differs from session pair")
            tally[f["winner_id"]] += 1
            expected_running = f"Donal {tally[person('Donal')]} - {tally[person('Sean')]} Sean"
            if f["source_running_score"] is not None and f["source_running_score"] != expected_running:
                f["quality_flags"].append("source_running_score_conflict")
            f["sequence_statistics_eligible"] = sequence_ok
            # Conservative policy: all details of the disputed night are excluded from aggregate inputs.
            f["detailed_statistics_eligible"] = sequence_ok
            if f["canonical_disposition"] == "accepted_proposal":
                n = f["source_frame_number"]
                if n in seen:
                    raise ValidationError("Unresolved canonical frame number collision")
                seen.add(n)
                cid = stable_id("frame", f"{mid}/{n}")
                f["canonical_frame_id"] = cid
                canonical.append({"id": cid, "group_id": group_id, "session_id": f["session_id"],
                                  "frame_number": n, "origin": "imported", "status": "completed",
                                  "source_observation_id": f["provenance"]["observation_id"],
                                  **{k: v for k, v in f.items() if k in ("winner_id", "breaker_id", "offender_id", "potted_on_break", "black_pocket_code", "pocket_state", "special_event", "elapsed_ms", "duration_quality", "started_at", "completed_at", "participants", "quality_flags", "sequence_statistics_eligible", "detailed_statistics_eligible")}})
            if f["quality_flags"]:
                exceptions.append({"observation_id": f["provenance"]["observation_id"], "legacy_match_id": mid,
                                   "sheet_row": f["provenance"]["row"], "flags": list(f["quality_flags"])})
        accepted_counts = Counter(f["winner_id"] for f in ff if f["canonical_frame_id"])
        sessions.append({"id": rr[0]["session_id"], "group_id": group_id, "legacy_match_id": mid,
                         "status": "finalized", "completion_evidence": [r["status_evidence"] for r in rr],
                         "record_kind": "frame_log" if ff else "result_only", "result_authority": "approved_historical_reported",
                         "result_statistics_eligible": True, "sequence_quality": "reconciled" if sequence_ok else "disputed" if ff else "not_recorded",
                         "classification": classification, "occurred_on": rr[0]["occurred_on"],
                         "date_precision": "date_only", "occurred_at": None, "started_at": None, "finalized_at": None,
                         "source_timezone": None, "season_id": None, "rules_status": "legacy_unknown", "venue_id": rr[0]["venue_id"],
                         "participants": [{"player_id": r["player_id"], "source_label": names[r["player_id"]]} for r in rr]})
        reconciliation.append({"legacy_match_id": mid, "session_id": rr[0]["session_id"], "classification": classification,
                               "match_rows": [r["provenance"]["row"] for r in rr], "frame_rows": [f["provenance"]["row"] for f in ff],
                               "reported_scores": {names[p]: n for p, n in scores.items()},
                               "observed_scores": {name: counts[p] for p, name in names.items()},
                               "canonical_scores": {name: accepted_counts[p] for p, name in names.items()},
                               "raw_observations": len(ff), "canonical_frames": sum(bool(f["canonical_frame_id"]) for f in ff),
                               "quarantined_observations": sum(not f["canonical_frame_id"] for f in ff),
                               "duplicate_source_numbers": duplicate_numbers, "source_scores_reconcile": not mismatch if ff else None,
                               "sequence_statistics_eligible": sequence_ok})

    leaderboard = {}
    for pid, name in names.items():
        own = [r for r in results if r["player_id"] == pid]
        count = len(own)
        won_frames = sum(r["frames_won"] for r in own)
        leaderboard[name] = {"nights": count, "wins": sum(r["outcome"] == "win" for r in own),
                             "losses": sum(r["outcome"] == "loss" for r in own), "draws": sum(r["outcome"] == "draw" for r in own),
                             "reported_frames_won": won_frames,
                             "frame_win_percentage": round(won_frames / sum(r["frames_won"] for r in results) * 100, 6) if sum(r["frames_won"] for r in results) else None,
                             "average_frames_won_per_night": round(won_frames / count, 6) if count else None}
    summary = {"sessions": len(sessions), "active_nights_not_imported": len({r["legacy_match_id"] for r in incomplete}), "active_result_rows_not_imported": len(incomplete), "classification_counts": dict(Counter(s["classification"] for s in sessions)),
               "sessions_with_observations": len(by_session) - sum(not value for value in by_session.values()),
               "source_frame_rows": len(wb.sheets["Frames"]) - 1,
               "excluded_source_rows": len(wb.sheets["Frames"]) - 1 - len(raw_frames),
               "raw_frame_observations": len(raw_frames), "canonical_frames_proposed": len(canonical),
               "quarantined_observations": sum(not f["canonical_frame_id"] for f in raw_frames),
               "detailed_statistics_frames": sum(f["detailed_statistics_eligible"] for f in canonical),
               "reported_frame_wins_total": sum(r["frames_won"] for r in results),
               "status_rules": dict(Counter(r["status_evidence"]["rule"] for r in results)),
               "missing_metadata": {"breaker": sum(f["breaker_id"] is None for f in raw_frames),
                                    "break_pot": sum(f["potted_on_break"] is None for f in raw_frames),
                                    "super_foul_offender": sum(f["special_event"] == "super_foul" and f["offender_id"] is None for f in raw_frames)},
               "leaderboard": leaderboard}
    fingerprint = {"sha256": wb.sha256, "size_bytes": wb.size_bytes}
    proposal = {"format_version": VERSION, "status_mapping_version": STATUS_VERSION, "owner_review_version": REVIEW_VERSION,
                "source_namespace": SOURCE_KEY, "input": fingerprint, "mode": "offline_proposal_no_database_writes",
                "group_assignment": {"id": group_id, "state": "proposed_not_created"},
                "players": players, "group_players": [{"group_id": group_id, "player_id": person(name), "display_name": name} for name in PEOPLE],
                "venues": venues, "sessions": sessions, "historical_reported_results": results,
                "raw_frame_observations": raw_frames, "canonical_frames": canonical,
                "private_noncanonical_observations": private_noncanonical,
                "excluded_source_rows": [{"sheet": "Frames", "row": 420, "legacy_match_id": DISPUTED_MATCH,
                                           "reason": "owner_requested_exclusion", "review_version": REVIEW_VERSION}]
                                         if DISPUTED_MATCH in by_session else [],
                "incomplete_results_not_imported": incomplete,
                "auth_users": [], "player_account_links": []}
    report = {"format_version": VERSION, "input": fingerprint, "summary": summary,
              "reconciliation": reconciliation, "data_quality_exceptions": exceptions,
              "blocked": ["No database/RLS/transaction/claim/import execution validated", "Resolve remaining reported-result versus retained-frame discrepancy before detailed statistics for the affected night", "Original server breaker policy and season definitions remain unverified"]}
    return proposal, report


def baseline_checks(proposal: dict, report: dict) -> list[dict]:
    s = report["summary"]
    updated = proposal["input"]["sha256"] == UPDATED_SHA256
    checks = []

    def check(name: str, actual: Any, expected: Any) -> None:
        checks.append({"check": name, "passed": actual == expected, "actual": actual, "expected": expected})

    check("approved_source_fingerprint", proposal["input"]["sha256"], UPDATED_SHA256 if updated else EXPECTED_SHA256)
    for key, expected in {"sessions": 36, "sessions_with_observations": 20, "source_frame_rows": 421, "excluded_source_rows": 1, "raw_frame_observations": 420,
                          "canonical_frames_proposed": 420, "quarantined_observations": 0,
                          "detailed_statistics_frames": 404, "reported_frame_wins_total": 726}.items():
        if updated:
            expected = {"sessions": 37, "sessions_with_observations": 21, "source_frame_rows": 453,
                        "raw_frame_observations": 452, "canonical_frames_proposed": 452,
                        "detailed_statistics_frames": 436, "reported_frame_wins_total": 758}.get(key, expected)
        check(key, s[key], expected)
    check("unique_session_ids", len({x["id"] for x in proposal["sessions"]}), 37 if updated else 36)
    check("unique_canonical_ids", len({x["id"] for x in proposal["canonical_frames"]}), 452 if updated else 420)
    check("unique_raw_observation_ids", len({x["provenance"]["observation_id"] for x in proposal["raw_frame_observations"]}), 452 if updated else 420)
    check("result_rows_once_per_session_player", len({(x["session_id"], x["player_id"]) for x in proposal["historical_reported_results"]}), 74 if updated else 72)
    check("result_authority_independent_of_details", all(x["result_authority"] == "approved_historical_reported" and x["result_statistics_eligible"] for x in proposal["sessions"]), True)
    check("session_classes", s["classification_counts"], {"score_only": 16, "fully_tracked_reconciled": 20 if updated else 19, "sequence_disputed": 1})
    for name, expected in {"Donal": {"nights": 36, "wins": 19, "losses": 13, "draws": 4, "reported_frames_won": 391},
                           "Sean": {"nights": 36, "wins": 13, "losses": 19, "draws": 4, "reported_frames_won": 335}}.items():
        for key, value in expected.items():
            if updated:
                value = {"nights": 37, "draws": 5, "reported_frames_won": 407 if name == "Donal" else 351}.get(key, value)
            check(f"{name}_{key}", s["leaderboard"].get(name, {}).get(key), value)
    check("missing_metadata", s["missing_metadata"], {"breaker": 22, "break_pot": 75, "super_foul_offender": 8})
    check("status_rules", s["status_rules"], {"status_g_completed": 40, "status_f_completed_when_g_absent": 34 if updated else 32})
    zero_detail_ids = {x["id"] for x in proposal["sessions"] if x["record_kind"] == "result_only"}
    check("score_only_has_no_frames", any(f["session_id"] in zero_detail_ids for f in proposal["canonical_frames"]), False)
    raw14 = [f for f in proposal["raw_frame_observations"] if f["legacy_match_id"] == DISPUTED_MATCH and f["source_frame_number"] == 14]
    check("only_retained_frame14_proposed", [f["provenance"]["row"] for f in raw14], [419])
    check("zero_frame14_excluded", any(f["provenance"]["row"] == 420 for f in proposal["raw_frame_observations"]), False)
    check("disputed_night_all_details_excluded", any(f["detailed_statistics_eligible"] for f in proposal["raw_frame_observations"] if f["legacy_match_id"] == DISPUTED_MATCH), False)
    check("no_accounts_or_claims", [proposal["auth_users"], proposal["player_account_links"]], [[], []])
    check("complete_excluded_private_evidence_retained", [(f["provenance"]["row"], f["elapsed_ms"], len(f["provenance"]["fields"])) for f in proposal["private_noncanonical_observations"]], [(420, 0, 14)])
    check("private_exclusion_not_scored", all(f["canonical_frame_id"] is None and not f["detailed_statistics_eligible"] for f in proposal["private_noncanonical_observations"]), True)
    check("numeric_financial_source_values_excluded", any("F" in r["provenance"]["fields"] for r in proposal["historical_reported_results"] if r["status_evidence"]["rule"] == "status_g_completed"), False)
    if updated:
        check("active_night_excluded", s["active_nights_not_imported"], 1)
        check("active_rows_excluded", s["active_result_rows_not_imported"], 2)
        check("active_id_not_proposed", any(x["legacy_match_id"] == "m_1793836042786" for x in proposal["sessions"]), False)
        nov3 = [r for r in report["reconciliation"] if r["legacy_match_id"] == "m_1793747146794"]
        check("nov3_scores_and_details", [(r["reported_scores"], r["canonical_frames"], r["sequence_statistics_eligible"]) for r in nov3], [({"Donal":16,"Sean":16},32,True)])
    return checks


def write_outputs(output: Path, proposal: dict, report: dict) -> None:
    allowed = (ROOT / "data/legacy").resolve()
    resolved = output.resolve()
    if not resolved.is_relative_to(allowed) or resolved == allowed:
        raise ValidationError("Generated payloads must be in a subdirectory of ignored data/legacy/")
    resolved.mkdir(parents=True, exist_ok=True)
    for name, value in [("proposed-records.json", proposal), ("reconciliation.json", report)]:
        target = resolved / name
        if target.is_symlink():
            raise ValidationError("Refusing to overwrite symlink output")
        temporary = resolved / (name + ".tmp")
        if temporary.is_symlink():
            raise ValidationError("Refusing symlink temporary output")
        temporary.write_text(canonical_json(value), encoding="utf-8")
        temporary.replace(target)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=INPUT)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    try:
        workbook = read_xlsx(args.input)
        proposal, report = normalize(workbook)
        checks = baseline_checks(proposal, report)
        report["automated_checks"] = checks
        report["passed"] = all(c["passed"] for c in checks)
        # Recompute from fresh input before emitting an acceptance result.
        if hashlib.sha256(args.input.read_bytes()).hexdigest() != workbook.sha256:
            raise ValidationError("Input changed during validation")
        write_outputs(args.output_dir, proposal, report)
        print(canonical_json({"passed": report["passed"], "checks_passed": sum(c["passed"] for c in checks),
                              "checks_total": len(checks), "summary": report["summary"],
                              "output_directory": str(args.output_dir.resolve())}), end="")
        return 0 if report["passed"] else 1
    except (ValidationError, OSError) as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
