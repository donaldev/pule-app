-- Synthetic local tests ONLY. Never run against hosted data.
insert into private.players(id,origin_group_id) values('30000000-0000-0000-0000-000000000099','383bd6df-9050-4d1c-b48f-d2a0f3349517');
insert into app.group_players(group_id,player_id,display_name) values('383bd6df-9050-4d1c-b48f-d2a0f3349517','30000000-0000-0000-0000-000000000099','Synthetic same name');
create table test.matchup_snapshot as select array(select id from app.frames) frame_ids,(select md5(string_agg(to_jsonb(f)::text,',' order by id)) from app.frames f) frame_hash,(select count(*) from app.match_sessions) nights,(select count(*) from app.frames) frames,(select sum(reported_frames_won) from app.legacy_session_results) reported;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$
declare d uuid:='acc51043-01a0-507d-8fdd-ae0729e9fe68'; s uuid:='5c575a65-aa80-590a-843a-0dfc7d5c1d89'; a uuid:='30000000-0000-0000-0000-000000000099'; x jsonb; y jsonb; op uuid:=gen_random_uuid(); gid uuid; v uuid; r uuid; st jsonb; sid uuid; fid uuid;
begin
 x:=app.resolve_matchup(op,array[d,s],'UTC');
 perform test.ok(x->>'group_id'='383bd6df-9050-4d1c-b48f-d2a0f3349517','reviewed historical identity set reuses original container');
 perform test.ok(app.resolve_matchup(gen_random_uuid(),array[s,d],'UTC')->>'group_id'=x->>'group_id','reversed order resolves same matchup');
 perform test.ok(app.resolve_matchup(op,array[d,s],'UTC')=x,'resolver operation replay returns original acknowledgment');
 perform test.ok(app.lookup_operation_receipt(op)->>'status'='confirmed_committed','resolver uses existing own-receipt recovery contract');
 perform test.denied(format('select app.resolve_matchup(%L,array[%L,%L]::uuid[],%L)',op,d,a,'UTC'),'22023','resolver rejects operation payload changes');
 y:=app.resolve_matchup(gen_random_uuid(),array[d,a],'UTC');gid:=(y->>'group_id')::uuid;
 perform test.ok(gid::text<>x->>'group_id','different opponent creates separate container');
 perform test.ok(app.resolve_matchup(gen_random_uuid(),array[a,d],'UTC')->>'group_id'=gid::text,'identical combination rerun reuses container');
 perform test.ok(app.resolve_matchup(gen_random_uuid(),array[d,s,a],'UTC')->>'group_id' not in(x->>'group_id',gid::text),'three-player set distinct from pair');
 perform test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=3,'discovery lists only authorized registered contexts');
 perform test.ok(app.get_my_matchups()->>'player_id' is null,'unlinked user is not attributed by equal display name');
 perform test.denied(format('select app.resolve_matchup(gen_random_uuid(),array[%L,%L]::uuid[],%L)',d,d,'UTC'),'22023','duplicate UUIDs rejected');
 perform test.denied(format('select app.resolve_matchup(gen_random_uuid(),array[%L,%L]::uuid[],%L)',d,'30000000-0000-0000-0000-000000000003','UTC'),'42501','cross-context inaccessible identity rejected');
 -- Scoring uses the unchanged commands, including standard rules and exact-set validation.
 v:=(app.create_venue(gen_random_uuid(),gid,'Synthetic venue')->>'id')::uuid;
 select id into r from app.rule_versions where group_id=gid and rules_status='verified' limit 1;
 st:=app.start_session(gen_random_uuid(),gid,v,r,array[d,a],d);
 perform test.ok(jsonb_array_length(st->'participants')=2,'registered matchup starts normal scoring session');
 sid:=(st#>>'{session,id}')::uuid;
 st:=app.start_frame(gen_random_uuid(),sid,1,array[d,a],d);fid:=(st#>>'{frames,0,id}')::uuid;
 st:=app.complete_frame(gen_random_uuid(),sid,2,fid,d,0,0,false,'regular');
 st:=app.finalize_session(gen_random_uuid(),sid,3);
 perform test.ok(st#>>'{session,status}'='finalized' and (st->'scores'->>d::text)::int=1,'registered matchup completes a real frame and finalizes with unchanged commands');
 perform test.denied(format('select app.start_session(gen_random_uuid(),%L,%L,%L,array[%L,%L]::uuid[],%L)',gid,v,r,d,s,d),'23514','wrong registered participant set cannot start a night');
end $$;
reset role;
select test.ok((select count(*)=3 from private.matchups),'exactly three registries, same-name players remain distinct');
select test.ok((select count(*)=1 from app.group_memberships where group_id=(select group_id from private.matchups where player_ids=private.canonical_players(array['acc51043-01a0-507d-8fdd-ae0729e9fe68','30000000-0000-0000-0000-000000000099']::uuid[]))),'new matchup grants creator only');
select test.ok((select count(*)=0 from private.player_account_links),'resolver creates no identity links');
-- An existing authorized source profile is not permission to join someone else's private matchup.
insert into app.group_memberships(group_id,user_id,role) values('383bd6df-9050-4d1c-b48f-d2a0f3349517','20000000-0000-0000-0000-000000000005','scorer');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=1,'other scorer cannot discover private created matchups');
select test.denied($q$select app.resolve_matchup(gen_random_uuid(),array['acc51043-01a0-507d-8fdd-ae0729e9fe68','30000000-0000-0000-0000-000000000099']::uuid[],'UTC')$q$,'42501','matching identities do not grant membership in private existing matchup');
select test.denied('select * from private.matchups','42501','registry table is private');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=0,'unrelated viewer cannot discover historical matchup');
select test.denied($q$select app.resolve_matchup(gen_random_uuid(),array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],'UTC')$q$,'42501','viewer cannot create matchup');
set role anon;
select test.denied('select app.get_my_matchups()','42501','anonymous matchup discovery denied');
select test.denied($q$select app.resolve_matchup(gen_random_uuid(),array['acc51043-01a0-507d-8fdd-ae0729e9fe68','5c575a65-aa80-590a-843a-0dfc7d5c1d89']::uuid[],'UTC')$q$,'42501','anonymous matchup creation denied');
reset role;
select test.ok((select count(*)=(select frames+1 from test.matchup_snapshot) from app.frames),'registered scoring adds exactly its one new frame');
select test.ok((select sum(reported_frames_won)=(select reported from test.matchup_snapshot) from app.legacy_session_results),'reported historical totals untouched');
select test.ok((select md5(string_agg(to_jsonb(f)::text,',' order by id))=(select frame_hash from test.matchup_snapshot) from app.frames f where id=any((select frame_ids from test.matchup_snapshot)::uuid[])),'all preexisting frame records remain byte-identical');
-- A fixture-only verified link is visible only to its own account; no claim API is introduced.
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference) values('acc51043-01a0-507d-8fdd-ae0729e9fe68','20000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001','synthetic verified evidence');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.ok(app.get_my_matchups()->>'player_id'='acc51043-01a0-507d-8fdd-ae0729e9fe68','own verified identity read supported without name inference');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok(app.get_my_matchups()->>'player_id' is null,'another account cannot read private link');
reset role;

do $$ declare before_count bigint; begin
 select count(*) into before_count from app.groups;
 begin
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
 perform app.resolve_matchup(gen_random_uuid(),array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005']::uuid[],'UTC');
 raise exception 'synthetic_rollback';
 exception when raise_exception then
 if sqlerrm<>'synthetic_rollback' then raise; end if;
 end;
 perform test.ok((select count(*)=before_count from app.groups),'failed enclosing transaction leaves no new container');
 perform test.ok(not exists(select 1 from private.matchups where player_ids=private.canonical_players(array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005']::uuid[])),'failed enclosing transaction leaves no registry');
end $$;
update app.group_memberships set status='revoked' where group_id='383bd6df-9050-4d1c-b48f-d2a0f3349517' and user_id='20000000-0000-0000-0000-000000000005';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=0,'revoked access immediately removes matchup discovery');
select test.denied($q$select app.resolve_matchup(gen_random_uuid(),array['acc51043-01a0-507d-8fdd-ae0729e9fe68','5c575a65-aa80-590a-843a-0dfc7d5c1d89']::uuid[],'UTC')$q$,'42501','revoked membership cannot resolve historical matchup');
reset role;
