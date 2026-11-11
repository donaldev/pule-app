-- Synthetic metadata and Storage RLS only. No real MP4s or hosted requests.
insert into app.frame_replays(group_id,session_id,frame_id,storage_path)
select group_id,session_id,id,session_id::text||'/'||id::text||'.mp4'
from app.frames where id='90000000-0000-0000-0000-000000000001';
insert into storage.objects(bucket_id,name)
select 'frame-replays',storage_path from app.frame_replays;
insert into storage.objects(bucket_id,name) values('frame-replays','unregistered.mp4'),('unrelated','untouched.mp4');
-- Prove the restrictive fences survive even an accidental permissive policy.
create policy synthetic_broad_storage on storage.objects for all to public using(true) with check(true);
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.ok((select count(*)=1 from app.frame_replays),'viewer sees replay metadata');
select test.ok((select count(*)=1 from storage.objects where bucket_id='frame-replays'),'viewer sees only registered replay');
select test.ok((select count(*)=1 from storage.objects where bucket_id='unrelated'),'other bucket policies unaffected');
select test.denied($q$insert into app.frame_replays select * from app.frame_replays$q$,'42501','viewer cannot insert replay');
select test.denied($q$update app.frame_replays set created_at=now()$q$,'42501','viewer cannot replace metadata');
select test.denied($q$delete from app.frame_replays$q$,'42501','viewer cannot delete metadata');
select test.denied($q$insert into storage.objects(bucket_id,name) values('frame-replays','upload.mp4')$q$,'42501','no browser replay upload even under broad policy');
with changed as (update storage.objects set name='replacement.mp4' where bucket_id='frame-replays' returning *)
select test.ok(not exists(select 1 from changed),'no browser replay replacement');
with removed as (delete from storage.objects where bucket_id='frame-replays' returning *)
select test.ok(not exists(select 1 from removed),'no browser replay deletion');
select test.denied($q$update storage.objects set bucket_id='frame-replays' where bucket_id='unrelated'$q$,'42501','cannot move another object into replay bucket');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok(not exists(select 1 from app.frame_replays),'other group metadata denied');
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-replays'),'other group object denied');
reset role;
set role anon;
select test.denied($q$select * from app.frame_replays$q$,'42501','anonymous metadata denied');
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-replays'),'anonymous object denied despite broad policy');
reset role;
update app.group_memberships set status='revoked' where user_id='20000000-0000-0000-0000-000000000003';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.ok(not exists(select 1 from app.frame_replays),'revoked viewer metadata denied');
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-replays'),'revoked viewer object denied');
reset role;
update app.group_memberships set status='active' where user_id='20000000-0000-0000-0000-000000000003';
update private.import_batches set status='staged' where id='71000000-0000-0000-0000-000000000001';
set role authenticated;
select test.ok(not exists(select 1 from app.frame_replays),'unaccepted history metadata denied');
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-replays'),'unaccepted history object denied');
reset role;
update private.import_batches set status='accepted' where id='71000000-0000-0000-0000-000000000001';
select test.denied($q$insert into app.frame_replays select frame_id,group_id,session_id,storage_path,now() from app.frame_replays$q$,'23505','one replay per frame');
select test.denied($q$update app.frame_replays set storage_path='arbitrary.mp4'$q$,'23514','path bound to frame identity');
select test.denied($q$update app.frame_replays set group_id='10000000-0000-0000-0000-000000000002'$q$,'23514','cross-group attachment denied');
select test.ok(exists(select 1 from pg_constraint where conrelid='app.frame_replays'::regclass and confrelid='app.frames'::regclass and contype='f' and cardinality(conkey)=3 and confdeltype='c'),'composite frame FK cascades');

-- Real command path: completed frame, correction, finalization, then removal.
create table test.replay_case(data jsonb);
grant select,insert,update on test.replay_case to authenticated;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$ declare a jsonb; sid uuid; fid uuid;
 p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002';
begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);
 sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);
 fid:=(a#>>'{frames,0,id}')::uuid;
 insert into test.replay_case values(jsonb_build_object('session',sid,'frame',fid));
end $$;
reset role;
select test.denied($q$insert into app.frame_replays(group_id,session_id,frame_id,storage_path)
select '10000000-0000-0000-0000-000000000001',(data->>'session')::uuid,(data->>'frame')::uuid,
data->>'session'||'/'||(data->>'frame')||'.mp4' from test.replay_case$q$,'23514','running frame cannot receive replay');
set role authenticated;
select app.complete_frame(gen_random_uuid(),(data->>'session')::uuid,2,(data->>'frame')::uuid,'30000000-0000-0000-0000-000000000001',0,0,false,'regular') from test.replay_case;
reset role;
insert into app.frame_replays(group_id,session_id,frame_id,storage_path)
select '10000000-0000-0000-0000-000000000001',(data->>'session')::uuid,(data->>'frame')::uuid,
(data->>'session')||'/'||(data->>'frame')||'.mp4' from test.replay_case;
insert into storage.objects(bucket_id,name)
select 'frame-replays',storage_path from app.frame_replays where frame_id=(select (data->>'frame')::uuid from test.replay_case);
set role authenticated;
select app.correct_frame(gen_random_uuid(),(data->>'session')::uuid,3,(data->>'frame')::uuid,'30000000-0000-0000-0000-000000000002',0,0,'Synthetic replay correction') from test.replay_case;
select test.ok(exists(select 1 from app.frame_replays where frame_id=(select (data->>'frame')::uuid from test.replay_case)),'correction preserves replay identity');
select app.finalize_session(gen_random_uuid(),(data->>'session')::uuid,4) from test.replay_case;
select app.remove_match(gen_random_uuid(),(data->>'session')::uuid,5,'delete') from test.replay_case;
select test.ok(not exists(select 1 from storage.objects where name=(select (data->>'session')||'/'||(data->>'frame')||'.mp4' from test.replay_case)),'removed replay object no longer authorized');
reset role;
select test.ok(not exists(select 1 from app.frame_replays where frame_id=(select (data->>'frame')::uuid from test.replay_case)),'removal physically cascades replay metadata');
select test.ok(exists(select 1 from storage.objects where name=(select (data->>'session')||'/'||(data->>'frame')||'.mp4' from test.replay_case)),'Storage object remains for manual cleanup');
-- Restore Storage test environment, leaving the shared scoring fixtures intact.
delete from storage.objects;
delete from app.frame_replays;
drop policy synthetic_broad_storage on storage.objects;
