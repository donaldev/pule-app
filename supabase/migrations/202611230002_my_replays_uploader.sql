begin;

create or replace function app.get_my_replays() returns jsonb
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
       and u.actor_id=auth.uid()
       and j.retain_until>now()
       and (j.state='queued' or (j.state='processing' and j.lease_until>now()))
   ) pending on true
   -- Only the job that published this exact object can establish its uploader.
   where f.status='completed' and (pending.state is not null or exists(
     select 1 from private.frame_replay_jobs j
     join private.frame_replay_uploads u on u.id=j.upload_id
     where j.output_path=r.storage_path and j.state='completed'
       and u.frame_id=f.id and u.actor_id=auth.uid()
   ))
 )
 select coalesce(jsonb_agg(to_jsonb(r)
   order by occurred_on desc nulls last, session_id, frame_number desc), '[]'::jsonb)
 from current_replays r
$$;

notify pgrst,'reload schema';
commit;
