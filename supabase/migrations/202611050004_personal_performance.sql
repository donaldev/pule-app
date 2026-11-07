-- Pending review: read-only personal result summaries, no counters or sporting writes.
begin;
create function app.get_my_performance() returns jsonb
language sql stable security definer set search_path='' as $$
 with identity as (select player_id from private.player_account_links where user_id=auth.uid()), eligible as (
 select s.* from app.match_sessions s
 where s.status='finalized' and s.result_quality='approved' and app.batch_visible(s.group_id,s.import_batch_id)
 and exists(select 1 from app.session_participants p join identity i on i.player_id=p.player_id where p.session_id=s.id)
 ), summaries as (
 select s.id,s.occurred_on,s.occurred_at,
 (select jsonb_agg(jsonb_build_object('player_id',sc.player_id,'name',gp.display_name,'frames_won',sc.frames_won) order by gp.player_id)
 from private.session_standings(s.id) sc join app.group_players gp on gp.group_id=s.group_id and gp.player_id=sc.player_id) participants
 from eligible s
 ) select jsonb_build_object('totals',app.get_my_player_stats(),'nights',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'date',occurred_on,'instant',occurred_at,'participants',participants)) from summaries),'[]'::jsonb))
$$;
revoke all on function app.get_my_performance() from public,anon,authenticated;
grant execute on function app.get_my_performance() to authenticated;
notify pgrst,'reload schema';
commit;
