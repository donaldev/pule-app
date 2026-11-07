#!/usr/bin/env python3
"""Existing-schema historical import adapter; SQL generation only, executed by local rehearsal runner."""
import json
from validate_history import stable_id, UPDATED_SHA256, baseline_checks, ValidationError


def rows_for_import(p, report):
    if p['input']['sha256'] != UPDATED_SHA256 or not all(c['passed'] for c in baseline_checks(p, report)):
        raise ValidationError('Approved updated baseline required')
    gid=p['group_assignment']['id']
    source=stable_id('source',p['source_namespace'])
    mapping='nov4-existing-schema-v1'
    batch=stable_id('batch',p['input']['sha256']+'/'+mapping)
    rule=stable_id('rule','legacy-unknown')
    tables=[]
    def add(table, keys, rows): tables.append((table,keys,rows))
    # Archived staging permits no owner membership, no Auth user and no API visibility.
    add('app.groups',['id'],[dict(id=gid,name='Historical Donal and Sean — local staging',timezone='UTC',status='archived')])
    add('private.players',['id'],[dict(id=r['id'],origin_group_id=gid,identity_revision=1) for r in p['players']])
    add('app.group_players',['group_id','player_id'],[dict(**r,status='active') for r in p['group_players']])
    add('app.venues',['id'],p['venues'])
    add('app.rule_versions',['id'],[dict(id=rule,group_id=gid,label='Historical rules unknown',rules_status='legacy_unknown',breaker_policy='explicit_per_frame',validation_version=1)])
    add('private.import_sources',['id'],[dict(id=source,group_id=gid,namespace=p['source_namespace'])])
    add('private.import_batches',['id'],[dict(id=batch,group_id=gid,source_id=source,checksum=p['input']['sha256'],mapping_version=mapping,status='accepted')])
    observations=p['raw_frame_observations']+p['private_noncanonical_observations']
    evidence=[r['provenance'] for r in p['historical_reported_results']+observations]
    add('private.import_records',['id'],[dict(id=r['observation_id'],group_id=gid,batch_id=batch,record_key=r['sheet']+'/'+str(r['row']),source_sheet=r['sheet'],source_row=r['row'],sanitized_evidence=r['fields'],extracted_hash=r['extracted_facts_sha256']) for r in evidence])
    sessions=[];participants=[]
    for r in p['sessions']:
        sessions.append(dict(id=r['id'],group_id=gid,venue_id=r['venue_id'],season_id=None,rule_version_id=rule,
          status='finalized',origin='imported',record_kind=r['record_kind'],result_authority='approved_historical_reported',result_quality='approved',sequence_quality=r['sequence_quality'],detail_eligible=r['sequence_quality']=='reconciled',
          occurred_on=r['occurred_on'],occurred_at=None,timezone_snapshot=None,date_precision='date_only',started_at=None,finalized_at=None,scorer_user_id=None,import_batch_id=batch,legacy_match_id=r['legacy_match_id'],initial_breaker_id=None))
        for side,pp in enumerate(r['participants'],1):participants.append(dict(group_id=gid,session_id=r['id'],player_id=pp['player_id'],side=side))
    add('app.match_sessions',['id'],sessions)
    add('app.session_participants',['session_id','player_id'],participants)
    add('app.legacy_session_results',['session_id','player_id'],[dict(group_id=gid,session_id=r['session_id'],player_id=r['player_id'],reported_frames_won=r['frames_won'],source_record_id=r['provenance']['observation_id']) for r in p['historical_reported_results']])
    frames=[];fp=[]
    for f in p['canonical_frames']:
        row={k:f[k] for k in ('id','group_id','session_id','frame_number','origin','status','winner_id','breaker_id','offender_id','potted_on_break','black_pocket_code','special_event','elapsed_ms','duration_quality','started_at','completed_at','quality_flags')}
        row.update(source_record_id=f['source_observation_id'],detail_eligible=f['detailed_statistics_eligible'],running_since=None)
        frames.append(row)
        for pp in f['participants']:fp.append(dict(group_id=gid,session_id=f['session_id'],frame_id=f['id'],**pp))
    add('app.frames',['id'],frames)
    add('app.frame_participants',['frame_id','player_id'],fp)
    add('private.legacy_frame_observations',['id'],[dict(id=f['provenance']['observation_id'],group_id=gid,source_record_id=f['provenance']['observation_id'],session_id=f['session_id'],source_frame_number=f['source_frame_number'],full_observation=f,canonical_frame_id=f['canonical_frame_id'],disposition='canonical_linked' if f['canonical_frame_id'] else 'excluded_noncanonical',detail_eligible=f['detailed_statistics_eligible']) for f in observations])
    links=[]
    def link(kind,key,dest):
        links.append(dict(id=stable_id('link',kind+'/'+key),source_id=source,group_id=gid,entity_kind=kind,legacy_key=key,session_id=dest if kind=='session' else None,player_id=dest if kind=='player' else None,venue_id=dest if kind=='venue' else None,frame_id=dest if kind=='frame' else None))
    for r in p['players']:link('player',r['source_identity_key'],r['id'])
    for r in p['venues']:link('venue',r['id'],r['id'])
    for r in p['sessions']:link('session',r['legacy_match_id'],r['id'])
    for r in p['canonical_frames']:
        mid=next(s['legacy_match_id'] for s in p['sessions'] if s['id']==r['session_id'])
        link('frame',mid+'/'+str(r['frame_number']),r['id'])
    add('private.legacy_entity_links',['id'],links)
    return tables


def literal(value):
    return "'"+json.dumps(value,ensure_ascii=False,sort_keys=True,allow_nan=False).replace("'","''")+"'::jsonb"


def import_sql(tables, fail_after=None, *, guard_sql=None):
    sql=["begin;", guard_sql if guard_sql is not None else "do $$ begin if current_database() not like 'pule_history_rehearsal_%' then raise exception 'local_rehearsal_database_required'; end if; end $$;",
         "select pg_advisory_xact_lock(741843112);", "create temporary table import_counts(entity text, inserted integer) on commit drop;"]
    for table,keys,rows in tables:
        if not rows:continue
        cols=list(rows[0]); names=','.join(cols)
        where=' and '.join(f"t.{k} = r.{k}" for k in keys)
        projection=','.join("'"+c+"',to_jsonb(t."+c+")" for c in cols)
        sql.append(f"""do $import$ declare j jsonb; r {table}; existing jsonb; inserted integer:=0; begin
for j in select value from jsonb_array_elements({literal(rows)}) loop
 r:=jsonb_populate_record(null::{table},j);
 select jsonb_build_object({projection}) into existing from {table} t where {where};
 if found then
  if existing<>j then raise exception 'historical_import_content_conflict: {table}' using errcode='23514'; end if;
 else
  insert into {table}({names}) select {','.join('r.'+c for c in cols)};
  inserted:=inserted+1;
 end if;
end loop;
insert into import_counts values('{table}',inserted); end $import$;""")
        if fail_after==table:sql.append("do $$ begin raise exception 'injected_rollback_test'; end $$;")
    sql+=['set constraints all immediate;',"select json_object_agg(entity,inserted) from import_counts;",'commit;']
    return '\n'.join(sql)
