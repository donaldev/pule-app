#!/usr/bin/env python3
"""Run synthetic migrations/tests in a NEW disposable local PostgreSQL database.
Requires a running local server and psql/createdb/dropdb. Never targets a hosted URL.
Supabase Auth is minimally emulated; this does not test GoTrue, JWTs or PostgREST.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import getpass
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sql-test', choices=['frame_replay_processing.sql','frame_replay_uploads.sql','frame_replays.sql','automatic_player_identity.sql','frame_correction_details.sql', 'guest_email.sql', 'frame_editing.sql', 'match_removal.sql', 'personal_performance.sql', 'frame_performance.sql'], help='Run only the selected focused SQL checks')
    parser.add_argument('--port', type=int, default=55439)
    parser.add_argument('--upgrade-foundation', action='store_true', help='Seed original two migrations, then upgrade existing synthetic history')
    args = parser.parse_args()
    name = 'pule_test_' + uuid.uuid4().hex[:12]
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1', PGPORT=str(args.port), PGUSER=getpass.getuser(), PGDATABASE=name, PGCONNECT_TIMEOUT='5')

    def run(tool, *arguments, **kwargs):
        return subprocess.run([tool, *arguments], env=env, text=True, check=True, capture_output=True, **kwargs)

    def sql(statement):
        return run('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement).stdout.strip()

    def file(path):
        return run('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', str(path))

    run('createdb', name)
    try:
        file(ROOT/'supabase/tests/bootstrap_postgres.sql')
        file(ROOT/'supabase/tests/storage_bootstrap.sql')
        fixtures_loaded = False
        for index, path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql')), start=1):
            if path.name == '202611040003_automatic_matchups.sql':
                file(ROOT/'supabase/tests/matchup_binding_fixture.sql')
            # Preserve the 2A checkpoint suite; Stage 1 intentionally replaces its direct-publication contract.
            if path.name == '202611100003_frame_replay_processing.sql' and args.sql_test == 'frame_replay_uploads.sql':
                continue
            file(path)
            if args.upgrade_foundation and index == 2:
                file(ROOT/'supabase/tests/fixtures.sql')
                fixtures_loaded = True
        file(ROOT/'supabase/verification/hosted_readiness.sql')
        if not fixtures_loaded:
            file(ROOT/'supabase/tests/fixtures.sql')
        if args.sql_test:
            file(ROOT/'supabase/tests'/args.sql_test)
            if args.sql_test == 'frame_replay_processing.sql':
                service = "set role service_role;"
                owner = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';"
                def claim_one(_):
                    return json.loads(sql(service + "select coalesce(app.claim_frame_replay_processing(),'null'::jsonb)").splitlines()[-1])
                with ThreadPoolExecutor(max_workers=2) as pool:
                    claims = list(pool.map(claim_one, range(2)))
                assert sum(item is not None for item in claims) == 1
                job = next(item for item in claims if item is not None)
                sql("select test.ok(true,'independent worker claims lease exactly one job')")
                def put_output(job):
                    sql("insert into storage.objects(bucket_id,name,metadata) values('frame-replays','%s','{\"size\":70,\"mimetype\":\"video/mp4\"}')" % job['destination_key'])
                put_output(job)
                def publish_one(_):
                    return json.loads(sql(service + "select app.complete_frame_replay_processing('%s','%s',70,5,1)" % (job['job_id'], job['lease_id'])).splitlines()[-1])
                with ThreadPoolExecutor(max_workers=2) as pool:
                    published = list(pool.map(publish_one, range(2)))
                assert published[0] == published[1]
                sql("select test.ok((select count(*)=1 from app.frame_replays where storage_path='%s'),'independent publication retries register one output')" % job['destination_key'])
                fid = sql('select frame_id from test.upload_cases where n=5')
                sid = sql('select session_id from test.upload_cases where n=5')
                upload = json.loads(sql(owner + "select app.reserve_frame_replay_upload(gen_random_uuid(),'%s',100)" % fid).splitlines()[-1])
                sql("insert into storage.objects(bucket_id,name,owner_id,metadata) values('frame-recordings','%s','20000000-0000-0000-0000-000000000001','{\"size\":100,\"mimetype\":\"video/mp4\"}')" % upload['storage_path'])
                sql(owner + "select app.finalize_frame_replay_upload('%s')" % upload['upload_id'])
                sql(owner + "select app.queue_frame_replay_processing('%s','[[20,20],[620,20],[620,460],[20,460]]',640,480)" % upload['upload_id'])
                raced = claim_one(0)
                put_output(raced)
                def race_publish():
                    try:
                        sql(service + "select app.complete_frame_replay_processing('%s','%s',70,5,1)" % (raced['job_id'], raced['lease_id']))
                    except subprocess.CalledProcessError as error:
                        if 'processing_lease_invalid' not in error.stderr:
                            raise
                def race_remove():
                    sql(owner + "select app.remove_match(gen_random_uuid(),'%s',12,'abandon')" % sid)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    jobs = [pool.submit(race_publish), pool.submit(race_remove)]
                    for future in jobs:
                        future.result()
                sql("select test.ok(not exists(select 1 from app.frame_replays where frame_id='%s') and exists(select 1 from private.frame_replay_cleanup where bucket_id='frame-replays' and storage_path='%s'),'publication racing removal cannot resurrect match or lose output cleanup')" % (fid, raced['destination_key']))
                sql("select test.ok(exists(select 1 from app.frame_replays where frame_id='90000000-0000-0000-0000-000000000001'),'unrelated historical replay survives processing/removal races')")
            if args.sql_test == 'frame_replay_uploads.sql':
                owner = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';"
                opponent = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';"
                def completed_case():
                    state = json.loads(sql(owner + "select app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000001')").splitlines()[-1])
                    sid = state['session']['id']
                    state = json.loads(sql(owner + "select app.start_frame(gen_random_uuid(),'%s',1,array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000001')" % sid).splitlines()[-1])
                    fid = state['frames'][0]['id']
                    sql(owner + "select app.complete_frame(gen_random_uuid(),'%s',2,'%s','30000000-0000-0000-0000-000000000001',0,0,false,'regular')" % (sid, fid))
                    return sid, fid
                sid, fid = completed_case()
                def reserve_competing(actor):
                    try:
                        return actor, json.loads(sql(actor + "select app.reserve_frame_replay_upload(gen_random_uuid(),'%s',100)" % fid).splitlines()[-1])
                    except subprocess.CalledProcessError as error:
                        if 'frame_upload_reserved' not in error.stderr:
                            raise
                        return actor, None
                with ThreadPoolExecutor(max_workers=2) as pool:
                    reservations = list(pool.map(reserve_competing, [owner, opponent]))
                assert sum(r is not None for _, r in reservations) == 1
                actor, upload = next((a, r) for a, r in reservations if r is not None)
                actor_id = '20000000-0000-0000-0000-000000000001' if actor == owner else '20000000-0000-0000-0000-000000000002'
                sql("insert into storage.objects(bucket_id,name,owner_id,metadata) values('frame-replays','%s','%s','{\"size\":100,\"mimetype\":\"video/mp4\"}')" % (upload['storage_path'], actor_id))
                def finalize_one(_):
                    return json.loads(sql(actor + "select app.finalize_frame_replay_upload('%s')" % upload['upload_id']).splitlines()[-1])
                with ThreadPoolExecutor(max_workers=2) as pool:
                    finalized = list(pool.map(finalize_one, range(2)))
                assert finalized[0] == finalized[1]
                sql("select test.ok((select count(*)=1 from app.frame_replays where frame_id='%s'),'independent competing reservations and finalizations register one replay')" % fid)
                _, same_frame = completed_case()
                operation = str(uuid.uuid4())
                statement = owner + "select app.reserve_frame_replay_upload('%s','%s',100)" % (operation, same_frame)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    same = list(pool.map(lambda _: json.loads(sql(statement).splitlines()[-1]), range(2)))
                assert same[0] == same[1]
                sql("select test.ok((select count(*)=1 from private.frame_replay_uploads where operation_id='%s'),'independent same-key reservation returns one attempt')" % operation)
                # Opponent has no active reservation after finalization, so can race removal.
                race_sid, race_frame = completed_case()
                race = json.loads(sql(opponent + "select app.reserve_frame_replay_upload(gen_random_uuid(),'%s',100)" % race_frame).splitlines()[-1])
                sql("insert into storage.objects(bucket_id,name,owner_id,metadata) values('frame-replays','%s','20000000-0000-0000-0000-000000000002','{\"size\":100,\"mimetype\":\"video/mp4\"}')" % race['storage_path'])
                def race_finalize():
                    try:
                        sql(opponent + "select app.finalize_frame_replay_upload('%s')" % race['upload_id'])
                    except subprocess.CalledProcessError as error:
                        if 'replay_upload_denied' not in error.stderr:
                            raise
                def race_remove():
                    sql(owner + "select app.remove_match(gen_random_uuid(),'%s',3,'abandon')" % race_sid)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    jobs = [pool.submit(race_finalize), pool.submit(race_remove)]
                    for job in jobs:
                        job.result()
                sql("select test.ok(not exists(select 1 from app.frame_replays where frame_id='%s') and exists(select 1 from private.frame_replay_cleanup where storage_path='%s'),'concurrent removal never leaves registered metadata or loses cleanup')" % (race_frame, race['storage_path']))
            if args.sql_test == 'automatic_player_identity.sql':
                actor = "set role authenticated; set request.jwt.claim.sub='21000000-0000-0000-0000-000000000006';"
                def initialize_one(_):
                    return json.loads(sql(actor + "select app.initialize_my_player(gen_random_uuid(),'Concurrent person')").splitlines()[-1])
                with ThreadPoolExecutor(max_workers=2) as pool:
                    initialized = list(pool.map(initialize_one, range(2)))
                assert initialized[0] == initialized[1], 'Concurrent initialization must preserve one identity'
                sql("select test.ok((select count(*)=1 from private.player_account_links where user_id='21000000-0000-0000-0000-000000000006'),'independent concurrent requests retain exactly one player')")
            if args.sql_test == 'match_removal.sql':
                owner = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';"
                game = json.loads(sql(owner + "select app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000001')").splitlines()[-1])
                sid = game['session']['id']
                def remove_one(_):
                    return json.loads(sql(owner + "select app.remove_match(gen_random_uuid(),'%s',1,'abandon')" % sid).splitlines()[-1])
                with ThreadPoolExecutor(max_workers=2) as pool:
                    removed = list(pool.map(remove_one, range(2)))
                assert removed[0] == removed[1], 'Concurrent removals must agree'
                sql("select test.ok((select count(*)=1 from private.match_removals where session_id='%s'),'concurrent removal has one audit')" % sid)
            if args.sql_test == 'frame_editing.sql':
                # A second connection finalizes after the editor captured its revision.
                case = json.loads(sql('select data from test.frame_edit_case').splitlines()[-1])
                actor = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';"
                sql(actor + "select app.finalize_session(gen_random_uuid(),'%s',%s)" % (case['session'], case['revision']))
                for revision, code in [(case['revision'], '40001'), (case['revision'] + 1, '55000')]:
                    command = "select app.correct_frame(gen_random_uuid(),'%s',%s,'%s','30000000-0000-0000-0000-000000000001',0,0,'Late correction')" % (case['session'], revision, case['frame'])
                    sql(actor + "select test.denied($edit$%s$edit$,'%s','finalized correction denied %s')" % (command, code, code))
                sql("select test.ok((select winner_id='30000000-0000-0000-0000-000000000002' from app.frames where id='%s'),'rejected corrections leave frame unchanged')" % case['frame'])
            print(json.dumps({'focused_sql_test':args.sql_test,'assertions_passed':int(sql('select count(*) from test.results')),'synthetic_only':True}))
            return
        file(ROOT/'supabase/tests/frame_replays.sql')
        file(ROOT/'supabase/tests/scoring.sql')
        file(ROOT/'supabase/tests/multiplayer.sql')
        file(ROOT/'supabase/tests/receipt_lookup.sql')
        file(ROOT/'supabase/tests/automatic_matchups.sql')
        file(ROOT/'supabase/tests/player_identity.sql')
        # Prove the function executes inside a genuinely read-only transaction.
        read_only = sql("begin read only; set local role authenticated; set local request.jwt.claim.sub='20000000-0000-0000-0000-000000000002'; select app.lookup_operation_receipt(operation_id)->>'status' from test.receipt_case;")
        assert 'confirmed_committed' in read_only, 'Read-only receipt confirmation failed'
        auth = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';"
        start = "select app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005']::uuid[],'30000000-0000-0000-0000-000000000001');"
        state = json.loads(sql(auth+start).splitlines()[-1])
        sid = state['session']['id']
        state = json.loads(sql(auth+f"select app.start_frame(gen_random_uuid(),'{sid}',1,array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000001');").splitlines()[-1])
        fid = state['frames'][0]['id']
        def compete(side):
            statement = auth+f"begin; select app.complete_frame(gen_random_uuid(),'{sid}',2,'{fid}','30000000-0000-0000-0000-00000000000{side}',0,0,false,'regular'); select pg_sleep(0.15); commit;"
            try:
                sql(statement)
                return 'committed'
            except subprocess.CalledProcessError as error:
                if 'session_revision_conflict' not in error.stderr:
                    raise
                return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(compete, [1, 2]))
        assert sorted(outcomes) == ['committed', 'conflict'], outcomes
        assert sql(f"select count(*) from app.frames where session_id='{sid}' and status='completed'") == '1'
        assert sql(f"select sum(frames_won) from private.session_scores('{sid}')") == '1'
        # Same-key concurrent retry: both responses must be byte-identical, only one event.
        state = json.loads(sql(auth+f"select app.start_frame(gen_random_uuid(),'{sid}',3,array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000002');").splitlines()[-1])
        fid = state['frames'][-1]['id']
        op = str(uuid.uuid4())
        statement = auth+f"select app.complete_frame('{op}','{sid}',4,'{fid}','30000000-0000-0000-0000-000000000001',0,0,false,'regular');"
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: sql(statement).splitlines()[-1], [1, 2]))
        assert receipts[0] == receipts[1]
        assert sql(f"select count(*) from private.match_events where operation_id='{op}'") == '1'
        matchup_auth = "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';"
        def resolve_concurrent(_):
            return json.loads(sql(matchup_auth+"select app.resolve_matchup(gen_random_uuid(),array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'UTC');").splitlines()[-1])
        with ThreadPoolExecutor(max_workers=2) as pool:
            resolved = list(pool.map(resolve_concurrent, [1, 2]))
        assert resolved[0]['group_id'] == resolved[1]['group_id'], resolved
        assert sum(r['created'] for r in resolved) == 1, resolved
        assert sql("select count(*) from private.matchups where player_ids=private.canonical_players(array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[])") == '1'
        def resolve_two_actors(actor):
            try:
                value = json.loads(sql(f"set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-00000000000{actor}';select app.resolve_matchup(gen_random_uuid(),array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005']::uuid[],'UTC');").splitlines()[-1])
                return 'created' if value['created'] else 'reused'
            except subprocess.CalledProcessError as error:
                if 'matchup_unavailable' not in error.stderr:
                    raise
                return 'denied'
        with ThreadPoolExecutor(max_workers=2) as pool:
            actor_outcomes = list(pool.map(resolve_two_actors, [1, 2]))
        assert sorted(actor_outcomes) == ['created', 'denied'], actor_outcomes
        assert sql("select count(*) from private.matchups where player_ids=private.canonical_players(array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005']::uuid[])") == '1'
        def redeem(actor):
            try:
                value = json.loads(sql(f"set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000{actor}'; select app.accept_player_invitation(gen_random_uuid(),repeat('d',64),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));").splitlines()[-1])
                return 'accepted' if value['id'] == '30000000-0000-0000-0000-000000000099' else 'unexpected'
            except subprocess.CalledProcessError as error:
                if 'invitation_unavailable' not in error.stderr:
                    raise
                return 'denied'
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(redeem, [101, 105]))
        assert sorted(claims) == ['accepted', 'denied'], claims
        assert sql("select count(*) from private.player_account_links where player_id='30000000-0000-0000-0000-000000000099'") == '1'
        count = int(sql('select count(*) from test.results'))
        print(json.dumps({'sql_assertions_passed': count, 'concurrency_tests_passed': 5, 'receipt_read_only_transaction_passed': True, 'migrations_applied': len(list((ROOT/'supabase/migrations').glob('*.sql'))), 'server_version': sql('show server_version'), 'auth_mode': 'minimal local stand-in; Supabase stack not exercised', 'synthetic_only': True, 'upgrade_existing_foundation': args.upgrade_foundation}, indent=2))
    except subprocess.CalledProcessError as error:
        print(error.stdout)
        print(error.stderr)
        raise
    finally:
        run('dropdb', name)


if __name__ == '__main__':
    main()
