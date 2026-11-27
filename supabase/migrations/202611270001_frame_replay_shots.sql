begin;

-- Candidate rows describe one published render. Review rows live as long as
-- the frame so deleting a replay does not delete its decisions.
create table private.frame_replay_shots (
 frame_id uuid not null references app.frame_replays(frame_id) on delete cascade,
 source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
 candidate_key text not null check (candidate_key ~ '^[0-9]{1,8}:[0-9]{1,8}$'),
 shot_number integer not null check (shot_number > 0),
 confidence text not null check (confidence in ('high','possible')),
 motion_start_ms integer not null,
 motion_end_ms integer not null,
 source_start_ms integer not null,
 source_end_ms integer not null,
 replay_start_ms integer not null,
 replay_end_ms integer not null,
 segment_source_start_ms integer not null,
 segment_source_end_ms integer not null,
 segment_replay_start_ms integer not null,
 segment_replay_end_ms integer not null,
 primary key (frame_id, source_sha256, candidate_key),
 unique (frame_id, shot_number),
 check (motion_start_ms >= 0 and motion_start_ms < motion_end_ms and motion_end_ms <= 7200000),
 check (0 <= segment_source_start_ms and segment_source_start_ms <= source_start_ms
        and source_start_ms < source_end_ms and source_end_ms <= segment_source_end_ms
        and segment_source_end_ms <= 7200000),
 check (0 <= segment_replay_start_ms and segment_replay_start_ms <= replay_start_ms
        and replay_start_ms < replay_end_ms and replay_end_ms <= segment_replay_end_ms
        and segment_replay_end_ms <= 7200000)
);

create table private.frame_replay_shot_reviews (
 frame_id uuid not null references app.frames(id) on delete cascade,
 source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
 candidate_key text not null check (candidate_key ~ '^[0-9]{1,8}:[0-9]{1,8}$'),
 accepted boolean not null default false,
 rejected boolean not null default false,
 edited_source_start_ms integer,
 edited_source_end_ms integer,
 revision integer not null default 1 check (revision > 0),
 primary key (frame_id, source_sha256, candidate_key),
 check ((edited_source_start_ms is null and edited_source_end_ms is null) or
        (edited_source_start_ms is not null and edited_source_end_ms is not null and
         edited_source_start_ms >= 0 and edited_source_start_ms < edited_source_end_ms
         and edited_source_end_ms <= 7200000))
);
revoke all on private.frame_replay_shots,private.frame_replay_shot_reviews from public,anon,authenticated,service_role;

create function app.complete_frame_replay_with_shots(
 p_upload uuid,p_lease uuid,p_bytes bigint,p_duration numeric,p_clips integer,p_source_sha256 text,p_shots jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare published jsonb; replay_frame uuid; expected_hash text;
begin
 if p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_shots) is distinct from 'array' then
   raise exception 'invalid_replay_shot_index' using errcode='22023';
 end if;
 if jsonb_array_length(p_shots) not between 1 and 10000 or octet_length(p_shots::text) > 6000000 then
   raise exception 'invalid_replay_shot_index' using errcode='22023';
 end if;
 -- Preserve existing locking, authorization, object verification and cleanup.
 -- Any invalid index rolls back publication and cleanup together.
 published := app.complete_frame_replay_processing(p_upload,p_lease,p_bytes,p_duration,p_clips);
 replay_frame := (published->>'frame_id')::uuid;
 select source_sha256 into expected_hash from private.frame_replay_uploads where id=p_upload;
 if expected_hash is not null and expected_hash <> p_source_sha256 then
   raise exception 'replay_shot_source_mismatch' using errcode='22023';
 end if;
 if exists(select 1 from private.frame_replay_shots where frame_id=replay_frame) then
   return published; -- An acknowledged or retried publication owns its original index.
 end if;
 insert into private.frame_replay_shots (
  frame_id,source_sha256,candidate_key,shot_number,confidence,motion_start_ms,motion_end_ms,
  source_start_ms,source_end_ms,replay_start_ms,replay_end_ms,
  segment_source_start_ms,segment_source_end_ms,segment_replay_start_ms,segment_replay_end_ms
 )
 select replay_frame,p_source_sha256,s.* from jsonb_to_recordset(p_shots) as s(
  candidate_key text,shot_number integer,confidence text,motion_start_ms integer,motion_end_ms integer,
  source_start_ms integer,source_end_ms integer,replay_start_ms integer,replay_end_ms integer,
  segment_source_start_ms integer,segment_source_end_ms integer,segment_replay_start_ms integer,segment_replay_end_ms integer
 ) where s.segment_replay_end_ms <= round(p_duration*1000);
 if (select count(*) from private.frame_replay_shots where frame_id=replay_frame) <> jsonb_array_length(p_shots) then
   raise exception 'invalid_replay_shot_timeline' using errcode='22023';
 end if;
 return published;
end $$;

