-- PROPOSED: mandatory email for NEW guest creation; no existing records are backfilled.
begin;
create table private.player_guest_emails (
 player_id uuid primary key references private.players on delete restrict,
 normalized_email text not null unique check(normalized_email=lower(trim(normalized_email)) and length(normalized_email)<=254 and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
 recorded_by uuid not null references auth.users,
 source text not null check(source in('new_guest','reviewed_invitation')),
 recorded_at timestamptz not null default now()
);
alter table private.player_guest_emails enable row level security;
revoke all on private.player_guest_emails from public,anon,authenticated;
create trigger immutable_guest_emails before update or delete on private.player_guest_emails
 for each row execute function private.immutable_evidence();
-- Include already verified account-linked identities without exposing the private Auth/link tables.
create function private.players_for_email(p_email text) returns setof uuid language sql stable set search_path='' as $$
 select player_id from private.player_guest_emails where normalized_email=lower(trim(p_email))
 union select player_id from private.player_account_links where private.verified_email(user_id)=lower(trim(p_email))
$$;
create function app.find_guest_by_email(p_email text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('player_id',gp.player_id,'display_name',gp.display_name,'group_id',gp.group_id)
 from app.group_players gp join app.group_memberships m on m.group_id=gp.group_id join app.groups g on g.id=gp.group_id
 where auth.uid() is not null and gp.player_id in(select private.players_for_email(p_email))
 and (select count(*) from private.players_for_email(p_email))=1
 and gp.status='active' and g.status='active' and m.user_id=auth.uid() and m.status='active' and m.role in('owner','admin','scorer')
 order by gp.group_id limit 1
$$;
create function app.create_guest_with_email(p_operation uuid,p_group uuid,p_name text,p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e text:=lower(trim(p_email)); response jsonb; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if private.require_role(p_group) not in('owner','admin','scorer') then raise exception 'setup_permission_required' using errcode='42501'; end if;
 if e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'guest_email_required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 -- Preserve exact replay and actor/payload checks through the existing setup command.
 if exists(select 1 from private.write_operations where actor_id=uid and operation_id=p_operation) then
 return private.setup_command('create_guest',p_operation,p_group,jsonb_build_object('name',p_name,'email',e)); end if;
 if exists(select 1 from private.players_for_email(e)) then raise exception 'guest_email_unavailable' using errcode='23505'; end if;
 response:=private.setup_command('create_guest',p_operation,p_group,jsonb_build_object('name',p_name,'email',e));
 insert into private.player_guest_emails(player_id,normalized_email,recorded_by,source) values((response->>'id')::uuid,e,uid,'new_guest');
 return response;
end $$;
-- Old committed operations can replay. No new name-only guest may be created.
create or replace function app.create_guest(p_operation uuid,p_group uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if private.require_role(p_group) not in('owner','admin','scorer') then raise exception 'setup_permission_required' using errcode='42501'; end if;
 if not exists(select 1 from private.write_operations where actor_id=auth.uid() and operation_id=p_operation)
 then raise exception 'guest_email_required' using errcode='22023'; end if;
 return private.setup_command('create_guest',p_operation,p_group,jsonb_build_object('name',p_name));
end $$;
-- A NEW authorized invitation can associate an existing historical guest, preserving its UUID.
-- Existing acknowledgments replay without silently backfilling an email association.
create or replace function app.create_player_invitation(p_operation uuid,p_group uuid,p_player uuid,p_email text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e text:=lower(trim(p_email)); response jsonb; existing_email text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 if exists(select 1 from private.write_operations where actor_id=auth.uid() and operation_id=p_operation) then
 return private.identity_command('create_player_invitation',p_operation,p_group,jsonb_build_object('player_id',p_player,'email',p_email,'token_hash',p_token_hash)); end if;
 if not private.can_invite(auth.uid(),p_group,p_player) then raise exception 'invitation_permission_required' using errcode='42501'; end if;
 if e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'guest_email_required' using errcode='22023'; end if;
 select normalized_email into existing_email from private.player_guest_emails where player_id=p_player;
 if (existing_email is not null and existing_email<>e) or exists(select 1 from private.players_for_email(e) p where p<>p_player)
 or exists(select 1 from private.player_account_links where player_id=p_player and private.verified_email(user_id) is distinct from e)
 then raise exception 'guest_email_unavailable' using errcode='23505'; end if;
 response:=private.identity_command('create_player_invitation',p_operation,p_group,jsonb_build_object('player_id',p_player,'email',p_email,'token_hash',p_token_hash));
 if existing_email is null then
 insert into private.player_guest_emails(player_id,normalized_email,recorded_by,source) values(p_player,e,auth.uid(),'reviewed_invitation'); end if;
 return response;
end $$;
create or replace function app.accept_player_invitation(p_operation uuid,p_token text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(p_token,'') !~ '^[a-f0-9]{64}$' or encode(sha256(convert_to(p_token,'UTF8')),'hex') is distinct from p_token_hash
 then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if not exists(select 1 from private.write_operations where actor_id=auth.uid() and operation_id=p_operation)
 and exists(select 1 from private.player_invitations i join private.player_guest_emails e on e.player_id=i.player_id
 where i.token_hash=p_token_hash and e.normalized_email is distinct from private.verified_email(auth.uid()))
 then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 return private.identity_command('accept_player_invitation',p_operation,null,jsonb_build_object('token_hash',p_token_hash));
end $$;
revoke all on function private.players_for_email(text) from public,anon,authenticated;
revoke all on function app.find_guest_by_email(text),app.create_guest_with_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function app.find_guest_by_email(text),app.create_guest_with_email(uuid,uuid,text,text) to authenticated;
-- Google discovery is caller-only. Email alone never authorizes membership.
create function private.google_guest_candidate(p_user uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare e text; pid uuid; n bigint; label text;
begin
 e:=private.verified_email(p_user);
 if e is null or not exists(select 1 from auth.identities where user_id=p_user and provider='google'
 and identity_data->>'email_verified'='true' and lower(trim(identity_data->>'email'))=e)
 then return jsonb_build_object('status','none'); end if;
 if exists(select 1 from private.player_account_links where user_id=p_user) then return jsonb_build_object('status','connected'); end if;
 select player_id into pid from private.player_guest_emails where normalized_email=e;
 if pid is null then return jsonb_build_object('status','none'); end if;
 if (select count(*) from private.players_for_email(e))<>1 or exists(select 1 from private.player_account_links where player_id=pid)
 then return jsonb_build_object('status','unavailable'); end if;
 select count(distinct i.group_id) into n from private.player_invitations i
 where i.player_id=pid and i.recipient_email=e and i.consumed_at is null and i.revoked_at is null and i.expires_at>now()
 and private.can_invite(i.issuer_id,i.group_id,pid)
 and not exists(select 1 from app.group_memberships m where m.group_id=i.group_id and m.user_id=p_user and m.status='revoked');
 if n=0 then return jsonb_build_object('status','needs_invitation'); end if;
 select gp.display_name into label from app.group_players gp join private.players p on p.id=gp.player_id
 where p.id=pid and gp.group_id=p.origin_group_id;
 return jsonb_build_object('status','eligible','player_id',pid,'player_name',label,'matchup_count',n);
end $$;
create function app.get_guest_email_claim() returns jsonb language sql stable security definer set search_path='' as $$
 select private.google_guest_candidate(auth.uid())
$$;
create function app.claim_guest_email(p_operation uuid,p_player uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); candidate jsonb; cached private.write_operations; inv record; child uuid; first_group uuid; response jsonb;
 request jsonb:=jsonb_build_object('action','claim_guest_email','group_id',null,'data',jsonb_build_object('player_id',p_player));
begin
 if uid is null or p_operation is null then raise exception 'claim_unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 perform 1 from auth.users where id=uid for update;
 perform 1 from auth.identities where user_id=uid for share;
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 if not app.is_member(cached.group_id) or not exists(select 1 from private.player_account_links where player_id=p_player and user_id=uid)
 then raise exception 'claim_unavailable' using errcode='42501'; end if;
 return cached.response;
 end if;
 candidate:=private.google_guest_candidate(uid);
 if candidate->>'status'<>'eligible' or (candidate->>'player_id')::uuid is distinct from p_player
 then raise exception 'claim_unavailable' using errcode='42501'; end if;
 -- Consume only fresh, explicitly owner-authorized invitations. No origin-group auto-enrollment.
 for inv in select i.* from private.player_invitations i
 where i.player_id=p_player and i.recipient_email=private.verified_email(uid) and i.consumed_at is null and i.revoked_at is null and i.expires_at>now()
 and private.can_invite(i.issuer_id,i.group_id,p_player)
 and not exists(select 1 from app.group_memberships m where m.group_id=i.group_id and m.user_id=uid and m.status='revoked')
 order by (select count(*) from app.match_sessions s where s.group_id=i.group_id and s.status='finalized') desc,i.group_id
 loop
 child:=md5('google-guest-claim/'||p_operation::text||'/'||inv.id::text)::uuid;
 perform private.identity_command('accept_player_invitation',child,null,jsonb_build_object('token_hash',inv.token_hash));
 first_group:=coalesce(first_group,inv.group_id);
 end loop;
 if first_group is null then raise exception 'claim_unavailable' using errcode='42501'; end if;
 response:=jsonb_build_object('id',p_player,'group_id',first_group);
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,first_group,request,response);
 insert into private.setup_events(group_id,actor_id,operation_id,action,saved_result) values(first_group,uid,p_operation,'claim_guest_email',response);
 return response;
end $$;
revoke all on function private.google_guest_candidate(uuid) from public,anon,authenticated;
revoke all on function app.get_guest_email_claim(),app.claim_guest_email(uuid,uuid) from public,anon,authenticated;
grant execute on function app.get_guest_email_claim(),app.claim_guest_email(uuid,uuid) to authenticated;
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
