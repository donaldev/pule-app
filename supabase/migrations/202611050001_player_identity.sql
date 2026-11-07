-- PROPOSED. No real links or invitations are executed by this migration.
begin;
-- Trusted Auth data only. User-editable profile metadata/JWT email is never evidence.
-- Email/password also needs an actual confirmation-send/confirmation chronology;
-- Google needs the provider's verified-email flag. Configure Confirm Email before rollout.
create function private.verified_email(p_user uuid) returns text language sql stable set search_path='' as $$
 select lower(trim(u.email)) from auth.users u where u.id=p_user and u.email_confirmed_at is not null
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and exists(select 1 from auth.identities i where i.user_id=u.id
 and lower(trim(i.identity_data->>'email'))=lower(trim(u.email)) and i.identity_data->>'email_verified'='true'
 and (i.provider='google' or (i.provider='email' and u.confirmation_sent_at is not null and u.email_confirmed_at>=u.confirmation_sent_at)))
$$;
-- Operator-only, one-person bootstrap. Target Auth UUID is explicitly supplied after independent verification.
create function private.link_historical_owner(p_user uuid,p_expected_email text,p_reviewer uuid,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid:='acc51043-01a0-507d-8fdd-ae0729e9fe68'; existing_user uuid; existing_player uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 perform 1 from auth.users where id in(p_user,p_reviewer) order by id for update;
 perform 1 from auth.identities where user_id in(p_user,p_reviewer) for share;
 perform 1 from private.players where id=pid for update;
 if not found then raise exception 'approved_owner_target_required' using errcode='42501'; end if;
 perform 1 from app.group_memberships m join private.players p on p.origin_group_id=m.group_id
 where p.id=pid and m.user_id=p_user for share of m;
 perform 1 from app.groups g join private.players p on p.origin_group_id=g.id where p.id=pid for share of g;
 if nullif(trim(p_evidence),'') is null or length(trim(p_evidence))>500
 or private.verified_email(p_user) is distinct from nullif(lower(trim(p_expected_email)),'')
 or private.verified_email(p_user) is null or private.verified_email(p_reviewer) is null
 then raise exception 'verified_identity_evidence_required' using errcode='42501'; end if;
 if not exists(select 1 from app.group_memberships m join private.players p on p.origin_group_id=m.group_id
 join app.groups g on g.id=m.group_id where p.id=pid and m.user_id=p_user and m.role='owner' and m.status='active' and g.status='active')
 then raise exception 'approved_owner_target_required' using errcode='42501'; end if;
 select user_id into existing_user from private.player_account_links where player_id=pid;
 select player_id into existing_player from private.player_account_links where user_id=p_user;
 if (existing_user is not null and existing_user<>p_user) or (existing_player is not null and existing_player<>pid)
 then raise exception 'identity_link_conflict' using errcode='23505'; end if;
 if existing_user is null then
 insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values(pid,p_user,p_reviewer,trim(p_evidence));
 end if;
 return pid;
end $$;
create table private.player_invitations (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references app.groups,
 player_id uuid not null references private.players, issuer_id uuid not null references auth.users,
 recipient_email text not null check(length(recipient_email) between 3 and 254),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '48 hours',
 consumed_at timestamptz, consumed_by uuid references auth.users, revoked_at timestamptz,
 check(expires_at>created_at), check((consumed_at is null)=(consumed_by is null))
);
create unique index one_pending_player_invite on private.player_invitations(group_id,player_id) where consumed_at is null and revoked_at is null;
alter table private.player_invitations enable row level security;
revoke all on private.player_invitations from public,anon,authenticated;
create function private.can_invite(p_issuer uuid,p_group uuid,p_player uuid) returns boolean language sql stable set search_path='' as $$
 select private.verified_email(p_issuer) is not null and exists(
 select 1 from app.group_memberships m join app.groups g on g.id=m.group_id
 join private.player_account_links l on l.user_id=m.user_id join private.matchups x on x.group_id=m.group_id
 join app.group_players ip on ip.group_id=m.group_id and ip.player_id=l.player_id and ip.status='active'
 join app.group_players gp on gp.group_id=m.group_id and gp.player_id=p_player
 where m.user_id=p_issuer and m.group_id=p_group and m.status='active' and m.role in('owner','admin')
 and g.status='active' and gp.status='active' and l.player_id=any(x.player_ids) and p_player=any(x.player_ids) and l.player_id<>p_player)
$$;
create function private.identity_command(p_action text,p_operation uuid,p_group uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); email text; gid uuid:=p_group; inv private.player_invitations;
 cached private.write_operations; response jsonb; target_user uuid; current_player uuid;
 request jsonb:=jsonb_build_object('action',p_action,'group_id',p_group,'data',p_data);
begin
 if uid is null or p_operation is null then raise exception 'verified_email_required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 perform 1 from auth.users where id=uid for update;
 perform 1 from auth.identities where user_id=uid for share;
 email:=private.verified_email(uid);
 if email is null then raise exception 'verified_email_required' using errcode='42501'; end if;
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 if not app.is_member(cached.group_id) then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 return cached.response;
 end if;
 if p_action='create_player_invitation' then
 perform 1 from app.group_memberships where group_id=gid and user_id=uid for share;
 perform 1 from app.groups where id=gid for share;
 perform 1 from app.group_players where group_id=gid for share;
 if not private.can_invite(uid,gid,(p_data->>'player_id')::uuid) then raise exception 'invitation_permission_required' using errcode='42501'; end if;
 if coalesce(p_data->>'token_hash','') !~ '^[a-f0-9]{64}$' or length(trim(p_data->>'email')) not between 3 and 254
 or position('@' in p_data->>'email')<2 then raise exception 'invalid_invitation' using errcode='22023'; end if;
 -- Issuance is deliberately not a directory lookup for another account's email.
 -- Existing link conflicts are checked only after the recipient proves email and token ownership.
 update private.player_invitations set revoked_at=now() where group_id=gid and player_id=(p_data->>'player_id')::uuid
 and consumed_at is null and revoked_at is null and expires_at<=now();
 insert into private.player_invitations(group_id,player_id,issuer_id,recipient_email,token_hash)
 values(gid,(p_data->>'player_id')::uuid,uid,lower(trim(p_data->>'email')),p_data->>'token_hash') returning * into inv;
 elsif p_action in('accept_player_invitation','revoke_player_invitation') then
 if p_action='accept_player_invitation' then
 select * into inv from private.player_invitations where token_hash=p_data->>'token_hash' for update;
 else select * into inv from private.player_invitations where id=(p_data->>'invitation_id')::uuid for update; end if;
 if not found then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 gid:=inv.group_id;
 perform 1 from auth.users where id=inv.issuer_id for share;
 perform 1 from auth.identities where user_id=inv.issuer_id for share;
 perform 1 from app.group_memberships where group_id=gid and user_id in(uid,inv.issuer_id) for share;
 perform 1 from app.groups where id=gid for share;
 perform 1 from app.group_players where group_id=gid for share;
 if p_action='revoke_player_invitation' then
 if not private.can_invite(uid,gid,inv.player_id) then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 update private.player_invitations set revoked_at=coalesce(revoked_at,now()) where id=inv.id;
 else
 if inv.recipient_email<>email or inv.expires_at<=now() or inv.revoked_at is not null or inv.consumed_at is not null
 or not private.can_invite(inv.issuer_id,gid,inv.player_id)
 or exists(select 1 from app.group_memberships where group_id=gid and user_id=uid and status='revoked')
 then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 perform 1 from auth.users where id=uid for update;
 perform 1 from private.players where id=inv.player_id for update;
 select user_id into target_user from private.player_account_links where player_id=inv.player_id;
 select player_id into current_player from private.player_account_links where user_id=uid;
 if (target_user is not null and target_user<>uid) or (current_player is not null and current_player<>inv.player_id)
 then raise exception 'identity_link_conflict' using errcode='23505'; end if;
 if target_user is null then
 insert into private.player_account_links(player_id,user_id,verified_by,verification_reference)
 values(inv.player_id,uid,inv.issuer_id,'invitation/'||inv.id::text);
 end if;
 if not exists(select 1 from app.group_memberships where group_id=gid and user_id=uid) then
 insert into app.group_memberships(group_id,user_id,role) values(gid,uid,'scorer');
 end if;
 update private.player_invitations set consumed_at=now(),consumed_by=uid where id=inv.id;
 end if;
 else raise exception 'unsupported_identity_command' using errcode='22023'; end if;
 response:=jsonb_build_object('id',case when p_action='accept_player_invitation' then inv.player_id else inv.id end,
 'group_id',gid,'invitation_id',inv.id,'expires_at',inv.expires_at);
 set constraints all immediate; set constraints all deferred;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,request,response);
 insert into private.setup_events(group_id,actor_id,operation_id,action,saved_result) values(gid,uid,p_operation,p_action,response);
 return response;
