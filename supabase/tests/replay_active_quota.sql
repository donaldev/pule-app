-- Synthetic published recordings with pending R2 and legacy source cleanup.
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic upload owner'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','synthetic upload opponent');
create table test.upload_cases(n integer primary key,session_id uuid,frame_id uuid);
grant select,insert on test.upload_cases to authenticated;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$ declare a jsonb; sid uuid; fid uuid; i integer; rev integer:=1;
 p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002';
begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);
 sid:=(a#>>'{session,id}')::uuid;
 for i in 1..11 loop
 a:=app.start_frame(gen_random_uuid(),sid,rev,array[p,q],p); rev:=rev+1;
 fid:=(a#>>'{frames,-1,id}')::uuid;
 insert into test.upload_cases values(i,sid,fid);
 a:=app.complete_frame(gen_random_uuid(),sid,rev,fid,p,0,0,false,'regular');rev:=rev+1;
 end loop;
end $$;


reset role;
with seed as (
 select c.*,gen_random_uuid() as upload_id from test.upload_cases c where n<=8
)
insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,
 storage_path,status,source_provider,source_sha256,created_at,expires_at,committed_at)
select upload_id,'20000000-0000-0000-0000-000000000001',gen_random_uuid(),f.group_id,c.session_id,c.frame_id,100,
 'video/mp4',c.session_id||'/'||c.frame_id||'/'||upload_id||'.mp4','committed',
 case when n=2 then 'supabase' else 'r2' end,case when n=2 then null else repeat('a',64) end,
 now()-interval '2 days',now()-interval '42 hours',now()-interval '2 days'
from seed c join app.frames f on f.id=c.frame_id;

insert into app.frame_replays(frame_id,group_id,session_id,storage_path)
select frame_id,group_id,session_id,session_id||'/'||frame_id||'.mp4' from private.frame_replay_uploads;
insert into private.frame_replay_jobs(upload_id,state,output_path,completed_at)
select u.id,'completed',r.storage_path,now() from private.frame_replay_uploads u join app.frame_replays r using(frame_id);

select private.enqueue_replay_cleanup('frame-recordings',storage_path,now()) from private.frame_replay_uploads;
-- An acknowledged cleanup for the wrong object must not release a source slot.
insert into private.frame_replay_cleanup(bucket_id,storage_path,upload_id,due_at,completed_at)
select 'frame-replays',u.storage_path,u.id,now(),now() from private.frame_replay_uploads u join test.upload_cases c using(frame_id) where n=1;

set role authenticated;
select test.denied(format('select app.reserve_r2_frame_recording(%L,%L,100,%L)',
 'bbbbbbbb-0000-0000-0000-000000000009',frame_id,repeat('a',64)),'55000','eight completed jobs with pending source cleanup still fill the quota')
 from test.upload_cases where n=9;
reset role;

update private.frame_replay_cleanup q set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
from private.frame_replay_uploads u join test.upload_cases c using(frame_id)
where q.upload_id=u.id and q.bucket_id='pule-frame-recordings' and c.n=1;
select app.finish_frame_replay_cleanup(bucket_id,storage_path,lease_id,true)
from private.frame_replay_cleanup where lease_id is not null;

set role authenticated;
select test.ok(app.reserve_r2_frame_recording('bbbbbbbb-0000-0000-0000-000000000009',frame_id,100,repeat('a',64))->>'status'='reserved',
 'R2 source acknowledgment allows the same saved reservation to succeed') from test.upload_cases where n=9;
select test.denied(format('select app.reserve_r2_frame_recording(gen_random_uuid(),%L,100,%L)',frame_id,repeat('a',64)),
 '55000','new reservation occupies the released slot') from test.upload_cases where n=10;
reset role;

update private.frame_replay_cleanup q set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
from private.frame_replay_uploads u join test.upload_cases c using(frame_id)
where q.upload_id=u.id and q.bucket_id='frame-recordings' and c.n=2;
select app.finish_frame_replay_cleanup(bucket_id,storage_path,lease_id,true)
from private.frame_replay_cleanup where lease_id is not null;
select test.ok((select count(*)=8 from app.frame_replays),'source cleanup and quota release preserve all eight published replays');
-- Seven active slots remain. The test harness races two different frame reservations.
