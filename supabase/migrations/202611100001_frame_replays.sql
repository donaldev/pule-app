-- Phase 1: dashboard-managed MP4s only; no client write commands.
begin;
create table app.frame_replays (
 frame_id uuid primary key, group_id uuid not null, session_id uuid not null,
 storage_path text not null unique,
 created_at timestamptz not null default now(),
 foreign key(group_id,session_id,frame_id) references app.frames(group_id,session_id,id) on delete cascade,
 check(storage_path=session_id::text||'/'||frame_id::text||'.mp4')
);
comment on table app.frame_replays is 'Private frame-replays bucket metadata. Frame deletion cascades metadata only, NOT Storage bytes. See docs/FRAME_REPLAYS.md for manual cleanup.';
create index frame_replays_session on app.frame_replays(group_id,session_id);
alter table app.frame_replays enable row level security;
revoke all on app.frame_replays from public,anon,authenticated;
grant select on app.frame_replays to authenticated;
create policy member_read on app.frame_replays for select to authenticated
 using(app.session_visible(group_id,session_id));

-- Privileged dashboard inserts must also target a completed frame. No scoring
-- triggers are changed; corrections retain the frame identity and replay.
create function private.check_replay_frame() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from app.frames where group_id=new.group_id and session_id=new.session_id
 and id=new.frame_id and status='completed' for share;
 if not found then raise exception 'replay_requires_completed_frame' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function private.check_replay_frame() from public,anon,authenticated;
create trigger replay_completed_frame before insert or update on app.frame_replays
 for each row execute function private.check_replay_frame();

-- Storage must already exist and be private. Fail closed rather than creating
-- a bucket or silently accepting a public one. No Storage metadata is mutated.
do $$ begin
 if not exists(select 1 from storage.buckets where id='frame-replays' and public=false) then
 raise exception 'private_frame_replays_bucket_required'; end if;
end $$;
-- The subquery runs as the caller, including frame_replays RLS. Exact registered
-- object identity is required: folder names or object ownership grant no access.
create policy frame_replays_read on storage.objects for select to authenticated
 using(bucket_id='frame-replays' and exists(
 select 1 from app.frame_replays r where r.storage_path=storage.objects.name
 and app.session_visible(r.group_id,r.session_id)));
-- Restrictive fences prevent other permissive Storage policies from widening
-- this bucket's access. Policies on unrelated buckets retain their behavior.
create policy frame_replays_read_fence on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'frame-replays' or exists(
 select 1 from app.frame_replays r where r.storage_path=storage.objects.name
 and app.session_visible(r.group_id,r.session_id)));
create policy frame_replays_anon_fence on storage.objects as restrictive for select to anon
 using(bucket_id<>'frame-replays');
create policy frame_replays_no_insert on storage.objects as restrictive for insert to public
 with check(bucket_id<>'frame-replays');
create policy frame_replays_no_update on storage.objects as restrictive for update to public
 using(bucket_id<>'frame-replays') with check(bucket_id<>'frame-replays');
create policy frame_replays_no_delete on storage.objects as restrictive for delete to public
 using(bucket_id<>'frame-replays');

-- Derive group identity from the actual frame. Fresh databases need not contain
-- this manually uploaded match; never fabricate a parent or overwrite metadata.
insert into app.frame_replays(group_id,session_id,frame_id,storage_path)
select group_id,session_id,id,'8926207a-9936-5762-a991-492b45ef7e50/366064c1-d7d3-5bf6-a17b-131fa5cf1fbb.mp4'
from app.frames where session_id='8926207a-9936-5762-a991-492b45ef7e50'
 and id='366064c1-d7d3-5bf6-a17b-131fa5cf1fbb' and status='completed'
on conflict(frame_id) do nothing;
notify pgrst,'reload schema';
commit;
