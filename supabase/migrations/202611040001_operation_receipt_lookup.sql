-- PROPOSED; local synthetic tests only until separately approved for hosted deployment.
begin;
create function app.lookup_operation_receipt(p_operation uuid) returns jsonb
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
 elsif action in ('create_group','create_guest','create_venue','adopt_rule_version') then
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
revoke all on function app.lookup_operation_receipt(uuid) from public,anon,authenticated;
grant execute on function app.lookup_operation_receipt(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
