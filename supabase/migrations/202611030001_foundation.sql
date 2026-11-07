-- Pule foundation. Native commands only; historical import is deliberately not exposed.
begin;
create schema if not exists app;
create schema if not exists private;
revoke all on schema app, private from public, anon, authenticated;
grant usage on schema app to authenticated;
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create table app.groups (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 100),
 timezone text not null default 'UTC', status text not null default 'active' check(status in ('active','archived')),
 created_at timestamptz not null default now()
);
create table app.group_memberships (
 group_id uuid not null references app.groups on delete restrict,
 user_id uuid not null references auth.users on delete restrict,
 role text not null check(role in ('viewer','scorer','admin','owner')),
 status text not null default 'active' check(status in ('active','revoked')),
 primary key(group_id,user_id)
);
create unique index one_group_owner on app.group_memberships(group_id) where role='owner' and status='active';
create index memberships_user on app.group_memberships(user_id,status,group_id);
create table private.players (
 id uuid primary key default gen_random_uuid(), origin_group_id uuid not null references app.groups on delete restrict,
 identity_revision bigint not null default 1 check(identity_revision>0), created_at timestamptz not null default now()
);
-- No name-based claim API. Only an independently verified future linking workflow can write here.
create table private.player_account_links (
 player_id uuid primary key references private.players on delete restrict,
 user_id uuid not null unique references auth.users on delete restrict,
 verified_by uuid not null references auth.users on delete restrict,
 verification_reference text not null check(length(trim(verification_reference))>0), linked_at timestamptz not null default now()
);
create table app.group_players (
 group_id uuid not null references app.groups on delete restrict,
 player_id uuid not null references private.players on delete restrict,
 display_name text not null check(length(trim(display_name)) between 1 and 100),
 status text not null default 'active' check(status in ('active','archived')), primary key(group_id,player_id)
);
create index group_player_names on app.group_players(group_id,lower(display_name));
create table app.venues (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 display_name text not null check(length(trim(display_name)) between 1 and 160), unique(group_id,id)
);
create table app.seasons (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 name text not null check(length(trim(name)) between 1 and 100), starts_on date, ends_before date,
 assignment_mode text not null check(assignment_mode in ('date_range','manual_legacy')),
 check(starts_on is null or ends_before is null or starts_on<ends_before),
 check(assignment_mode<>'date_range' or (starts_on is not null and ends_before is not null)),
 unique(group_id,id), unique(group_id,name)
);
create table app.rule_versions (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 label text not null, rules_status text not null check(rules_status in ('verified','legacy_unknown')),
 -- No invented automatic breaker rotation. Each frame supplies its actual breaker.
 breaker_policy text not null default 'explicit_per_frame' check(breaker_policy='explicit_per_frame'),
 unique(group_id,id), unique(group_id,label)
);
create table private.import_sources (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 namespace text not null, unique(group_id,id), unique(group_id,namespace)
);
create table private.import_batches (
 id uuid primary key default gen_random_uuid(), group_id uuid not null,
 source_id uuid not null, checksum text not null check(length(checksum)=64), mapping_version text not null,
 status text not null check(status in ('staged','accepted','rejected')),
 foreign key(group_id,source_id) references private.import_sources(group_id,id) on delete restrict,
 unique(group_id,id), unique(source_id,checksum,mapping_version)
);
create table private.import_records (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, batch_id uuid not null,
 record_key text not null, source_sheet text not null, source_row integer not null check(source_row>0),
 sanitized_evidence jsonb not null, extracted_hash text not null,
 foreign key(group_id,batch_id) references private.import_batches(group_id,id) on delete restrict,
 unique(group_id,id), unique(batch_id,record_key)
);
create table app.match_sessions (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups on delete restrict,
 venue_id uuid not null, season_id uuid, rule_version_id uuid not null,
 status text not null default 'active' check(status in ('active','finalized','abandoned')),
 origin text not null check(origin in ('native','imported')),
 record_kind text not null check(record_kind in ('frame_log','result_only')),
 result_authority text not null check(result_authority in ('native_frames','approved_historical_reported')),
 result_quality text not null default 'approved' check(result_quality in ('approved','disputed','unknown')),
 sequence_quality text not null default 'reconciled' check(sequence_quality in ('reconciled','partial','disputed','not_recorded')),
 detail_eligible boolean not null default true,
 occurred_on date, occurred_at timestamptz, timezone_snapshot text,
 date_precision text not null check(date_precision in ('instant','date_only','unknown')),
 started_at timestamptz, finalized_at timestamptz,
 scorer_user_id uuid references auth.users on delete restrict,
 revision bigint not null default 1 check(revision>0), import_batch_id uuid, legacy_match_id text,
 created_at timestamptz not null default now(),
 foreign key(group_id,venue_id) references app.venues(group_id,id) on delete restrict,
 foreign key(group_id,season_id) references app.seasons(group_id,id) on delete restrict,
 foreign key(group_id,rule_version_id) references app.rule_versions(group_id,id) on delete restrict,
 foreign key(group_id,import_batch_id) references private.import_batches(group_id,id) on delete restrict,
 unique(group_id,id),
 check((origin='native' and result_authority='native_frames' and record_kind='frame_log' and import_batch_id is null
        and legacy_match_id is null and scorer_user_id is not null and started_at is not null and occurred_at is not null
        and occurred_on is not null and date_precision='instant' and timezone_snapshot is not null)
    or (origin='imported' and result_authority='approved_historical_reported' and import_batch_id is not null and legacy_match_id is not null)),
 check(origin<>'native' or status<>'finalized' or finalized_at is not null),
 check(record_kind<>'result_only' or (origin='imported' and status='finalized' and sequence_quality='not_recorded' and not detail_eligible)),
 check(date_precision<>'date_only' or (occurred_on is not null and occurred_at is null))
);
create index sessions_history on app.match_sessions(group_id,season_id,occurred_on,id);
create index sessions_active on app.match_sessions(group_id,status);
create table app.session_participants (
 group_id uuid not null, session_id uuid not null, player_id uuid not null, side smallint not null check(side in (1,2)),
 primary key(session_id,player_id), unique(group_id,session_id,player_id), unique(session_id,side),
 foreign key(group_id,session_id) references app.match_sessions(group_id,id) on delete restrict,
 foreign key(group_id,player_id) references app.group_players(group_id,player_id) on delete restrict
);
create index participant_history on app.session_participants(group_id,player_id,session_id);
create table app.frames (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, session_id uuid not null,
 frame_number integer not null check(frame_number>0), status text not null check(status in ('running','paused','completed','voided')),
 origin text not null check(origin in ('native','imported')), winner_id uuid, breaker_id uuid, offender_id uuid,
 potted_on_break boolean, black_pocket_code text check(black_pocket_code in ('TL','TM','TR','BL','BM','BR')),
 special_event text check(special_event in ('regular','golden_break','break_and_run','dry_clearance','super_foul')),
 elapsed_ms bigint check(elapsed_ms>=0), running_since timestamptz, started_at timestamptz, completed_at timestamptz,
 duration_quality text not null check(duration_quality in ('server_measured','imported_unverified','unknown')),
 detail_eligible boolean not null default true, quality_flags jsonb not null default '[]',
 revision bigint not null default 1 check(revision>0), source_record_id uuid,
 unique(group_id,id), unique(group_id,session_id,id), unique(session_id,frame_number),
 foreign key(group_id,session_id) references app.match_sessions(group_id,id) on delete restrict,
 foreign key(group_id,source_record_id) references private.import_records(group_id,id) on delete restrict,
 check(origin<>'native' or (breaker_id is not null and started_at is not null and elapsed_ms is not null and duration_quality='server_measured')),
 check(origin<>'native' or ((status='running')=(running_since is not null))),
 check(origin<>'native' or status<>'completed' or (winner_id is not null and potted_on_break is not null and special_event is not null and completed_at is not null)),
 check(status not in ('running','paused') or winner_id is null)
);
create unique index one_active_frame on app.frames(session_id) where status in ('running','paused');
create index frame_winners on app.frames(group_id,winner_id,session_id);
create table app.frame_participants (
 group_id uuid not null, session_id uuid not null, frame_id uuid not null, player_id uuid not null,
 side smallint not null check(side in (1,2)), foul_count integer check(foul_count>=0),
 primary key(frame_id,player_id), unique(frame_id,side), unique(group_id,frame_id,player_id),
 foreign key(group_id,session_id,frame_id) references app.frames(group_id,session_id,id) on delete restrict,
 foreign key(group_id,session_id,player_id) references app.session_participants(group_id,session_id,player_id) on delete restrict
);
alter table app.frames add constraint winner_in_frame foreign key(group_id,id,winner_id) references app.frame_participants(group_id,frame_id,player_id) deferrable initially deferred;
alter table app.frames add constraint breaker_in_frame foreign key(group_id,id,breaker_id) references app.frame_participants(group_id,frame_id,player_id) deferrable initially deferred;
alter table app.frames add constraint offender_in_frame foreign key(group_id,id,offender_id) references app.frame_participants(group_id,frame_id,player_id) deferrable initially deferred;
create table app.legacy_session_results (
 group_id uuid not null, session_id uuid not null, player_id uuid not null,
 reported_frames_won integer not null check(reported_frames_won>=0), source_record_id uuid not null,
 primary key(session_id,player_id),
 foreign key(group_id,session_id,player_id) references app.session_participants(group_id,session_id,player_id) on delete restrict,
 foreign key(group_id,source_record_id) references private.import_records(group_id,id) on delete restrict
);
create table private.legacy_frame_observations (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, source_record_id uuid not null unique,
 session_id uuid not null, source_frame_number integer not null check(source_frame_number>0),
 full_observation jsonb not null, canonical_frame_id uuid,
 disposition text not null check(disposition in ('canonical_linked','excluded_noncanonical','pending_review')),
 detail_eligible boolean not null default false,
 foreign key(group_id,source_record_id) references private.import_records(group_id,id) on delete restrict,
 foreign key(group_id,session_id) references app.match_sessions(group_id,id) on delete restrict,
 foreign key(group_id,session_id,canonical_frame_id) references app.frames(group_id,session_id,id) on delete restrict,
 check(disposition<>'excluded_noncanonical' or (canonical_frame_id is null and not detail_eligible))
);
create table private.legacy_entity_links (
 id uuid primary key default gen_random_uuid(), source_id uuid not null, group_id uuid not null,
 entity_kind text not null check(entity_kind in ('session','player','venue','frame')), legacy_key text not null,
 session_id uuid, player_id uuid, venue_id uuid, frame_id uuid,
 foreign key(group_id,source_id) references private.import_sources(group_id,id) on delete restrict,
 foreign key(group_id,session_id) references app.match_sessions(group_id,id) on delete restrict,
 foreign key(group_id,player_id) references app.group_players(group_id,player_id) on delete restrict,
 foreign key(group_id,venue_id) references app.venues(group_id,id) on delete restrict,
 foreign key(group_id,frame_id) references app.frames(group_id,id) on delete restrict,
 check(num_nonnulls(session_id,player_id,venue_id,frame_id)=1),
 check((entity_kind='session' and session_id is not null) or (entity_kind='player' and player_id is not null) or (entity_kind='venue' and venue_id is not null) or (entity_kind='frame' and frame_id is not null)),
 unique(source_id,entity_kind,legacy_key)
);
create table private.write_operations (
 actor_id uuid not null references auth.users on delete restrict, operation_id uuid not null,
 group_id uuid not null references app.groups on delete restrict, request jsonb not null, response jsonb not null,
 committed_at timestamptz not null default now(), primary key(actor_id,operation_id)
);
create table private.match_events (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, session_id uuid not null,
 revision bigint not null, actor_id uuid not null references auth.users on delete restrict,
 operation_id uuid not null, action text not null, reason text, before_state jsonb, after_state jsonb not null,
 committed_at timestamptz not null default now(),
 foreign key(group_id,session_id) references app.match_sessions(group_id,id) on delete restrict,
 foreign key(actor_id,operation_id) references private.write_operations(actor_id,operation_id) deferrable initially deferred,
 unique(session_id,revision)
);
create table private.frame_observation_resolutions (
 id uuid primary key default gen_random_uuid(), observation_id uuid not null references private.legacy_frame_observations on delete restrict,
 actor_id uuid not null references auth.users on delete restrict, reason text not null check(length(trim(reason))>0),
 previous_disposition text not null, new_disposition text not null, decision jsonb not null,
 committed_at timestamptz not null default now()
);

