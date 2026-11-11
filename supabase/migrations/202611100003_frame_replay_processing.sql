-- Stage 1 processing: recordings are private sources, never published replays.
-- Apply with the undeployed 2A migration; no existing replay/history is rewritten.
begin;
do $$ begin
 if not exists(select 1 from storage.buckets where id='frame-recordings' and public=false
 and file_size_limit between 1 and 262144000 and allowed_mime_types=array['video/mp4']::text[])
 then raise exception 'private_mp4_recordings_bucket_required'; end if;
 -- Do not silently reinterpret any already-published 2A source as a generated replay.
 if exists(select 1 from private.frame_replay_uploads) then raise exception 'processing_requires_unused_2a_backend'; end if;
end $$;
create table private.frame_replay_jobs (
 upload_id uuid primary key references private.frame_replay_uploads(id) on delete restrict,
 state text not null default 'uploaded' check(state in ('uploaded','queued','processing','completed','failed')),
 uploaded_at timestamptz not null default clock_timestamp(),
 retain_until timestamptz not null default clock_timestamp()+interval '48 hours',
 corners jsonb, source_width integer, source_height integer,
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_id uuid, lease_until timestamptz, output_path text unique,
 completed_at timestamptz, failure_code text
);
alter table private.frame_replay_jobs enable row level security;
revoke all on private.frame_replay_jobs from public,anon,authenticated,service_role;
create index replay_jobs_claim on private.frame_replay_jobs(state,uploaded_at);
-- Bucket-qualified durable work: recordings and outputs may share relative paths.
alter table private.frame_replay_cleanup add column bucket_id text not null default 'frame-replays'
 check(bucket_id in ('frame-replays','frame-recordings'));
alter table private.frame_replay_cleanup add column upload_id uuid references private.frame_replay_uploads(id) on delete restrict;
alter table private.frame_replay_cleanup drop constraint frame_replay_cleanup_pkey;
alter table private.frame_replay_cleanup add primary key(bucket_id,storage_path);
drop index private.one_reserved_replay_per_frame;
create unique index one_reserved_replay_per_frame on private.frame_replay_uploads(frame_id) where status in ('reserved','committed');

-- Restrict all untrusted output writes again, regardless of other policies.
drop policy frame_replays_no_insert on storage.objects;
drop policy frame_replays_reserved_insert on storage.objects;
create policy frame_replays_no_insert on storage.objects as restrictive for insert to public with check(bucket_id<>'frame-replays');
create policy frame_recordings_read_fence on storage.objects as restrictive for select to public using(bucket_id<>'frame-recordings');
create policy frame_recordings_insert_fence on storage.objects as restrictive for insert to public
 with check(bucket_id<>'frame-recordings' or app.can_upload_frame_replay(name,owner_id,metadata));
create policy frame_recordings_insert on storage.objects for insert to authenticated
 with check(bucket_id='frame-recordings' and app.can_upload_frame_replay(name,owner_id,metadata));
create policy frame_recordings_update_fence on storage.objects as restrictive for update to public
 using(bucket_id<>'frame-recordings') with check(bucket_id<>'frame-recordings');
create policy frame_recordings_delete_fence on storage.objects as restrictive for delete to public using(bucket_id<>'frame-recordings');

create function private.replay_job_result(p_upload uuid) returns jsonb language sql stable set search_path='' as $$
 select private.replay_upload_result(u)||jsonb_build_object('bucket','frame-recordings','processing_status',j.state,
 'retain_until',j.retain_until,'attempts',j.attempts,'failure_code',j.failure_code)
 from private.frame_replay_uploads u left join private.frame_replay_jobs j on j.upload_id=u.id where u.id=p_upload
