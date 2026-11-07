"""No hosted execution: exercise binding and safety guards with the approved private snapshot."""
import importlib.util
from pathlib import Path
import sys
import unittest
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
import prepare_pondon_import as h
from validate_history import UPDATED_INPUT, read_xlsx, normalize
from import_local import import_sql

@unittest.skipUnless(UPDATED_INPUT.exists(),'private workbook absent')
class PonDonPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p,cls.r=normalize(read_xlsx(UPDATED_INPUT))
        cls.rows=h.bind_tables(cls.p,cls.r)

    def test_only_target_group_bound_and_no_group_auth_or_membership_insert(self):
        self.assertFalse(any(t in ('app.groups','auth.users','private.player_account_links','app.group_memberships') for t,_,_ in self.rows))
        for table,keys,rows in self.rows:
            for row in rows:
                self.assertEqual(row.get('group_id',row.get('origin_group_id')),h.GROUP)
        self.assertNotEqual(self.p['group_assignment']['id'],h.GROUP)

    def test_stable_identities_venues_and_sporting_rows(self):
        mapped=dict((t,r) for t,_,r in self.rows)
        self.assertEqual({p['id'] for p in mapped['private.players']},{p['id'] for p in self.p['players']})
        self.assertEqual(len(mapped['app.match_sessions']),37)
        self.assertEqual(sum(r['reported_frames_won'] for r in mapped['app.legacy_session_results']),758)
        self.assertEqual(len(mapped['app.frames']),452)
        self.assertEqual(sum(r['detail_eligible'] for r in mapped['app.frames']),436)
        self.assertTrue(all(s['timezone_snapshot'] is None and s['season_id'] is None for s in mapped['app.match_sessions']))

    def test_hosted_guards_and_default_local_guard_remain_distinct(self):
        g=h.guard(self.rows)
        for value in (h.GROUP,h.OWNER,'email_confirmed_at','for update','for share','server_version_num','unexpected_pondon_data'):
            self.assertIn(value,g)
        self.assertIn('local_rehearsal_database_required',import_sql([]))
        sql=import_sql(self.rows,guard_sql=g)
        self.assertNotIn('local_rehearsal_database_required',sql)
        self.assertNotIn('insert into app.groups',sql)
        self.assertIn('set constraints all immediate',sql)

if __name__=='__main__':unittest.main()
