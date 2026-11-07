-- Entirely synthetic. No historical workbook values or real user accounts.
begin;
insert into auth.users(id) values
 ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003'),('20000000-0000-0000-0000-000000000004'),('20000000-0000-0000-0000-000000000005');
insert into app.groups(id,name) values('10000000-0000-0000-0000-000000000001','Synthetic Green'),('10000000-0000-0000-0000-000000000002','Synthetic Blue');
insert into app.group_memberships(group_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','scorer'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','viewer'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005','owner');
insert into private.players(id,origin_group_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002');
insert into app.group_players(group_id,player_id,display_name) select origin_group_id,id,'Synthetic '||right(id::text,1) from private.players where origin_group_id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
insert into app.venues(id,group_id,display_name) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test Venue A'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Test Venue B');
insert into app.rule_versions(id,group_id,label,rules_status) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic explicit breaker','verified'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Synthetic explicit breaker','verified'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Unknown imported rules','legacy_unknown');
insert into app.seasons(id,group_id,name,assignment_mode) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic Season','manual_legacy');
insert into private.import_sources(id,group_id,namespace) values('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','synthetic-only');
insert into private.import_batches(id,group_id,source_id,checksum,mapping_version,status) values
 ('71000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',repeat('a',64),'test-v1','accepted');
insert into private.import_records(id,group_id,batch_id,record_key,source_sheet,source_row,sanitized_evidence,extracted_hash) values
 ('72000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','synthetic-1','Fixture',1,'{}','synthetic-hash'),
 ('72000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','synthetic-2','Fixture',2,'{}','synthetic-hash');
-- An older score-only result and a tracked result with intentionally conflicting detail.
insert into app.match_sessions(id,group_id,venue_id,season_id,rule_version_id,status,origin,record_kind,result_authority,sequence_quality,detail_eligible,occurred_on,date_precision,import_batch_id,legacy_match_id) values
 ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','finalized','imported','result_only','approved_historical_reported','not_recorded',false,'2020-01-01','date_only','71000000-0000-0000-0000-000000000001','synthetic-score-only'),
 ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null,'50000000-0000-0000-0000-000000000003','finalized','imported','frame_log','approved_historical_reported','disputed',false,'2020-01-02','date_only','71000000-0000-0000-0000-000000000001','synthetic-disputed');
insert into app.session_participants(group_id,session_id,player_id,side)
 select s.group_id,s.id,gp.player_id,row_number() over(partition by s.id order by gp.player_id)
 from app.match_sessions s join app.group_players gp on gp.group_id=s.group_id;
insert into app.legacy_session_results(group_id,session_id,player_id,reported_frames_won,source_record_id)
 select p.group_id,p.session_id,p.player_id,case when p.side=1 then 3 else 1 end,'72000000-0000-0000-0000-000000000001'
 from app.session_participants p;
insert into app.frames(id,group_id,session_id,frame_number,status,origin,winner_id,duration_quality,detail_eligible,source_record_id)
 values('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',1,'completed','imported','30000000-0000-0000-0000-000000000001','unknown',false,'72000000-0000-0000-0000-000000000002');
insert into app.frame_participants(group_id,session_id,frame_id,player_id,side)
 select group_id,session_id,'90000000-0000-0000-0000-000000000001',player_id,side from app.session_participants where session_id='80000000-0000-0000-0000-000000000002';
insert into private.legacy_frame_observations(group_id,source_record_id,session_id,source_frame_number,full_observation,disposition)
 values('10000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000002',1,'{"duration_sec":0,"synthetic":true}','excluded_noncanonical');
commit;
-- Test-only assertions. No production grants are broadened.
create schema test;
create table test.results(label text primary key);
grant usage on schema test to authenticated,anon;
grant insert,select on test.results to authenticated,anon;
create function test.ok(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAILED: %',label; end if; insert into test.results values(label); end $$;
create function test.denied(statement text, expected_state text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
 if sqlstate=expected_state then perform test.ok(true,label); return; end if;
 raise;
 end;
 raise exception 'FAILED: expected % for %',expected_state,label;
end $$;
grant execute on all functions in schema test to authenticated,anon;
