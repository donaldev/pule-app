-- Local proposal only: explicit, owner/admin, single-match permanent removal.
begin;
create table private.match_removals (
 session_id uuid primary key, group_id uuid not null references app.groups on delete restrict,
 actor_id uuid not null references auth.users on delete restrict, operation_id uuid not null,
 mode text not null check(mode in ('abandon','delete')), expected_revision bigint not null,
 removed_at timestamptz not null default clock_timestamp(), unique(actor_id,operation_id)
);
create table private.purged_match_operations (
 actor_id uuid not null, operation_id uuid not null, session_id uuid not null references private.match_removals(session_id),
 primary key(actor_id,operation_id)
);
alter table private.purged_match_operations enable row level security;
revoke all on private.purged_match_operations from public,anon,authenticated;
create table private.match_purge_scope (
 transaction_id bigint not null, table_name text not null, row_key text not null,
 primary key(transaction_id,table_name,row_key)
);
alter table private.match_removals enable row level security;
alter table private.match_purge_scope enable row level security;
revoke all on private.match_removals,private.match_purge_scope from public,anon,authenticated;
-- No GUC bypass or disabled triggers: only rows enrolled by the trusted command
-- in a client-inaccessible, transaction-scoped allowlist may be removed.
create or replace function private.immutable_evidence() returns trigger language plpgsql set search_path='' as $$
declare k text;
begin
 if tg_op='DELETE' then
 k:=case when tg_table_name='write_operations' then (to_jsonb(old)->>'actor_id')||'/'||(to_jsonb(old)->>'operation_id') else to_jsonb(old)->>'id' end;
 if exists(select 1 from private.match_purge_scope where transaction_id=txid_current() and table_name=tg_table_name and row_key=k) then return old; end if;
 end if;
 raise exception 'append_only_evidence' using errcode='55000';
end $$;
create trigger immutable_removal before update or delete on private.match_removals for each row execute function private.immutable_evidence();
create or replace function private.check_session_integrity() returns trigger language plpgsql set search_path='' as $$
declare s app.match_sessions; sid uuid; f app.frames;
begin
 if tg_table_name='match_sessions' then sid:=new.id; elsif tg_op='DELETE' then sid:=old.session_id; else sid:=new.session_id; end if;
 select * into s from app.match_sessions where id=sid;
 if not found then return null; end if;
 if (select count(*) from app.session_participants where session_id=sid)<2 then
 raise exception 'session_requires_at_least_two_participants' using errcode='23514'; end if;
 if s.record_kind='result_only' and exists(select 1 from app.frames where session_id=sid) then
 raise exception 'score_only_has_no_frames' using errcode='23514'; end if;
 if s.origin='native' and not exists(select 1 from app.rule_versions r where r.id=s.rule_version_id and r.rules_status='verified') then
 raise exception 'native_requires_verified_rules' using errcode='23514'; end if;
 if s.status='finalized' and s.origin='native' and (not exists(select 1 from app.frames where session_id=sid and status='completed')
 or exists(select 1 from app.frames where session_id=sid and status in ('running','paused'))) then
 raise exception 'invalid_native_finalization' using errcode='23514'; end if;
 if s.origin='imported' and s.status='finalized' and s.result_quality='approved' and
 (select count(*) from app.legacy_session_results where session_id=sid)<>(select count(*) from app.session_participants where session_id=sid) then
 raise exception 'approved_import_requires_reported_results' using errcode='23514'; end if;
 for f in select * from app.frames where session_id=sid loop
 if f.origin<>s.origin or (select count(*) from app.frame_participants where frame_id=f.id)<>2 then
 raise exception 'invalid_frame_pair_or_origin' using errcode='23514'; end if;
 if f.origin='native' and exists(select 1 from app.frame_participants where frame_id=f.id and foul_count is null) then
 raise exception 'native_requires_foul_counts' using errcode='23514'; end if;
 if f.origin='native' and f.status='completed' and (
 (f.special_event='super_foul' and (f.offender_id is null or f.offender_id=f.winner_id)) or
 (f.special_event<>'super_foul' and f.offender_id is not null) or
 (f.special_event in ('golden_break','break_and_run') and (f.winner_id<>f.breaker_id or not f.potted_on_break))) then
 raise exception 'invalid_special_event' using errcode='23514'; end if;
 end loop;
 return null;
