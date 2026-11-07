begin;
alter table app.match_sessions add column initial_breaker_id uuid;
alter table app.match_sessions add check(origin<>'native' or initial_breaker_id is not null);
alter table app.match_sessions add constraint initial_breaker_participates foreign key(group_id,id,initial_breaker_id)
 references app.session_participants(group_id,session_id,player_id) deferrable initially deferred;

create function private.require_role(p_group uuid) returns text language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
 select m.role into r from app.group_memberships m join app.groups g on g.id=m.group_id
 where m.group_id=p_group and m.user_id=auth.uid() and m.status='active' and g.status='active'
 for share of m,g;
 if r is null then raise exception 'group_access_denied' using errcode='42501'; end if;
 return r;
end $$;

create function private.session_scores(p_session uuid) returns table(player_id uuid,frames_won bigint)
language sql stable set search_path='' as $$
 select p.player_id,
 case when s.result_authority='approved_historical_reported' then r.reported_frames_won::bigint
 else (select count(*) from app.frames f where f.session_id=s.id and f.status='completed' and f.winner_id=p.player_id) end
 from app.match_sessions s join app.session_participants p on p.session_id=s.id
 left join app.legacy_session_results r on r.session_id=s.id and r.player_id=p.player_id
 where s.id=p_session
$$;
create function private.session_state(p_session uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'session',to_jsonb(s)-'scorer_user_id',
 'participants',coalesce((select jsonb_agg(jsonb_build_object('player_id',p.player_id,'side',p.side,'display_name',gp.display_name) order by p.side)
 from app.session_participants p join app.group_players gp on gp.group_id=p.group_id and gp.player_id=p.player_id where p.session_id=s.id),'[]'::jsonb),
 'scores',coalesce((select jsonb_object_agg(player_id::text,frames_won) from private.session_scores(s.id)),'{}'::jsonb),
 'frames',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('participants',
 (select jsonb_agg(jsonb_build_object('player_id',fp.player_id,'side',fp.side,'foul_count',fp.foul_count) order by fp.side) from app.frame_participants fp where fp.frame_id=f.id)) order by f.frame_number)
 from app.frames f where f.session_id=s.id),'[]'::jsonb),
 'corrections',coalesce((select jsonb_agg(jsonb_build_object('revision',e.revision,'reason',e.reason,'committed_at',e.committed_at) order by e.revision)
 from private.match_events e where e.session_id=s.id and e.action='correct_frame'),'[]'::jsonb))
 from app.match_sessions s where s.id=p_session
