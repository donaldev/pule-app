-- Phase 2A backend. No existing replay/identity/history rows are rewritten.
begin;
-- Fail closed: operators configure limits through Storage settings before rollout.
do $$ begin
 if not exists(select 1 from storage.buckets where id='frame-replays' and public=false
 and file_size_limit between 1 and 262144000 and allowed_mime_types=array['video/mp4']::text[])
 then raise exception 'private_mp4_bucket_limit_required'; end if;
end $$;

-- Deliberately no parent FK: cleanup/recovery must survive match/account removal.
create table private.frame_replay_uploads (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null, operation_id uuid not null,
 group_id uuid not null, session_id uuid not null, frame_id uuid not null,
 expected_bytes bigint not null check(expected_bytes between 1 and 262144000),
 content_type text not null check(content_type='video/mp4'),
 storage_path text not null unique,
 status text not null default 'reserved' check(status in ('reserved','committed','cleanup','cleaned')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '6 hours',
 committed_at timestamptz,
 unique(actor_id,operation_id),
 check(expires_at>created_at and expires_at<=created_at+interval '6 hours 1 second'),
 check(storage_path=session_id::text||'/'||frame_id::text||'/'||id::text||'.mp4')
);
create unique index one_reserved_replay_per_frame on private.frame_replay_uploads(frame_id) where status='reserved';
create index replay_upload_actor_budget on private.frame_replay_uploads(actor_id,status,created_at);
create index replay_upload_group_budget on private.frame_replay_uploads(group_id,status);
create table private.frame_replay_cleanup (
 storage_path text primary key, due_at timestamptz not null,
 lease_id uuid, lease_until timestamptz, attempts integer not null default 0,
 completed_at timestamptz
);
create index replay_cleanup_due on private.frame_replay_cleanup(due_at) where completed_at is null;
alter table private.frame_replay_uploads enable row level security;
alter table private.frame_replay_cleanup enable row level security;
revoke all on private.frame_replay_uploads,private.frame_replay_cleanup from public,anon,authenticated,service_role;

-- One bounded, short control-plane lock serializes quota/reservation/finalization
-- decisions. Always acquire match-lifecycle first (same order as remove_match).
create function private.replay_frame_eligible(p_frame uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from app.frames f join app.match_sessions s on s.id=f.session_id and s.group_id=f.group_id
 join app.frame_participants fp on fp.frame_id=f.id and fp.group_id=f.group_id and fp.session_id=f.session_id
 join private.player_account_links l on l.player_id=fp.player_id and l.user_id=auth.uid()
 where f.id=p_frame and f.status='completed' and f.detail_eligible and s.detail_eligible
 and app.session_visible(f.group_id,f.session_id))
$$;
create function private.replay_upload_result(u private.frame_replay_uploads) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('upload_id',u.id,'frame_id',u.frame_id,'session_id',u.session_id,
 'storage_path',u.storage_path,'bucket','frame-replays','status',u.status,
 'expected_bytes',u.expected_bytes,'content_type',u.content_type,'expires_at',u.expires_at)
$$;

create function app.reserve_frame_replay_upload(p_operation uuid,p_frame uuid,p_bytes bigint,p_content_type text default 'video/mp4') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); f app.frames; u private.frame_replay_uploads; attempt uuid:=gen_random_uuid();
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 if p_frame is null or p_bytes is null or p_bytes not between 1 and 262144000 or p_content_type is distinct from 'video/mp4'
 then raise exception 'invalid_replay_upload' using errcode='22023'; end if;
 perform set_config('lock_timeout','5s',true);
 select * into f from app.frames where id=p_frame;
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||f.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 if not private.replay_frame_eligible(p_frame) then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 select * into u from private.frame_replay_uploads where actor_id=uid and operation_id=p_operation;
 if found then
 if u.frame_id<>p_frame or u.expected_bytes<>p_bytes or u.content_type<>p_content_type
 then raise exception 'replay_operation_payload_mismatch' using errcode='22023'; end if;
 return private.replay_upload_result(u); -- Never renew an expired capability on retry.
 end if;
 if exists(select 1 from app.frame_replays where frame_id=p_frame) then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 -- Expired slots become durable cleanup work, never reusable paths.
 update private.frame_replay_uploads set status='cleanup' where status='reserved' and expires_at<=clock_timestamp();
 insert into private.frame_replay_cleanup(storage_path,due_at)
 select storage_path,expires_at+interval '24 hours' from private.frame_replay_uploads where status='cleanup'
 on conflict(storage_path) do nothing;
 if exists(select 1 from private.frame_replay_uploads where frame_id=p_frame and status='reserved')
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
 insert into private.frame_replay_uploads(id,actor_id,operation_id,group_id,session_id,frame_id,expected_bytes,content_type,storage_path)
 values(attempt,uid,p_operation,f.group_id,f.session_id,f.id,p_bytes,p_content_type,
 f.session_id::text||'/'||f.id::text||'/'||attempt::text||'.mp4') returning * into u;
 return private.replay_upload_result(u);
