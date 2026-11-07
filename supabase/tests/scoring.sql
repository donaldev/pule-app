set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.ok((select count(*) from app.groups)=1,'viewer sees own group only');
select test.ok((select count(*) from app.group_players)=2,'cross-group roster hidden');
select test.denied($q$insert into app.group_memberships(group_id,user_id,role) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','owner')$q$,'42501','no membership self-promotion');
select test.denied($q$select * from private.legacy_frame_observations$q$,'42501','private raw observations denied');
select test.denied($q$select * from private.player_account_links$q$,'42501','account identity mapping private');
select test.denied($q$select app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'30000000-0000-0000-0000-000000000001')$q$,'42501','viewer cannot start scoring');
select test.ok((select frames_won=6 and wins=2 and nights=2 from app.get_standings('10000000-0000-0000-0000-000000000001') where player_id='30000000-0000-0000-0000-000000000001'),'reported authority counts score-only and tracked result once');
select test.ok((select nights=1 and frames_won=3 from app.get_standings('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001') where player_id='30000000-0000-0000-0000-000000000001'),'season filters reported history');
select test.ok((select breaker_id is null and potted_on_break is null and elapsed_ms is null from app.frames where id='90000000-0000-0000-0000-000000000001'),'unknown historical metadata remains null');
select test.ok((select count(*)=0 from app.frames where session_id='80000000-0000-0000-0000-000000000001'),'score-only result has no invented frames');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000004';
select test.ok((select count(*) from app.match_sessions)=0,'nonmember cannot read sessions');
select test.denied($q$select app.get_session_state('80000000-0000-0000-0000-000000000001')$q$,'42501','RPC rejects nonmember');
set role anon;
select test.denied($q$select * from app.match_sessions$q$,'42501','anonymous history denied');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$
declare
 g uuid:='10000000-0000-0000-0000-000000000001'; v uuid:='40000000-0000-0000-0000-000000000001';
 rule uuid:='50000000-0000-0000-0000-000000000001'; p1 uuid:='30000000-0000-0000-0000-000000000001'; p2 uuid:='30000000-0000-0000-0000-000000000002';
 a jsonb; b jsonb; sid uuid; fid uuid; op uuid; rev bigint;
