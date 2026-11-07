"""Synthetic contract tests plus optional read-only private-workbook integration tests."""
import contextlib
from copy import deepcopy
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

SCRIPT = Path(__file__).resolve().parents[1] / 'validate_history.py'
spec = importlib.util.spec_from_file_location('validate_history', SCRIPT)
v = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = v
spec.loader.exec_module(v)


def fixture():
    def row(n, values):
        return v.Row(n, {chr(65+i): v.Cell(x, 'n' if chr(65+i) in 'BD' else 'inlineStr') for i, x in enumerate(values) if x is not None})
    return v.Workbook('synthetic', 1, {
        'Matches': [row(1, v.MATCH_HEADERS),
                    row(2, ['fixture-only', '46027', 'Donal', '1', 'Soho', '999999', 'Completed']),
                    row(3, ['fixture-only', '46027', 'Sean', '0', 'Soho', '999999', 'Completed'])],
        'Frames': [row(1, v.FRAME_HEADERS)]})


class ContractTests(unittest.TestCase):
    def test_score_only_has_no_invented_frames_or_times(self):
        p, _ = v.normalize(fixture())
        self.assertEqual(p['canonical_frames'], [])
        self.assertEqual(p['raw_frame_observations'], [])
        s = p['sessions'][0]
        self.assertEqual(s['occurred_on'], '2026-01-05')
        for field in ('occurred_at', 'started_at', 'finalized_at', 'season_id'):
            self.assertIsNone(s[field])

    def test_financial_values_never_enter_normalized_evidence(self):
        w = fixture()
        a = v.canonical_json(v.normalize(w))
        w.sheets['Matches'][1].cells['F'] = v.Cell('123456789')
        self.assertEqual(a, v.canonical_json(v.normalize(w)))
        self.assertNotIn('999999', a)

    def test_g_status_precedence(self):
        r = v.Row(2, {'F': v.Cell('Completed'), 'G': v.Cell('Completed')})
        self.assertEqual(v.status_mapping(r)['cell'], 'G2')

    def test_shifted_status_only_when_g_absent(self):
        self.assertEqual(v.status_mapping(v.Row(2, {'F': v.Cell('Completed')}))['cell'], 'F2')
        for g in (None, '', 'Pending'):
            with self.subTest(g=g), self.assertRaises(v.ValidationError):
                v.status_mapping(v.Row(2, {'F': v.Cell('Completed'), 'G': v.Cell(g)}))

    def test_status_is_exact_not_trimmed_or_case_folded(self):
        for value in ('completed', ' Completed', 'Completed ', '0'):
            with self.subTest(value=value), self.assertRaises(v.ValidationError):
                v.status_mapping(v.Row(2, {'F': v.Cell(value)}))

    def test_invalid_counts_rejected(self):
        for value in ('-1', '1.5', 'NaN', 'Infinity', 'bad'):
            w = fixture()
            w.sheets['Matches'][1].cells['D'] = v.Cell(value)
            with self.subTest(value=value), self.assertRaises(v.ValidationError):
                v.normalize(w)

    def test_duplicate_participant_rejected(self):
        w = fixture()
        w.sheets['Matches'][2].cells['C'] = v.Cell('Donal')
        with self.assertRaises(v.ValidationError):
            v.normalize(w)

    def test_unknown_identity_needs_explicit_map(self):
        w = fixture()
        w.sheets['Matches'][1].cells['C'] = v.Cell('Fictional New Player')
        with self.assertRaises(v.ValidationError):
            v.normalize(w)

    def test_legacy_ids_preserve_lexical_text(self):
        w = fixture()
        for row in w.sheets['Matches'][1:]:
            row.cells['A'] = v.Cell('001.0')
        p, _ = v.normalize(w)
        self.assertEqual(p['sessions'][0]['legacy_match_id'], '001.0')
        self.assertNotEqual(v.stable_id('session', '001.0'), v.stable_id('session', '1'))

    def test_player_identity_independent_of_account(self):
        p, _ = v.normalize(fixture())
        self.assertEqual(p['auth_users'], [])
        self.assertEqual(p['player_account_links'], [])
        self.assertTrue(all(x['ownership_state'] == 'unclaimed' and x['account_user_id'] is None for x in p['players']))
        self.assertEqual(p['players'][0]['id'], v.stable_id('player', v.PEOPLE['Donal']))

    def test_output_outside_ignored_directory_rejected(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(v.ValidationError):
            v.write_outputs(Path(directory), {}, {})

    def test_malformed_zip_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bad.xlsx'
            path.write_bytes(b'not a workbook')
            with self.assertRaises(v.ValidationError):
                v.read_xlsx(path)

    def test_formula_and_external_relationship_rejected_without_evaluation(self):
        for formula, external in ((True, False), (False, True)):
            with self.subTest(formula=formula), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/'synthetic.xlsx'
                with ZipFile(path, 'w') as z:
                    z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Matches" r:id="r1"/></sheets></workbook>')
                    mode = ' TargetMode="External"' if external else ''
                    z.writestr('xl/_rels/workbook.xml.rels', f'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"{mode}/></Relationships>')
                    z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')
                before = path.read_bytes()
                with self.assertRaises(v.ValidationError):
                    v.read_xlsx(path)
                self.assertEqual(before, path.read_bytes())


@unittest.skipUnless(v.INPUT.exists(), 'Private workbook not available; baseline integration blocked')
class HistoricalIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = v.read_xlsx(v.INPUT)
        cls.p, cls.r = v.normalize(cls.w)

    def test_all_baseline_checks(self):
        failed = [c for c in v.baseline_checks(self.p, self.r) if not c['passed']]
        self.assertEqual(failed, [])

    def test_reported_result_not_replaced_by_canonical_count(self):
        r = next(x for x in self.r['reconciliation'] if x['legacy_match_id'] == v.DISPUTED_MATCH)
        self.assertEqual(r['reported_scores'], {'Donal': 12, 'Sean': 5})
        self.assertEqual(r['canonical_scores'], {'Donal': 11, 'Sean': 5})
        self.assertEqual(sum(x['frames_won'] for x in self.p['historical_reported_results']), 726)

    def test_zero_second_observation_excluded_not_quarantined(self):
        rows = [x for x in self.p['raw_frame_observations'] if x['legacy_match_id'] == v.DISPUTED_MATCH and x['source_frame_number'] == 14]
        self.assertEqual([x['provenance']['row'] for x in rows], [419])
        self.assertFalse(any(x['provenance']['row'] == 420 for x in self.p['raw_frame_observations']))
        self.assertEqual(self.r['summary']['quarantined_observations'], 0)
        self.assertEqual(self.r['summary']['excluded_source_rows'], 1)

    def test_complete_excluded_observation_retained_only_as_private_evidence(self):
        evidence = self.p['private_noncanonical_observations']
        self.assertEqual(len(evidence), 1)
        excluded = evidence[0]
        self.assertEqual(excluded['provenance']['row'], 420)
        source = next(row for row in self.w.sheets['Frames'] if row.number == 420)
        self.assertEqual(excluded['provenance']['fields'], {c: source.get(c) for c in 'ABCDEFGHIJKLMN'})
        self.assertEqual(excluded['canonical_disposition'], 'excluded_noncanonical')
        self.assertIsNone(excluded['canonical_frame_id'])
        self.assertFalse(excluded['detailed_statistics_eligible'])

    def test_missing_values_stay_null_not_false_or_zero(self):
        ff = self.p['raw_frame_observations']
        self.assertEqual(sum(f['potted_on_break'] is None for f in ff), 75)
        self.assertEqual(sum(f['potted_on_break'] is False for f in ff), 205)
        self.assertEqual(sum(f['potted_on_break'] is True for f in ff), 140)
        self.assertEqual(sum(f['breaker_id'] is None for f in ff), 22)
        self.assertTrue(all(f['started_at'] is None and f['completed_at'] is None for f in ff))

    def test_running_score_error_is_flagged_not_repaired(self):
        f = next(f for f in self.p['raw_frame_observations'] if f['provenance']['row'] == 300)
        self.assertIn('source_running_score_conflict', f['quality_flags'])
        self.assertEqual(f['source_running_score'], 'Donal 2 - 1 Sean')
        self.assertEqual(f['winner_id'], v.person('Sean'))

    def test_changed_snapshot_requires_new_duplicate_review(self):
        with self.assertRaises(v.ValidationError):
            v.normalize(v.Workbook('changed-fingerprint', self.w.size_bytes, self.w.sheets))

    def test_out_of_order_sequence_requires_review(self):
        sheets = deepcopy(self.w.sheets)
        sheets['Frames'][1], sheets['Frames'][2] = sheets['Frames'][2], sheets['Frames'][1]
        with self.assertRaises(v.ValidationError):
            v.normalize(v.Workbook(self.w.sha256, self.w.size_bytes, sheets))

    def test_unknown_metadata_tokens_require_review(self):
        for column, value in [('I', 'unknown-pocket'), ('J', 'unsupported-event'), ('M', 'false')]:
            sheets = deepcopy(self.w.sheets)
            sheets['Frames'][1].cells[column] = v.Cell(value)
            with self.subTest(column=column), self.assertRaises(v.ValidationError):
                v.normalize(v.Workbook(self.w.sha256, self.w.size_bytes, sheets))

    def test_orphan_and_unreviewed_collision_rejected(self):
        for column, value in [('A', 'synthetic-orphan'), ('B', '2')]:
            sheets = deepcopy(self.w.sheets)
            sheets['Frames'][1].cells[column] = v.Cell(value)
            with self.subTest(column=column), self.assertRaises(v.ValidationError):
                v.normalize(v.Workbook(self.w.sha256, self.w.size_bytes, sheets))

    def test_repeat_run_identical_source_unchanged_and_network_disabled(self):
        before = hashlib.sha256(v.INPUT.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(dir=v.INPUT.parent) as directory:
            output = Path(directory)/'payloads'
            with patch('socket.socket', side_effect=AssertionError('Network forbidden')), patch('urllib.request.urlopen', side_effect=AssertionError('Network forbidden')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(v.main(['--output-dir', str(output)]), 0)
                first = {p.name: p.read_bytes() for p in output.iterdir()}
                self.assertEqual(v.main(['--output-dir', str(output)]), 0)
                self.assertEqual(first, {p.name: p.read_bytes() for p in output.iterdir()})
        self.assertEqual(before, hashlib.sha256(v.INPUT.read_bytes()).hexdigest())


@unittest.skipUnless(v.UPDATED_INPUT.exists(), 'private updated workbook not present')
class UpdatedWorkbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = v.read_xlsx(v.UPDATED_INPUT)
        cls.p, cls.r = v.normalize(cls.w)

    def test_updated_baseline(self):
        self.assertEqual(self.w.sha256, v.UPDATED_SHA256)
        self.assertTrue(all(c['passed'] for c in v.baseline_checks(self.p, self.r)))

    def test_active_is_private_classification_only(self):
        rows = self.p['incomplete_results_not_imported']
        self.assertEqual([(r['legacy_match_id'], r['frames_won']) for r in rows], [('m_1793836042786', 0)] * 2)
        self.assertFalse(any(s['legacy_match_id'] == rows[0]['legacy_match_id'] for s in self.p['sessions']))
        self.assertEqual(sum(len(s['participants']) for s in self.p['sessions']), 74)

    def test_snapshot_overlap_ids_and_evidence(self):
        if not v.INPUT.exists():
            self.skipTest('old private snapshot not present')
        old, _ = v.normalize(v.read_xlsx(v.INPUT))
        for key in ('players', 'group_players', 'venues'):
            self.assertEqual(old[key], self.p[key])
        self.assertEqual({s['legacy_match_id']: s['id'] for s in old['sessions']},
                         {s['legacy_match_id']: s['id'] for s in self.p['sessions'] if s['legacy_match_id'] != 'm_1793747146794'})
        self.assertTrue({f['id'] for f in old['canonical_frames']} <= {f['id'] for f in self.p['canonical_frames']})
        self.assertEqual(old['private_noncanonical_observations'][0]['provenance']['fields'], self.p['private_noncanonical_observations'][0]['provenance']['fields'])
        # Prior sanitized facts unchanged, including disputed running score.
        for key in ('historical_reported_results', 'raw_frame_observations'):
            old_rows = {r['provenance']['row']: r['provenance']['fields'] for r in old[key]}
            new_rows = {r['provenance']['row']: r['provenance']['fields'] for r in self.p[key]}
            self.assertTrue(all(new_rows[row] == fields for row, fields in old_rows.items()))

    def test_repeat_run_with_no_network_and_unchanged_source(self):
        before = v.UPDATED_INPUT.read_bytes()
        with tempfile.TemporaryDirectory(dir=v.UPDATED_INPUT.parent) as directory:
            args = ['--input', str(v.UPDATED_INPUT), '--output-dir', str(Path(directory)/'dry-run')]
            with patch('socket.socket', side_effect=AssertionError('Network forbidden')), patch('urllib.request.urlopen', side_effect=AssertionError('Network forbidden')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(v.main(args), 0)
                a = {p.name: p.read_bytes() for p in (Path(directory)/'dry-run').iterdir()}
                self.assertEqual(v.main(args), 0)
                self.assertEqual(a, {p.name: p.read_bytes() for p in (Path(directory)/'dry-run').iterdir()})
        self.assertEqual(v.UPDATED_INPUT.read_bytes(), before)

    def test_bad_active_record_fails_closed(self):
        for column, value in [('D', '1'), ('A', 'm_1793747146794')]:
            sheets = deepcopy(self.w.sheets)
            sheets['Matches'][-1].cells[column] = v.Cell(value)
            with self.subTest(column=column), self.assertRaises(v.ValidationError):
                v.normalize(v.Workbook(self.w.sha256, self.w.size_bytes, sheets))

    def test_new_fingerprint_required_for_exclusion(self):
        with self.assertRaises(v.ValidationError):
            v.normalize(v.Workbook('unapproved', self.w.size_bytes, self.w.sheets))


@unittest.skipUnless(v.UPDATED_INPUT.exists(), 'private updated workbook not present')
class ImportPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('prepare_import', SCRIPT.with_name('prepare_import.py'))
        cls.prep = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.prep)
        cls.p, cls.r = v.normalize(v.read_xlsx(v.UPDATED_INPUT))
        cls.plan = cls.prep.manifest(cls.p, cls.r)

    def test_idempotent_simulation_and_conflict_stop(self):
        first = self.prep.compare({}, self.plan)
        existing = {(r['entity'], r['key']):r['content_sha256'] for r in first}
        self.assertEqual(self.prep.compare(existing, self.plan), [])
        existing[next(iter(existing))] = 'changed'
        with self.assertRaises(v.ValidationError):
            self.prep.compare(existing, self.plan)

    def test_manifest_deterministic_and_active_not_scored(self):
        self.assertEqual(self.plan, self.prep.manifest(self.p, self.r))
        self.assertEqual(self.plan['excluded_active_ids'], ['m_1793836042786'])
        self.assertEqual(self.plan['private_only_excluded_frame_rows'], [420])
        self.assertEqual(len([r for r in self.plan['records'] if r['entity']=='frame']), 452)

    def test_full_source_accounting_and_no_auth(self):
        from collections import Counter
        c=Counter(r['entity'] for r in self.plan['records'])
        self.assertEqual(c['source_record'],74+453)
        self.assertEqual(c['private_observation'],453)
        self.assertEqual(c['reported_result'],74)
        self.assertEqual(c['frame_participant'],904)
        self.assertEqual(self.p['auth_users'],[])
        self.assertEqual(self.p['player_account_links'],[])


if __name__ == '__main__':
    unittest.main()