-- Evidence/journal records cannot be rewritten through ordinary UPDATE/DELETE, even by an accidental grant.
create function private.immutable_evidence() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'append_only_evidence' using errcode='55000'; end $$;
do $$ declare t text; begin
 foreach t in array array['import_records','legacy_frame_observations','match_events','write_operations','frame_observation_resolutions'] loop
 execute format('create trigger immutable_evidence before update or delete on private.%I for each row execute function private.immutable_evidence()',t);
 end loop;
end $$;

-- Cross-row integrity applies to privileged imports too; historical nullability stays distinct from native requirements.
create function private.check_session_integrity() returns trigger language plpgsql set search_path='' as $$
declare s app.match_sessions; sid uuid; f app.frames;
begin
 if tg_table_name='match_sessions' then sid:=new.id; else sid:=new.session_id; end if;
 select * into s from app.match_sessions where id=sid;
 if (select count(*) from app.session_participants where session_id=sid)<>2 then
 raise exception 'session_requires_two_participants' using errcode='23514'; end if;
 if s.record_kind='result_only' and exists(select 1 from app.frames where session_id=sid) then
 raise exception 'score_only_has_no_frames' using errcode='23514'; end if;
 if s.origin='native' and not exists(select 1 from app.rule_versions r where r.id=s.rule_version_id and r.rules_status='verified') then
 raise exception 'native_requires_verified_rules' using errcode='23514'; end if;
 if s.status='finalized' and s.origin='native' and (not exists(select 1 from app.frames where session_id=sid and status='completed')
 or exists(select 1 from app.frames where session_id=sid and status in ('running','paused'))) then
 raise exception 'invalid_native_finalization' using errcode='23514'; end if;
 if s.origin='imported' and s.status='finalized' and s.result_quality='approved' and
 (select count(*) from app.legacy_session_results where session_id=sid)<>2 then
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
do $$ declare t text; begin
 foreach t in array array['match_sessions','session_participants','frames','frame_participants','legacy_session_results'] loop
 execute format('create constraint trigger session_integrity after insert or update on app.%I deferrable initially deferred for each row execute function private.check_session_integrity()',t);
 end loop;