end $$;
create function app.create_player_invitation(p_operation uuid,p_group uuid,p_player uuid,p_email text,p_token_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select private.identity_command('create_player_invitation',p_operation,p_group,jsonb_build_object('player_id',p_player,'email',p_email,'token_hash',p_token_hash))
$$;
create function app.accept_player_invitation(p_operation uuid,p_token text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(p_token,'') !~ '^[a-f0-9]{64}$' or encode(sha256(convert_to(p_token,'UTF8')),'hex') is distinct from p_token_hash
 then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 return private.identity_command('accept_player_invitation',p_operation,null,jsonb_build_object('token_hash',p_token_hash));
end $$;
create function app.revoke_player_invitation(p_operation uuid,p_invitation uuid) returns jsonb
language sql security definer set search_path='' as $$
 select private.identity_command('revoke_player_invitation',p_operation,null,jsonb_build_object('invitation_id',p_invitation))
$$;
create function app.preview_player_invitation(p_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('player_name',gp.display_name,'expires_at',i.expires_at) from private.player_invitations i
 join app.group_players gp on gp.group_id=i.group_id and gp.player_id=i.player_id
 where length(p_token)=64 and i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 and i.recipient_email=private.verified_email(auth.uid()) and i.expires_at>now() and i.revoked_at is null and i.consumed_at is null
 and private.can_invite(i.issuer_id,i.group_id,i.player_id)
 and not exists(select 1 from private.player_account_links l where l.player_id=i.player_id and l.user_id<>auth.uid())
 and not exists(select 1 from private.player_account_links l where l.user_id=auth.uid() and l.player_id<>i.player_id)
$$;
create function app.get_my_player_invitations() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'group_id',i.group_id,'player_id',i.player_id,'email',i.recipient_email,
 'expires_at',i.expires_at,'accepted',i.consumed_at is not null,'revoked',i.revoked_at is not null) order by i.created_at desc),'[]'::jsonb)
 from private.player_invitations i where i.issuer_id=auth.uid() and app.is_member(i.group_id)
