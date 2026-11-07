#!/usr/bin/env python3
"""Create/drop an isolated loopback-only PostgreSQL database; never accepts a hosted URL."""
import argparse
from copy import deepcopy
import getpass
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
from validate_history import ROOT, UPDATED_INPUT, UPDATED_SHA256, read_xlsx, normalize, canonical_json
from import_local import rows_for_import, import_sql


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=55439)
    args=parser.parse_args()
    wb=read_xlsx(UPDATED_INPUT)
    assert wb.sha256==UPDATED_SHA256
    proposal,report=normalize(wb)
    tables=rows_for_import(proposal,report)
    db='pule_history_rehearsal_'+uuid.uuid4().hex[:12]
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST='127.0.0.1',PGPORT=str(args.port),PGUSER=getpass.getuser(),PGDATABASE=db,PGCONNECT_TIMEOUT='5',PGPASSFILE='/dev/null')
    output=ROOT/'data/legacy/rehearsal-nov-4'
    output.mkdir(parents=True,exist_ok=True)
    def run(tool,*argv):return subprocess.run([tool,*argv],env=env,text=True,capture_output=True,check=True)
    def sql(q):return run('psql','-X','-At','-v','ON_ERROR_STOP=1','-c',q).stdout.strip()
    def execute(text,name,expect_error=False):
        path=output/(name+'.sql');path.write_text(text)
        try:r=run('psql','-X','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-f',str(path))
        except subprocess.CalledProcessError as e:
            # Source-bearing SQL/context stays private, never printed to terminal.
            (output/(name+'.stderr')).write_text(e.stderr)
            if expect_error:return e.stderr
            raise RuntimeError('Local SQL failed; private diagnostic saved for '+name) from None
        if expect_error:raise AssertionError(name+' unexpectedly succeeded')
        return r.stdout
    def counts():return json.loads(sql("select json_object_agg(n,c) from ("+' union all '.join(f"select '{t}' as n,count(*) as c from {t}" for t,_,_ in tables)+") q"))
    def injections(label,table,mutate):
        changed=deepcopy(tables)
        target=next(rows for t,_,rows in changed if t==table)
        mutate(target)
        error=execute(import_sql(changed),label,True)
        assert counts()==baseline,label+' changed saved data'
        return error
    run('createdb',db)
    try:
        run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(ROOT/'supabase/tests/bootstrap_postgres.sql'))
        for path in sorted((ROOT/'supabase/migrations').glob('*.sql')):
            run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(path))
        empty=counts()
        execute(import_sql(tables,fail_after='app.legacy_session_results'),'rollback-first-import',True)
        assert counts()==empty
        gid=proposal['group_assignment']['id']
        collision=import_sql(tables).replace('begin;',f"begin; insert into app.groups(id,name,status) values('{gid}','Conflicting existing group','archived');",1)
        execute(collision,'preexisting-id-collision',True)
        assert counts()==empty
        first=execute(import_sql(tables),'first-import')
        baseline=counts()
        second=execute(import_sql(tables),'second-import')
        assert counts()==baseline
        first_counts=json.loads(next(line for line in first.splitlines() if line.startswith('{')))
        second_counts=json.loads(next(line for line in second.splitlines() if line.startswith('{')))
        assert first_counts=={table:len(rows) for table,_,rows in tables}
        assert all(v==0 for v in second_counts.values())
        conflict=injections('conflicting-result','app.legacy_session_results',lambda rows:rows[0].update(reported_frames_won=rows[0]['reported_frames_won']+1))
        assert '23514' in conflict
        evidence=injections('conflicting-private-evidence','private.legacy_frame_observations',lambda rows:rows[0]['full_observation'].update(source_running_score='modified'))
        assert '23514' in evidence
        fk=injections('foreign-key-violation','app.frame_participants',lambda rows:rows[-1].update(frame_id=str(uuid.uuid4())))
        assert '23503' in fk
        # Deferred integrity check catches an extra score-only frame even when participants are supplied.
        changed=deepcopy(tables)
        scoreonly=next(s for s in proposal['sessions'] if s['record_kind']=='result_only')
        frames=next(r for t,_,r in changed if t=='app.frames');parts=next(r for t,_,r in changed if t=='app.frame_participants')
        f=deepcopy(frames[0]);old=f['id'];f.update(id=str(uuid.uuid4()),session_id=scoreonly['id'],frame_number=1);frames.append(f)
        for pp in [r for r in parts if r['frame_id']==old]:parts.append(dict(pp,session_id=scoreonly['id'],frame_id=f['id']))
        err=execute(import_sql(changed),'score-only-frame-guard',True)
        assert '23514' in err and counts()==baseline
        # Operator-only aggregate uses the SAME result-authority functions as get_standings.
        standings=json.loads(sql("""select json_agg(x order by display_name) from (
with per as (select s.id,sc.*,max(sc.frames_won) over(partition by s.id) best,min(sc.frames_won) over(partition by s.id) worst
from app.match_sessions s cross join lateral private.session_standings(s.id) sc
where s.status='finalized' and s.result_quality='approved' and s.result_authority='approved_historical_reported')
select gp.display_name,count(*) nights,count(*) filter(where frames_won=best and best<>worst) wins,
count(*) filter(where frames_won<best) losses,count(*) filter(where best=worst) draws,
sum(frames_won) frames_won,sum(frames_lost) frames_lost,sum(frames_played) frames_played
from per join app.group_players gp using(player_id) group by gp.display_name) x"""))
        assert [(r['nights'],r['wins'],r['losses'],r['draws'],r['frames_won']) for r in standings]==[(37,19,13,5,407),(37,13,19,5,351)]
        checks=json.loads(sql("""select json_build_object(
'auth_users',(select count(*) from auth.users),'account_links',(select count(*) from private.player_account_links),
'reported_total',(select sum(reported_frames_won) from app.legacy_session_results),
'detail_eligible',(select count(*) from app.frames where detail_eligible),
'active_source_imports',(select count(*) from app.match_sessions where legacy_match_id='m_1793836042786'),
'score_only_frames',(select count(*) from app.frames f join app.match_sessions s on s.id=f.session_id where s.record_kind='result_only'),
'excluded_evidence',(select count(*) from private.legacy_frame_observations where disposition='excluded_noncanonical' and canonical_frame_id is null and not detail_eligible),
'unknown_breakers',(select count(*) from app.frames where breaker_id is null),
'unknown_break_pot',(select count(*) from app.frames where potted_on_break is null),
'unknown_time_season',(select count(*) from app.match_sessions where season_id is null and timezone_snapshot is null and occurred_at is null and started_at is null and finalized_at is null),
'excluded_night_detail',(select count(*) from app.frames f join app.match_sessions s on s.id=f.session_id where s.legacy_match_id='m_1793225336292' and f.detail_eligible)
)"""))
        assert checks==dict(auth_users=0,account_links=0,reported_total=758,detail_eligible=436,active_source_imports=0,score_only_frames=0,excluded_evidence=1,unknown_breakers=22,unknown_break_pot=75,unknown_time_season=37,excluded_night_detail=0)
        # Independent H2H from reported result pair, no frame join or invented frame rows.
        h2h=json.loads(sql("""select json_build_object('nights',count(*),'donal_wins',count(*) filter(where d.reported_frames_won>s.reported_frames_won),'sean_wins',count(*) filter(where d.reported_frames_won<s.reported_frames_won),'draws',count(*) filter(where d.reported_frames_won=s.reported_frames_won),'donal_frames',sum(d.reported_frames_won),'sean_frames',sum(s.reported_frames_won))
from app.legacy_session_results d join app.group_players dp on dp.player_id=d.player_id
join app.legacy_session_results s on s.session_id=d.session_id join app.group_players sp on sp.player_id=s.player_id
where dp.display_name='Donal' and sp.display_name='Sean'"""))
        assert h2h==dict(nights=37,donal_wins=19,sean_wins=13,draws=5,donal_frames=407,sean_frames=351)
        assert hashlib.sha256(UPDATED_INPUT.read_bytes()).hexdigest()==UPDATED_SHA256
        result=dict(passed=True,postgres_version=sql('show server_version'),first_insertions=first_counts,second_insertions=second_counts,standings=standings,head_to_head=h2h,checks=checks,
                    failure_tests=['partial_first_import_rolled_back','preexisting_id_collision_rolled_back','conflicting_result_rejected','conflicting_private_evidence_rejected','foreign_key_rejected','score_only_frame_deferred_constraint_rejected'],
                    limitations=['archived_group_no_auth_owner','operator_aggregates_not_authenticated_RPC','Supabase_JWT_PostgREST_not_tested'],source_sha256=UPDATED_SHA256)
        (output/'database-results.json').write_text(canonical_json(result))
        print(canonical_json(result))
    finally:
        run('dropdb',db)

if __name__=='__main__':main()