end $$;

-- Clear any inherited default table grants before applying the explicit read-only allowlist.
revoke all on all tables in schema app from public,anon,authenticated;

-- Helpers expose only caller-scoped predicates. No writable policies: all browser DML is denied.
create function app.is_member(p_group uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from app.group_memberships m join app.groups g on g.id=m.group_id
 where m.group_id=p_group and m.user_id=auth.uid() and m.status='active' and g.status='active')
$$;
create function app.batch_visible(p_group uuid,p_batch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select app.is_member(p_group) and (p_batch is null or exists(select 1 from private.import_batches b where b.id=p_batch and b.group_id=p_group and b.status='accepted'))
$$;
create function app.session_visible(p_group uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select app.is_member(p_group) and exists(select 1 from app.match_sessions s where s.id=p_session and s.group_id=p_group
 and s.status<>'abandoned' and app.batch_visible(s.group_id,s.import_batch_id))
$$;
do $$ declare t text; begin
 foreach t in array array['groups','group_memberships','group_players','venues','seasons','rule_versions','match_sessions','session_participants','frames','frame_participants','legacy_session_results'] loop
 execute format('alter table app.%I enable row level security',t);
 execute format('grant select on app.%I to authenticated',t);
 if t='groups' then
 execute format('create policy member_read on app.%I for select to authenticated using(app.is_member(id))',t);
 elsif t='match_sessions' then
 execute format('create policy member_read on app.%I for select to authenticated using(app.session_visible(group_id,id))',t);
 elsif t in ('session_participants','frames','frame_participants','legacy_session_results') then
 execute format('create policy member_read on app.%I for select to authenticated using(app.session_visible(group_id,session_id))',t);
 else
 execute format('create policy member_read on app.%I for select to authenticated using(app.is_member(group_id))',t);
 end if;
 end loop;
 for t in select tablename from pg_tables where schemaname='private' loop
 execute format('alter table private.%I enable row level security',t);
 end loop;
end $$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on all functions in schema app from public,anon,authenticated;
grant execute on function app.is_member(uuid),app.batch_visible(uuid,uuid),app.session_visible(uuid,uuid) to authenticated;
-- Reviewed rule versions cannot change underneath a recorded match.
create function private.freeze_used_rule() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from app.match_sessions where rule_version_id=old.id) then
 raise exception 'referenced_rule_version_is_immutable' using errcode='55000'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger freeze_used_rule before update or delete on app.rule_versions for each row execute function private.freeze_used_rule();

create function private.check_group_owner() returns trigger language plpgsql set search_path='' as $$
declare gid uuid; g app.groups;
begin
 if tg_table_name='groups' then gid:=new.id;
 elsif tg_op='DELETE' then gid:=old.group_id;
 else gid:=new.group_id; end if;
 select * into g from app.groups where id=gid;
 if g.status='active' and (select count(*) from app.group_memberships where group_id=gid and status='active' and role='owner')<>1 then
 raise exception 'active_group_requires_one_owner' using errcode='23514'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=g.timezone) then
 raise exception 'invalid_group_timezone' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger group_owner_integrity after insert or update on app.groups deferrable initially deferred for each row execute function private.check_group_owner();
create constraint trigger member_owner_integrity after insert or update or delete on app.group_memberships deferrable initially deferred for each row execute function private.check_group_owner();
revoke all on all functions in schema private from public,anon,authenticated;
commit;
