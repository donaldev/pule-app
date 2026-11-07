-- Synthetic linked identity; never hosted data.
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference)
values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic personal performance test');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.ok((app.get_my_performance()#>>'{totals,nights}')::int=2,'score-only and detailed imported nights included once');
select test.ok((app.get_my_performance()#>>'{totals,frames_won}')::int=6,'reported history authority excludes conflicting detailed raw wins');
select test.ok(jsonb_array_length(app.get_my_performance()->'nights')=2,'all own completed history summaries returned');
select test.ok((select count(*)=0 from app.frames where session_id='80000000-0000-0000-0000-000000000001'),'score-only history has no invented frames');
do $$declare a jsonb; sid uuid; f uuid; p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000002'; op uuid:=gen_random_uuid(); begin
 a:=app.start_session(op,'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);sid:=(a#>>'{session,id}')::uuid;
 perform test.ok((app.get_my_performance()#>>'{totals,nights}')::int=2,'unfinished nights excluded from personal summaries');
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);f:=(a#>>'{frames,0,id}')::uuid;
 a:=app.complete_frame(gen_random_uuid(),sid,2,f,q,0,0,false,'regular');a:=app.finalize_session(gen_random_uuid(),sid,3);
 perform test.ok((app.get_my_performance()#>>'{totals,losses}')::int=1,'native completed loss included');
 perform test.ok((app.get_my_performance()#>>'{totals,nights}')::int=3,'native and imported completed nights counted once');
 perform app.remove_match(gen_random_uuid(),sid,4,'delete');
 perform test.ok((app.get_my_performance()#>>'{totals,nights}')::int=2 and jsonb_array_length(app.get_my_performance()->'nights')=2,'deleted night excluded from totals and form');
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p,q],p);sid:=(a#>>'{session,id}')::uuid;
 perform app.remove_match(gen_random_uuid(),sid,1,'abandon');
 perform test.ok(jsonb_array_length(app.get_my_performance()->'nights')=2,'abandoned night excluded');
end $$;
reset role;
insert into app.group_memberships(group_id,user_id,role) values('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','scorer');
insert into app.group_players(group_id,player_id,display_name) values('10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Synthetic player');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$declare a jsonb; sid uuid; f uuid; p uuid:='30000000-0000-0000-0000-000000000001'; q uuid:='30000000-0000-0000-0000-000000000003'; third uuid:='30000000-0000-0000-0000-000000000004'; begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',array[p,q],p);sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);f:=(a#>>'{frames,0,id}')::uuid;
 a:=app.complete_frame(gen_random_uuid(),sid,2,f,p,0,0,false,'regular');perform app.finalize_session(gen_random_uuid(),sid,3);
 perform test.ok((app.get_my_performance()#>>'{totals,nights}')::int=3 and (app.get_my_performance()#>>'{totals,matchups}')::int=2,'personal summaries span multiple authorized opponents and contexts');
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',array[p,q,third],p);sid:=(a#>>'{session,id}')::uuid;
 a:=app.start_frame(gen_random_uuid(),sid,1,array[p,q],p);f:=(a#>>'{frames,0,id}')::uuid;
 a:=app.complete_frame(gen_random_uuid(),sid,2,f,p,0,0,false,'regular');perform app.finalize_session(gen_random_uuid(),sid,3);
 perform test.ok((app.get_my_performance()#>>'{totals,nights}')::int=4 and (app.get_my_performance()#>>'{totals,multiplayer_nights}')::int=1 and (app.get_my_performance()#>>'{totals,wins}')::int=3,'multiplayer included without inventing a two-player night win');
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.ok(app.get_my_performance()->'totals'='null'::jsonb and app.get_my_performance()->'nights'='[]'::jsonb,'unlinked account cannot select another player');
set role anon;
select test.denied($q$select app.get_my_performance()$q$,'42501','anonymous personal performance denied');
reset role;
update app.group_memberships set status='revoked' where group_id='10000000-0000-0000-0000-000000000002' and user_id='20000000-0000-0000-0000-000000000001';
update app.groups set status='archived' where id='10000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.ok((app.get_my_performance()#>>'{totals,nights}')::int=0 and app.get_my_performance()->'nights'='[]'::jsonb,'inaccessible matchups excluded from personal feed');
reset role;