end $$;

create function app.remove_match(p_operation uuid,p_session uuid,p_expected_revision bigint,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); s app.match_sessions; d private.match_removals; gid uuid; r text;
 records uuid[]; ops uuid[]; answer jsonb; cached private.write_operations;
 removal_request jsonb:=jsonb_build_object('action','remove_match','group_id',null,'data',jsonb_build_object('session_id',p_session,'expected_revision',p_expected_revision,'mode',p_mode));
begin
 if uid is null or p_operation is null or p_session is null or p_expected_revision is null or p_mode is null or p_mode not in ('abandon','delete') then raise exception 'removal_request_invalid' using errcode='22023'; end if;
 perform set_config('lock_timeout','5s',true);
 select group_id into gid from app.match_sessions where id=p_session;
 if gid is null then select group_id into gid from private.match_removals where session_id=p_session; end if;
 if gid is null then raise exception 'match_unavailable' using errcode='42501'; end if;
 if private.require_role(gid) not in ('owner','admin') then raise exception 'match_removal_requires_owner_or_admin' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('match-lifecycle/'||gid::text,0));
 perform pg_advisory_xact_lock(hashtextextended(uid::text||'/'||p_operation::text,0));
 perform pg_advisory_xact_lock(hashtextextended('remove-match/'||p_session::text,0));
 select * into s from app.match_sessions where id=p_session for update;
 select * into d from private.match_removals where session_id=p_session;
 gid:=coalesce(s.group_id,d.group_id);
 if gid is null then raise exception 'match_unavailable' using errcode='42501'; end if;
 r:=private.require_role(gid);
 if r not in ('owner','admin') then raise exception 'match_removal_requires_owner_or_admin' using errcode='42501'; end if;
 perform 1 from app.group_memberships where group_id=gid and user_id=uid and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'match_unavailable' using errcode='42501'; end if;
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>removal_request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 return cached.response;
 end if;
 if d.session_id is not null then
 if d.mode<>p_mode or d.expected_revision<>p_expected_revision then raise exception 'session_revision_conflict' using errcode='40001'; end if;
 answer:=jsonb_build_object('id',p_session,'group_id',gid,'removed',true,'mode',d.mode);
 else
 if s.revision<>p_expected_revision then raise exception 'session_revision_conflict' using errcode='40001'; end if;
 if (p_mode='delete' and s.status<>'finalized') or (p_mode='abandon' and s.status<>'active') then raise exception 'match_status_changed' using errcode='55000'; end if;
 -- Save only IDs/actor/time, never names, emails, scores or source payloads.
 insert into private.match_removals(session_id,group_id,actor_id,operation_id,mode,expected_revision) values(p_session,gid,uid,p_operation,p_mode,p_expected_revision);
 select array_agg(ir.id) into records from private.import_records ir where ir.id in (
 select source_record_id from private.legacy_frame_observations where session_id=p_session
 union select source_record_id from app.legacy_session_results where session_id=p_session
 union select source_record_id from app.frames where session_id=p_session)
 and not exists(select 1 from app.legacy_session_results x where x.source_record_id=ir.id and x.session_id<>p_session)
 and not exists(select 1 from app.frames x where x.source_record_id=ir.id and x.session_id<>p_session)
 and not exists(select 1 from private.legacy_frame_observations x where x.source_record_id=ir.id and x.session_id<>p_session);
 insert into private.purged_match_operations(actor_id,operation_id,session_id)
 select actor_id,operation_id,p_session from private.write_operations where group_id=gid and (request->>'session_id'=p_session::text or response#>>'{session,id}'=p_session::text);
 select array_agg(operation_id) into ops from private.write_operations where group_id=gid and (request->>'session_id'=p_session::text or response#>>'{session,id}'=p_session::text);
 insert into private.match_purge_scope
 select txid_current(),'match_events',id::text from private.match_events where session_id=p_session
 union all select txid_current(),'legacy_frame_observations',id::text from private.legacy_frame_observations where session_id=p_session
 union all select txid_current(),'frame_observation_resolutions',id::text from private.frame_observation_resolutions where observation_id in(select id from private.legacy_frame_observations where session_id=p_session)
 union all select txid_current(),'import_records',id::text from private.import_records where id=any(records)
 union all select txid_current(),'write_operations',actor_id::text||'/'||operation_id::text from private.write_operations where group_id=gid and (request->>'session_id'=p_session::text or response#>>'{session,id}'=p_session::text);
 delete from private.frame_observation_resolutions where observation_id in(select id from private.legacy_frame_observations where session_id=p_session);
 delete from private.legacy_frame_observations where session_id=p_session;
 delete from private.legacy_entity_links where session_id=p_session or frame_id in(select id from app.frames where session_id=p_session);
 delete from private.match_events where session_id=p_session;
 delete from private.write_operations where group_id=gid and (request->>'session_id'=p_session::text or response#>>'{session,id}'=p_session::text);
 delete from app.frame_participants where session_id=p_session;
 delete from app.legacy_session_results where session_id=p_session;
 delete from app.frames where session_id=p_session;
 delete from app.session_participants where session_id=p_session;
 delete from app.match_sessions where id=p_session;
 delete from private.import_records where id=any(records);
 delete from private.match_purge_scope where transaction_id=txid_current();
 answer:=jsonb_build_object('id',p_session,'group_id',gid,'removed',true,'mode',p_mode);
 end if;
 set constraints all immediate;
 set constraints all deferred;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,removal_request,answer);
 return answer;
end $$;
create or replace function private.scoring_command(p_action text,p_operation uuid,p_session uuid,p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); gid uuid; r text; s app.match_sessions; f app.frames;
 sid uuid:=p_session; fid uuid; players uuid[]; prior jsonb; answer jsonb;
 request jsonb:=jsonb_build_object('action',p_action,'session_id',p_session,'expected_revision',p_revision,'data',p_data);
 cached private.write_operations; instant timestamptz; reason text;
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 -- Keep the existing function OID so already-connected clients also honor removal.
 if p_action='start_session' then gid:=(p_data->>'group_id')::uuid;
 else select group_id into gid from app.match_sessions where id=p_session; end if;
 if gid is not null then perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||gid::text,0)); end if;
 if exists(select 1 from private.purged_match_operations where actor_id=uid and operation_id=p_operation) then raise exception 'match_permanently_removed' using errcode='55000'; end if;
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
 if cardinality(players)<2 or players is null or array_position(players,null) is not null or (select count(distinct x) from unnest(players) x)<>cardinality(players) then
 raise exception 'at_least_two_distinct_players_required' using errcode='22023'; end if;
 if (select count(*) from app.group_players where group_id=gid and player_id=any(players) and status='active')<>cardinality(players) then
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
 insert into app.session_participants(group_id,session_id,player_id,side) select gid,sid,p,ord::integer from unnest(players) with ordinality as roster(p,ord);
 elsif p_action='start_frame' then
 select array_agg(value::uuid order by ordinality) into players from jsonb_array_elements_text(p_data->'players') with ordinality;
 if players is null or cardinality(players)<>2 or players[1] is null or players[2] is null or players[1]=players[2] then
 raise exception 'frame_requires_two_distinct_players' using errcode='22023'; end if;
 if (select count(*) from app.session_participants where session_id=sid and player_id=any(players))<>2 then
 raise exception 'frame_players_must_be_in_session' using errcode='23514'; end if;
 if exists(select 1 from app.frames where session_id=sid and status in ('running','paused')) then
 raise exception 'frame_already_active' using errcode='55000'; end if;
 if p_data->>'breaker_id' is null or not ((p_data->>'breaker_id')::uuid=any(players)) then
 raise exception 'breaker_must_participate' using errcode='23514'; end if;
 instant:=clock_timestamp();
 insert into app.frames(group_id,session_id,frame_number,status,origin,breaker_id,elapsed_ms,running_since,started_at,duration_quality)
 select gid,sid,coalesce(max(frame_number),0)+1,'running','native',(p_data->>'breaker_id')::uuid,0,instant,instant,'server_measured'
 from app.frames where session_id=sid returning id into fid;
 insert into app.frame_participants(group_id,session_id,frame_id,player_id,side,foul_count)
 select gid,sid,fid,p,ord::smallint,0 from unnest(players) with ordinality as pair(p,ord);
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

revoke all on function private.scoring_command(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
create function app.get_match_removal(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d private.match_removals;
begin
 select * into d from private.match_removals where session_id=p_session;
 if not found or private.require_role(d.group_id) not in ('owner','admin') then raise exception 'match_unavailable' using errcode='42501'; end if;
 return jsonb_build_object('id',d.session_id,'group_id',d.group_id,'removed',true,'mode',d.mode);
end $$;
revoke all on function app.remove_match(uuid,uuid,bigint,text),app.get_match_removal(uuid) from public,anon,authenticated;
grant execute on function app.remove_match(uuid,uuid,bigint,text),app.get_match_removal(uuid) to authenticated;
create or replace function app.lookup_operation_receipt(p_operation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); op private.write_operations; member_role text;
 action text; saved_session app.match_sessions; session_id uuid; saved_result jsonb;
begin
 if uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
 -- Actor restriction is applied before examining context. Unknown and inaccessible
 -- UUIDs have the same public response; an admin cannot inspect another actor's receipt.
 select * into op from private.write_operations where actor_id=uid and operation_id=p_operation;
 if not found then return jsonb_build_object('status','not_confirmed'); end if;
 select m.role into member_role from app.group_memberships m join app.groups g on g.id=m.group_id
 where m.group_id=op.group_id and m.user_id=uid and m.status='active' and g.status='active';
 if member_role is null or member_role not in ('scorer','admin','owner') then
 return jsonb_build_object('status','not_confirmed'); end if;
 action:=op.request->>'action';
 if action in ('start_session','start_frame','complete_frame','correct_frame','finalize_session','set_frame_paused') then
 session_id:=(op.response#>>'{session,id}')::uuid;
 select * into saved_session from app.match_sessions where id=session_id and group_id=op.group_id;
 if not found or saved_session.origin<>'native' or not app.session_visible(op.group_id,session_id)
 or (saved_session.scorer_user_id is distinct from uid and member_role not in ('admin','owner')) then
 return jsonb_build_object('status','not_confirmed'); end if;
 saved_result:=jsonb_build_object('kind','scoring','session_id',session_id,'revision',op.response#>'{session,revision}');
 elsif action='remove_match' then
 if member_role not in ('owner','admin') then return jsonb_build_object('status','not_confirmed'); end if;
 saved_result:=jsonb_build_object('kind','setup','entity_id',op.response->>'id');
 elsif action in ('create_group','create_guest','create_venue','adopt_rule_version','resolve_matchup','create_player_invitation','accept_player_invitation','revoke_player_invitation','claim_guest_email') then
 if action in ('create_group','adopt_rule_version') and member_role not in ('admin','owner') then
 return jsonb_build_object('status','not_confirmed'); end if;
 saved_result:=jsonb_build_object('kind','setup','entity_id',op.response->>'id');
 else return jsonb_build_object('status','not_confirmed'); end if;
 -- Exact own-request context is necessary to compare every original parameter.
 -- No raw response snapshot, tokens, other actors, or private table access is exposed.
 return jsonb_build_object('status','confirmed_committed','operation_id',op.operation_id,
 'actor_id',uid,'group_id',op.group_id,'command',op.request,
 'saved',saved_result,'committed_at',op.committed_at);
end $$;

notify pgrst,'reload schema';
commit;
