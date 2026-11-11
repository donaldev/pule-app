-- R2 temporary sources only. Legacy Supabase sources and all published replays remain unchanged.
begin;
alter table private.frame_replay_uploads add column source_provider text not null default 'supabase' check(source_provider in ('supabase','r2'));
alter table private.frame_replay_uploads add column source_sha256 text check(source_sha256 ~ '^[0-9a-f]{64}$');
alter table private.frame_replay_uploads add column r2_multipart_id text;
alter table private.frame_replay_uploads add column r2_etag text;
alter table private.frame_replay_uploads drop constraint frame_replay_uploads_expected_bytes_check;
alter table private.frame_replay_uploads add constraint recording_source_size check(expected_bytes between 1 and case when source_provider='r2' then 2147483648::bigint else 262144000::bigint end);
alter table private.frame_replay_uploads add constraint r2_recording_identity check(source_provider<>'r2' or source_sha256 is not null);
alter table private.frame_replay_cleanup drop constraint frame_replay_cleanup_bucket_id_check;
alter table private.frame_replay_cleanup add constraint frame_replay_cleanup_bucket_id_check check(bucket_id in ('frame-replays','frame-recordings','pule-frame-recordings'));
create or replace function private.enqueue_replay_cleanup(b text,p text,d timestamptz) returns void language sql set search_path='' as $$
 insert into private.frame_replay_cleanup(bucket_id,storage_path,due_at,upload_id)
 select case when b='frame-recordings' and u.source_provider='r2' then 'pule-frame-recordings' else b end,p,d,u.id
 from (select 1) seed left join private.frame_replay_uploads u on
 (b in ('frame-recordings','pule-frame-recordings') and u.storage_path=p) or
 (b='frame-replays' and exists(select 1 from private.frame_replay_jobs j where j.upload_id=u.id and j.output_path=p))
 where p is not null on conflict(bucket_id,storage_path) do update set due_at=least(private.frame_replay_cleanup.due_at,excluded.due_at),upload_id=coalesce(private.frame_replay_cleanup.upload_id,excluded.upload_id)
$$;
create or replace function private.replay_upload_result(u private.frame_replay_uploads) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('upload_id',u.id,'frame_id',u.frame_id,'session_id',u.session_id,'storage_path',u.storage_path,
 'source_provider',u.source_provider,'bucket',case when u.source_provider='r2' then 'pule-frame-recordings' else 'frame-recordings' end,
 'status',u.status,'expected_bytes',u.expected_bytes,'content_type',u.content_type,'expires_at',u.expires_at)
$$;
create or replace function private.replay_job_result(p_upload uuid) returns jsonb language sql stable set search_path='' as $$
 select private.replay_upload_result(u)||jsonb_build_object('processing_status',j.state,'retain_until',j.retain_until,'attempts',j.attempts,'failure_code',j.failure_code)
 from private.frame_replay_uploads u left join private.frame_replay_jobs j on j.upload_id=u.id where u.id=p_upload
