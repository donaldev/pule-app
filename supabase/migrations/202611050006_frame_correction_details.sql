-- Extend only completed-frame corrections. Existing callers omit p_details.
begin;
-- Retain the scoring engine OID, locks, authorization, receipts and audit path.
-- Fail closed if the reviewed correction branch no longer matches.
do $migration$
declare definition text; original text := $old$update app.frames set winner_id=(p_data->>'winner_id')::uuid,revision=revision+1 where id=f.id;$old$;
 replacement text := $new$
 if p_data ? 'correction_details' then
 if jsonb_typeof(p_data->'correction_details') is distinct from 'object'
 or not ((p_data->'correction_details') ?& array['special_event','potted_on_break','offender_id'])
 or (select count(*) from jsonb_object_keys(p_data->'correction_details'))<>3
 or jsonb_typeof(p_data#>'{correction_details,special_event}') is distinct from 'string'
 or jsonb_typeof(p_data#>'{correction_details,potted_on_break}') is distinct from 'boolean'
 or (p_data#>>'{correction_details,special_event}') not in ('regular','golden_break','break_and_run','dry_clearance','super_foul') then
 raise exception 'invalid_correction_details' using errcode='22023'; end if;
 -- Explicitly supply all dependent values: no stale offender survives a type change.
 -- Existing deferred integrity checks and participant FKs validate these together.
 update app.frames set winner_id=(p_data->>'winner_id')::uuid,
 special_event=p_data#>>'{correction_details,special_event}',
 potted_on_break=(p_data#>>'{correction_details,potted_on_break}')::boolean,
 offender_id=(p_data#>>'{correction_details,offender_id}')::uuid,
 revision=revision+1 where id=f.id;
 else
 update app.frames set winner_id=(p_data->>'winner_id')::uuid,revision=revision+1 where id=f.id;
 end if;
$new$;
begin
 definition:=pg_get_functiondef('private.scoring_command(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
 raise exception 'unexpected_scoring_correction_definition'; end if;
 execute replace(definition,original,replacement);
end $migration$;
-- One signature, not an overlapping default-argument overload. Old named/positional
-- calls resolve via the optional final argument and generate identical old receipts.
drop function app.correct_frame(uuid,uuid,bigint,uuid,uuid,integer,integer,text);
create function app.correct_frame(p_operation uuid,p_session uuid,p_expected_revision bigint,p_frame uuid,p_winner uuid,p_p1_fouls integer,p_p2_fouls integer,p_reason text,p_details jsonb default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.scoring_command('correct_frame',p_operation,p_session,p_expected_revision,
 jsonb_build_object('frame_id',p_frame,'winner_id',p_winner,'p1_fouls',p_p1_fouls,'p2_fouls',p_p2_fouls,'reason',p_reason)
 || case when p_details is null then '{}'::jsonb else jsonb_build_object('correction_details',p_details) end)
$$;
revoke all on function app.correct_frame(uuid,uuid,bigint,uuid,uuid,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function app.correct_frame(uuid,uuid,bigint,uuid,uuid,integer,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