$$;
create function app.get_session_state(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.match_sessions;
begin
 select * into s from app.match_sessions where id=p_session;
 if not found or not app.session_visible(s.group_id,s.id) then raise exception 'session_access_denied' using errcode='42501'; end if;
 return private.session_state(p_session);
end $$;

-- Serializes all commands for a session, and independently serializes operation-key reuse.
-- Explicit wrapper functions below constrain the public operation contract.
create function private.scoring_command(p_action text,p_operation uuid,p_session uuid,p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); gid uuid; r text; s app.match_sessions; f app.frames;
 sid uuid:=p_session; fid uuid; players uuid[]; prior jsonb; answer jsonb;
 request jsonb:=jsonb_build_object('action',p_action,'session_id',p_session,'expected_revision',p_revision,'data',p_data);
 cached private.write_operations; instant timestamptz; reason text;
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 if p_action='start_session' then gid:=(p_data->>'group_id')::uuid;
 else
 select group_id into gid from app.match_sessions where id=sid;
 if gid is null then raise exception 'session_access_denied' using errcode='42501'; end if;
 end if;
 r:=private.require_role(gid);
 if r not in ('scorer','admin','owner') then raise exception 'scoring_permission_required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 if p_action<>'start_session' then
 select * into s from app.match_sessions where id=sid and group_id=gid for update;
 if s.scorer_user_id is distinct from uid and r not in ('admin','owner') then
 raise exception 'assigned_scorer_required' using errcode='42501'; end if;
 end if;
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request or cached.group_id<>gid then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 return cached.response;
 end if;
 if p_action<>'start_session' then
 if p_revision is null or p_revision<>s.revision then raise exception 'session_revision_conflict' using errcode='40001'; end if;
 if s.origin<>'native' then raise exception 'historical_amendment_requires_separate_review' using errcode='55000'; end if;
 if s.status<>'active' then raise exception 'session_not_active' using errcode='55000'; end if;
 prior:=private.session_state(sid);
 end if;
 if p_action='start_session' then
 select array_agg(value::uuid order by ordinality) into players from jsonb_array_elements_text(p_data->'players') with ordinality;
 if cardinality(players)<>2 or players[1]=players[2] or players[1] is null or players[2] is null then
 raise exception 'exactly_two_distinct_players_required' using errcode='22023'; end if;
 if (select count(*) from app.group_players where group_id=gid and player_id=any(players) and status='active')<>2 then
 raise exception 'players_not_available_in_group' using errcode='23514'; end if;
 if not ((p_data->>'breaker_id')::uuid=any(players)) or p_data->>'breaker_id' is null then
 raise exception 'initial_breaker_must_participate' using errcode='23514'; end if;
 if not exists(select 1 from app.rule_versions where group_id=gid and id=(p_data->>'rule_version_id')::uuid and rules_status='verified') then
 raise exception 'verified_rule_version_required' using errcode='23514'; end if;
 instant:=clock_timestamp();
 insert into app.match_sessions(group_id,venue_id,season_id,rule_version_id,origin,record_kind,result_authority,date_precision,
 occurred_on,occurred_at,timezone_snapshot,started_at,scorer_user_id,initial_breaker_id)
 select gid,(p_data->>'venue_id')::uuid,(p_data->>'season_id')::uuid,(p_data->>'rule_version_id')::uuid,'native','frame_log','native_frames','instant',
 (instant at time zone g.timezone)::date,instant,g.timezone,instant,uid,(p_data->>'breaker_id')::uuid from app.groups g where g.id=gid returning * into s;
 sid:=s.id;
 insert into app.session_participants(group_id,session_id,player_id,side) values(gid,sid,players[1],1),(gid,sid,players[2],2);
 elsif p_action='start_frame' then
 if exists(select 1 from app.frames where session_id=sid and status in ('running','paused')) then
 raise exception 'frame_already_active' using errcode='55000'; end if;
 if not exists(select 1 from app.session_participants where session_id=sid and player_id=(p_data->>'breaker_id')::uuid) then
 raise exception 'breaker_must_participate' using errcode='23514'; end if;
 instant:=clock_timestamp();
 insert into app.frames(group_id,session_id,frame_number,status,origin,breaker_id,elapsed_ms,running_since,started_at,duration_quality)
 select gid,sid,coalesce(max(frame_number),0)+1,'running','native',(p_data->>'breaker_id')::uuid,0,instant,instant,'server_measured'
 from app.frames where session_id=sid returning id into fid;
 insert into app.frame_participants(group_id,session_id,frame_id,player_id,side,foul_count)
 select gid,sid,fid,player_id,side,0 from app.session_participants where session_id=sid;
 elsif p_action in ('complete_frame','correct_frame','set_frame_paused') then
 select * into f from app.frames where id=(p_data->>'frame_id')::uuid and session_id=sid and group_id=gid for update;
 if not found then raise exception 'frame_not_in_session' using errcode='23514'; end if;
 if p_action='correct_frame' then
 if f.status<>'completed' then raise exception 'only_logged_frames_can_be_corrected' using errcode='55000'; end if;
 reason:=trim(p_data->>'reason');
 if reason is null or length(reason) not between 1 and 500 then raise exception 'correction_reason_required' using errcode='22023'; end if;
 elsif f.status not in ('running','paused') then raise exception 'frame_not_active' using errcode='55000'; end if;
 if p_action='set_frame_paused' then
 if p_data->>'paused' is null or (p_data->>'paused')::boolean=(f.status='paused') then raise exception 'invalid_pause_transition' using errcode='55000'; end if;
 instant:=clock_timestamp();
 update app.frames set elapsed_ms=elapsed_ms+case when status='running' then greatest(0,floor(extract(epoch from (instant-running_since))*1000)::bigint) else 0 end,
 running_since=case when (p_data->>'paused')::boolean then null else instant end,
 status=case when (p_data->>'paused')::boolean then 'paused' else 'running' end,revision=revision+1 where id=f.id;
 else
 if not exists(select 1 from app.frame_participants where frame_id=f.id and player_id=(p_data->>'winner_id')::uuid) then
 raise exception 'winner_must_participate' using errcode='23514'; end if;
 if (p_data->>'p1_fouls')::integer is null or (p_data->>'p2_fouls')::integer is null
 or (p_data->>'p1_fouls')::integer<0 or (p_data->>'p2_fouls')::integer<0 then
 raise exception 'nonnegative_foul_counts_required' using errcode='23514'; end if;
 update app.frame_participants set foul_count=case side when 1 then (p_data->>'p1_fouls')::integer else (p_data->>'p2_fouls')::integer end where frame_id=f.id;
 if p_action='correct_frame' then
 update app.frames set winner_id=(p_data->>'winner_id')::uuid,revision=revision+1 where id=f.id;
 else
 instant:=clock_timestamp();
 update app.frames set status='completed',winner_id=(p_data->>'winner_id')::uuid,
 potted_on_break=(p_data->>'potted_on_break')::boolean,black_pocket_code=p_data->>'black_pocket_code',
 special_event=p_data->>'special_event',offender_id=(p_data->>'offender_id')::uuid,
 elapsed_ms=elapsed_ms+case when status='running' then greatest(0,floor(extract(epoch from (instant-running_since))*1000)::bigint) else 0 end,
 running_since=null,completed_at=instant,revision=revision+1 where id=f.id;
 end if;
 end if;
 elsif p_action='finalize_session' then
 if exists(select 1 from app.frames where session_id=sid and status in ('running','paused')) or
 not exists(select 1 from app.frames where session_id=sid and status='completed') then
 raise exception 'finalization_requires_completed_frames_and_no_active_frame' using errcode='55000'; end if;
 update app.match_sessions set status='finalized',finalized_at=clock_timestamp() where id=sid;
 else raise exception 'unsupported_command' using errcode='22023'; end if;
 if p_action<>'start_session' then update app.match_sessions set revision=revision+1 where id=sid; end if;
 -- Validate deferred relational/native rules before recording a successful receipt.
 set constraints all immediate;
 set constraints all deferred;
 instant:=clock_timestamp();
 answer:=private.session_state(sid);
 if p_action='correct_frame' then
 answer:=jsonb_set(answer,'{corrections}',(answer->'corrections')||jsonb_build_array(jsonb_build_object(
 'revision',(answer#>>'{session,revision}')::bigint,'reason',reason,'committed_at',instant)));
 end if;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,request,answer);
 insert into private.match_events(group_id,session_id,revision,actor_id,operation_id,action,reason,before_state,after_state,committed_at)
 select gid,sid,revision,uid,p_operation,p_action,reason,prior,answer,instant from app.match_sessions where id=sid;
 return answer;
end $$;

create function app.start_session(p_operation uuid,p_group uuid,p_venue uuid,p_rule_version uuid,p_players uuid[],p_breaker uuid,p_season uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('start_session',p_operation,null,null,jsonb_build_object('group_id',p_group,'venue_id',p_venue,'rule_version_id',p_rule_version,'players',p_players,'breaker_id',p_breaker,'season_id',p_season))
$$;
create function app.start_frame(p_operation uuid,p_session uuid,p_expected_revision bigint,p_breaker uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('start_frame',p_operation,p_session,p_expected_revision,jsonb_build_object('breaker_id',p_breaker))
$$;
create function app.complete_frame(p_operation uuid,p_session uuid,p_expected_revision bigint,p_frame uuid,p_winner uuid,p_p1_fouls integer,p_p2_fouls integer,p_potted_on_break boolean,p_special text,p_pocket text default null,p_offender uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('complete_frame',p_operation,p_session,p_expected_revision,jsonb_build_object('frame_id',p_frame,'winner_id',p_winner,'p1_fouls',p_p1_fouls,'p2_fouls',p_p2_fouls,'potted_on_break',p_potted_on_break,'special_event',p_special,'black_pocket_code',p_pocket,'offender_id',p_offender))
$$;
create function app.correct_frame(p_operation uuid,p_session uuid,p_expected_revision bigint,p_frame uuid,p_winner uuid,p_p1_fouls integer,p_p2_fouls integer,p_reason text)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('correct_frame',p_operation,p_session,p_expected_revision,jsonb_build_object('frame_id',p_frame,'winner_id',p_winner,'p1_fouls',p_p1_fouls,'p2_fouls',p_p2_fouls,'reason',p_reason))
$$;
create function app.finalize_session(p_operation uuid,p_session uuid,p_expected_revision bigint)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('finalize_session',p_operation,p_session,p_expected_revision,'{}'::jsonb)
$$;
create function app.set_frame_paused(p_operation uuid,p_session uuid,p_expected_revision bigint,p_frame uuid,p_paused boolean)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('set_frame_paused',p_operation,p_session,p_expected_revision,jsonb_build_object('frame_id',p_frame,'paused',p_paused))
$$;
create function app.get_standings(p_group uuid,p_season uuid default null)
returns table(player_id uuid,display_name text,nights bigint,wins bigint,losses bigint,draws bigint,frames_won bigint)
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_role(p_group);
 return query
 with eligible as (
 select s.id from app.match_sessions s where s.group_id=p_group and s.status='finalized' and s.result_quality='approved'
 and (p_season is null or s.season_id=p_season) and app.batch_visible(s.group_id,s.import_batch_id)
 ), per_night as (
 select e.id,sc.player_id,sc.frames_won, max(sc.frames_won) over(partition by e.id) as best,
 min(sc.frames_won) over(partition by e.id) as worst
 from eligible e cross join lateral private.session_scores(e.id) sc
 )
 select n.player_id,gp.display_name,count(*),count(*) filter(where n.frames_won=n.best and n.best<>n.worst),
 count(*) filter(where n.frames_won<n.best),count(*) filter(where n.best=n.worst),sum(n.frames_won)::bigint
 from per_night n join app.group_players gp on gp.group_id=p_group and gp.player_id=n.player_id group by n.player_id,gp.display_name;
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on all functions in schema app from public,anon,authenticated;
grant execute on function app.is_member(uuid),app.batch_visible(uuid,uuid),app.session_visible(uuid,uuid),app.get_session_state(uuid),
 app.start_session(uuid,uuid,uuid,uuid,uuid[],uuid,uuid),app.start_frame(uuid,uuid,bigint,uuid),
 app.complete_frame(uuid,uuid,bigint,uuid,uuid,integer,integer,boolean,text,text,uuid),
 app.correct_frame(uuid,uuid,bigint,uuid,uuid,integer,integer,text),app.finalize_session(uuid,uuid,bigint),
 app.set_frame_paused(uuid,uuid,bigint,uuid,boolean),app.get_standings(uuid,uuid) to authenticated;
commit;