$$;
-- Complete authoritative totals over accessible finalized approved nights, with no 100-night cap.
create function app.get_my_player_stats() returns jsonb language sql stable security definer set search_path='' as $$
 with identity as (select player_id from private.player_account_links where user_id=auth.uid()), eligible as (
 select s.id,s.group_id,(select count(*) from app.session_participants where session_id=s.id) size
 from app.match_sessions s join app.session_participants p on p.session_id=s.id join identity i on i.player_id=p.player_id
 where s.status='finalized' and s.result_quality='approved' and app.batch_visible(s.group_id,s.import_batch_id)
 ), facts as (
 select e.*,sc.*,max(sc.frames_won) over(partition by e.id) best,min(sc.frames_won) over(partition by e.id) worst
 from eligible e cross join lateral private.session_standings(e.id) sc
 ), own as (select f.* from facts f join identity i on i.player_id=f.player_id), totals as (
 select count(*) nights,count(*) filter(where size=2 and frames_won=best and best<>worst) wins,
 count(*) filter(where size=2 and frames_won<best) losses,count(*) filter(where size=2 and best=worst) draws,
 coalesce(sum(frames_won),0) frames_won,case when count(*) filter(where frames_lost is null)>0 then null else coalesce(sum(frames_lost),0) end frames_lost,
 count(*) filter(where size>2) multiplayer_nights,count(distinct group_id) matchups from own
 ) select case when exists(select 1 from identity) then jsonb_build_object('player_id',(select player_id from identity),
 'display_name',(select gp.display_name from app.group_players gp join private.players p on p.id=gp.player_id and p.origin_group_id=gp.group_id join identity i on i.player_id=gp.player_id limit 1),
 'nights',t.nights,'wins',t.wins,'losses',t.losses,'draws',t.draws,'frames_won',t.frames_won,'frames_lost',t.frames_lost,
 'multiplayer_nights',t.multiplayer_nights,'matchups',t.matchups,'scope','all_accessible_approved_nights') else null end from totals t
$$;
revoke all on function private.verified_email(uuid),private.link_historical_owner(uuid,text,uuid,text),private.can_invite(uuid,uuid,uuid),private.identity_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function app.create_player_invitation(uuid,uuid,uuid,text,text),app.accept_player_invitation(uuid,text,text),app.revoke_player_invitation(uuid,uuid),app.preview_player_invitation(text),app.get_my_player_invitations(),app.get_my_player_stats() from public,anon,authenticated;
grant execute on function app.create_player_invitation(uuid,uuid,uuid,text,text),app.accept_player_invitation(uuid,text,text),app.revoke_player_invitation(uuid,uuid),app.preview_player_invitation(text),app.get_my_player_invitations(),app.get_my_player_stats() to authenticated;
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
 elsif action in ('create_group','create_guest','create_venue','adopt_rule_version','resolve_matchup','create_player_invitation','accept_player_invitation','revoke_player_invitation') then
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