$$;
-- Retain all 2A actor/payload/quota/lifecycle checks, redirect only the response
-- bucket and the active-slot check. Abort if the expected baseline is absent.
do $$ declare d text; needle text:='where frame_id=p_frame and status=''reserved'''; begin
 d:=pg_get_functiondef('app.reserve_frame_replay_upload(uuid,uuid,bigint,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'reservation_baseline_mismatch'; end if;
 d:=replace(d,needle,'where frame_id=p_frame and status in (''reserved'',''committed'')');
 -- The old expiry insert needs a composite conflict target after adding buckets.
 d:=replace(d,'private.frame_replay_cleanup(storage_path,due_at)','private.frame_replay_cleanup(bucket_id,storage_path,due_at,upload_id)');
 d:=replace(d,'select storage_path,expires_at+interval ''24 hours''','select ''frame-recordings'',storage_path,expires_at+interval ''24 hours''');
 d:=replace(d,'from private.frame_replay_uploads where status=''cleanup''',',id from private.frame_replay_uploads where status=''cleanup''');
 d:=replace(d,'on conflict(storage_path)','on conflict(bucket_id,storage_path)');
 execute d;
 d:=pg_get_functiondef('private.replay_upload_result(private.frame_replay_uploads)'::regprocedure);
 execute replace(d,'''bucket'', ''frame-replays''','''bucket'', ''frame-recordings''');
 -- SQL function body preserves lexical spacing in pg_get_functiondef.
 d:=pg_get_functiondef('private.replay_upload_result(private.frame_replay_uploads)'::regprocedure);
 execute replace(d,'''bucket'',''frame-replays''','''bucket'',''frame-recordings''');
end $$;
create or replace function app.finalize_frame_replay_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; obj storage.objects;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid();
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||u.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where id=p_upload for update;
 if not private.replay_frame_eligible(u.frame_id) then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 if exists(select 1 from private.frame_replay_jobs where upload_id=u.id) then return private.replay_job_result(u.id); end if;
 if u.status<>'reserved' or u.expires_at<=clock_timestamp() then raise exception 'replay_upload_expired' using errcode='55000'; end if;
 if exists(select 1 from app.frame_replays where frame_id=u.frame_id) then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 select * into obj from storage.objects where bucket_id='frame-recordings' and name=u.storage_path for share;
 if not found or obj.owner_id is distinct from u.actor_id::text or obj.metadata->>'size' is distinct from u.expected_bytes::text
 or obj.metadata->>'mimetype' is distinct from 'video/mp4' then raise exception 'replay_object_not_verified' using errcode='55000'; end if;
 insert into private.frame_replay_jobs(upload_id) values(u.id);
 update private.frame_replay_uploads set status='committed',committed_at=clock_timestamp() where id=u.id;
 -- Uploaded means source verified, NOT publication. Wait for explicit corners.
 return private.replay_job_result(u.id);
end $$;
create or replace function app.get_my_frame_replay_upload(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid()) then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 return private.replay_job_result(p_upload);
end $$;
-- Four cyclic convex corners in original decoded pixel coordinates, never auto-detected.
create function private.valid_replay_corners(c jsonb,w integer,h integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare i integer; xs numeric[]:='{}'; ys numeric[]:='{}'; cross_value numeric; direction integer:=0;
begin
 if w is null or h is null or w not between 16 and 8192 or h not between 16 and 8192 or w::bigint*h>33554432
 or jsonb_typeof(c) is distinct from 'array' then return false; end if;
 if jsonb_array_length(c)<>4 then return false; end if;
 for i in 0..3 loop
 if jsonb_typeof(c->i) is distinct from 'array' then return false; end if;
 if jsonb_array_length(c->i)<>2 or jsonb_typeof(c->i->0) is distinct from 'number' or jsonb_typeof(c->i->1) is distinct from 'number' then return false; end if;
 xs:=array_append(xs,(c->i->>0)::numeric);ys:=array_append(ys,(c->i->>1)::numeric);
 if xs[i+1]<0 or xs[i+1]>=w or ys[i+1]<0 or ys[i+1]>=h then return false; end if;
 end loop;
 for i in 1..4 loop
 cross_value:=(xs[i%4+1]-xs[i])*(ys[(i+1)%4+1]-ys[i%4+1])-(ys[i%4+1]-ys[i])*(xs[(i+1)%4+1]-xs[i%4+1]);
 if cross_value=0 or (direction<>0 and sign(cross_value)<>direction) then return false; end if;
 direction:=sign(cross_value)::integer;
 end loop;
 return true;
end $$;
create function app.queue_frame_replay_processing(p_upload uuid,p_corners jsonb,p_width integer,p_height integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; j private.frame_replay_jobs;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid();
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||u.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 if not private.replay_frame_eligible(u.frame_id) or not private.valid_replay_corners(p_corners,p_width,p_height) then raise exception 'invalid_replay_processing_request' using errcode='22023'; end if;
 select * into j from private.frame_replay_jobs where upload_id=p_upload for update;
 if not found or u.status<>'committed' or j.retain_until<=clock_timestamp() or j.attempts>=3 then raise exception 'replay_processing_unavailable' using errcode='55000'; end if;
 if j.state in ('queued','processing','completed') then
 if j.corners is distinct from p_corners or j.source_width<>p_width or j.source_height<>p_height then raise exception 'processing_parameters_locked' using errcode='55000'; end if;
 return private.replay_job_result(u.id);
 end if;
 update private.frame_replay_jobs set state='queued',corners=p_corners,source_width=p_width,source_height=p_height,failure_code=null where upload_id=u.id;
 return private.replay_job_result(u.id);
end $$;
-- Worker authority checks the original actor, never trusts worker JWT as a player.
create function private.replay_processing_eligible(p_upload uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.frame_replay_uploads u
 join app.frames f on f.id=u.frame_id and f.session_id=u.session_id and f.group_id=u.group_id
 join app.match_sessions s on s.id=f.session_id and s.group_id=f.group_id
 join app.groups g on g.id=u.group_id and g.status='active'
 join app.group_memberships m on m.group_id=u.group_id and m.user_id=u.actor_id and m.status='active'
 join private.player_account_links l on l.user_id=u.actor_id
 join app.frame_participants fp on fp.frame_id=f.id and fp.session_id=f.session_id and fp.group_id=f.group_id and fp.player_id=l.player_id
 where u.id=p_upload and u.status='committed' and f.status='completed' and f.detail_eligible and s.detail_eligible and s.status<>'abandoned'
 and (s.import_batch_id is null or exists(select 1 from private.import_batches b where b.id=s.import_batch_id and b.group_id=s.group_id and b.status='accepted')))
$$;
create function private.enqueue_replay_cleanup(b text,p text,d timestamptz) returns void language sql set search_path='' as $$
 insert into private.frame_replay_cleanup(bucket_id,storage_path,due_at,upload_id)
 select b,p,d,(select u.id from private.frame_replay_uploads u left join private.frame_replay_jobs j on j.upload_id=u.id
 where (b='frame-recordings' and u.storage_path=p) or (b='frame-replays' and j.output_path=p) limit 1) where p is not null
 on conflict(bucket_id,storage_path) do update set due_at=least(private.frame_replay_cleanup.due_at,excluded.due_at),
 upload_id=coalesce(private.frame_replay_cleanup.upload_id,excluded.upload_id)
$$;
create function app.claim_frame_replay_processing() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.frame_replay_jobs; u private.frame_replay_uploads; token uuid:=gen_random_uuid();
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 -- Expired processing loses its lease and output, while retaining the source for explicit retry.
 for j in select * from private.frame_replay_jobs where state='processing' and lease_until<=clock_timestamp() loop
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,clock_timestamp());
 update private.frame_replay_jobs set state='failed',failure_code='lease_expired',lease_id=null,lease_until=null where upload_id=j.upload_id;
 end loop;
 select * into j from private.frame_replay_jobs where state='queued' and retain_until>clock_timestamp() and attempts<3
 and private.replay_processing_eligible(upload_id) order by uploaded_at for update skip locked limit 1;
 if not found then return null; end if;
 select * into u from private.frame_replay_uploads where id=j.upload_id;
 update private.frame_replay_jobs set state='processing',attempts=attempts+1,lease_id=token,lease_until=clock_timestamp()+interval '40 minutes',
 output_path=u.session_id::text||'/'||u.frame_id::text||'/'||token::text||'.mp4',failure_code=null where upload_id=u.id returning * into j;
 return jsonb_build_object('job_id',u.id,'lease_id',token,'source_bucket','frame-recordings','source_key',u.storage_path,
 'expected_bytes',u.expected_bytes,'table_corners',j.corners,'source_width',j.source_width,'source_height',j.source_height,
 'destination_bucket','frame-replays','destination_key',j.output_path);
end $$;
create function app.complete_frame_replay_processing(p_upload uuid,p_lease uuid,p_bytes bigint,p_duration numeric,p_clips integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; j private.frame_replay_jobs; obj storage.objects; r app.frame_replays;
begin
 select * into u from private.frame_replay_uploads where id=p_upload;
 if not found then raise exception 'processing_job_unavailable' using errcode='55000'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||u.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into j from private.frame_replay_jobs where upload_id=p_upload for update;
 select * into r from app.frame_replays where frame_id=u.frame_id;
 if j.state='completed' and j.lease_id=p_lease and r.storage_path=j.output_path then return to_jsonb(r); end if;
 if j.state is distinct from 'processing' or j.lease_id is distinct from p_lease or j.lease_until<=clock_timestamp()
 or j.retain_until<=clock_timestamp() or not private.replay_processing_eligible(u.id) then raise exception 'processing_lease_invalid' using errcode='55000'; end if;
 if p_bytes is null or p_bytes not between 1 and 262144000 or p_duration is null or p_duration<=0 or p_duration>7200 or p_duration='NaN'::numeric or p_clips is null or p_clips not between 1 and 1000 then raise exception 'invalid_processed_replay' using errcode='22023'; end if;
 select * into obj from storage.objects where bucket_id='frame-replays' and name=j.output_path for share;
 if not found or obj.metadata->>'size' is distinct from p_bytes::text or obj.metadata->>'mimetype' is distinct from 'video/mp4'
 then raise exception 'processed_object_not_verified' using errcode='55000'; end if;
 if r.frame_id is not null then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 insert into app.frame_replays(frame_id,group_id,session_id,storage_path) values(u.frame_id,u.group_id,u.session_id,j.output_path) returning * into r;
 update private.frame_replay_jobs set state='completed',completed_at=clock_timestamp() where upload_id=u.id;
 perform private.enqueue_replay_cleanup('frame-recordings',u.storage_path,clock_timestamp());
 return to_jsonb(r);
end $$;
create function app.fail_frame_replay_processing(p_upload uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j private.frame_replay_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into j from private.frame_replay_jobs where upload_id=p_upload for update;
 if j.state='failed' and j.lease_id=p_lease then return; end if;
 if j.state is distinct from 'processing' or j.lease_id is distinct from p_lease then raise exception 'processing_lease_invalid' using errcode='55000'; end if;
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,clock_timestamp());
 update private.frame_replay_jobs set state='failed',failure_code='processing_failed',lease_until=null where upload_id=p_upload;
end $$;
create or replace function private.queue_removed_frame_uploads() returns trigger language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; j private.frame_replay_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 for u in select * from private.frame_replay_uploads where frame_id=old.id and status in ('reserved','committed') loop
 select * into j from private.frame_replay_jobs where upload_id=u.id;
 perform private.enqueue_replay_cleanup('frame-recordings',u.storage_path,greatest(clock_timestamp(),u.expires_at+interval '24 hours'));
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,clock_timestamp());
 update private.frame_replay_uploads set status='cleanup' where id=u.id;
 update private.frame_replay_jobs set state=case when state='completed' then state else 'failed' end,failure_code='frame_removed',lease_id=null,lease_until=null where upload_id=u.id;
 end loop;
 return old;
end $$;
create or replace function private.queue_removed_replay() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 perform private.enqueue_replay_cleanup('frame-replays',old.storage_path,clock_timestamp());
 -- This may also run for a privileged metadata-only removal.
 update private.frame_replay_uploads set status='cleanup' where id in(select upload_id from private.frame_replay_jobs where output_path=old.storage_path);
 return old;
end $$;
create or replace function app.claim_frame_replay_cleanup(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; u private.frame_replay_uploads; j private.frame_replay_jobs;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_cleanup_limit' using errcode='22023'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 for u in select x.* from private.frame_replay_uploads x left join private.frame_replay_jobs y on y.upload_id=x.id
 where (x.status='reserved' and x.expires_at<=clock_timestamp())
 or (x.status='committed' and y.state<>'completed' and y.retain_until<=clock_timestamp()) loop
 select * into j from private.frame_replay_jobs where upload_id=u.id;
 perform private.enqueue_replay_cleanup('frame-recordings',u.storage_path,greatest(clock_timestamp(),u.expires_at+interval '24 hours'));
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,clock_timestamp());
 update private.frame_replay_uploads set status='cleanup' where id=u.id;
 update private.frame_replay_jobs set state='failed',failure_code='retention_expired',lease_id=null,lease_until=null where upload_id=u.id;
 end loop;
 update private.frame_replay_cleanup q set completed_at=null,due_at=clock_timestamp(),lease_id=null,lease_until=null
 where q.completed_at is not null and exists(select 1 from storage.objects o where o.bucket_id=q.bucket_id and o.name=q.storage_path)
 and not exists(select 1 from app.frame_replays r where q.bucket_id='frame-replays' and r.storage_path=q.storage_path);
 update private.frame_replay_uploads retired set status='cleanup' where retired.status='cleaned' and exists(
 select 1 from private.frame_replay_cleanup workitem where workitem.upload_id=retired.id and workitem.completed_at is null);
 with candidates as (
 select q.bucket_id,q.storage_path from private.frame_replay_cleanup q where q.completed_at is null and q.due_at<=clock_timestamp()
 and (q.lease_until is null or q.lease_until<=clock_timestamp())
 and not exists(select 1 from app.frame_replays r where q.bucket_id='frame-replays' and r.storage_path=q.storage_path)
 order by q.due_at,q.bucket_id,q.storage_path for update skip locked limit p_limit
 ), leased as (
 update private.frame_replay_cleanup q set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=q.attempts+1
 from candidates c where q.bucket_id=c.bucket_id and q.storage_path=c.storage_path returning q.bucket_id,q.storage_path,q.lease_id,q.lease_until)
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'storage_path',storage_path,'lease_id',lease_id,'lease_until',lease_until)),'[]'::jsonb) into answer from leased;
 return answer;
