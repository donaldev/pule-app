begin;

create function app.get_my_replays() returns jsonb
language sql stable security definer set search_path='' as $$
 with visible_matches as (
   select s.id, s.group_id, s.occurred_on, v.display_name as venue_name
   from private.player_account_links l
   join app.session_participants p on p.player_id=l.player_id
   join app.match_sessions s on (s.group_id,s.id)=(p.group_id,p.session_id)
   join app.venues v on (v.group_id,v.id)=(s.group_id,s.venue_id)
   where l.user_id=auth.uid() and app.session_visible(s.group_id,s.id)
 ), current_replays as (
   select m.id as session_id, m.venue_name, m.occurred_on,
     f.id as frame_id, f.frame_number,
     case when r.frame_id is not null then 'ready' else pending.state end as status,
     r.storage_path,
     r.frame_id is not null and private.replay_frame_eligible(f.id) as can_delete
   from visible_matches m
   join app.frames f on (f.group_id,f.session_id)=(m.group_id,m.id)
   left join app.frame_replays r on r.frame_id=f.id
   left join lateral (
     select j.state
     from private.frame_replay_uploads u
     join private.frame_replay_jobs j on j.upload_id=u.id
     where r.frame_id is null and u.frame_id=f.id and u.status='committed'
       and j.retain_until>now()
       and (j.state='queued' or (j.state='processing' and j.lease_until>now()))
   ) pending on true
   where f.status='completed' and (r.frame_id is not null or pending.state is not null)
 )
 select coalesce(jsonb_agg(to_jsonb(r)
   order by occurred_on desc nulls last, session_id, frame_number desc), '[]'::jsonb)
 from current_replays r
$$;
revoke all on function app.get_my_replays() from public,anon,authenticated,service_role;
grant execute on function app.get_my_replays() to authenticated;

-- Retired attempts retain their immutable paths, cleanup deadlines and quota charge.
-- Only a live attempt (or cleanup without a terminal job) occupies the frame slot.
create or replace function app.get_session_frame_recordings(p_session uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('frame_id',u.frame_id,
 'state',case when u.status='cleanup' then 'cleanup' when u.status='reserved' then 'uploading' else 'processing' end,
 'owned',u.actor_id=auth.uid(),
 'failed',coalesce(j.failure_code not in ('replay_removed'),false))), '[]'::jsonb)
 from (select distinct on (candidate.frame_id) candidate.* from private.frame_replay_uploads candidate
 where candidate.session_id=p_session and candidate.status in ('reserved','committed','cleanup')
 and not (candidate.status='cleanup' and exists(
   select 1 from private.frame_replay_jobs retired where retired.upload_id=candidate.id and retired.state='failed'))
 order by candidate.frame_id,case when candidate.status='cleanup' then 1 else 0 end,candidate.created_at desc) u
 left join private.frame_replay_jobs j on j.upload_id=u.id
 where private.replay_frame_eligible(u.frame_id)
 and not exists(select 1 from app.frame_replays r where r.frame_id=u.frame_id)
$$;

do $$ declare d text; needle text:='from private.frame_replay_uploads where frame_id=p_frame and status in (''reserved'',''committed'',''cleanup'')';
begin
 d:=pg_get_functiondef('private.reserve_frame_recording(uuid,uuid,bigint,text,text,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'reservation_baseline_mismatch'; end if;
 execute replace(d,needle,$predicate$from private.frame_replay_uploads candidate where candidate.frame_id=p_frame
 and (candidate.status in ('reserved','committed') or (candidate.status='cleanup' and not exists(
   select 1 from private.frame_replay_jobs retired where retired.upload_id=candidate.id and retired.state='failed')))$predicate$);
end $$;

notify pgrst,'reload schema';
commit;
