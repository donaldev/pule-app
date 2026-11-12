-- Remove only the explicitly identified attempt/replay. Keep durable cleanup tombstones.
begin;
create function app.get_my_frame_recording(p_frame uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.replay_job_result(u.id) from private.frame_replay_uploads u
 where u.frame_id=p_frame and u.actor_id=auth.uid() and u.status in ('reserved','committed')
 and private.replay_frame_eligible(p_frame) order by u.created_at desc limit 1
$$;
create function app.remove_frame_replay(p_frame uuid,p_upload uuid default null,p_operation uuid default null,p_path text default null) returns void
language plpgsql security definer set search_path='' as $$
declare f app.frames; u private.frame_replay_uploads; j private.frame_replay_jobs; target text; due timestamptz;
begin
 select * into f from app.frames where id=p_frame;
 if auth.uid() is null or not found then raise exception 'replay_removal_denied' using errcode='42501'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock_shared(hashtextextended('match-lifecycle/'||f.group_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 if not private.replay_frame_eligible(p_frame) then raise exception 'replay_removal_denied' using errcode='42501'; end if;
 if p_path is not null then
 if p_upload is not null or p_operation is not null then raise exception 'invalid_replay_removal' using errcode='22023'; end if;
 select storage_path into target from app.frame_replays where frame_id=p_frame and storage_path=p_path;
 if not found then return; end if; -- A retry must never delete a replacement replay.
 select x.* into u from private.frame_replay_uploads x join private.frame_replay_jobs y on y.upload_id=x.id
 where x.frame_id=p_frame and y.output_path=target;
 else
 if p_upload is null and p_operation is null then raise exception 'invalid_replay_removal' using errcode='22023'; end if;
 select * into u from private.frame_replay_uploads where frame_id=p_frame
 and (p_upload is null or id=p_upload) and (p_operation is null or operation_id=p_operation) and actor_id=auth.uid();
 if not found then
 -- Never acknowledge an unknown in-flight reservation as cancelled.
 raise exception 'replay_removal_not_confirmed' using errcode='42501';
 end if;
 select r.storage_path into target from app.frame_replays r join private.frame_replay_jobs y on y.output_path=r.storage_path
 where y.upload_id=u.id and r.frame_id=p_frame;
 end if;
 if u.id is not null then
 select * into j from private.frame_replay_jobs where upload_id=u.id;
 -- A trusted worker can still finish its physical PUT after losing SQL publication authority.
 due:=case when j.state='processing' then greatest(clock_timestamp(),j.lease_until+interval '5 minutes') else clock_timestamp() end;
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,due);
 perform private.enqueue_replay_cleanup('frame-recordings',u.storage_path,
 case when u.source_provider='supabase' then greatest(due,u.expires_at+interval '24 hours')
 else greatest(due,clock_timestamp()+interval '5 minutes') end);
 -- Existing cleanup tasks may have an earlier due_at: retain the quiescence barrier.
 update private.frame_replay_cleanup set due_at=greatest(due_at,due)
 where upload_id=u.id and bucket_id='frame-replays' and completed_at is null;
 update private.frame_replay_cleanup set completed_at=null,lease_id=null,lease_until=null,
 due_at=greatest(due_at,case when u.source_provider='supabase' then u.expires_at+interval '24 hours' else clock_timestamp()+interval '5 minutes' end,due)
 where upload_id=u.id and bucket_id in ('frame-recordings','pule-frame-recordings');
 update private.frame_replay_uploads set status='cleanup' where id=u.id;
 update private.frame_replay_jobs set state='failed',failure_code='replay_removed',lease_id=null,lease_until=null where upload_id=u.id;
 end if;
 if target is not null then delete from app.frame_replays where frame_id=p_frame and storage_path=target; end if;
end $$;
-- Queueing may have read the upload before waiting for the same cancellation lock.
do $$ declare d text; needle text:=' select * into j from private.frame_replay_jobs where upload_id=p_upload for update;'; begin
 d:=pg_get_functiondef('app.queue_frame_replay_processing(uuid,jsonb,integer,integer)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'replay_queue_baseline_mismatch'; end if;
 execute replace(d,needle,' select * into u from private.frame_replay_uploads where id=p_upload;'||needle);
end $$;
revoke all on function app.get_my_frame_recording(uuid),app.remove_frame_replay(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app.get_my_frame_recording(uuid),app.remove_frame_replay(uuid,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
