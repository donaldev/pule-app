-- Pending review: caller-only recorded-frame summaries, no sporting writes.
begin;
create function app.get_my_frame_summary(p_opponent uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 with identity as (select player_id from private.player_account_links where user_id=auth.uid()), eligible as (
 select s.* from app.match_sessions s
 where s.status='finalized' and s.result_quality='approved' and app.batch_visible(s.group_id,s.import_batch_id)
 and exists(select 1 from app.session_participants p join identity i on i.player_id=p.player_id where p.session_id=s.id)
 and (p_opponent is null or (p_opponent<>(select player_id from identity)
 and (select count(*) from app.session_participants p where p.session_id=s.id)=2
 and exists(select 1 from app.session_participants p where p.session_id=s.id and p.player_id=p_opponent)))
 ) select jsonb_build_object('player_id',(select player_id from identity),'nights',coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.id,'date',s.occurred_on,'sequence_quality',s.sequence_quality,'detail_eligible',s.detail_eligible,
 'recorded_frame_count',(select count(*) from app.frames f where f.session_id=s.id),
 'frames',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'number',f.frame_number,'winner',f.winner_id,
 'breaker',f.breaker_id,'break_pot',f.potted_on_break,'event',f.special_event,'pocket',f.black_pocket_code,
 'elapsed_ms',f.elapsed_ms,'duration_quality',f.duration_quality,
 'players',(select jsonb_agg(jsonb_build_object('id',p.player_id,'fouls',p.foul_count) order by p.side) from app.frame_participants p where p.frame_id=f.id)) order by f.frame_number)
 from app.frames f where f.session_id=s.id and f.status='completed' and s.detail_eligible and f.detail_eligible),'[]'::jsonb)) order by s.occurred_on,s.id) from eligible s),'[]'::jsonb))
$$;
revoke all on function app.get_my_frame_summary(uuid) from public,anon,authenticated;
grant execute on function app.get_my_frame_summary(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
