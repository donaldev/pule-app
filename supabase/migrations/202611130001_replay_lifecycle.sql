-- Reuse reservation locks, worker leases and the durable cleanup ledger.
begin;
create function app.get_session_frame_recordings(p_session uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('frame_id',u.frame_id,
 'state',case when u.status='cleanup' then 'cleanup' when u.status='reserved' then 'uploading' else 'processing' end,
 'owned',u.actor_id=auth.uid(),
 'failed',coalesce(j.failure_code not in ('replay_removed'),false))), '[]'::jsonb)
 from (select distinct on (frame_id) * from private.frame_replay_uploads
 where session_id=p_session and status in ('reserved','committed','cleanup')
 order by frame_id,case when status='cleanup' then 1 else 0 end,created_at desc) u
 left join private.frame_replay_jobs j on j.upload_id=u.id
 where u.session_id=p_session
 and private.replay_frame_eligible(u.frame_id)
 and not exists(select 1 from app.frame_replays r where r.frame_id=u.frame_id)
$$;
revoke all on function app.get_session_frame_recordings(uuid) from public,anon,authenticated,service_role;
grant execute on function app.get_session_frame_recordings(uuid) to authenticated;

create function private.retire_frame_recording(p_upload uuid,p_reason text) returns void
language plpgsql set search_path='' as $$
declare u private.frame_replay_uploads; j private.frame_replay_jobs; due timestamptz;
begin
 -- Caller holds the upload-control lock. Never retire a published attempt.
 select * into u from private.frame_replay_uploads where id=p_upload;
 select * into j from private.frame_replay_jobs where upload_id=p_upload;
 if u.id is null or u.status in ('cleanup','cleaned') or j.state='completed' then return; end if;
 due:=greatest(clock_timestamp(),coalesce(j.lease_until,clock_timestamp())+interval '5 minutes');
 -- A legacy failed job may have lost its lease deadline; allow its writer to quiesce.
 if j.state='failed' then due:=greatest(due,clock_timestamp()+interval '45 minutes'); end if;
 perform private.enqueue_replay_cleanup('frame-replays',j.output_path,due);
 perform private.enqueue_replay_cleanup('frame-recordings',u.storage_path,
 case when u.source_provider='supabase' then greatest(due,u.expires_at+interval '24 hours') else due end);
 update private.frame_replay_cleanup set due_at=greatest(due_at,due),lease_id=null,lease_until=null
 where upload_id=u.id and completed_at is null;
 update private.frame_replay_uploads set status='cleanup' where id=u.id;
 insert into private.frame_replay_jobs(upload_id,state,failure_code) values(u.id,'failed',p_reason)
 on conflict(upload_id) do update set state='failed',failure_code=p_reason,lease_until=null;
end $$;
revoke all on function private.retire_frame_recording(uuid,text) from public,anon,authenticated,service_role;