end $$;
drop function app.finish_frame_replay_cleanup(text,uuid,boolean);
create function app.finish_frame_replay_cleanup(p_bucket text,p_path text,p_lease uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
declare q private.frame_replay_cleanup;
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into q from private.frame_replay_cleanup where bucket_id=p_bucket and storage_path=p_path and lease_id=p_lease and lease_until>clock_timestamp() for update;
 if not found or p_success is null then raise exception 'cleanup_lease_invalid' using errcode='55000'; end if;
 if exists(select 1 from app.frame_replays where p_bucket='frame-replays' and storage_path=p_path) then raise exception 'cleanup_object_still_registered' using errcode='55000'; end if;
 if p_success then
 if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then raise exception 'cleanup_object_still_present' using errcode='55000'; end if;
 update private.frame_replay_cleanup set completed_at=clock_timestamp(),lease_id=null,lease_until=null where bucket_id=p_bucket and storage_path=p_path;
 update private.frame_replay_uploads u set status='cleaned' where u.status='cleanup'
 and not exists(select 1 from storage.objects o where (o.bucket_id='frame-recordings' and o.name=u.storage_path)
 or (o.bucket_id='frame-replays' and o.name in(select output_path from private.frame_replay_jobs where upload_id=u.id)))
 and not exists(select 1 from app.frame_replays r where r.frame_id=u.frame_id)
 and not exists(select 1 from private.frame_replay_cleanup workitem where workitem.upload_id=u.id and workitem.completed_at is null)
 and not exists(select 1 from storage.objects o join private.frame_replay_cleanup workitem on workitem.bucket_id=o.bucket_id and workitem.storage_path=o.name where workitem.upload_id=u.id);
 else
 update private.frame_replay_cleanup set due_at=clock_timestamp()+interval '1 minute'*least(60,power(2,least(q.attempts,6))::integer),lease_id=null,lease_until=null where bucket_id=p_bucket and storage_path=p_path;
 end if;
end $$;
revoke all on function private.replay_job_result(uuid),private.valid_replay_corners(jsonb,integer,integer),private.replay_processing_eligible(uuid),private.enqueue_replay_cleanup(text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.queue_frame_replay_processing(uuid,jsonb,integer,integer),app.claim_frame_replay_processing(),app.complete_frame_replay_processing(uuid,uuid,bigint,numeric,integer),app.fail_frame_replay_processing(uuid,uuid),app.finish_frame_replay_cleanup(text,text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app.queue_frame_replay_processing(uuid,jsonb,integer,integer) to authenticated;
grant execute on function app.claim_frame_replay_processing(),app.complete_frame_replay_processing(uuid,uuid,bigint,numeric,integer),app.fail_frame_replay_processing(uuid,uuid),app.finish_frame_replay_cleanup(text,text,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
