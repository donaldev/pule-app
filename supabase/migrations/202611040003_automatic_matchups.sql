-- PROPOSED. Local verification only; separate hosted approval required.
begin;
create function private.canonical_players(ids uuid[]) returns uuid[] language sql immutable strict set search_path='' as $$
 select array_agg(distinct id order by id) from unnest(ids) id where id is not null
$$;
create table private.matchups (
 group_id uuid primary key references app.groups on delete restrict,
 player_ids uuid[] not null unique,
 check(cardinality(player_ids)>=2 and array_position(player_ids,null) is null
       and player_ids=private.canonical_players(player_ids))
);
create table private.matchup_players (
 group_id uuid not null references private.matchups on delete restrict,
 player_id uuid not null, primary key(group_id,player_id),
 foreign key(group_id,player_id) references app.group_players(group_id,player_id) on delete restrict
);
alter table private.matchups enable row level security;
alter table private.matchup_players enable row level security;
revoke all on private.matchups,private.matchup_players from public,anon,authenticated;
create trigger immutable_matchups before update or delete on private.matchups
 for each row execute function private.immutable_evidence();
create trigger immutable_matchup_players before update or delete on private.matchup_players
 for each row execute function private.immutable_evidence();
create function private.check_matchup_members() returns trigger language plpgsql set search_path='' as $$
declare gid uuid:=new.group_id; expected uuid[]; actual uuid[];
begin
 select player_ids into expected from private.matchups where group_id=gid;
 select array_agg(player_id order by player_id) into actual from private.matchup_players where group_id=gid;
 if expected is distinct from actual then raise exception 'matchup_members_mismatch' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger matchup_member_integrity after insert on private.matchups
 deferrable initially deferred for each row execute function private.check_matchup_members();
create constraint trigger matchup_player_integrity after insert on private.matchup_players
 deferrable initially deferred for each row execute function private.check_matchup_members();
-- A native night in a registered container must use its full registered participant set.
-- Rotating frame pairs remain governed by the existing scoring validation.
create function private.check_matchup_night() returns trigger language plpgsql set search_path='' as $$
declare sid uuid:=case when tg_op='DELETE' then old.session_id else new.session_id end; expected uuid[]; actual uuid[];
begin
 select m.player_ids into expected from private.matchups m join app.match_sessions s on s.group_id=m.group_id
 where s.id=sid and s.origin='native';
 if expected is not null then
 select array_agg(player_id order by player_id) into actual from app.session_participants where session_id=sid;
 if actual is distinct from expected then raise exception 'matchup_night_players_mismatch' using errcode='23514'; end if;
 end if;
 return null;
end $$;
create constraint trigger matchup_night_integrity after insert or update or delete on app.session_participants
 deferrable initially deferred for each row execute function private.check_matchup_night();
-- Bind the reviewed rivalry only; never infer global identity from names or change sporting data.
do $$
declare gid uuid:='383bd6df-9050-4d1c-b48f-d2a0f3349517';
 ids uuid[]:=private.canonical_players(array['acc51043-01a0-507d-8fdd-ae0729e9fe68','5c575a65-aa80-590a-843a-0dfc7d5c1d89']::uuid[]);
begin
 if exists(select 1 from app.groups where id=gid) then
 if not exists(select 1 from app.groups where id=gid and status='active')
 or (select count(*) from private.players where id=any(ids) and origin_group_id=gid)<>2
 or (select count(*) from app.group_players where group_id=gid and player_id=any(ids) and status='active')<>2
 or exists(select 1 from app.match_sessions s where s.group_id=gid and
   (select array_agg(p.player_id order by p.player_id) from app.session_participants p where p.session_id=s.id) is distinct from ids)
 then raise exception 'historical_matchup_binding_requires_review' using errcode='23514'; end if;
 insert into private.matchups values(gid,ids);
 insert into private.matchup_players select gid,unnest(ids);
 end if;