$$;
create function private.reserve_frame_recording(p_operation uuid,p_frame uuid,p_bytes bigint,p_content_type text,p_provider text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); f app.frames; u private.frame_replay_uploads; attempt uuid:=gen_random_uuid();
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 if p_provider not in ('supabase','r2') or p_provider is null or (p_provider='r2' and (p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$')) then raise exception 'invalid_recording_provider' using errcode='22023'; end if;
 if p_frame is null or p_bytes is null or (p_bytes<1 or p_bytes>(case when p_provider='r2' then 2147483648::bigint else 262144000::bigint end)) or p_content_type is distinct from 'video/mp4'
 then raise exception 'invalid_replay_upload' using errcode='22023'; end if;
 perform set_config('lock_timeout','5s',true);
 select * into f from app.frames where id=p_frame;
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||f.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 if not private.replay_frame_eligible(p_frame) then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 select * into u from private.frame_replay_uploads where actor_id=uid and operation_id=p_operation;
 if found then
 if u.frame_id<>p_frame or u.expected_bytes<>p_bytes or u.content_type<>p_content_type or u.source_provider<>p_provider or u.source_sha256 is distinct from p_sha256
 then raise exception 'replay_operation_payload_mismatch' using errcode='22023'; end if;
 return private.replay_upload_result(u); -- Never renew an expired capability on retry.
 end if;
 if exists(select 1 from app.frame_replays where frame_id=p_frame) then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 -- Expired slots become durable cleanup work, never reusable paths.
 update private.frame_replay_uploads set status='cleanup' where status='reserved' and expires_at<=clock_timestamp();
 perform private.enqueue_replay_cleanup('frame-recordings',x.storage_path,x.expires_at+interval '24 hours') from private.frame_replay_uploads x where x.status='cleanup';
 if exists(select 1 from private.frame_replay_uploads where frame_id=p_frame and status in ('reserved','committed'))
 then raise exception 'frame_upload_reserved' using errcode='55000'; end if;
 -- Budget the MAXIMUM object size per attempt, not the caller's claimed size.
 -- Pending cleanup remains charged until Storage absence is acknowledged.
 -- 2 simultaneous transfers, 8 retained slots/user, 40/group, 10 attempts/day.
 if (select count(*) from private.frame_replay_uploads where actor_id=uid and status='reserved')>=2
 or (select count(*) from private.frame_replay_uploads where actor_id=uid and status<>'cleaned')>=8
 or (select count(*) from private.frame_replay_uploads where actor_id=uid and created_at>clock_timestamp()-interval '24 hours')>=10
 or (select count(*) from private.frame_replay_uploads where group_id=f.group_id and status<>'cleaned')
 +(select count(*) from app.frame_replays r where r.group_id=f.group_id and not exists(
 select 1 from private.frame_replay_uploads x where x.storage_path=r.storage_path))>=40
 then raise exception 'replay_upload_quota_exceeded' using errcode='55000'; end if;
 insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,storage_path,source_provider,source_sha256)
 values(attempt,uid,p_operation,f.group_id,f.session_id,f.id,p_bytes,p_content_type,
 f.session_id::text||'/'||f.id::text||'/'||attempt::text||'.mp4',p_provider,p_sha256) returning * into u;
 return private.replay_upload_result(u);
end $$;
create function private.replay_recording_actor_eligible(p_upload uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.frame_replay_uploads u
 join app.frames f on f.id=u.frame_id and f.session_id=u.session_id and f.group_id=u.group_id
 join app.match_sessions s on s.id=f.session_id and s.group_id=f.group_id
 join app.groups g on g.id=u.group_id and g.status='active'
 join app.group_memberships m on m.group_id=u.group_id and m.user_id=u.actor_id and m.status='active'
 join private.player_account_links l on l.user_id=u.actor_id
 join app.frame_participants fp on fp.frame_id=f.id and fp.session_id=f.session_id and fp.group_id=f.group_id and fp.player_id=l.player_id
 where u.id=p_upload and u.status in ('reserved','committed') and f.status='completed' and f.detail_eligible and s.detail_eligible and s.status<>'abandoned'
 and (s.import_batch_id is null or exists(select 1 from private.import_batches b where b.id=s.import_batch_id and b.group_id=s.group_id and b.status='accepted')))
$$;

create function private.claim_frame_recording(p_provider text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.frame_replay_jobs; u private.frame_replay_uploads; token uuid:=gen_random_uuid();
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 -- Expired processing loses its lease and output, while retaining the source for explicit retry.
 for j in select * from private.frame_replay_jobs where state='processing' and upload_id in(select id from private.frame_replay_uploads where source_provider=p_provider) and lease_until<=clock_timestamp() loop
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,clock_timestamp());
 update private.frame_replay_jobs set state='failed',failure_code='lease_expired',lease_id=null,lease_until=null where upload_id=j.upload_id;
 end loop;
 select * into j from private.frame_replay_jobs where state='queued' and upload_id in(select id from private.frame_replay_uploads where source_provider=p_provider) and retain_until>clock_timestamp() and attempts<3
 and private.replay_processing_eligible(upload_id) order by uploaded_at for update skip locked limit 1;
 if not found then return null; end if;
 select * into u from private.frame_replay_uploads where id=j.upload_id;
 update private.frame_replay_jobs set state='processing',attempts=attempts+1,lease_id=token,lease_until=clock_timestamp()+interval '40 minutes',
 output_path=u.session_id::text||'/'||u.frame_id::text||'/'||token::text||'.mp4',failure_code=null where upload_id=u.id returning * into j;
 return jsonb_build_object('job_id',u.id,'lease_id',token,'source_provider',u.source_provider,'source_bucket',case when u.source_provider='r2' then 'pule-frame-recordings' else 'frame-recordings' end,'source_sha256',u.source_sha256,'source_etag',u.r2_etag,'source_key',u.storage_path,
 'expected_bytes',u.expected_bytes,'table_corners',j.corners,'source_width',j.source_width,'source_height',j.source_height,
 'destination_bucket','frame-replays','destination_key',j.output_path);
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
 from candidates c where q.bucket_id=c.bucket_id and q.storage_path=c.storage_path returning q.bucket_id,q.storage_path,q.lease_id,q.lease_until,q.upload_id)
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'storage_path',storage_path,'lease_id',lease_id,'lease_until',lease_until,'multipart_id',(select r2_multipart_id from private.frame_replay_uploads where id=leased.upload_id))),'[]'::jsonb) into answer from leased;
 return answer;
