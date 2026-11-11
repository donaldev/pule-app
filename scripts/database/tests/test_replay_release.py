import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_replay_release import ROOT, MIGRATIONS, build_bundle, migration_body


class ReleaseBundleTests(unittest.TestCase):
    def test_one_transaction_in_reviewed_order(self):
        sql = build_bundle()
        self.assertEqual(sum(line.strip() == 'begin;' for line in sql.splitlines()), 1)
        self.assertEqual(sum(line.strip() == 'commit;' for line in sql.splitlines()), 1)
        positions = [sql.index('-- Source: ' + name) for name in MIGRATIONS]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('sha256=', sql)
        self.assertIn('processing_requires_unused_2a_backend', sql)

    def test_invalid_wrappers_fail_closed(self):
        for source in ['select 1;', 'begin;\nselect 1;\n', 'begin;\ncommit;\nselect 1;', 'begin;\nbegin;\ncommit;']:
            with self.assertRaises(ValueError):
                migration_body(source)

    def test_committed_upload_flag_stays_disabled(self):
        self.assertIn('VITE_FRAME_RECORDING_UPLOADS=false', (ROOT/'.env.example').read_text())

    def test_no_remote_execution_or_history_fabrication(self):
        sql = build_bundle()
        self.assertNotIn('insert into supabase_migrations', sql.lower())
        self.assertIn('set local lock_timeout', sql)
        self.assertNotIn('delete from storage.objects', sql.lower())


if __name__ == '__main__':
    unittest.main()