create or replace function app.fail_frame_replay_processing(p_upload uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j private.frame_replay_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into j from private.frame_replay_jobs where upload_id=p_upload for update;
 if j.state='failed' and j.lease_id=p_lease then return; end if;
 if j.state is distinct from 'processing' or j.lease_id is distinct from p_lease then raise exception 'processing_lease_invalid' using errcode='55000'; end if;
 perform private.retire_frame_recording(p_upload,'processing_failed');
end $$;

-- Only the trusted broker can classify a verified, terminal source-integrity failure.
create function app.fail_frame_recording_upload(p_upload uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u private.frame_replay_uploads;
begin
 perform pg_advisory_xact_lock(hashtextextended('pule/replay-upload-control',0));
 select * into u from private.frame_replay_uploads where id=p_upload and actor_id=p_actor and source_provider='r2';
 if not found then raise exception 'replay_upload_denied' using errcode='42501'; end if;
 if u.status in ('cleanup','cleaned') then return; end if;
 if u.status<>'reserved' then raise exception 'replay_upload_already_committed' using errcode='55000'; end if;
 perform private.retire_frame_recording(p_upload,'upload_failed');
end $$;
revoke all on function app.fail_frame_recording_upload(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.fail_frame_recording_upload(uuid,uuid) to service_role;

-- Preserve existing bodies and permissions; fail migration on unexpected baselines.
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('private.reserve_frame_recording(uuid,uuid,bigint,text,text,text)'::regprocedure);
 needle:='where frame_id=p_frame and status in (''reserved'',''committed'')';
 if strpos(d,needle)=0 then raise exception 'reservation_baseline_mismatch'; end if;
 d:=replace(d,needle,'where frame_id=p_frame and status in (''reserved'',''committed'',''cleanup'')');
 needle:=' update private.frame_replay_uploads set status=''cleanup'' where status=''reserved'' and expires_at<=clock_timestamp();
 perform private.enqueue_replay_cleanup(''frame-recordings'',x.storage_path,x.expires_at+interval ''24 hours'') from private.frame_replay_uploads x where x.status=''cleanup'';';
 if strpos(d,needle)=0 then raise exception 'reservation_expiry_baseline_mismatch'; end if;
 -- Do not let unrelated reservations shorten an existing cleanup/writer barrier.
 execute replace(d,needle,' for u in select * from private.frame_replay_uploads where status=''reserved'' and expires_at<=clock_timestamp() loop
 perform private.retire_frame_recording(u.id,''upload_expired'');
 end loop;');
 d:=pg_get_functiondef('app.queue_frame_replay_processing(uuid,jsonb,integer,integer)'::regprocedure);
 needle:='if not found or u.status<>''committed''';
 if strpos(d,needle)=0 then raise exception 'queue_baseline_mismatch'; end if;
 execute replace(d,needle,'if not found or j.state=''failed'' or u.status<>''committed''');
 d:=pg_get_functiondef('private.claim_frame_recording(text)'::regprocedure);
 needle:='update private.frame_replay_jobs set state=''failed'',failure_code=''lease_expired'',lease_id=null,lease_until=null where upload_id=j.upload_id;';
 if strpos(d,needle)=0 then raise exception 'claim_baseline_mismatch'; end if;
 execute replace(d,needle,'perform private.retire_frame_recording(j.upload_id,''lease_expired'');');
 d:=pg_get_functiondef('app.claim_frame_replay_cleanup(integer)'::regprocedure);
 needle:=' for u in select x.*';
 if strpos(d,needle)=0 then raise exception 'cleanup_claim_baseline_mismatch'; end if;
 -- Also recover terminal failures/expired writers when only the cleanup worker runs.
 d:=replace(d,needle,' for j in select * from private.frame_replay_jobs where state=''failed'' or (state=''processing'' and lease_until<=clock_timestamp()) loop
 perform private.retire_frame_recording(j.upload_id,coalesce(j.failure_code,''lease_expired''));
 end loop;'||needle);
 needle:=' select * into j from private.frame_replay_jobs where upload_id=u.id;
 perform private.enqueue_replay_cleanup(''frame-recordings'',u.storage_path,greatest(clock_timestamp(),u.expires_at+interval ''24 hours''));
 perform private.enqueue_replay_cleanup(''frame-replays'',j.output_path,clock_timestamp());
 update private.frame_replay_uploads set status=''cleanup'' where id=u.id;
 update private.frame_replay_jobs set state=''failed'',failure_code=''retention_expired'',lease_id=null,lease_until=null where upload_id=u.id;';
 if strpos(d,needle)=0 then raise exception 'cleanup_retention_baseline_mismatch'; end if;
 execute replace(d,needle,' perform private.retire_frame_recording(u.id,''retention_expired'');');
 d:=pg_get_functiondef('app.finish_frame_replay_cleanup(text,text,uuid,boolean)'::regprocedure);
 needle:=' else
 update private.frame_replay_cleanup set due_at=';
 if strpos(d,needle)=0 then raise exception 'cleanup_finish_baseline_mismatch'; end if;
 execute replace(d,needle,' -- Drop processing payloads only after every object is confirmed absent and writers have quiesced.
 delete from private.frame_replay_jobs j using private.frame_replay_uploads u
 where j.upload_id=u.id and u.id=q.upload_id and u.status=''cleaned'' and j.state=''failed'';
 -- Keep compact upload/cleanup receipts for idempotency, quotas and late-write recovery.
 else
 update private.frame_replay_cleanup set due_at=');
end $$;
notify pgrst,'reload schema';
commit;
