-- Local proposal: confirmed-account initialization only. No existing links/history are backfilled.
begin;
create function private.player_initialization_state(p_user uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare pid uuid; gid uuid; e text; label text; metadata jsonb; field text;
begin
 if p_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
 select l.player_id,p.origin_group_id into pid,gid from private.player_account_links l join private.players p on p.id=l.player_id where l.user_id=p_user;
 if found then return jsonb_build_object('status','linked','id',pid,'group_id',gid); end if;
 e:=private.verified_email(p_user);
 if e is null then return jsonb_build_object('status','confirmation_required'); end if;
 -- Email is a collision/claim guard, never proof authorizing a player takeover.
 if exists(select 1 from private.players_for_email(e)) or exists(
 select 1 from private.player_invitations where recipient_email=e and consumed_at is null and revoked_at is null)
 then return jsonb_build_object('status','claim_required'); end if;
 select raw_user_meta_data into metadata from auth.users where id=p_user;
 foreach field in array array['display_name','full_name','name'] loop
 if jsonb_typeof(metadata->field)='string' then
 label:=trim(metadata->>field);
 if length(label) between 1 and 100 and label !~ '[[:cntrl:]]' then return jsonb_build_object('status','initialize','name',label); end if;
 end if;
 end loop;
 return jsonb_build_object('status','name_required');
end $$;
create function app.get_my_player_initialization() returns jsonb
language sql stable security definer set search_path='' as $$
 select private.player_initialization_state(auth.uid())
$$;
create function app.initialize_my_player(p_operation uuid,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); state jsonb; label text; pid uuid; gid uuid; cached private.write_operations; response jsonb;
 request jsonb:=jsonb_build_object('action','initialize_my_player','group_id',null,'data',jsonb_build_object('name',p_name));
begin
 if uid is null or p_operation is null then raise exception 'authentication_and_operation_required' using errcode='42501'; end if;
 -- Same lock order as invitation/guest claiming. The Auth row and unique links also serialize first login.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pule/identity-links',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'/'||p_operation::text,0));
 perform 1 from auth.users where id=uid for update;
 if not found then raise exception 'authentication_required' using errcode='42501'; end if;
 perform 1 from auth.identities where user_id=uid for share;
 select * into cached from private.write_operations where actor_id=uid and operation_id=p_operation;
 if found then
 if cached.request<>request then raise exception 'idempotency_key_reused_with_different_request' using errcode='22023'; end if;
 if not exists(select 1 from private.player_account_links where user_id=uid and player_id=(cached.response->>'id')::uuid)
 then raise exception 'identity_link_changed' using errcode='42501'; end if;
 return cached.response;
 end if;
 state:=private.player_initialization_state(uid);
 if state->>'status'='linked' then
 pid:=(state->>'id')::uuid;gid:=(state->>'group_id')::uuid;
 else
 if state->>'status'='confirmation_required' then raise exception 'verified_email_required' using errcode='42501'; end if;
 if state->>'status'='claim_required' then raise exception 'existing_player_claim_required' using errcode='55000'; end if;
 label:=trim(coalesce(p_name,state->>'name'));
 if label is null or length(label) not between 1 and 100 or label ~ '[[:cntrl:]]' then raise exception 'player_name_required' using errcode='22023'; end if;
 -- One private identity-origin/setup context; no match session or matchup is created.
 insert into app.groups(name,timezone) values('Pool matches','UTC') returning id into gid;
 insert into app.group_memberships(group_id,user_id,role) values(gid,uid,'owner');
 insert into private.players(origin_group_id) values(gid) returning id into pid;
 insert into app.group_players(group_id,player_id,display_name) values(gid,pid,label);
 insert into private.player_account_links(player_id,user_id,verified_by,verification_reference)
 values(pid,uid,uid,'confirmed-account-self-initialization/'||p_operation::text);
 end if;
 response:=jsonb_build_object('id',pid,'group_id',gid);
 set constraints all immediate;set constraints all deferred;
 insert into private.write_operations(actor_id,operation_id,group_id,request,response) values(uid,p_operation,gid,request,response);
 return response;
end $$;
revoke all on function private.player_initialization_state(uuid) from public,anon,authenticated;
revoke all on function app.get_my_player_initialization(),app.initialize_my_player(uuid,text) from public,anon,authenticated;
grant execute on function app.get_my_player_initialization(),app.initialize_my_player(uuid,text) to authenticated;
-- Add own-link acknowledgment before group membership checks. No other receipt authority changes.
do $$
declare definition text; needle text:=' select m.role into member_role from app.group_memberships m join app.groups g on g.id=m.group_id'; addition text:=$patch$
 if op.request->>'action'='initialize_my_player' then
 if not exists(select 1 from private.player_account_links l join private.players p on p.id=l.player_id
 where l.user_id=uid and l.player_id=(op.response->>'id')::uuid and p.origin_group_id=op.group_id)
 then return jsonb_build_object('status','not_confirmed'); end if;
 return jsonb_build_object('status','confirmed_committed','operation_id',op.operation_id,'actor_id',uid,
 'group_id',op.group_id,'command',op.request,'saved',jsonb_build_object('kind','setup','entity_id',op.response->>'id'),'committed_at',op.committed_at);
 end if;
$patch$;
begin
 select pg_get_functiondef('app.lookup_operation_receipt(uuid)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'identity_receipt_baseline_mismatch'; end if;
 execute replace(definition,needle,addition||needle);
end $$;
notify pgrst,'reload schema';
commit;