-- Views, downloads, favourites and statistics should use the active list.
-- No payload is returned without the same visibility as the full replay.
create function app.list_frame_replay_shots(p_frame uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(
   (to_jsonb(s)-'source_sha256') || jsonb_build_object(
    'storage_path',p.storage_path,'accepted',coalesce(r.accepted,false),'revision',coalesce(r.revision,0),
    'edited_source_start_ms',r.edited_source_start_ms,'edited_source_end_ms',r.edited_source_end_ms,
    'edit_needs_review',r.edited_source_start_ms is not null and not bounds.usable,
    'effective_replay_start_ms',case when bounds.usable then greatest(s.segment_replay_start_ms,
      s.segment_replay_start_ms+r.edited_source_start_ms-s.segment_source_start_ms) else s.replay_start_ms end,
    'effective_replay_end_ms',case when bounds.usable then least(s.segment_replay_end_ms,
      s.segment_replay_start_ms+r.edited_source_end_ms-s.segment_source_start_ms) else s.replay_end_ms end
   ) order by s.shot_number),'[]'::jsonb)
 from app.frame_replays p
 join private.frame_replay_shots s using(frame_id)
 left join private.frame_replay_shot_reviews r using(frame_id,source_sha256,candidate_key)
 cross join lateral (select coalesce(
    r.edited_source_start_ms >= s.segment_source_start_ms and r.edited_source_end_ms <= s.segment_source_end_ms
    and s.segment_replay_start_ms+r.edited_source_start_ms-s.segment_source_start_ms < s.segment_replay_end_ms,
    false) as usable) bounds
 where p.frame_id=p_frame and auth.uid() is not null and app.session_visible(p.group_id,p.session_id)
 and not coalesce(r.rejected,false)
$$;

create function app.review_frame_replay_shot(
 p_frame uuid,p_path text,p_candidate text,p_revision integer,p_action text,
 p_start_ms integer default null,p_end_ms integer default null
) returns integer language plpgsql security definer set search_path='' as $$
declare s private.frame_replay_shots; r private.frame_replay_shot_reviews; owner_group uuid;
begin
 select group_id into owner_group from app.frame_replays where frame_id=p_frame and storage_path=p_path;
 if auth.uid() is null or not found then
   raise exception 'replay_shot_review_denied' using errcode='42501';
 end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||owner_group::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 if not private.replay_frame_eligible(p_frame) then
   raise exception 'replay_shot_review_denied' using errcode='42501';
 end if;
 select c.* into s from private.frame_replay_shots c join app.frame_replays p using(frame_id)
 where c.frame_id=p_frame and p.storage_path=p_path and c.candidate_key=p_candidate;
 if not found then raise exception 'replay_shot_unavailable' using errcode='55000'; end if;
 select * into r from private.frame_replay_shot_reviews
 where frame_id=p_frame and source_sha256=s.source_sha256 and candidate_key=p_candidate;
 if p_revision is distinct from coalesce(r.revision,0) then
   raise exception 'replay_shot_review_conflict' using errcode='40001';
 end if;
 if p_action is null or p_action not in ('accept','reject','restore','edit','reset_bounds')
    or (p_action <> 'edit' and (p_start_ms is not null or p_end_ms is not null))
    or (coalesce(r.rejected,false) and p_action not in ('restore','reject')) then
   raise exception 'invalid_replay_shot_review' using errcode='22023';
 end if;
 if p_action='edit' then
   if p_start_ms is null or p_end_ms is null or p_start_ms>=p_end_ms
      or p_start_ms<s.segment_source_start_ms or p_end_ms>s.segment_source_end_ms
      or s.segment_replay_start_ms+p_start_ms-s.segment_source_start_ms>=s.segment_replay_end_ms then
     raise exception 'replay_shot_edit_outside_retained_segment' using errcode='22023';
   end if;
   r.edited_source_start_ms:=p_start_ms;
   r.edited_source_end_ms:=p_end_ms;
 elsif p_action='reset_bounds' then
   r.edited_source_start_ms:=null;
   r.edited_source_end_ms:=null;
 elsif p_action='accept' then
   r.accepted:=true;
 elsif p_action='reject' then
   r.rejected:=true;
 elsif p_action='restore' then
   r.rejected:=false;
 end if;
 insert into private.frame_replay_shot_reviews as review values
 (p_frame,s.source_sha256,p_candidate,coalesce(r.accepted,false),coalesce(r.rejected,false),
  r.edited_source_start_ms,r.edited_source_end_ms,p_revision+1)
 on conflict(frame_id,source_sha256,candidate_key) do update set
  accepted=excluded.accepted,rejected=excluded.rejected,edited_source_start_ms=excluded.edited_source_start_ms,
  edited_source_end_ms=excluded.edited_source_end_ms,revision=excluded.revision;
 return p_revision+1;
end $$;

revoke all on function app.complete_frame_replay_with_shots(uuid,uuid,bigint,numeric,integer,text,jsonb),
 app.list_frame_replay_shots(uuid),app.review_frame_replay_shot(uuid,text,text,integer,text,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function app.complete_frame_replay_with_shots(uuid,uuid,bigint,numeric,integer,text,jsonb) to service_role;
grant execute on function app.list_frame_replay_shots(uuid),
 app.review_frame_replay_shot(uuid,text,text,integer,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
