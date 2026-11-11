-- Synthetic only: Storage rows stand in for completed uploads, never real bytes.
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic upload owner'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','synthetic upload opponent');
create table test.upload_cases(n integer primary key,session_id uuid,frame_id uuid);
create table test.upload_reservations(n integer primary key,answer jsonb);
create table test.cleanup_leases(answer jsonb);
grant select,insert,update on test.upload_cases,test.upload_reservations,test.cleanup_leases to authenticated;
grant select on test.upload_cases to anon;
grant select on test.upload_cases,test.upload_reservations to service_role;
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

-- Trusted HEAD attestations below are synthetic; no remote Storage is contacted.
insert into test.upload_reservations select 1,app.reserve_r2_frame_recording('aaaaaaaa-0000-0000-0000-000000000001',frame_id,1073741824,repeat('a',64)) from test.upload_cases where n=1;
select test.ok(answer->>'bucket'='pule-frame-recordings' and answer->>'source_provider'='r2' and (answer->>'expected_bytes')::bigint=1073741824,'R2 reservations accept large sources without changing replay storage') from test.upload_reservations where n=1;
select test.ok(app.reserve_r2_frame_recording('aaaaaaaa-0000-0000-0000-000000000001',frame_id,1073741824,repeat('a',64))=(select answer from test.upload_reservations where n=1),'identical reservation returns original ID') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_r2_frame_recording(%L,%L,100,%L)','aaaaaaaa-0000-0000-0000-000000000001',frame_id,repeat('a',64)),'22023','operation payload cannot change size') from test.upload_cases where n=1;
select test.denied(format('select app.reserve_r2_frame_recording(gen_random_uuid(),%L,2147483649,%L)',frame_id,repeat('a',64)),'22023','source cap is enforced before reservation') from test.upload_cases where n=2;
select test.denied(format('select app.reserve_r2_frame_recording(gen_random_uuid(),%L,100,%L)',frame_id,repeat('a',64)),'42501','running frames cannot accept recordings') from test.upload_cases where n=6;
select test.denied(format('select app.reserve_r2_frame_recording(gen_random_uuid(),%L,100,%L)',frame_id,repeat('a',64)),'55000','competing reservation for same frame is denied') from test.upload_cases where n=1;
select test.ok(not app.can_upload_frame_replay(answer->>'storage_path',auth.uid()::text,null),'R2 reservations never authorize legacy Supabase source INSERT') from test.upload_reservations where n=1;
select test.denied(format('select app.finalize_frame_replay_upload(%L)',answer->>'upload_id'),'42501','legacy finalizer cannot attest R2 sources') from test.upload_reservations where n=1;
select test.denied(format('select app.confirm_r2_frame_recording(%L,auth.uid(),1073741824,%L,%L,%L)',answer->>'upload_id','video/mp4',repeat('a',64),'etag'),'42501','browser cannot fabricate HEAD attestation') from test.upload_reservations where n=1;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied(format('select app.get_r2_frame_recording(%L)',answer->>'upload_id'),'42501','another player cannot get upload permissions') from test.upload_reservations where n=1;
reset role;
set role anon;
select test.denied($q$select app.reserve_r2_frame_recording(gen_random_uuid(),gen_random_uuid(),100,repeat('a',64))$q$,'42501','anonymous reservation denied');
reset role;
set role service_role;
reset role;
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000003' where user_id='20000000-0000-0000-0000-000000000001';
set role service_role;
select test.denied(format('select app.bind_r2_frame_recording(%L,%L,%L)',answer->>'upload_id','20000000-0000-0000-0000-000000000001','revoked'),'42501','revoked participation blocks trusted multipart binding') from test.upload_reservations where n=1;
reset role;
update private.player_account_links set player_id='30000000-0000-0000-0000-000000000001' where user_id='20000000-0000-0000-0000-000000000001';
set role service_role;
select test.ok(app.bind_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001','first')='first','trusted broker binds first multipart ID') from test.upload_reservations where n=1;
select test.ok(app.bind_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001','loser')='first','competing bind cannot replace immutable ID') from test.upload_reservations where n=1;
select test.denied(format('select app.bind_r2_frame_recording(%L,%L,%L)',answer->>'upload_id','20000000-0000-0000-0000-000000000002','other'),'42501','service calls remain explicitly actor bound') from test.upload_reservations where n=1;
select test.denied(format('select app.confirm_r2_frame_recording(%L,%L,100,%L,%L,%L)',answer->>'upload_id','20000000-0000-0000-0000-000000000001','video/mp4',repeat('a',64),'etag'),'55000','wrong HEAD byte count denied') from test.upload_reservations where n=1;
select test.denied(format('select app.confirm_r2_frame_recording(%L,%L,1073741824,%L,%L,%L)',answer->>'upload_id','20000000-0000-0000-0000-000000000001','video/mp4',repeat('b',64),'etag'),'55000','wrong hash evidence denied') from test.upload_reservations where n=1;
select test.ok(app.confirm_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001',1073741824,'video/mp4',repeat('a',64),'etag')->>'processing_status'='uploaded','broker attestation creates uploaded job only') from test.upload_reservations where n=1;
select test.ok(app.confirm_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001',1073741824,'video/mp4',repeat('a',64),'etag')->>'processing_status'='uploaded','duplicate finalization is idempotent') from test.upload_reservations where n=1;
reset role;
select test.ok(not exists(select 1 from app.frame_replays),'raw source never registered as playable replay');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480) from test.upload_reservations where n=1;
reset role;
create table test.r2_lease(answer jsonb);
grant select,insert on test.r2_lease to service_role;
set role service_role;
select test.ok(app.claim_frame_replay_processing() is null,'deployed legacy workers cannot claim R2 recordings');
insert into test.r2_lease select app.claim_r2_frame_replay_processing();
select test.ok(answer->>'source_provider'='r2' and answer->>'source_bucket'='pule-frame-recordings' and answer->>'source_sha256'=repeat('a',64),'R2 worker receives original object identity and source hash') from test.r2_lease;
select test.ok(app.claim_r2_frame_replay_processing() is null,'one worker lease per R2 job');
reset role;
select test.ok(not exists(select 1 from private.frame_replay_cleanup),'source retained before verified publication');
insert into storage.objects(bucket_id,name,metadata) select 'frame-replays',answer->>'destination_key','{"size":70,"mimetype":"video/mp4"}' from test.r2_lease;
set role service_role;
select app.complete_frame_replay_processing((answer->>'job_id')::uuid,(answer->>'lease_id')::uuid,70,5,1) from test.r2_lease;
reset role;
select test.ok(exists(select 1 from app.frame_replays where storage_path=(select answer->>'destination_key' from test.r2_lease)),'only generated replay is published to existing Supabase playback');
select test.ok(exists(select 1 from private.frame_replay_cleanup where bucket_id='pule-frame-recordings' and upload_id=(select (answer->>'job_id')::uuid from test.r2_lease)),'successful publication queues exact R2 source cleanup');
select test.ok(not exists(select 1 from private.frame_replay_cleanup where bucket_id='frame-recordings'),'R2 cleanup cannot target the legacy bucket');
-- Expiry retains a durable abort/delete task even without completed object metadata.
set role authenticated;
insert into test.upload_reservations select 3,app.reserve_r2_frame_recording(gen_random_uuid(),frame_id,100,repeat('a',64)) from test.upload_cases where n=3;
reset role;
update private.frame_replay_uploads set created_at=clock_timestamp()-interval '31 hours',expires_at=clock_timestamp()-interval '25 hours',r2_multipart_id='abandoned-multipart' where id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=3);
select app.claim_frame_replay_cleanup();
select test.ok(exists(select 1 from private.frame_replay_cleanup where bucket_id='pule-frame-recordings' and upload_id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=3)),'expired upload has durable R2 cleanup work');
select test.ok((select status='cleanup' from private.frame_replay_uploads where id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=3)),'expired reservation cannot obtain new permissions');
select app.finish_frame_replay_cleanup(bucket_id,storage_path,lease_id,true) from private.frame_replay_cleanup where bucket_id='pule-frame-recordings' and lease_id is not null;
select test.ok((select status='cleaned' from private.frame_replay_uploads where id=(select (answer->>'upload_id')::uuid from test.upload_reservations where n=3)),'attested abort/object absence releases expired R2 quota');
-- Preserve canonical Phase 1 metadata and historical null timestamps.
insert into app.frame_replays(frame_id,group_id,session_id,storage_path) select id,group_id,session_id,session_id::text||'/'||id::text||'.mp4' from app.frames where id='90000000-0000-0000-0000-000000000001';
select test.ok((select started_at is null and completed_at is null from app.frames where id='90000000-0000-0000-0000-000000000001'),'historical timestamps remain null');
set role authenticated;
insert into test.upload_reservations select 4,app.reserve_frame_replay_upload(gen_random_uuid(),frame_id,100) from test.upload_cases where n=4;
select test.ok(answer->>'bucket'='frame-recordings' and answer->>'source_provider'='supabase','legacy source reservations remain recoverable') from test.upload_reservations where n=4;
-- Leave R2 frame 2 queued and frame 5 unreserved for independent-connection races.
insert into test.upload_reservations select 2,app.reserve_r2_frame_recording(gen_random_uuid(),frame_id,100,repeat('a',64)) from test.upload_cases where n=2;
reset role;
select app.bind_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001','concurrency-multipart') from test.upload_reservations where n=2;
select app.confirm_r2_frame_recording((answer->>'upload_id')::uuid,'20000000-0000-0000-0000-000000000001',100,'video/mp4',repeat('a',64),'etag') from test.upload_reservations where n=2;
set role authenticated;
select app.queue_frame_replay_processing((answer->>'upload_id')::uuid,'[[20,20],[620,20],[620,460],[20,460]]',640,480) from test.upload_reservations where n=2;
reset role;
