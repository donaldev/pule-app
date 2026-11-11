-- Release quota only for this attempt's cleaned objects, not an unrelated replay
-- on the same frame (e.g. a manual Phase 1 attachment that won the race).
begin;
do $$
declare d text; needle text:='and not exists(select 1 from app.frame_replays r where r.frame_id=u.frame_id)';
 replacement text:=$patch$and not exists(select 1 from app.frame_replays r join private.frame_replay_cleanup owned
 on owned.bucket_id='frame-replays' and owned.storage_path=r.storage_path where owned.upload_id=u.id)$patch$;
begin
 d:=pg_get_functiondef('app.finish_frame_replay_cleanup(text,text,uuid,boolean)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'replay_cleanup_baseline_mismatch'; end if;
 execute replace(d,needle,replacement);
end $$;
notify pgrst,'reload schema';
commit;