end $$;
create or replace function app.finish_frame_replay_cleanup(p_bucket text,p_path text,p_lease uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
declare q private.frame_replay_cleanup;
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into q from private.frame_replay_cleanup where bucket_id=p_bucket and storage_path=p_path and lease_id=p_lease and lease_until>clock_timestamp() for update;
 if not found or p_success is null then raise exception 'cleanup_lease_invalid' using errcode='55000'; end if;
 if exists(select 1 from app.frame_replays where p_bucket='frame-replays' and storage_path=p_path) then raise exception 'cleanup_object_still_registered' using errcode='55000'; end if;
 if p_success then
 if p_bucket<>'pule-frame-recordings' and exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then raise exception 'cleanup_object_still_present' using errcode='55000'; end if;
 update private.frame_replay_cleanup set completed_at=clock_timestamp(),lease_id=null,lease_until=null where bucket_id=p_bucket and storage_path=p_path;
 update private.frame_replay_uploads u set status='cleaned' where u.status='cleanup'
 and not exists(select 1 from storage.objects o where (o.bucket_id='frame-recordings' and o.name=u.storage_path)
 or (o.bucket_id='frame-replays' and o.name in(select output_path from private.frame_replay_jobs where upload_id=u.id)))
 and not exists(select 1 from app.frame_replays r join private.frame_replay_cleanup owned on owned.bucket_id='frame-replays' and owned.storage_path=r.storage_path where owned.upload_id=u.id)
 and not exists(select 1 from private.frame_replay_cleanup workitem where workitem.upload_id=u.id and workitem.completed_at is null)
 and not exists(select 1 from storage.objects o join private.frame_replay_cleanup workitem on workitem.bucket_id=o.bucket_id and workitem.storage_path=o.name where workitem.upload_id=u.id);
 else
 update private.frame_replay_cleanup set due_at=clock_timestamp()+interval '1 minute'*least(60,power(2,least(q.attempts,6))::integer),lease_id=null,lease_until=null where bucket_id=p_bucket and storage_path=p_path;
 end if;
end $$;

create or replace function app.reserve_frame_replay_upload(p_operation uuid,p_frame uuid,p_bytes bigint,p_content_type text default 'video/mp4') returns jsonb
language sql security definer set search_path='' as $$ select private.reserve_frame_recording(p_operation,p_frame,p_bytes,p_content_type,'supabase',null) $$;
create function app.reserve_r2_frame_recording(p_operation uuid,p_frame uuid,p_bytes bigint,p_sha256 text) returns jsonb
language sql security definer set search_path='' as $$ select private.reserve_frame_recording(p_operation,p_frame,p_bytes,'video/mp4','r2',p_sha256) $$;
create function app.get_r2_frame_recording(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u private.frame_replay_uploads;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid() and source_provider='r2';
 if not found or not private.replay_frame_eligible(u.frame_id) or u.status not in ('reserved','committed')
 or (u.status='reserved' and u.expires_at<=clock_timestamp()) then raise exception 'r2_recording_unavailable' using errcode='42501'; end if;
 return private.replay_job_result(u.id)||jsonb_build_object('multipart_id',u.r2_multipart_id,'source_sha256',u.source_sha256);
end $$;
create function app.bind_r2_frame_recording(p_upload uuid,p_actor uuid,p_multipart text) returns text
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads;
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=p_actor and source_provider='r2' for update;
 if not found or u.status<>'reserved' or u.expires_at<=clock_timestamp() or not private.replay_recording_actor_eligible(u.id)
 or p_multipart is null or length(p_multipart) not between 1 and 2048 then raise exception 'r2_recording_unavailable' using errcode='42501'; end if;
 update private.frame_replay_uploads set r2_multipart_id=coalesce(r2_multipart_id,p_multipart) where id=u.id returning r2_multipart_id into p_multipart;
 return p_multipart;
end $$;
-- Only the trusted broker may attest HEAD/list-parts evidence; browser reports are not evidence.
create function app.confirm_r2_frame_recording(p_upload uuid,p_actor uuid,p_bytes bigint,p_type text,p_sha256 text,p_etag text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and source_provider='r2' and actor_id=p_actor;
 if not found then raise exception 'r2_recording_unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||u.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where id=p_upload for update;
 if not private.replay_recording_actor_eligible(u.id) then raise exception 'r2_recording_unavailable' using errcode='42501'; end if;
 if u.status='committed' and exists(select 1 from private.frame_replay_jobs where upload_id=u.id) then return private.replay_job_result(u.id); end if;
 if u.status<>'reserved' or u.expires_at<=clock_timestamp() or u.r2_multipart_id is null or p_bytes is distinct from u.expected_bytes
 or p_type is distinct from 'video/mp4' or p_sha256 is distinct from u.source_sha256 or p_etag is null or length(p_etag) not between 1 and 128
 then raise exception 'r2_object_not_verified' using errcode='55000'; end if;
 if exists(select 1 from app.frame_replays where frame_id=u.frame_id) then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 insert into private.frame_replay_jobs(upload_id) values(u.id);
 update private.frame_replay_uploads set status='committed',committed_at=clock_timestamp(),r2_etag=p_etag where id=u.id;
 return private.replay_job_result(u.id);
end $$;
-- An R2 reservation must never open the legacy Supabase INSERT path.
do $$ declare d text; needle text:='if u.status<>''reserved'' or u.expires_at'; begin
 d:=pg_get_functiondef('app.can_upload_frame_replay(text,text,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r2_storage_fence_baseline_mismatch'; end if;
 execute replace(d,needle,'if u.source_provider<>''supabase'' or u.status<>''reserved'' or u.expires_at');
end $$;
-- Keep the old browser finalizer confined to actual legacy Storage objects.
do $$ declare d text; needle text:='if not found then raise exception ''replay_upload_denied'' using errcode=''42501''; end if;'; begin
 d:=pg_get_functiondef('app.finalize_frame_replay_upload(uuid)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r2_finalizer_baseline_mismatch'; end if;
 execute replace(d,needle,needle||' if u.source_provider<>''supabase'' then raise exception ''r2_requires_trusted_verification'' using errcode=''42501''; end if;');
end $$;
create or replace function app.claim_frame_replay_processing() returns jsonb language sql security definer set search_path='' as $$ select private.claim_frame_recording('supabase') $$;
create function app.claim_r2_frame_replay_processing() returns jsonb language sql security definer set search_path='' as $$ select private.claim_frame_recording('r2') $$;
revoke all on function private.reserve_frame_recording(uuid,uuid,bigint,text,text,text),private.replay_recording_actor_eligible(uuid),private.claim_frame_recording(text) from public,anon,authenticated,service_role;
revoke all on function app.reserve_r2_frame_recording(uuid,uuid,bigint,text),app.get_r2_frame_recording(uuid),app.bind_r2_frame_recording(uuid,uuid,text),app.confirm_r2_frame_recording(uuid,uuid,bigint,text,text,text),app.claim_r2_frame_replay_processing() from public,anon,authenticated,service_role;
grant execute on function app.reserve_r2_frame_recording(uuid,uuid,bigint,text),app.get_r2_frame_recording(uuid) to authenticated;
grant execute on function app.bind_r2_frame_recording(uuid,uuid,text),app.confirm_r2_frame_recording(uuid,uuid,bigint,text,text,text),app.claim_r2_frame_replay_processing() to service_role;
notify pgrst,'reload schema';
commit;
