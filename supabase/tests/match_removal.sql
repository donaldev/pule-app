insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic removal test only');
create table test.removal_baseline as select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) players from private.players p;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$
declare g uuid:='10000000-0000-0000-0000-000000000001'; v uuid:='40000000-0000-0000-0000-000000000001'; r uuid:='50000000-0000-0000-0000-000000000001';
 p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002';
 a jsonb; sid uuid; fid uuid; op uuid; startop uuid; result jsonb;
begin
 startop:=gen_random_uuid(); a:=app.start_session(startop,g,v,r,array[p,q],p); sid:=(a#>>'{session,id}')::uuid;
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
 perform test.denied(format('select app.remove_match(gen_random_uuid(),%L,1,%L)',sid,'abandon'),'42501','scorer is not deletion authority');
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
 op:=gen_random_uuid(); result:=app.remove_match(op,sid,1,'abandon');
 perform test.ok((result->>'removed')::bool,'abandon empty match');
 perform test.ok(app.get_match_removal(sid)=result,'read-only removal acknowledgment');
 perform test.ok(app.lookup_operation_receipt(op)#>>'{saved,kind}'='setup','removal receipt supports interrupted acknowledgment');
 perform test.ok(app.remove_match(op,sid,1,'abandon')=result,'identical removal replay');
 perform test.ok(app.remove_match(gen_random_uuid(),sid,1,'abandon')=result,'repeated removal no duplicate effect');
 perform test.ok(not exists(select 1 from app.match_sessions where id=sid),'empty match gone from RLS discovery');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L]::uuid[],%L)',sid,p,q,p),'42501','stale resume denied');
 perform test.denied(format('select app.start_session(%L,%L,%L,%L,array[%L,%L]::uuid[],%L)',startop,g,v,r,p,q,p),'55000','old start replay cannot resurrect removed night');
 a:=app.start_session(gen_random_uuid(),g,v,r,array[p,q],p); sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);fid:=(a#>>'{frames,0,id}')::uuid;
 a:=app.complete_frame(gen_random_uuid(),sid,2,fid,p,0,0,false,'regular');
 perform test.denied(format('select app.remove_match(gen_random_uuid(),%L,2,%L)',sid,'abandon'),'40001','stale removal revision denied');
 perform app.remove_match(gen_random_uuid(),sid,3,'abandon');
 perform test.ok(not exists(select 1 from app.frames where id=fid),'abandon purges frames');
 a:=app.start_session(gen_random_uuid(),g,v,r,array[p,q],p); sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);fid:=(a#>>'{frames,0,id}')::uuid;
 a:=app.complete_frame(gen_random_uuid(),sid,2,fid,p,0,0,false,'regular'); a:=app.finalize_session(gen_random_uuid(),sid,3);
 perform test.ok((select frames_won=7 from app.get_standings(g) where player_id=p),'completed night counted before deletion');
 perform test.ok((app.get_my_player_stats()->>'frames_won')::int=7,'personal stats include completed night');
 perform test.denied(format('select app.remove_match(gen_random_uuid(),%L,4,%L)',sid,'abandon'),'55000','abandon cannot remove finalized status');
 perform app.remove_match(gen_random_uuid(),sid,4,'delete');
 perform test.ok((select frames_won=6 from app.get_standings(g) where player_id=p),'standings recalculate after native deletion');
 perform test.ok((app.get_my_player_stats()->>'frames_won')::int=6,'personal stats recalculate after deletion');
 perform test.ok(not exists(select 1 from app.frame_participants where frame_id=fid),'frame dependents removed');
 -- Imported score-only evidence is removed one night at a time, never the cohort.
 perform app.remove_match(gen_random_uuid(),'80000000-0000-0000-0000-000000000001',1,'delete');
 perform test.ok((select frames_won=3 from app.get_standings(g) where player_id=p),'deleted score-only result no longer counted');
 perform test.ok(exists(select 1 from app.match_sessions where id='80000000-0000-0000-0000-000000000002'),'unrelated imported night preserved');
end $$;
reset role;
select test.ok((select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) from private.players p)=(select players from test.removal_baseline),'historical player UUIDs preserved');
select test.ok(not exists(select 1 from private.match_purge_scope),'purge authorization is transaction scoped and cleared');
select test.ok(not exists(select 1 from private.match_events e join private.match_removals d on d.session_id=e.session_id),'match operation evidence purged');
select test.ok((select count(*)=4 from private.match_removals),'minimal one audit per removed match');
select test.denied($q$delete from private.match_removals$q$,'55000','minimal audit immutable');
set role authenticated;
select test.denied($q$delete from private.match_purge_scope$q$,'42501','client cannot authorize evidence purge');
select test.denied($q$delete from app.match_sessions$q$,'42501','no broad client DELETE permission');
reset role;

-- Exercise a real imported observation and its private resolution/source dependencies.
insert into private.frame_observation_resolutions(observation_id,actor_id,reason,previous_disposition,new_disposition,decision)
select id,'20000000-0000-0000-0000-000000000001','Synthetic decision','pending_review','canonical_linked','{}' from private.legacy_frame_observations where session_id='80000000-0000-0000-0000-000000000002';
set role authenticated;
select app.remove_match(gen_random_uuid(),'80000000-0000-0000-0000-000000000002',1,'delete');
reset role;
select test.ok(not exists(select 1 from private.legacy_frame_observations),'private observations purged');
select test.ok(not exists(select 1 from private.frame_observation_resolutions),'private resolutions purged');
select test.ok(not exists(select 1 from private.import_records where id='72000000-0000-0000-0000-000000000002'),'exclusive source evidence purged');
-- Inject a mid-purge failure, after journal deletion has begun, to prove atomic rollback.
create function test.stop_frame_delete() returns trigger language plpgsql as $$begin raise exception 'synthetic mid-purge failure'; end $$;
create trigger synthetic_removal_failure before delete on app.frames for each row execute function test.stop_frame_delete();
set role authenticated;
do $$declare a jsonb; sid uuid; p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002'; begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);
 perform test.denied(format('select app.remove_match(gen_random_uuid(),%L,2,%L)',sid,'abandon'),'P0001','mid-purge error rolls back');
 perform test.ok(app.get_session_state(sid)=a,'failed removal preserves entire match state');
end $$;
reset role;
drop trigger synthetic_removal_failure on app.frames;
select test.ok(not exists(select 1 from private.match_removals d join app.match_sessions s on s.id=d.session_id),'failed removal leaves no audit');
select test.ok(not exists(select 1 from private.match_purge_scope),'failed removal leaves no purge permission');

select test.ok((select count(*)=1 from private.player_account_links),'account link preserved');
insert into private.import_records(group_id,batch_id,record_key,source_sheet,source_row,sanitized_evidence,extracted_hash) values('10000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','unrelated-retained','Synthetic',99,'{}','test');
select test.denied($q$delete from private.import_records$q$,'55000','unrelated source evidence remains append-only');
