-- Safe initial onboarding; no membership promotion, identity claim, or import endpoint.
begin;
alter table app.rule_versions add check(length(trim(label)) between 1 and 100);
alter table app.rule_versions add column validation_version integer not null default 1 check(validation_version=1);
create table private.setup_events (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 actor_id uuid not null references auth.users on delete restrict, operation_id uuid not null,
 action text not null, saved_result jsonb not null, committed_at timestamptz not null default now(),
 foreign key(actor_id,operation_id) references private.write_operations(actor_id,operation_id) deferrable initially deferred
);
alter table private.setup_events enable row level security;
revoke all on private.setup_events from public,anon,authenticated;
create trigger immutable_setup_events before update or delete on private.setup_events for each row execute function private.immutable_evidence();
create function private.setup_command(p_action text,p_operation uuid,p_group uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); gid uuid:=p_group; r text; answer jsonb; entity uuid;
 request jsonb:=jsonb_build_object('action',p_action,'group_id',p_group,'data',p_data);
 cached private.write_operations;
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 if p_action<>'create_group' then
 r:=private.require_role(gid);
 if r not in ('scorer','admin','owner') then raise exception 'setup_permission_required' using errcode='42501'; end if;
 if p_action='adopt_rule_version' and r not in ('admin','owner') then raise exception 'admin_permission_required' using errcode='42501'; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 if not app.is_member(cached.group_id) then raise exception 'group_access_denied' using errcode='42501'; end if;
 return cached.response;
 end if;
 if p_action='create_group' then
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_data->>'timezone') then
 raise exception 'invalid_group_timezone' using errcode='22023'; end if;
 insert into app.groups(name,timezone) values(trim(p_data->>'name'),p_data->>'timezone') returning id into gid;
 insert into app.group_memberships(group_id,user_id,role) values(gid,uid,'owner');
 answer:=jsonb_build_object('id',gid,'group_id',gid,'name',trim(p_data->>'name'),'role','owner');
 elsif p_action='create_guest' then
 insert into private.players(origin_group_id) values(gid) returning id into entity;
 insert into app.group_players(group_id,player_id,display_name) values(gid,entity,trim(p_data->>'name'));
 answer:=jsonb_build_object('id',entity,'group_id',gid,'display_name',trim(p_data->>'name'),'ownership_state','unclaimed');
 elsif p_action='create_venue' then
 insert into app.venues(group_id,display_name) values(gid,trim(p_data->>'name')) returning id into entity;
 answer:=jsonb_build_object('id',entity,'group_id',gid,'display_name',trim(p_data->>'name'));
 elsif p_action='adopt_rule_version' then
 if (p_data->>'confirmed')::boolean is distinct from true then raise exception 'explicit_rule_review_required' using errcode='22023'; end if;
 insert into app.rule_versions(group_id,label,rules_status,validation_version) values(gid,trim(p_data->>'name'),'verified',1) returning id into entity;
 answer:=jsonb_build_object('id',entity,'group_id',gid,'label',trim(p_data->>'name'),'validation_version',1,'breaker_policy','explicit_per_frame');
 else raise exception 'unsupported_setup_command' using errcode='22023'; end if;
 set constraints all immediate;
 set constraints all deferred;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,request,answer);
 insert into private.setup_events(group_id,actor_id,operation_id,action,saved_result) values(gid,uid,p_operation,p_action,answer);
 return answer;
end $$;
create function app.create_group(p_operation uuid,p_name text,p_timezone text) returns jsonb
language sql security definer set search_path='' as $$
 select private.setup_command('create_group',p_operation,null,jsonb_build_object('name',p_name,'timezone',p_timezone))
$$;
create function app.create_guest(p_operation uuid,p_group uuid,p_name text) returns jsonb
language sql security definer set search_path='' as $$
 select private.setup_command('create_guest',p_operation,p_group,jsonb_build_object('name',p_name))
$$;
create function app.create_venue(p_operation uuid,p_group uuid,p_name text) returns jsonb
language sql security definer set search_path='' as $$
 select private.setup_command('create_venue',p_operation,p_group,jsonb_build_object('name',p_name))
$$;
create function app.adopt_rule_version(p_operation uuid,p_group uuid,p_label text,p_confirm_review boolean) returns jsonb
language sql security definer set search_path='' as $$
 select private.setup_command('adopt_rule_version',p_operation,p_group,jsonb_build_object('name',p_label,'confirmed',p_confirm_review))
$$;
-- Membership SELECT must not expose other members' Auth UUIDs to ordinary viewers.
revoke select on app.group_memberships from authenticated;
create function app.get_my_memberships() returns table(group_id uuid,role text)
language sql stable security definer set search_path='' as $$
 select m.group_id,m.role from app.group_memberships m where m.user_id=auth.uid() and app.is_member(m.group_id)
$$;
-- Auth and recorder IDs are not part of ordinary match-history reads.
revoke select on app.match_sessions from authenticated;
grant select(id,group_id,venue_id,season_id,rule_version_id,status,origin,record_kind,result_authority,result_quality,
 sequence_quality,detail_eligible,occurred_on,occurred_at,timezone_snapshot,date_precision,started_at,finalized_at,
 revision,import_batch_id,legacy_match_id,created_at,initial_breaker_id) on app.match_sessions to authenticated;
-- Avoid accidental permissive grants for future tables/functions under the migration role.
alter default privileges in schema app revoke all on tables from public,anon,authenticated;
alter default privileges in schema private revoke all on tables from public,anon,authenticated;
alter default privileges in schema app revoke execute on functions from public,anon,authenticated;
alter default privileges in schema private revoke execute on functions from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function app.create_group(uuid,text,text),app.create_guest(uuid,uuid,text),app.create_venue(uuid,uuid,text),
 app.adopt_rule_version(uuid,uuid,text,boolean),app.get_my_memberships() from public,anon,authenticated;
grant execute on function app.create_group(uuid,text,text),app.create_guest(uuid,uuid,text),app.create_venue(uuid,uuid,text),
 app.adopt_rule_version(uuid,uuid,text,boolean),app.get_my_memberships() to authenticated;
notify pgrst,'reload schema';
commit;
