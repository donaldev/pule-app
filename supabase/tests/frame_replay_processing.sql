-- Synthetic only: Storage rows stand in for completed uploads, never real bytes.
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic upload owner'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','synthetic upload opponent');
create table test.upload_cases(n integer primary key,session_id uuid,frame_id uuid);
create table test.upload_reservations(n integer primary key,answer jsonb);
create table test.cleanup_leases(answer jsonb);
grant select,insert,update on test.upload_cases,test.upload_reservations,test.cleanup_leases to authenticated;
grant select on test.upload_cases to anon;
grant usage on schema test to service_role;
grant insert,select on test.results to service_role;
grant select,insert on test.cleanup_leases to service_role;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$ declare a jsonb; sid uuid; fid uuid; i integer; rev integer:=1;
 p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002';
begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);
 sid:=(a#>>'{session,id}')::uuid;
 for i in 1..6 loop
 a:=app.start_frame(gen_random_uuid(),sid,rev,array[p,q],p); rev:=rev+1;
 fid:=(a#>>'{frames,-1,id}')::uuid;
 insert into test.upload_cases values(i,sid,fid);
 if i<6 then a:=app.complete_frame(gen_random_uuid(),sid,rev,fid,p,0,0,false,'regular');rev:=rev+1; end if;
 end loop;
end $$;
insert into test.upload_reservations select 1,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=1;
select test.ok(answer->>'bucket'='frame-recordings','reservations name the private source bucket') from test.upload_reservations where n=1;
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-replays',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=1$q$,'42501','browser cannot upload a raw recording into replay bucket');
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-recordings',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=1;
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-recordings'),'recordings cannot be read as replays');
select test.ok(app.finalize_frame_replay_upload((answer->>'upload_id')::uuid)->>'processing_status'='uploaded','finalization verifies source without publication') from test.upload_reservations where n=1;
select test.ok(app.finalize_frame_replay_upload((answer->>'upload_id')::uuid)=app.get_my_frame_replay_upload((answer->>'upload_id')::uuid),'source finalization is idempotent') from test.upload_reservations where n=1;
select test.ok(not exists(select 1 from app.frame_replays),'source never appears in replay metadata');
select test.denied($q$select app.claim_frame_replay_processing()$q$,'42501','browser cannot claim processing');
select test.denied($q$select app.complete_frame_replay_processing(gen_random_uuid(),gen_random_uuid(),100,10,1)$q$,'42501','browser cannot publish output');
reset role;
set role service_role;
select test.ok(app.claim_frame_replay_processing() is null,'job without corners cannot be claimed');
reset role;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied(format('select app.queue_frame_replay_processing(%L,%L,640,480)',answer->>'upload_id','[[20,20],[620,20],[620,460],[20,460]]'),'42501','another actor cannot choose corners') from test.upload_reservations where n=1;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.denied(format('select app.queue_frame_replay_processing(%L,%L,640,480)',answer->>'upload_id','[[0,0],[640,0],[640,480],[0,480]]'),'22023','out of bounds corners denied') from test.upload_reservations where n=1;
select test.denied(format('select app.queue_frame_replay_processing(%L,%L,640,480)',answer->>'upload_id','[[20,20],[620,460],[620,20],[20,460]]'),'22023','crossed corners denied') from test.upload_reservations where n=1;
select test.denied(format('select app.queue_frame_replay_processing(%L,%L,640,480)',answer->>'upload_id','[[20,20],[20,20],[620,460],[20,460]]'),'22023','degenerate corners denied') from test.upload_reservations where n=1;
select test.ok(app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480)->>'processing_status'='queued','explicit convex corners queue job') from test.upload_reservations where n=1;
reset role;
-- Broad policies cannot expose recordings or reopen direct replay INSERT.
create policy synthetic_processing_broad on storage.objects for all to public using(true) with check(true);
set role authenticated;
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-recordings'),'source SELECT fence survives broad policy');
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) values('frame-recordings','random.mp4',auth.uid()::text)$q$,'42501','arbitrary source paths denied under broad policy');
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) values('frame-replays','random.mp4',auth.uid()::text)$q$,'42501','output INSERT fence survives broad policy');
reset role;
create table test.processing_leases(n integer primary key,answer jsonb);
grant select,insert,update on test.processing_leases to service_role;
grant usage on schema test to service_role;
grant insert,select on test.results to service_role;
set role service_role;
insert into test.processing_leases select 1,app.claim_frame_replay_processing();
select test.ok(app.claim_frame_replay_processing() is null,'leased job cannot be claimed twice');
reset role;
select test.ok((select answer->'table_corners'='[[20,20],[620,20],[620,460],[20,460]]'::jsonb from test.processing_leases where n=1),'worker receives exact supplied corners');
select test.ok(not exists(select 1 from private.frame_replay_cleanup where bucket_id='frame-recordings'),'source not scheduled for deletion before publication');
select test.denied(format('select app.complete_frame_replay_processing(%L,%L,70,5,1)',answer->>'job_id',answer->>'lease_id'),'55000','missing generated object cannot publish') from test.processing_leases where n=1;
insert into storage.objects(bucket_id,name,metadata) select 'frame-replays',answer->>'destination_key','{"size":70,"mimetype":"video/mp4"}' from test.processing_leases where n=1;
select test.denied(format('select app.complete_frame_replay_processing(%L,gen_random_uuid(),70,5,1)',answer->>'job_id'),'55000','wrong worker lease denied') from test.processing_leases where n=1;
-- Membership revoked after claiming must also block service publication.
update app.group_memberships set status='revoked' where user_id='20000000-0000-0000-0000-000000000002';
-- This job belongs to owner 1, so revoke its link without modifying owner membership.
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000003' where user_id='20000000-0000-0000-0000-000000000001';
select test.denied(format('select app.complete_frame_replay_processing(%L,%L,70,5,1)',answer->>'job_id',answer->>'lease_id'),'55000','worker cannot publish after participant authority changes') from test.processing_leases where n=1;
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000001' where user_id='20000000-0000-0000-0000-000000000001';
update app.group_memberships set status='active' where user_id='20000000-0000-0000-0000-000000000002';
select test.denied(format('select app.complete_frame_replay_processing(%L,%L,71,5,1)',answer->>'job_id',answer->>'lease_id'),'55000','generated size mismatch denied') from test.processing_leases where n=1;
set role service_role;
select test.ok(app.complete_frame_replay_processing((answer->>'job_id')::uuid,(answer->>'lease_id')::uuid,70,5,1)=app.complete_frame_replay_processing((answer->>'job_id')::uuid,(answer->>'lease_id')::uuid,70,5,1),'publication is idempotent') from test.processing_leases where n=1;
reset role;
select test.ok((select r.storage_path=l.answer->>'destination_key' from app.frame_replays r join test.upload_cases c on c.frame_id=r.frame_id join test.processing_leases l on l.n=1 where c.n=1),'only generated output registered');
select test.ok(exists(select 1 from private.frame_replay_cleanup where bucket_id='frame-recordings'),'successful publication atomically schedules source cleanup');
select test.ok(exists(select 1 from storage.objects where bucket_id='frame-recordings'),'publication does not SQL-delete Storage bytes');
select test.denied(format('select app.fail_frame_replay_processing(%L,%L)',answer->>'job_id',answer->>'lease_id'),'55000','late failure cannot retire published output') from test.processing_leases where n=1;
-- Failed source stays private and can retry with a fresh output path/lease.
set role authenticated;
insert into test.upload_reservations select 2,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=2;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-recordings',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=2;
select app.finalize_frame_replay_upload((answer->>'upload_id')::uuid) from test.upload_reservations where n=2;
select app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480) from test.upload_reservations where n=2;
reset role;
insert into test.processing_leases select 2,app.claim_frame_replay_processing();
select app.fail_frame_replay_processing((answer->>'job_id')::uuid,(answer->>'lease_id')::uuid) from test.processing_leases where n=2;
select test.ok(not exists(select 1 from private.frame_replay_cleanup q join test.upload_reservations u on q.storage_path=u.answer->>'storage_path' where u.n=2 and q.bucket_id='frame-recordings'),'failed source retained for retry');
set role authenticated;
select app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480) from test.upload_reservations where n=2;
reset role;
insert into test.processing_leases select 3,app.claim_frame_replay_processing();
select test.ok((select answer->>'destination_key' from test.processing_leases where n=2)<>(select answer->>'destination_key' from test.processing_leases where n=3),'retry assigns immutable new output path');
select test.denied(format('select app.complete_frame_replay_processing(%L,%L,70,5,1)',answer->>'job_id',answer->>'lease_id'),'55000','stale worker cannot publish after retry') from test.processing_leases where n=2;
update private.frame_replay_jobs set lease_until=clock_timestamp()-interval '1 minute' where upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=2);
select app.claim_frame_replay_processing();
select test.ok((select state='failed' from private.frame_replay_jobs where upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=2)),'expired lease becomes failed and retryable');
update private.frame_replay_jobs set retain_until=clock_timestamp()-interval '1 minute' where upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=2);
select app.claim_frame_replay_cleanup();
select test.ok(exists(select 1 from private.frame_replay_cleanup q join test.upload_reservations u on q.storage_path=u.answer->>'storage_path' where u.n=2 and q.bucket_id='frame-recordings'),'failed source expires into durable cleanup');
-- Early success acknowledgments cannot discard source bytes or queue state.
select test.denied(format('select app.finish_frame_replay_cleanup(%L,%L,%L,true)',q.bucket_id,q.storage_path,q.lease_id),'55000','cleanup cannot acknowledge source still present')
from private.frame_replay_cleanup q join test.upload_reservations u on q.storage_path=u.answer->>'storage_path' where q.bucket_id='frame-recordings' and u.n=1;
-- Test-only Storage API deletion emulation, then service acknowledgment.
delete from storage.objects where bucket_id='frame-recordings' and name=(select answer->>'storage_path' from test.upload_reservations where n=1);
select app.finish_frame_replay_cleanup(q.bucket_id,q.storage_path,q.lease_id,true)
from private.frame_replay_cleanup q join test.upload_reservations u on q.storage_path=u.answer->>'storage_path' where q.bucket_id='frame-recordings' and u.n=1;
select test.ok(exists(select 1 from app.frame_replays where frame_id=(select frame_id from test.upload_cases where n=1)),'source cleanup preserves generated replay');
select test.ok((select count(*)>=2 from private.frame_replay_cleanup where bucket_id='frame-replays' and upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=2)),'retired output attempts remain associated with quota and cleanup');
-- Legacy canonical playback remains intact, including historical null timestamps.
insert into app.frame_replays(frame_id,group_id,session_id,storage_path) select id,group_id,session_id,session_id::text||'/'||id::text||'.mp4' from app.frames where id='90000000-0000-0000-0000-000000000001';
select test.ok((select started_at is null and completed_at is null from app.frames where id='90000000-0000-0000-0000-000000000001'),'historical frame timestamps unchanged');
-- An unrelated canonical replay must not permanently charge an abandoned attempt.
set role authenticated;
insert into test.upload_reservations select 4,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=4;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-recordings',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=4;
reset role;
insert into app.frame_replays(frame_id,group_id,session_id,storage_path) select frame_id,'10000000-0000-0000-0000-000000000001',session_id,session_id::text||'/'||frame_id::text||'.mp4' from test.upload_cases where n=4;
update private.frame_replay_uploads set created_at=clock_timestamp()-interval '31 hours',expires_at=clock_timestamp()-interval '25 hours' where id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=4);
select app.claim_frame_replay_cleanup();
delete from storage.objects where bucket_id='frame-recordings' and name=(select answer->>'storage_path' from test.upload_reservations where n=4);
select app.finish_frame_replay_cleanup(q.bucket_id,q.storage_path,q.lease_id,true) from private.frame_replay_cleanup q where q.upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=4);
select test.ok((select status='cleaned' from private.frame_replay_uploads where id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=4)),'unrelated legacy replay does not leak abandoned upload quota');
select test.ok(exists(select 1 from app.frame_replays where frame_id=(select frame_id from test.upload_cases where n=4)),'cleanup leaves unrelated legacy replay untouched');
-- Leave one queued job for independent-connection claim/publication/removal tests.
set role authenticated;
insert into test.upload_reservations select 3,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=3;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-recordings',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=3;
select app.finalize_frame_replay_upload((answer->>'upload_id')::uuid) from test.upload_reservations where n=3;
select app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480) from test.upload_reservations where n=3;
reset role;
drop policy synthetic_processing_broad on storage.objects;
