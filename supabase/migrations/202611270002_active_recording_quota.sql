begin;

-- Keep the existing reservation and cleanup lock. A publication releases its
-- active slot only after the cleanup worker acknowledges the exact source.
-- Published replay rows, review decisions and the retained group budget stay intact.
do $$
declare
 definition text := pg_get_functiondef('private.reserve_frame_recording(uuid,uuid,bigint,text,text,text)'::regprocedure);
 baseline text := '(select count(*) from private.frame_replay_uploads where actor_id=uid and status<>''cleaned'')>=8';
begin
 if strpos(definition,baseline)=0 then
   raise exception 'active_recording_quota_baseline_mismatch';
 end if;
 execute replace(definition,baseline,$quota$
 (select count(*) from private.frame_replay_uploads a
   where a.actor_id=uid and a.status<>'cleaned'
   and not (a.status='committed' and exists (
     select 1 from private.frame_replay_jobs j
     join private.frame_replay_cleanup q on q.upload_id=j.upload_id
     where j.upload_id=a.id and j.state='completed'
       and q.bucket_id=case when a.source_provider='r2' then 'pule-frame-recordings' else 'frame-recordings' end
       and q.storage_path=a.storage_path and q.completed_at is not null
   )))>=8$quota$);
end $$;

commit;
