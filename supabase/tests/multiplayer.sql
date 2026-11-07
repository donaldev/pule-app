-- Add extra unclaimed group-local synthetic identities only after old fixture assertions.
insert into private.players(id,origin_group_id) values
 ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001');
insert into app.group_players(group_id,player_id,display_name)
 select origin_group_id,id,'Synthetic rotating '||right(id::text,1) from private.players where id in ('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$
declare g uuid:='10000000-0000-0000-0000-000000000001'; v uuid:='40000000-0000-0000-0000-000000000001';
 r uuid:='50000000-0000-0000-0000-000000000001';
 a uuid:='30000000-0000-0000-0000-000000000001'; b uuid:='30000000-0000-0000-0000-000000000002';
 c uuid:='30000000-0000-0000-0000-000000000005'; d uuid:='30000000-0000-0000-0000-000000000006';
 state jsonb; saved jsonb; sid uuid; fid uuid; op uuid; pair uuid[]; winner uuid; revision bigint; i integer;
begin
 state:=app.start_session(gen_random_uuid(),g,v,r,array[a,b,c],a); sid:=(state#>>'{session,id}')::uuid;
 perform test.ok(jsonb_array_length(state->'participants')=3 and jsonb_array_length(state->'standings')=3,'three-player roster and standings');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L]::uuid[],%L)',sid,a,a),'22023','reject single-player frame');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L,%L]::uuid[],%L)',sid,a,b,c,a),'22023','reject three-player frame');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L]::uuid[],%L)',sid,a,a,a),'22023','reject duplicate frame pair');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L]::uuid[],%L)',sid,a,d,a),'23514','reject non-session group player');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L]::uuid[],%L)',sid,a,'30000000-0000-0000-0000-000000000003',a),'23514','reject cross-group rotating player');
 perform test.denied(format('select app.start_frame(gen_random_uuid(),%L,1,array[%L,%L]::uuid[],%L)',sid,a,b,c),'23514','breaker must be in selected pair');
 for i in 1..3 loop
 pair:=case i when 1 then array[a,b] when 2 then array[b,c] else array[c,a] end;
 winner:=pair[1]; revision:=(state#>>'{session,revision}')::bigint;
 state:=app.start_frame(gen_random_uuid(),sid,revision,pair,pair[1]); fid:=(state->'frames'->(i-1)->>'id')::uuid;
 perform test.ok(jsonb_array_length(state->'frames'->(i-1)->'participants')=2,'frame pair size '||i);
 if i=1 then
 perform test.denied(format('select app.complete_frame(gen_random_uuid(),%L,2,%L,%L,0,0,false,%L)',sid,fid,c,'regular'),'23514','reject winner who sat out');
 end if;
 op:=gen_random_uuid(); revision:=(state#>>'{session,revision}')::bigint;
 state:=app.complete_frame(op,sid,revision,fid,winner,i,0,false,'regular');
 saved:=app.complete_frame(op,sid,revision,fid,winner,i,0,false,'regular');
 perform test.ok(saved=state,'rotating completion retry '||i);
 end loop;
 perform test.ok((state->'scores'->>a::text)::integer=1 and (state->'scores'->>b::text)::integer=1 and (state->'scores'->>c::text)::integer=1,'all three players have one win');
 perform test.ok((select bool_and((x->>'frames_won')::integer=1 and (x->>'frames_lost')::integer=1 and (x->>'frames_played')::integer=2 and (x->>'rank')::integer=1) from jsonb_array_elements(state->'standings') x),'sit-outs excluded and equal wins share rank');
 perform test.ok(state#>>'{frames,1,participants,0,player_id}'=b::text and state#>>'{frames,1,participants,0,foul_count}'='2','fouls assigned to actual frame side not roster position');
 -- Correction to a sitting-out winner must also fail.
 fid:=(state#>>'{frames,0,id}')::uuid;
 perform test.denied(format('select app.correct_frame(gen_random_uuid(),%L,7,%L,%L,0,0,%L)',sid,fid,c,'Invalid sitting-out winner'),'23514','correction winner must have played');
 state:=app.finalize_session(gen_random_uuid(),sid,7);
 perform test.ok((select multiplayer_nights=1 from app.get_standings(g) where player_id=c),'multiplayer nights reported separately');
 perform test.ok((select wins=0 and losses=0 and draws=0 from app.get_standings(g) where player_id=c),'no manufactured multiplayer night WLD');
 state:=app.start_session(gen_random_uuid(),g,v,r,array[a,b,c,d],a); sid:=(state#>>'{session,id}')::uuid;
 perform test.ok(jsonb_array_length(state->'participants')=4,'four-player session');
 state:=app.start_frame(gen_random_uuid(),sid,1,array[d,c],d); fid:=(state#>>'{frames,0,id}')::uuid;
 state:=app.complete_frame(gen_random_uuid(),sid,2,fid,d,2,3,false,'regular');
 perform test.ok((select bool_and((x->>'frames_played')::integer=0 and (x->>'frames_lost')::integer=0) from jsonb_array_elements(state->'standings') x where x->>'player_id' in (a::text,b::text)),'four-player sit-outs receive no loss');
 perform test.ok(state#>>'{frames,0,participants,0,player_id}'=d::text,'frame side can differ from roster order');
 state:=app.start_frame(gen_random_uuid(),sid,3,array[b,d],b); fid:=(state#>>'{frames,1,id}')::uuid;
 state:=app.complete_frame(gen_random_uuid(),sid,4,fid,b,0,1,false,'regular');
 perform test.ok((select count(*)=2 from jsonb_array_elements(state->'standings') x where (x->>'rank')::integer=1 and (x->>'frames_won')::integer=1),'partial tie shares top rank without invented winner');
 perform test.ok((select (x->>'frames_won')::integer=0 and (x->>'frames_lost')::integer=1 from jsonb_array_elements(state->'standings') x where x->>'player_id'=c::text),'four-player actual loser total');
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L,%L,%L]::uuid[],%L)',g,v,r,a,b,a,a),'22023','duplicate session identities rejected');
end $$;
-- Onboard a fresh group from an authenticated account, not operator-created membership.
do $$
declare op uuid:=gen_random_uuid(); g uuid; p uuid; venue uuid; rule uuid; a jsonb;
begin
 a:=app.create_group(op,'Synthetic self-created group','UTC'); g:=(a->>'id')::uuid;
 perform test.ok(app.create_group(op,'Synthetic self-created group','UTC')=a,'group onboarding idempotent');
 perform test.ok((select role='owner' from app.get_my_memberships() where group_id=g),'creator is initial owner');
 a:=app.create_guest_with_email(gen_random_uuid(),g,'Synthetic guest','synthetic-guest@example.invalid'); p:=(a->>'id')::uuid;
 perform test.ok(a->>'ownership_state'='unclaimed','guest creation never claims identity');
 venue:=(app.create_venue(gen_random_uuid(),g,'Synthetic new venue')->>'id')::uuid;
 perform test.denied(format('select app.adopt_rule_version(gen_random_uuid(),%L,%L,false)',g,'Unreviewed settings'),'22023','rule adoption requires explicit review');
 rule:=(app.adopt_rule_version(gen_random_uuid(),g,'Reviewed native v1',true)->>'id')::uuid;
 perform test.ok(rule is not null and venue is not null and p is not null,'owner can prepare versioned scoring setup');
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
 perform test.denied(format('select app.create_guest(gen_random_uuid(),%L,%L)',g,'Unauthorized guest'),'42501','setup cannot target another group');
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
end $$;
reset role;
select test.ok((select count(*) from private.player_account_links)=0,'onboarding leaves every sporting identity unclaimed');
set role anon;
select test.denied($q$select app.create_group(gen_random_uuid(),'Anonymous','UTC')$q$,'42501','anonymous onboarding denied');
reset role;
select test.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','private') and p.prosecdef and p.proconfig is null),'definer functions have fixed search path');

set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.denied($q$select * from app.group_memberships$q$,'42501','raw Auth membership UUIDs hidden');
select test.denied($q$select scorer_user_id from app.match_sessions$q$,'42501','recorder Auth UUID not exposed in raw session reads');
select test.denied($q$select app.adopt_rule_version(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','Viewer cannot verify',true)$q$,'42501','viewer cannot adopt rule configuration');
reset role;
