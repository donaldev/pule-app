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
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','running frame denied') from test.upload_cases where n=6;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,0)',frame_id),'22023','zero bytes denied') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,262144001)',frame_id),'22023','oversize reservation denied') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100,%L)',frame_id,'video/quicktime'),'22023','unsupported mime denied') from test.upload_cases where n=1;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','unlinked viewer denied') from test.upload_cases where n=1;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','other group denied') from test.upload_cases where n=1;
reset role;
set role anon;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','anonymous reserve denied') from test.upload_cases where n=1;
reset role;
-- Anonymous has no test table access; preceding SELECT is run with a test grant.
-- Linked nonparticipants, revoked membership and detail flags cannot authorize.
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000003' where user_id='20000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','linked nonparticipant denied') from test.upload_cases where n=1;
reset role;
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000002' where user_id='20000000-0000-0000-0000-000000000002';
update app.frames set detail_eligible=false where id=(select frame_id from test.upload_cases where n=1);
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','ineligible detail denied') from test.upload_cases where n=1;
reset role;
update app.frames set detail_eligible=true where id=(select frame_id from test.upload_cases where n=1);
update app.match_sessions set detail_eligible=false where id=(select session_id from test.upload_cases where n=1);
set role authenticated;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'42501','ineligible session denied') from test.upload_cases where n=1;
reset role;
update app.match_sessions set detail_eligible=true where id=(select session_id from test.upload_cases where n=1);
set role authenticated;
insert into test.upload_reservations select 1,app.reserve_frame_replay_upload('a0000000-0000-0000-0000-000000000001',frame_id,100) from test.upload_cases where n=1;
select test.ok(app.reserve_frame_replay_upload('a0000000-0000-0000-0000-000000000001',frame_id,100)=(select answer from test.upload_reservations where n=1),'same operation returns same reservation') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_frame_replay_upload(%L,%L,101)','a0000000-0000-0000-0000-000000000001',frame_id),'22023','operation payload cannot change') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','competing reservation denied') from test.upload_cases where n=1;
select test.ok((answer->>'storage_path')<>((answer->>'session_id')||'/'||(answer->>'frame_id')||'.mp4'),'server assigns unique attempt path') from test.upload_reservations where n=1;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','missing object cannot publish metadata') from test.upload_reservations where n=1;
select test.denied($q$select * from private.frame_replay_uploads$q$,'42501','reservation ledger is private');
select test.denied($q$select * from private.frame_replay_cleanup$q$,'42501','cleanup queue is private');
select test.denied($q$select app.claim_frame_replay_cleanup()$q$,'42501','browser cannot claim cleanup');
select test.denied($q$select app.finish_frame_replay_cleanup('x',gen_random_uuid(),true)$q$,'42501','browser cannot acknowledge cleanup');
select test.denied($q$insert into app.frame_replays(frame_id,group_id,session_id,storage_path) select frame_id,'10000000-0000-0000-0000-000000000001',session_id,session_id::text||'/'||frame_id::text||'.mp4' from test.upload_cases where n=1$q$,'42501','direct metadata insert denied');
reset role;
-- A deliberately broad Storage policy must not bypass restrictive fences.
create policy synthetic_upload_broad on storage.objects for all to public using(true) with check(true);
set role authenticated;
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) values('frame-replays','arbitrary.mp4',auth.uid()::text)$q$,'42501','arbitrary path insert denied');
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) select 'frame-replays',answer->>'storage_path','wrong' from test.upload_reservations where n=1$q$,'42501','forged owner denied');
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-replays',answer->>'storage_path',auth.uid()::text,'{"size":101,"mimetype":"video/mp4"}' from test.upload_reservations where n=1$q$,'42501','wrong size insert denied');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) select 'frame-replays',answer->>'storage_path',auth.uid()::text from test.upload_reservations where n=1$q$,'42501','another participant cannot use reservation');
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'42501','another actor cannot finalize') from test.upload_reservations where n=1;
select test.denied(format('select app.get_my_frame_replay_upload(%L)',answer->>'upload_id'),'42501','another actor cannot read status') from test.upload_reservations where n=1;
reset role;
update app.groups set status='archived' where id='10000000-0000-0000-0000-000000000001';
update app.group_memberships set status='revoked' where user_id='20000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) select 'frame-replays',answer->>'storage_path',auth.uid()::text from test.upload_reservations where n=1$q$,'42501','revocation blocks existing upload capability');
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'42501','revocation blocks finalization') from test.upload_reservations where n=1;
reset role;
update app.group_memberships set status='active' where user_id='20000000-0000-0000-0000-000000000001';
update app.groups set status='active' where id='10000000-0000-0000-0000-000000000001';
set role authenticated;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'frame-replays',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=1;
select test.ok(not exists(select 1 from storage.objects where bucket_id='frame-replays'),'unregistered uploaded object is not readable');
reset role;
-- Simulate incomplete/wrong server metadata independently of upload policies.
update storage.objects set metadata=null where bucket_id='frame-replays';
set role authenticated;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','incomplete object metadata denied') from test.upload_reservations where n=1;
reset role;
update storage.objects set metadata='{"size":99,"mimetype":"video/mp4"}' where bucket_id='frame-replays';
set role authenticated;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','stored size mismatch denied') from test.upload_reservations where n=1;
reset role;
update storage.objects set metadata='{"size":100,"mimetype":"text/plain"}' where bucket_id='frame-replays';
set role authenticated;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','stored mime mismatch denied') from test.upload_reservations where n=1;
reset role;
update storage.objects set metadata='{"size":100,"mimetype":"video/mp4"}',owner_id='other' where bucket_id='frame-replays';
set role authenticated;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','stored owner mismatch denied') from test.upload_reservations where n=1;
reset role;
update storage.objects set owner_id='20000000-0000-0000-0000-000000000001' where bucket_id='frame-replays';
set role authenticated;
select test.ok(app.finalize_frame_replay_upload((answer->>'upload_id')::uuid)=app.finalize_frame_replay_upload((answer->>'upload_id')::uuid),'duplicate finalization returns identical replay') from test.upload_reservations where n=1;
select test.ok((select count(*)=1 from app.frame_replays),'exactly one replay registered');
select test.ok((select count(*)=1 from storage.objects where bucket_id='frame-replays'),'registered object readable');
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','existing replay cannot be replaced') from test.upload_cases where n=1;
with changed as(update storage.objects set name='overwrite.mp4' where bucket_id='frame-replays' returning *) select test.ok(not exists(select 1 from changed),'Storage UPDATE denied even with broad policy');
with removed as(delete from storage.objects where bucket_id='frame-replays' returning *) select test.ok(not exists(select 1 from removed),'Storage DELETE denied even with broad policy');
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) select 'frame-replays',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=1 on conflict(bucket_id,name) do update set metadata=excluded.metadata$q$,'42501','upsert cannot replace committed replay');
-- Quotas and expiry: committed slot does not count as an active transfer.
insert into test.upload_reservations select n,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n in (2,3);
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','concurrent transfer quota enforced') from test.upload_cases where n=4;
reset role;
update private.frame_replay_uploads set created_at=clock_timestamp()-interval '7 hours',expires_at=clock_timestamp()-interval '1 hour' where frame_id=(select frame_id from test.upload_cases where n=2);
set role authenticated;
select test.denied($q$insert into storage.objects(bucket_id,name,owner_id) select 'frame-replays',answer->>'storage_path',auth.uid()::text from test.upload_reservations where n=2$q$,'42501','expired upload cannot insert');
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','expired upload cannot finalize') from test.upload_reservations where n=2;
insert into test.upload_reservations select 4,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=2;
select test.ok((select answer->>'storage_path' from test.upload_reservations where n=2)<>(select answer->>'storage_path' from test.upload_reservations where n=4),'expired attempt path is never reused');
reset role;
select test.ok(exists(select 1 from private.frame_replay_cleanup where due_at>clock_timestamp()),'cleanup waits beyond upload expiry for TUS quiescence');
-- Privileged synthetic ledger rows isolate retained-byte and daily quotas.
insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,storage_path,status)
select x,'20000000-0000-0000-0000-000000000005',gen_random_uuid(),'10000000-0000-0000-0000-000000000001',c.session_id,c.frame_id,1,'video/mp4',c.session_id::text||'/'||c.frame_id::text||'/'||x::text||'.mp4','cleanup'
from test.upload_cases c cross join lateral (select gen_random_uuid() x from generate_series(1,40)) a where c.n=5;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','group retained-slot quota enforced') from test.upload_cases where n=5;
reset role;
delete from private.frame_replay_uploads where actor_id='20000000-0000-0000-0000-000000000005';
insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,storage_path,status)
select x,'20000000-0000-0000-0000-000000000002',gen_random_uuid(),'10000000-0000-0000-0000-000000000001',c.session_id,c.frame_id,1,'video/mp4',c.session_id::text||'/'||c.frame_id::text||'/'||x::text||'.mp4','cleanup'
from test.upload_cases c cross join lateral (select gen_random_uuid() x from generate_series(1,8)) a where c.n=5;
set role authenticated;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','actor retained-slot quota enforced') from test.upload_cases where n=5;
reset role;
update private.frame_replay_uploads set status='cleaned' where actor_id='20000000-0000-0000-0000-000000000002';
insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,storage_path,status)
select x,'20000000-0000-0000-0000-000000000002',gen_random_uuid(),'10000000-0000-0000-0000-000000000001',c.session_id,c.frame_id,1,'video/mp4',c.session_id::text||'/'||c.frame_id::text||'/'||x::text||'.mp4','cleaned'
from test.upload_cases c cross join lateral (select gen_random_uuid() x from generate_series(1,2)) a where c.n=5;
set role authenticated;
select test.denied(format('select app.reserve_frame_replay_upload(gen_random_uuid(),%L,100)',frame_id),'55000','daily attempt quota enforced after cleanup') from test.upload_cases where n=5;
reset role;
delete from private.frame_replay_uploads where actor_id='20000000-0000-0000-0000-000000000002';
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
-- Ledger survives match deletion; both uploaded and pending attempts are queued.
set role authenticated;
select app.remove_match(gen_random_uuid(),session_id,12,'abandon') from test.upload_cases where n=1;
reset role;
select test.ok(not exists(select 1 from app.frame_replays),'removal cascades replay metadata');
select test.ok((select count(*)=4 from private.frame_replay_uploads),'removal retains durable attempt identities');
select test.ok((select count(*)=4 from private.frame_replay_cleanup),'removal queues completed and pending attempts');
select test.ok(exists(select 1 from storage.objects where bucket_id='frame-replays'),'SQL removal does not delete Storage bytes');
-- Worker lease/ack, retries, and tombstones.
update private.frame_replay_cleanup set due_at=clock_timestamp()-interval '1 minute';
set role service_role;
insert into test.cleanup_leases select app.claim_frame_replay_cleanup(1);
reset role;
select test.ok(jsonb_array_length(answer)=1,'worker claims bounded batch') from test.cleanup_leases;
select test.denied(format('select app.finish_frame_replay_cleanup(%L,gen_random_uuid(),true)',answer#>>'{0,storage_path}'),'55000','wrong cleanup lease denied') from test.cleanup_leases;
-- Force one leased object to exist to prove the absence check.
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'frame-replays',answer#>>'{0,storage_path}','system','{"size":100,"mimetype":"video/mp4"}' from test.cleanup_leases on conflict do nothing;
select test.denied(format('select app.finish_frame_replay_cleanup(%L,%L,true)',answer#>>'{0,storage_path}',answer#>>'{0,lease_id}'),'55000','cleanup cannot acknowledge existing object') from test.cleanup_leases;
select app.finish_frame_replay_cleanup(answer#>>'{0,storage_path}',(answer#>>'{0,lease_id}')::uuid,false) from test.cleanup_leases;
select test.ok(exists(select 1 from private.frame_replay_cleanup where attempts=1 and due_at>clock_timestamp() and lease_id is null),'worker failure uses bounded backoff');
-- Test-only emulation of a Storage API deletion, never part of production SQL.
delete from storage.objects where bucket_id='frame-replays';
update private.frame_replay_cleanup set due_at=clock_timestamp()-interval '1 minute';
truncate test.cleanup_leases;
set role service_role;
insert into test.cleanup_leases select app.claim_frame_replay_cleanup(100);
select app.finish_frame_replay_cleanup(x->>'storage_path',(x->>'lease_id')::uuid,true) from test.cleanup_leases,jsonb_array_elements(answer) x;
reset role;
select test.ok((select count(*)=4 from private.frame_replay_uploads where status='cleaned'),'acknowledged absence releases budget');
insert into storage.objects(bucket_id,name) select 'frame-replays',storage_path from private.frame_replay_cleanup limit 1;
select test.ok(jsonb_array_length(app.claim_frame_replay_cleanup())=1,'late object revives cleanup tombstone');
-- Imported frames need no timestamps. Legacy replay attachment remains intact.
update app.frames set detail_eligible=true where id='90000000-0000-0000-0000-000000000001';
update app.match_sessions set detail_eligible=true where id='80000000-0000-0000-0000-000000000002';
set role authenticated;
insert into test.upload_reservations select 5,app.reserve_frame_replay_upload(gen_random_uuid(),'90000000-0000-0000-0000-000000000001',100);
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'frame-replays',answer->>'storage_path',auth.uid()::text,'{"size":100,"mimetype":"video/mp4"}' from test.upload_reservations where n=5;
select test.ok(app.finalize_frame_replay_upload((answer->>'upload_id')::uuid)->>'storage_path'=answer->>'storage_path','historical frame finalizes without timestamps') from test.upload_reservations where n=5;
reset role;
delete from app.frame_replays where frame_id='90000000-0000-0000-0000-000000000001';
select test.ok((select started_at is null and completed_at is null from app.frames where id='90000000-0000-0000-0000-000000000001'),'historical timestamps remain null');
insert into app.frame_replays(frame_id,group_id,session_id,storage_path)
select id,group_id,session_id,session_id::text||'/'||id::text||'.mp4' from app.frames where id='90000000-0000-0000-0000-000000000001';
set role authenticated;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'55000','manual Phase 1 replay wins without overwrite') from test.upload_reservations where n=5;
select test.ok((select storage_path='80000000-0000-0000-0000-000000000002/90000000-0000-0000-0000-000000000001.mp4' from app.frame_replays where frame_id='90000000-0000-0000-0000-000000000001'),'legacy replay path preserved');
reset role;
drop policy synthetic_upload_broad on storage.objects;
