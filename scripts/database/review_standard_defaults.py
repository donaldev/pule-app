#!/usr/bin/env python3
"""Synthetic-only migration review in a new disposable loopback database."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT=Path(__file__).resolve().parents[2]
MIGRATION=ROOT/'supabase/migrations/202611040002_standard_scoring_default.sql'

def main():
    name='pule_standard_review_'+uuid.uuid4().hex[:12]
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1',PGPORT='55439',PGUSER=getpass.getuser(),PGDATABASE=name,PGCONNECT_TIMEOUT='5',PGPASSFILE='/dev/null')
    def run(tool,*args):return subprocess.run([tool,*args],env=env,text=True,capture_output=True,check=True)
    def sql(q):return run('psql','-X','-At','-v','ON_ERROR_STOP=1','-c',q).stdout.strip()
    def file(p):return run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(p))
    def snapshot():
        tables=['app.match_sessions','app.session_participants','app.frames','app.frame_participants','app.legacy_session_results','private.legacy_frame_observations','private.import_records','auth.users','app.group_memberships']
        return {t:sql(f"select coalesce(jsonb_agg(j order by j::text),'[]'::jsonb) from (select to_jsonb(x) j from {t} x) y") for t in tables}
    run('createdb',name)
    try:
        file(ROOT/'supabase/tests/bootstrap_postgres.sql')
        for p in sorted((ROOT/'supabase/migrations').glob('*.sql')):
            if p!=MIGRATION:file(p)
        file(ROOT/'supabase/tests/fixtures.sql')
        auth="set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';"
        missing=json.loads(sql(auth+"select app.create_group('a0000000-0000-0000-0000-000000000001','Synthetic legacy-only group','UTC')").splitlines()[-1])['id']
        sql(f"insert into app.rule_versions(group_id,label,rules_status) values('{missing}','Legacy imported rules','legacy_unknown')")
        before=snapshot()
        old_rules=json.loads(sql('select jsonb_agg(to_jsonb(r)) from app.rule_versions r'))
        file(MIGRATION)
        assert snapshot()==before
        new_rules=json.loads(sql('select jsonb_agg(to_jsonb(r)) from app.rule_versions r'))
        assert all(r in new_rules for r in old_rules)
        assert len(new_rules)==len(old_rules)+1
        assert sql(f"select count(*) from app.rule_versions where group_id='{missing}' and rules_status='verified'")=='1'
        # Existing verified groups receive nothing; historical row unchanged.
        gid=json.loads(sql(auth+"select app.create_group('a0000000-0000-0000-0000-000000000002','Synthetic ready group','UTC')").splitlines()[-1])['id']
        answer=json.loads(sql(auth+"select app.create_group('a0000000-0000-0000-0000-000000000002','Synthetic ready group','UTC')").splitlines()[-1])
        assert answer['id']==gid
        assert sql(f"select count(*) from app.rule_versions where group_id='{gid}' and label='Pule standard' and rules_status='verified' and validation_version=1")=='1'
        assert sql(f"select count(*) from app.group_memberships where group_id='{gid}' and role='owner'")=='1'
        # Run the exact backfill statement again: no additional rows.
        start=MIGRATION.read_text().index('insert into app.rule_versions',MIGRATION.read_text().index('-- Existing active groups'))
        backfill=MIGRATION.read_text()[start:].split('commit;')[0]
        count=sql('select count(*) from app.rule_versions');sql(backfill)
        assert sql('select count(*) from app.rule_versions')==count
        # Synthetic fault injects failure during default insertion, verifying atomic group+receipt rollback.
        sql("""create function private.review_reject_default() returns trigger language plpgsql as $$ begin
if exists(select 1 from app.groups where id=new.group_id and name='Synthetic rollback group') then raise exception 'injected_default_failure'; end if; return new; end $$;
create trigger review_reject_default before insert on app.rule_versions for each row execute function private.review_reject_default();""")
        try:sql(auth+"select app.create_group('a0000000-0000-0000-0000-000000000003','Synthetic rollback group','UTC')")
        except subprocess.CalledProcessError as e:assert 'injected_default_failure' in e.stderr
        else:raise AssertionError('fault injection did not reject')
        assert sql("select count(*) from app.groups where name='Synthetic rollback group'")=='0'
        assert sql("select count(*) from private.write_operations where operation_id='a0000000-0000-0000-0000-000000000003'")=='0'
        sql('drop trigger review_reject_default on app.rule_versions; drop function private.review_reject_default()')
        # Actual role/validation/multiplayer/security suites still pass with the default trigger.
        file(ROOT/'supabase/tests/scoring.sql');file(ROOT/'supabase/tests/multiplayer.sql')
        file(ROOT/'supabase/tests/receipt_lookup.sql')
        assert sql("select has_function_privilege('anon','private.initialize_standard_scoring()','EXECUTE') or has_function_privilege('authenticated','private.initialize_standard_scoring()','EXECUTE')")=='f'
        assert sql("select prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='private.initialize_standard_scoring()'::regprocedure")=='t'
        # Re-running full DDL is deliberately not migration idempotency: it fails, changes nothing.
        rule_count=sql('select count(*) from app.rule_versions')
        try:file(MIGRATION)
        except subprocess.CalledProcessError as e:assert 'already exists' in e.stderr
        else:raise AssertionError('repeat DDL unexpectedly applied')
        assert sql('select count(*) from app.rule_versions')==rule_count
        print(json.dumps({'passed':True,'postgres':sql('show server_version'),'migration_cases':['missing_existing_group_backfilled_once','existing_verified_rows_unchanged','imported_history_and_identities_unchanged','new_group_atomic_default_and_owner','receipt_retry_one_default','backfill_rerun_no_duplicates','injected_failure_rolls_back_group_and_receipt','private_function_hardened','repeat_full_DDL_rejected_without_changes'], 'existing_sql_assertions':int(sql('select count(*) from test.results'))},indent=2))
    finally:run('dropdb',name)

if __name__=='__main__':main()
