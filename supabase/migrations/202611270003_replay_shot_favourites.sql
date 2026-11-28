begin;

create table private.frame_replay_shot_favourites (
 actor_id uuid not null references auth.users(id) on delete cascade,
 frame_id uuid not null references app.frames(id) on delete cascade,
 source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
 candidate_key text not null check (candidate_key ~ '^[0-9]{1,8}:[0-9]{1,8}$'),
 primary key(actor_id,frame_id,source_sha256,candidate_key)
);
alter table private.frame_replay_shot_favourites enable row level security;
revoke all on private.frame_replay_shot_favourites from public,anon,authenticated,service_role;

-- Only expose active candidates, the caller's favourites, and a count of
-- rejected candidates for review progress. Rejected identities stay private.
create function app.get_frame_replay_shot_workspace(p_frame uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'rejected_count',(
     select count(*) from private.frame_replay_shots s
     join private.frame_replay_shot_reviews r using(frame_id,source_sha256,candidate_key)
     where s.frame_id=p.frame_id and r.rejected
   ),
   'shots',coalesce((
     select jsonb_agg(item || jsonb_build_object('favourite', f.actor_id is not null) order by ordinal)
     from jsonb_array_elements(app.list_frame_replay_shots(p.frame_id)) with ordinality as entries(item,ordinal)
     join private.frame_replay_shots s on s.frame_id=p.frame_id and s.candidate_key=item->>'candidate_key'
     left join private.frame_replay_shot_favourites f
       on f.actor_id=auth.uid() and f.frame_id=s.frame_id and f.source_sha256=s.source_sha256 and f.candidate_key=s.candidate_key
   ),'[]'::jsonb)
 )
 from app.frame_replays p where p.frame_id=p_frame
 and auth.uid() is not null and app.session_visible(p.group_id,p.session_id)
$$;

create function app.set_frame_replay_shot_favourite(
 p_frame uuid,p_path text,p_candidate text,p_favourite boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner_group uuid; source_hash text;
begin
 select group_id into owner_group from app.frame_replays where frame_id=p_frame and storage_path=p_path;
 if actor is null or owner_group is null or p_favourite is null then
   raise exception 'replay_shot_favourite_denied' using errcode='42501';
 end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||owner_group::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select s.source_sha256 into source_hash
 from app.frame_replays p join private.frame_replay_shots s using(frame_id)
 left join private.frame_replay_shot_reviews r using(frame_id,source_sha256,candidate_key)
 where p.frame_id=p_frame and p.storage_path=p_path and s.candidate_key=p_candidate
 and app.session_visible(p.group_id,p.session_id)
 and (s.confidence='high' or coalesce(r.accepted,false)) and not coalesce(r.rejected,false);
 if not found then raise exception 'replay_shot_favourite_denied' using errcode='42501'; end if;
 if p_favourite then
   insert into private.frame_replay_shot_favourites values(actor,p_frame,source_hash,p_candidate) on conflict do nothing;
 else
   delete from private.frame_replay_shot_favourites
   where actor_id=actor and frame_id=p_frame and source_sha256=source_hash and candidate_key=p_candidate;
 end if;
 return p_favourite;
end $$;

revoke all on function app.get_frame_replay_shot_workspace(uuid),
 app.set_frame_replay_shot_favourite(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function app.get_frame_replay_shot_workspace(uuid),
 app.set_frame_replay_shot_favourite(uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