begin
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L]::uuid[],%L)',g,v,rule,p1,p1),'22023','two-player requirement');
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L,%L]::uuid[],%L)',g,'40000000-0000-0000-0000-000000000002',rule,p1,p2,p1),'23503','cross-group venue FK rejected');
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L,%L]::uuid[],%L)',g,v,rule,p1,'30000000-0000-0000-0000-000000000003',p1),'23514','cross-group participant rejected');
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L,%L]::uuid[],%L)',g,v,'50000000-0000-0000-0000-000000000003',p1,p2,p1),'23514','native rejects unknown legacy rule');
 op:=gen_random_uuid(); a:=app.start_session(op,g,v,rule,array[p1,p2],p1); sid:=(a#>>'{session,id}')::uuid;
 perform test.ok(jsonb_array_length(a->'participants')=2,'two-player match created atomically');
 perform test.ok(a=app.start_session(op,g,v,rule,array[p1,p2],p1),'start retry returns original saved state');
 perform test.denied(format('select app.start_session(%L,%L,%L,%L,array[%L,%L]::uuid[],%L)',op,g,v,rule,p1,p2,p2),'22023','operation key cannot change payload');
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p1,p2],p1); fid:=(a#>>'{frames,0,id}')::uuid;
 perform test.ok(a#>>'{frames,0,status}'='running','frame starts with authoritative timer');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,2,array[''30000000-0000-0000-0000-000000000001'',''30000000-0000-0000-0000-000000000002'']::uuid[],%L)',sid,p2),'55000','second active frame rejected');
 a:=app.set_frame_paused(gen_random_uuid(),sid,2,fid,true);
 perform test.ok(a#>>'{frames,0,status}'='paused','frame pause saved');
 -- Completion while paused must preserve accumulated elapsed time exactly.
 rev:=(a#>>'{frames,0,elapsed_ms}')::bigint;
 perform test.denied(format('select app.complete_frame(gen_random_uuid(),%L,3,%L,%L,0,0,true,%L)',sid,fid,p1,'super_foul'),'23514','super foul requires offender');
 op:=gen_random_uuid(); a:=app.complete_frame(op,sid,3,fid,p1,1,0,false,'regular');
 perform test.ok((a#>>'{frames,0,elapsed_ms}')::bigint=rev,'paused completion excludes paused wall time');
 perform test.ok((a->'scores'->>p1::text)::integer=1,'frame awards one win');
 b:=app.complete_frame(op,sid,3,fid,p1,1,0,false,'regular');
 perform test.ok(a=b,'duplicate completion returns original receipt');
 perform test.denied(format('select app.complete_frame(gen_random_uuid(),%L,3,%L,%L,0,0,false,%L)',sid,fid,p2,'regular'),'40001','stale competing submission rejected');
 perform test.denied(format('select app.complete_frame(gen_random_uuid(),%L,4,%L,%L,0,0,false,%L)',sid,fid,p2,'regular'),'55000','completed frame cannot award again with fresh revision');
 a:=app.correct_frame(gen_random_uuid(),sid,4,fid,p2,1,2,'Synthetic wrong-side correction');
 perform test.ok((a->'scores'->>p1::text)::integer=0 and (a->'scores'->>p2::text)::integer=1,'correction recalculates authoritative score');
 perform test.ok(jsonb_array_length(a->'corrections')=1,'correction reason appears in sanitized audit');
 a:=app.finalize_session(gen_random_uuid(),sid,5);
 perform test.ok(a#>>'{session,status}'='finalized','explicit night finalization');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,6,array[''30000000-0000-0000-0000-000000000001'',''30000000-0000-0000-0000-000000000002'']::uuid[],%L)',sid,p1),'55000','no scoring after finalization');
 perform test.ok(app.get_session_state(sid)=a,'read state matches saved response');
end $$;
reset role;
select test.ok((select count(*) from private.match_events where action='correct_frame')=1,'private correction journal retained');
select test.ok((select count(*) from private.player_account_links)=0,'guest players remain unclaimed');
select test.ok((select count(*) from private.legacy_frame_observations where disposition='excluded_noncanonical' and canonical_frame_id is null)=1,'excluded observation preserved privately without canonical identity');
select test.denied($q$delete from private.match_events$q$,'55000','journal immutable even to accidental privileged DML');
-- Deferred native/historical invariants and cross-group FKs also protect operator paths.
select test.denied($q$update app.session_participants set group_id='10000000-0000-0000-0000-000000000002' where session_id='80000000-0000-0000-0000-000000000001' and side=1$q$,'23503','operator cannot cross group parent reference');
-- Additional boundary cases: state rollback, write permissions, active-draft preservation.
insert into app.group_memberships(group_id,user_id,role) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','scorer');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied($q$update app.frames set winner_id='30000000-0000-0000-0000-000000000002'$q$,'42501','no direct frame writes even for scorer');
select test.denied($q$select app.get_standings('10000000-0000-0000-0000-000000000002')$q$,'42501','cross-group standings RPC denied');
do $$
declare
 g uuid:='10000000-0000-0000-0000-000000000001'; v uuid:='40000000-0000-0000-0000-000000000001';
 rule uuid:='50000000-0000-0000-0000-000000000001'; p1 uuid:='30000000-0000-0000-0000-000000000001'; p2 uuid:='30000000-0000-0000-0000-000000000002';
 a jsonb; sid uuid; f1 uuid; f2 uuid;
begin
 a:=app.start_session(gen_random_uuid(),g,v,rule,array[p1,p2],p1); sid:=(a#>>'{session,id}')::uuid;
 perform test.denied(format('select app.finalize_session(gen_random_uuid(),%L,1)',sid),'55000','empty native night cannot finalize');
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[''30000000-0000-0000-0000-000000000001'',''30000000-0000-0000-0000-000000000002'']::uuid[],%L)',sid,p1),'42501','other scorer cannot take over assigned session');
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p1,p2],p1); f1:=(a#>>'{frames,0,id}')::uuid;
 perform test.denied(format('select app.finalize_session(gen_random_uuid(),%L,2)',sid),'55000','running frame blocks finalization');
 a:=app.set_frame_paused(gen_random_uuid(),sid,2,f1,true);
 a:=app.set_frame_paused(gen_random_uuid(),sid,3,f1,false);
 perform test.ok(a#>>'{frames,0,status}'='running','timer resumes with server anchor');
 a:=app.complete_frame(gen_random_uuid(),sid,4,f1,p1,0,0,false,'regular');
 a:=app.start_frame(gen_random_uuid(),sid,5,array[p1,p2],p2); f2:=(a#>>'{frames,1,id}')::uuid;
 a:=app.correct_frame(gen_random_uuid(),sid,6,f1,p2,0,0,'Synthetic old-frame correction');
 perform test.ok(a#>>'{frames,1,status}'='running' and a#>>'{frames,1,id}'=f2::text,'earlier correction preserves running frame');
 perform test.denied(format('select app.complete_frame(gen_random_uuid(),%L,7,%L,%L,0,0,true,%L)',sid,f2,p1,'golden_break'),'23514','golden break cannot credit nonbreaker');
 perform test.ok((app.get_session_state(sid)#>>'{session,revision}')::integer=7,'invalid transaction leaves revision unchanged');
end $$;
reset role;
-- Updating referenced rules cannot silently change native validation semantics.
select test.denied($q$update app.rule_versions set label='Changed underneath history' where id='50000000-0000-0000-0000-000000000001'$q$,'55000','used rules immutable');
-- Check all exposed tables actually have RLS and no ordinary write grants.
select test.ok(not exists(select 1 from pg_tables where schemaname='app' and not rowsecurity),'RLS enabled on every app table');
select test.ok(not exists(select 1 from information_schema.role_table_grants where table_schema in ('app','private') and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),'no ordinary table mutation grants');