end $$;
create function app.get_my_matchups() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('player_id',(select player_id from private.player_account_links where user_id=auth.uid()),
 'matchups',coalesce((select jsonb_agg(jsonb_build_object('group_id',m.group_id,'player_ids',m.player_ids) order by m.group_id)
 from private.matchups m where app.is_member(m.group_id)),'[]'::jsonb)) where auth.uid() is not null
$$;
create function app.resolve_matchup(p_operation uuid,p_players uuid[],p_timezone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); ids uuid[]:=private.canonical_players(p_players); gid uuid; answer jsonb; cached private.write_operations; created boolean:=false;
 request jsonb:=jsonb_build_object('action','resolve_matchup','group_id',null,'data',jsonb_build_object('players',p_players,'timezone',p_timezone));
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 if coalesce(cardinality(ids),0)<2 or cardinality(ids)<>cardinality(p_players) or array_ndims(p_players)<>1 or array_position(p_players,null) is not null then
 raise exception 'distinct_players_required' using errcode='22023'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 if private.require_role(cached.group_id) not in ('scorer','admin','owner') then raise exception 'matchup_unavailable' using errcode='42501'; end if;
 return cached.response;
 end if;
 -- Each identity must already be visible through a context the caller may score in.
 -- Identity ownership is deliberately not inferred from membership or display names.
 if exists(select 1 from unnest(ids) p where not exists(
 select 1 from app.group_players gp join app.group_memberships mm on mm.group_id=gp.group_id join app.groups g on g.id=gp.group_id
 where gp.player_id=p and gp.status='active' and mm.user_id=uid and mm.status='active'
 and mm.role in ('owner','admin','scorer') and g.status='active')) then
 raise exception 'matchup_unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('matchup/'||ids::text,0));
 select group_id into gid from private.matchups where player_ids=ids;
 if found then
 if not app.is_member(gid) then raise exception 'matchup_unavailable' using errcode='42501'; end if;
 if private.require_role(gid) not in ('scorer','admin','owner') then raise exception 'matchup_unavailable' using errcode='42501'; end if;
 else
 created:=true;
 insert into app.groups(name,timezone) values('Pool matches',p_timezone) returning id into gid;
 insert into app.group_memberships(group_id,user_id,role) values(gid,uid,'owner');
 insert into app.group_players(group_id,player_id,display_name)
 select gid, player_id,display_name from (
 select distinct on(gp.player_id) gp.player_id,gp.display_name from app.group_players gp
 join app.group_memberships mm on mm.group_id=gp.group_id join app.groups g on g.id=gp.group_id
 where gp.player_id=any(ids) and gp.status='active' and mm.user_id=uid and mm.status='active'
 and mm.role in ('owner','admin','scorer') and g.status='active' order by gp.player_id,gp.group_id) names;
 if not exists(select 1 from app.rule_versions where group_id=gid and rules_status='verified' and validation_version=1)
 then raise exception 'standard_scoring_missing' using errcode='23514'; end if;
 insert into private.matchups values(gid,ids);
 insert into private.matchup_players select gid,unnest(ids);
 end if;
 answer:=jsonb_build_object('id',gid,'group_id',gid,'player_ids',ids,'matchup',true,'created',created);
 set constraints all immediate;
 set constraints all deferred;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,request,answer);
 insert into private.setup_events(group_id,actor_id,operation_id,action,saved_result) values(gid,uid,p_operation,'resolve_matchup',answer);
 return answer;
end $$;
revoke all on function private.canonical_players(uuid[]),private.check_matchup_members(),private.check_matchup_night() from public,anon,authenticated;
revoke all on function app.get_my_matchups(),app.resolve_matchup(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function app.get_my_matchups(),app.resolve_matchup(uuid,uuid[],text) to authenticated;
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
 elsif action in ('create_group','create_guest','create_venue','adopt_rule_version','resolve_matchup') then
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
