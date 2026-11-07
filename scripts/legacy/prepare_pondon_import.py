#!/usr/bin/env python3
"""Prepare ONLY: guarded PonDon SQL and manifest. No connection or execution capability."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from validate_history import ROOT, UPDATED_INPUT, UPDATED_SHA256, read_xlsx, normalize, canonical_json, ValidationError
from import_local import rows_for_import, import_sql, literal

PROJECT='pgljdmevusgvvlplaedt'
GROUP='383bd6df-9050-4d1c-b48f-d2a0f3349517'
OWNER='33251a76-7709-4818-8ed0-01e54d8c54cc'
OUTPUT=ROOT/'data/legacy/pondon-preflight'

def bind_tables(proposal, report):
    old=proposal['group_assignment']['id']
    def bind(v):
        if isinstance(v,dict):return {k:bind(x) for k,x in v.items()}
        if isinstance(v,list):return [bind(x) for x in v]
        return GROUP if v==old else v
    return [(t,keys,bind(deepcopy(rows))) for t,keys,rows in rows_for_import(proposal,report) if t!='app.groups']


def guard(tables):
    # No group or Auth creation. Bind existing reviewed owner; race-protect this scope.
    checks=[f"""do $guard$ begin
if current_database()<>'postgres' or current_setting('server_version_num')::int/10000<>17 then raise exception 'hosted_runtime_mismatch'; end if;
perform 1 from app.groups where id='{GROUP}' and name='PonDon' and status='active' for update;
if not found then raise exception 'pondon_identity_mismatch'; end if;
perform 1 from app.group_memberships m join auth.users u on u.id=m.user_id where m.group_id='{GROUP}' and m.user_id='{OWNER}' and m.role='owner' and m.status='active' and u.email_confirmed_at is not null for share of m;
if not found then raise exception 'pondon_confirmed_owner_mismatch'; end if;
if (select count(*) from app.group_memberships where group_id='{GROUP}' and role='owner' and status='active')<>1 then raise exception 'owner_count_mismatch'; end if;
"""]
    # Reject added sporting rows, not only collisions; reruns may contain only this exact snapshot's keys.
    for table,keys,rows in tables:
        scope='origin_group_id' if table=='private.players' else 'group_id'
        pred=' and '.join(f"t.{k}=r.{k}" for k in keys)
        checks.append(f"if exists(select 1 from {table} t where t.{scope}='{GROUP}' and not exists(select 1 from jsonb_populate_recordset(null::{table},{literal(rows)}) r where {pred})) then raise exception 'unexpected_pondon_data: {table}'; end if;")
    checks.append(f"if exists(select 1 from app.seasons where group_id='{GROUP}') then raise exception 'unexpected_pondon_seasons'; end if;")
    checks.append('end $guard$;')
    return '\n'.join(checks)


def main():
    wb=read_xlsx(UPDATED_INPUT)
    if wb.sha256!=UPDATED_SHA256:raise ValidationError('Snapshot mismatch')
    p,r=normalize(wb);tables=bind_tables(p,r)
    sql=import_sql(tables,guard_sql=guard(tables))
    locks='lock table '+','.join(t for t,_,_ in tables)+' in share row exclusive mode;'
    sql=sql.replace('begin;', "begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\n"+locks,1)
    # Verify the committed cohort, not only insertion counts. Failure rolls back before COMMIT.
    assertions=f"""do $totals$ begin
if (select count(*) from app.match_sessions where group_id='{GROUP}')<>37
or (select sum(reported_frames_won) from app.legacy_session_results where group_id='{GROUP}')<>758
or (select count(*) from app.frames where group_id='{GROUP}')<>452
or (select count(*) from app.frames where group_id='{GROUP}' and detail_eligible)<>436
or exists(select 1 from app.match_sessions where group_id='{GROUP}' and legacy_match_id='m_1793836042786')
then raise exception 'historical_import_reconciliation_failed'; end if;
end $totals$;
"""
    sql=sql.replace('set constraints all immediate;',assertions+'set constraints all immediate;')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    path=OUTPUT/'approved-pending-import.sql'
    if path.is_symlink():raise ValidationError('Symlink output refused')
    path.write_text(sql)
    manifest={'status':'PREPARED_ONLY_NOT_EXECUTED','project_ref':PROJECT,'group_id':GROUP,'owner_id':OWNER,
      'source_sha256':wb.sha256,'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),
      'expected_inserts':{t:len(rows) for t,_,rows in tables},'expected_standings':r['summary']['leaderboard'],
      'identities':[{'source_identity_key':x['source_identity_key'],'player_id':x['id'],'name':x['source_label'],'account_link':None} for x in p['players']],
      'venues':[{'name':v['display_name'],'venue_id':v['id'],'nights':sum(s['venue_id']==v['id'] for s in p['sessions'])} for v in p['venues']],
      'preconditions':['fresh_linked_target_check','restorable_backup_and_restore_rehearsal','explicit_hosted_import_approval','unchanged_schema_and_owner'],
      'exclusions':['active_m_1793836042786','canonical_zero_second_frame_row_420','financial_values','auth_accounts_and_claims'],
      'sql_file':str(path.relative_to(ROOT))}
    (OUTPUT/'final-manifest.json').write_text(canonical_json(manifest))
    collision=[]
    for t,keys,rows in tables:
        pred=' and '.join(f't.{k}=r.{k}' for k in keys)
        collision.append(f"select '{t}' entity,count(*) existing_keys from {t} t where exists(select 1 from jsonb_populate_recordset(null::{t},{literal([{k:row[k] for k in keys} for row in rows])}) r where {pred})")
    (OUTPUT/'read-only-collision-check.sql').write_text('select jsonb_object_agg(entity,existing_keys) from ('+' union all '.join(collision)+') q;')
    if hashlib.sha256(UPDATED_INPUT.read_bytes()).hexdigest()!=UPDATED_SHA256:raise ValidationError('Source changed')
    print(canonical_json({'prepared_only':True,'sql_sha256':manifest['sql_sha256'],'output':str(OUTPUT),'expected_inserts':manifest['expected_inserts']}))

if __name__=='__main__':main()