end $$;

-- Called only in the exact-path INSERT policies. Recheck participation/membership
-- at object insertion, not just when a reservation was issued. Lock against
-- finalization, expiry and match removal through the Storage metadata transaction.
create function app.can_upload_frame_replay(p_path text,p_owner text,p_metadata jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; gid uuid;
begin
 if auth.uid() is null or p_owner is distinct from auth.uid()::text then return false; end if;
 select group_id into gid from private.frame_replay_uploads where storage_path=p_path and actor_id=auth.uid();
 if not found then return false; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||gid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where storage_path=p_path and actor_id=auth.uid();
 if u.status<>'reserved' or u.expires_at<=clock_timestamp() or not private.replay_frame_eligible(u.frame_id)
 or exists(select 1 from app.frame_replays where frame_id=u.frame_id) then return false; end if;
 -- Storage may initially insert null metadata. Finalization requires complete,
 -- server-maintained metadata. Never trust user_metadata or filename alone.
 if p_metadata->>'size' is not null and (p_metadata->>'size' is distinct from u.expected_bytes::text) then return false; end if;
 if p_metadata->>'mimetype' is not null and p_metadata->>'mimetype'<>'video/mp4' then return false; end if;
 return true;
end $$;
-- Retain the restrictive public fence, narrowing its exception to the actor's
-- exact attempt. A broad policy elsewhere cannot authorize other replay uploads.
drop policy frame_replays_no_insert on storage.objects;
create policy frame_replays_no_insert on storage.objects as restrictive for insert to public
 with check(bucket_id<>'frame-replays' or app.can_upload_frame_replay(name,owner_id,metadata));
create policy frame_replays_reserved_insert on storage.objects for insert to authenticated
 with check(bucket_id='frame-replays' and app.can_upload_frame_replay(name,owner_id,metadata));
-- No UPDATE/DELETE policy/grant changes. Upserts/replacements stay denied.

-- Preserve legacy canonical paths; the finalize RPC supplies immutable attempt paths.
alter table app.frame_replays drop constraint frame_replays_check;
alter table app.frame_replays add constraint frame_replays_path_check check(
 storage_path=session_id::text||'/'||frame_id::text||'.mp4'
 or storage_path ~ ('^'||session_id::text||'/'||frame_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$'));
create function app.finalize_frame_replay_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads; obj storage.objects; r app.frame_replays;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid();
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||u.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid() for update;
 if not private.replay_frame_eligible(u.frame_id) then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 select * into r from app.frame_replays where frame_id=u.frame_id;
 if u.status='committed' and r.storage_path=u.storage_path then return to_jsonb(r); end if;
 if r.frame_id is not null then raise exception 'frame_replay_exists' using errcode='55000'; end if;
 if u.status<>'reserved' or u.expires_at<=clock_timestamp() then raise exception 'replay_upload_expired' using errcode='55000'; end if;
 select * into obj from storage.objects where bucket_id='frame-replays' and name=u.storage_path for share;
 if not found or obj.owner_id is distinct from u.actor_id::text
 or obj.metadata->>'size' is distinct from u.expected_bytes::text
 or obj.metadata->>'mimetype' is distinct from 'video/mp4'
 then raise exception 'replay_object_not_verified' using errcode='55000'; end if;
 insert into app.frame_replays(frame_id,group_id,session_id,storage_path)
 values(u.frame_id,u.group_id,u.session_id,u.storage_path) returning * into r;
 update private.frame_replay_uploads set status='committed',committed_at=clock_timestamp() where id=u.id;
 return to_jsonb(r);
end $$;
create function app.get_my_frame_replay_upload(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u private.frame_replay_uploads;
begin
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=auth.uid();
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 return private.replay_upload_result(u);
end $$;

-- Queue both Phase 1 and Phase 2 objects on replay removal. Upload ledger and
-- queue deliberately survive parent deletion. Never DELETE storage.objects here.
create function private.queue_removed_replay() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 update private.frame_replay_uploads set status='cleanup' where storage_path=old.storage_path and status<>'cleaned';
 insert into private.frame_replay_cleanup(storage_path,due_at)
 values(old.storage_path,coalesce((select expires_at+interval '24 hours' from private.frame_replay_uploads where storage_path=old.storage_path),clock_timestamp()))
 on conflict(storage_path) do nothing;
 return old;
end $$;
create trigger replay_storage_cleanup after delete on app.frame_replays for each row execute function private.queue_removed_replay();
create function private.queue_removed_frame_uploads() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 update private.frame_replay_uploads set status='cleanup' where frame_id=old.id and status='reserved';
 insert into private.frame_replay_cleanup(storage_path,due_at)
 select storage_path,expires_at+interval '24 hours' from private.frame_replay_uploads where frame_id=old.id and status='cleanup'
 on conflict(storage_path) do nothing;
 return old;
end $$;
create trigger replay_upload_frame_cleanup before delete on app.frames for each row execute function private.queue_removed_frame_uploads();

-- Worker API: only service_role may lease exact paths, delete via Storage API,
-- then acknowledge absence. Lease tokens prevent stale workers completing new work.
create function app.claim_frame_replay_cleanup(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_cleanup_limit' using errcode='22023'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 update private.frame_replay_uploads set status='cleanup' where status='reserved' and expires_at<=clock_timestamp();
 insert into private.frame_replay_cleanup(storage_path,due_at)
 select storage_path,expires_at+interval '24 hours' from private.frame_replay_uploads where status='cleanup'
 on conflict(storage_path) do nothing;
 -- Keep tombstones: late objects revive cleanup, never revive playback metadata.
 update private.frame_replay_cleanup q set completed_at=null,due_at=clock_timestamp(),lease_id=null,lease_until=null
 where q.completed_at is not null and exists(select 1 from storage.objects o where o.bucket_id='frame-replays' and o.name=q.storage_path)
 and not exists(select 1 from app.frame_replays r where r.storage_path=q.storage_path);
 update private.frame_replay_uploads u set status='cleanup' where u.status='cleaned'
 and exists(select 1 from private.frame_replay_cleanup q where q.storage_path=u.storage_path and q.completed_at is null);
 with candidates as (
 select q.storage_path from private.frame_replay_cleanup q
 where q.completed_at is null and q.due_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
 and not exists(select 1 from app.frame_replays r where r.storage_path=q.storage_path)
 order by q.due_at,q.storage_path for update skip locked limit p_limit
 ), leased as (
 update private.frame_replay_cleanup q set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=q.attempts+1
 from candidates c where q.storage_path=c.storage_path returning q.storage_path,q.lease_id,q.lease_until)
 select coalesce(jsonb_agg(jsonb_build_object('bucket','frame-replays','storage_path',storage_path,'lease_id',lease_id,'lease_until',lease_until)),'[]'::jsonb) into answer from leased;
 return answer;
end $$;
create function app.finish_frame_replay_cleanup(p_path text,p_lease uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
declare q private.frame_replay_cleanup;
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into q from private.frame_replay_cleanup where storage_path=p_path and lease_id=p_lease and lease_until>clock_timestamp() for update;
 if not found or p_success is null then raise exception 'cleanup_lease_invalid' using errcode='55000'; end if;
 if exists(select 1 from app.frame_replays where storage_path=p_path) then raise exception 'cleanup_object_still_registered' using errcode='55000'; end if;
 if p_success then
 if exists(select 1 from storage.objects where bucket_id='frame-replays' and name=p_path) then raise exception 'cleanup_object_still_present' using errcode='55000'; end if;
 update private.frame_replay_cleanup set completed_at=clock_timestamp(),lease_id=null,lease_until=null where storage_path=p_path;
 update private.frame_replay_uploads set status='cleaned' where storage_path=p_path and status='cleanup';
 else
 update private.frame_replay_cleanup set due_at=clock_timestamp()+interval '1 minute'*least(60,power(2,least(q.attempts,6))::integer),lease_id=null,lease_until=null where storage_path=p_path;
 end if;
end $$;
revoke all on function private.replay_frame_eligible(uuid),private.replay_upload_result(private.frame_replay_uploads),private.queue_removed_replay(),private.queue_removed_frame_uploads() from public,anon,authenticated,service_role;
revoke all on function app.reserve_frame_replay_upload(uuid,uuid,bigint,text),app.can_upload_frame_replay(text,text,jsonb),app.finalize_frame_replay_upload(uuid),app.get_my_frame_replay_upload(uuid),app.claim_frame_replay_cleanup(integer),app.finish_frame_replay_cleanup(text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app.reserve_frame_replay_upload(uuid,uuid,bigint,text),app.can_upload_frame_replay(text,text,jsonb),app.finalize_frame_replay_upload(uuid),app.get_my_frame_replay_upload(uuid) to authenticated;
-- PUBLIC INSERT fence must remain callable for anon but always returns false there.
grant execute on function app.can_upload_frame_replay(text,text,jsonb) to anon;
grant usage on schema app to service_role;
grant execute on function app.claim_frame_replay_cleanup(integer),app.finish_frame_replay_cleanup(text,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
