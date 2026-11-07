-- Synthetic local identities/invitations only. No real Auth flow or email delivery.
update auth.users set email=case when id='20000000-0000-0000-0000-000000000099' then 'donal@example.invalid' else 'reviewer@example.invalid' end,
 confirmation_sent_at=now()-interval '2 hours',email_confirmed_at=now()-interval '1 hour'
 where id in('20000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001');
insert into auth.users(id,email,email_confirmed_at,confirmation_sent_at) values
 ('20000000-0000-0000-0000-000000000100','sean@example.invalid',now(),now()-interval '1 hour'),
 ('20000000-0000-0000-0000-000000000101','alan@example.invalid',now(),null),
 ('20000000-0000-0000-0000-000000000102','wrong@example.invalid',now(),now()-interval '1 hour'),
 ('20000000-0000-0000-0000-000000000103','unconfirmed@example.invalid',null,now()),
 ('20000000-0000-0000-0000-000000000104','assumed@example.invalid',now(),null);
insert into auth.identities(user_id,provider,identity_data)
 select id,case when id='20000000-0000-0000-0000-000000000101' then 'google' else 'email' end,jsonb_build_object('email',email,'email_verified',true)
 from auth.users where email is not null;
delete from private.player_account_links where player_id='acc51043-01a0-507d-8fdd-ae0729e9fe68'; -- remove Phase 5 synthetic link for bootstrap testing
select test.ok(private.verified_email('20000000-0000-0000-0000-000000000103') is null,'unconfirmed email is not ownership evidence');
select test.ok(private.verified_email('20000000-0000-0000-0000-000000000104') is null,'assumed email confirmation without send evidence fails closed');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.denied($q$select private.link_historical_owner('20000000-0000-0000-0000-000000000099','donal@example.invalid','20000000-0000-0000-0000-000000000001','synthetic evidence')$q$,'42501','browser cannot bootstrap historical ownership');
select test.ok(app.get_my_player_stats() is null,'membership and matching display name alone give no personal stats');
reset role;
select test.denied($q$select private.link_historical_owner('20000000-0000-0000-0000-000000000099','wrong@example.invalid','20000000-0000-0000-0000-000000000001','synthetic evidence')$q$,'42501','operator expected email must match trusted verified account');
select test.denied($q$select private.link_historical_owner('20000000-0000-0000-0000-000000000099','donal@example.invalid','20000000-0000-0000-0000-000000000001','')$q$,'42501','operator needs independent evidence reference');
select test.ok(private.link_historical_owner('20000000-0000-0000-0000-000000000099','donal@example.invalid','20000000-0000-0000-0000-000000000001','synthetic independent verification')='acc51043-01a0-507d-8fdd-ae0729e9fe68','explicit verified operator bootstrap preserves historical player UUID');
select test.ok(private.link_historical_owner('20000000-0000-0000-0000-000000000099','donal@example.invalid','20000000-0000-0000-0000-000000000001','synthetic independent verification')='acc51043-01a0-507d-8fdd-ae0729e9fe68','same operator link is an idempotent no-op');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$ declare x jsonb; op uuid:=gen_random_uuid(); hash text:=encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'); begin
 x:=app.create_player_invitation(op,'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','sean@example.invalid',hash);
 perform test.ok(app.lookup_operation_receipt(op)->>'status'='confirmed_committed','invitation creation uses existing own-receipt evidence');
 perform test.ok(x=app.create_player_invitation(op,'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','sean@example.invalid',hash),'invitation creation replay is idempotent');
 perform test.denied(format('select app.create_player_invitation(%L,%L,%L,%L,%L)',op,'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','changed@example.invalid',hash),'22023','invitation operation cannot change recipient');
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000102';
select test.ok(app.preview_player_invitation(repeat('a',64)) is null,'wrong verified email cannot preview recipient/player');
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('a',64),encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'))$q$,'42501','wrong verified email cannot redeem stolen token');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000100';
select test.ok(app.preview_player_invitation(repeat('a',64)) is not null,'verified recipient can preview without membership');
do $$ declare op uuid:=gen_random_uuid(); x jsonb; h text:=encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'); begin
 x:=app.accept_player_invitation(op,repeat('a',64),h);
 perform test.ok(app.lookup_operation_receipt(op)->>'status'='confirmed_committed','claim acceptance supports existing actor-bound receipt lookup');
 perform test.ok(x->>'id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','recipient claims existing Sean, not a replacement player');
 perform test.ok(x=app.accept_player_invitation(op,repeat('a',64),h),'lost acceptance acknowledgment can replay identical operation');
 perform test.denied(format('select app.accept_player_invitation(gen_random_uuid(),%L,%L)',repeat('a',64),h),'42501','new operation cannot reuse consumed invitation');
end $$;
select test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=1,'claim grants only the invited historical matchup');
select test.ok(app.get_my_matchups()->>'player_id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','claimed identity read is account-scoped');
select test.denied('select * from private.player_invitations','42501','raw invitation storage is private');
reset role;
select test.ok((select role='scorer' from app.group_memberships where group_id='383bd6df-9050-4d1c-b48f-d2a0f3349517' and user_id='20000000-0000-0000-0000-000000000100'),'accept grants explicit scorer membership atomically');
select test.ok((select count(*)=2 from private.player_account_links),'claim created no duplicate person/account link');
-- Revoke and expiry, without modifying any real token or historical data.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$ declare g uuid; x jsonb; begin
 select id into g from app.groups where id in(select (m->>'group_id')::uuid from jsonb_array_elements(app.get_my_matchups()->'matchups') m where jsonb_array_length(m->'player_ids')=3);
 x:=app.create_player_invitation(gen_random_uuid(),g,'30000000-0000-0000-0000-000000000099','alan@example.invalid',encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'));
 perform app.revoke_player_invitation(gen_random_uuid(),(x->>'id')::uuid);
 perform app.create_player_invitation(gen_random_uuid(),g,'30000000-0000-0000-0000-000000000099','alan@example.invalid',encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'));
end $$;
reset role;
update private.player_invitations set created_at=now()-interval '3 days',expires_at=now()-interval '1 day' where token_hash=encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000101';
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('b',64),encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'))$q$,'42501','revoked invitation cannot be redeemed');
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('c',64),encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'))$q$,'42501','expired invitation cannot be redeemed');
reset role;
select test.ok(private.verified_email('20000000-0000-0000-0000-000000000101') is not null,'Google provider verified email supported');
reset role;
-- Complete cross-context statistics above the old 100-night limit, through real scoring commands.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$ declare d uuid:='acc51043-01a0-507d-8fdd-ae0729e9fe68'; a uuid:='30000000-0000-0000-0000-000000000099'; g uuid; v uuid; r uuid; state jsonb; sid uuid; fid uuid; begin
 g:=(app.resolve_matchup(gen_random_uuid(),array[d,a],'UTC')->>'group_id')::uuid;
 select id into v from app.venues where group_id=g limit 1;select id into r from app.rule_versions where group_id=g and rules_status='verified' limit 1;
 for i in 1..101 loop
 state:=app.start_session(gen_random_uuid(),g,v,r,array[d,a],d);sid:=(state#>>'{session,id}')::uuid;
 state:=app.start_frame(gen_random_uuid(),sid,1,array[d,a],d);fid:=(state#>>'{frames,0,id}')::uuid;
 perform app.complete_frame(gen_random_uuid(),sid,2,fid,case when i%2=1 then d else a end,0,0,false,'regular');
 perform app.finalize_session(gen_random_uuid(),sid,3);
 end loop;
 perform test.ok((app.get_my_player_stats()->>'nights')::int=102,'personal aggregate has no 100-night limit');
 perform test.ok((app.get_my_player_stats()->>'frames_won')::int=52 and (app.get_my_player_stats()->>'frames_lost')::int=50,'personal aggregate counts native results exactly once');
end $$;
reset role;
set role anon;
select test.denied('select app.get_my_player_stats()','42501','anonymous personal aggregate denied');
select test.denied('select app.get_my_player_invitations()','42501','anonymous invitation listing denied');
reset role;
-- Two fictional score-only nights contribute official results, without fabricated frames.
begin;
do $$ declare g uuid:='383bd6df-9050-4d1c-b48f-d2a0f3349517'; d uuid:='acc51043-01a0-507d-8fdd-ae0729e9fe68'; s uuid:='5c575a65-aa80-590a-843a-0dfc7d5c1d89'; v uuid; r uuid; src uuid; batch uuid; sid uuid; rec uuid; begin
 insert into app.venues(group_id,display_name) values(g,'Synthetic historical venue') returning id into v;
 insert into app.rule_versions(group_id,label,rules_status) values(g,'Synthetic unverified history','legacy_unknown') returning id into r;
 insert into private.import_sources(group_id,namespace) values(g,'synthetic-identity-test') returning id into src;
 insert into private.import_batches(group_id,source_id,checksum,mapping_version,status) values(g,src,repeat('6',64),'synthetic','accepted') returning id into batch;
 for i in 1..2 loop
 insert into app.match_sessions(group_id,venue_id,rule_version_id,status,origin,record_kind,result_authority,sequence_quality,detail_eligible,occurred_on,date_precision,import_batch_id,legacy_match_id)
 values(g,v,r,'finalized','imported','result_only','approved_historical_reported','not_recorded',false,'2020-01-01'::date+i,'date_only',batch,'synthetic-history-'||i) returning id into sid;
 insert into app.session_participants(group_id,session_id,player_id,side) values(g,sid,d,1),(g,sid,s,2);
 for j in 1..2 loop
 insert into private.import_records(group_id,batch_id,record_key,source_sheet,source_row,sanitized_evidence,extracted_hash)
 values(g,batch,i||'/'||j,'Synthetic',i*2+j,'{}','synthetic') returning id into rec;
 insert into app.legacy_session_results(group_id,session_id,player_id,reported_frames_won,source_record_id)
 values(g,sid,case when j=1 then d else s end,case when i=2 then 3 when j=1 then 2 else 1 end,rec);
 end loop;
 end loop;
end $$;
commit;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.ok((app.get_my_player_stats()->>'nights')::int=104 and (app.get_my_player_stats()->>'wins')::int=53 and (app.get_my_player_stats()->>'draws')::int=1,'cross-matchup aggregate includes score-only history plus over 100 native nights');
select test.ok((app.get_my_player_stats()->>'frames_won')::int=57 and (app.get_my_player_stats()->>'frames_lost')::int=54,'reported and native authority counted exactly once');
reset role;
select test.ok(not exists(select 1 from app.frames f join app.match_sessions s on s.id=f.session_id where s.legacy_match_id like 'synthetic-history-%'),'score-only personal history has no invented frames');
-- Losing membership removes that context from the aggregate, even though the player is linked.
begin;
update app.group_memberships set role='admin' where user_id='20000000-0000-0000-0000-000000000099' and group_id in(select group_id from private.matchups where player_ids=private.canonical_players(array['acc51043-01a0-507d-8fdd-ae0729e9fe68','30000000-0000-0000-0000-000000000099']::uuid[]));
insert into app.group_memberships(group_id,user_id,role) select group_id,'20000000-0000-0000-0000-000000000001','owner' from private.matchups where player_ids=private.canonical_players(array['acc51043-01a0-507d-8fdd-ae0729e9fe68','30000000-0000-0000-0000-000000000099']::uuid[]);
update app.group_memberships set status='revoked' where user_id='20000000-0000-0000-0000-000000000099' and group_id in(select group_id from private.matchups where player_ids=private.canonical_players(array['acc51043-01a0-507d-8fdd-ae0729e9fe68','30000000-0000-0000-0000-000000000099']::uuid[]));
commit;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.ok((app.get_my_player_stats()->>'nights')::int=2 and (app.get_my_player_stats()->>'frames_won')::int=5,'identity ownership cannot include inaccessible private history');
-- An account linked to Sean cannot overwrite it with an Alan claim.
do $$ declare g uuid; x jsonb; begin
 select (m->>'group_id')::uuid into g from jsonb_array_elements(app.get_my_matchups()->'matchups') m where jsonb_array_length(m->'player_ids')=3;
 perform test.denied(format('select app.create_player_invitation(gen_random_uuid(),%L,%L,%L,%L)',g,'30000000-0000-0000-0000-000000000099','sean@example.invalid',encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex')),'23505','an associated guest email cannot be changed to another account');
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000100';
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('e',64),encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex'))$q$,'42501','a rejected email association cannot issue a usable claim');
select test.ok(app.get_my_matchups()->>'player_id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','Sean link remains unchanged after conflict');
reset role;
-- Fresh Alan invitation used by the runner for actual concurrent redemption.
insert into auth.users(id,email,email_confirmed_at,confirmation_sent_at) values('20000000-0000-0000-0000-000000000105','alan@example.invalid',now(),now()-interval '1 hour');
insert into auth.identities(user_id,provider,identity_data) values('20000000-0000-0000-0000-000000000105','email','{"email":"alan@example.invalid","email_verified":true}');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$ declare g uuid; old uuid; begin
 select (m->>'group_id')::uuid into g from jsonb_array_elements(app.get_my_matchups()->'matchups') m where jsonb_array_length(m->'player_ids')=3;
 select (i->>'id')::uuid into old from jsonb_array_elements(app.get_my_player_invitations()) i where i->>'email'='sean@example.invalid' and i->>'accepted'='false' and i->>'revoked'='false';
 if old is not null then perform app.revoke_player_invitation(gen_random_uuid(),old); end if;
 perform app.create_player_invitation(gen_random_uuid(),g,'30000000-0000-0000-0000-000000000099','alan@example.invalid',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
end $$;
reset role;
-- Failed acceptance rolls back link, membership and token consumption together.
do $$ declare g uuid; before_count bigint; begin
 select group_id into g from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex');
 select count(*) into before_count from private.player_account_links;
 begin
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000101',true);
 perform app.accept_player_invitation(gen_random_uuid(),repeat('d',64),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
 raise exception 'synthetic_claim_rollback';
 exception when raise_exception then if sqlerrm<>'synthetic_claim_rollback' then raise; end if;
 end;
 perform test.ok((select count(*)=before_count from private.player_account_links),'claim rollback preserves original identity links');
 perform test.ok(not exists(select 1 from app.group_memberships where group_id=g and user_id='20000000-0000-0000-0000-000000000101'),'claim rollback leaves no access grant');
 perform test.ok((select consumed_at is null from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex')),'claim rollback leaves invitation unconsumed');
end $$;
-- Storing a digest does not make that digest a redeemable bearer token.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000101';
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'))$q$,'42501','stored digest alone cannot redeem invitation');
reset role;
insert into app.group_memberships(group_id,user_id,role,status) select group_id,'20000000-0000-0000-0000-000000000101','viewer','revoked' from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000101';
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('d',64),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'))$q$,'42501','claim cannot silently reactivate revoked membership');
reset role;
delete from app.group_memberships where user_id='20000000-0000-0000-0000-000000000101'; -- synthetic denied member only
-- Receipt is actor-bound and has a digest, never the raw acceptance token.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.ok(jsonb_array_length(app.get_my_player_invitations())>=3,'only own sent invitations are listed');
reset role;
select test.ok(not exists(select 1 from private.write_operations where request->>'action'='accept_player_invitation' and request::text like '%'||repeat('a',64)||'%'),'raw acceptance token never enters durable server request evidence');
-- Revoking the inviter invalidates outstanding invitations without editing historical data.
begin;
update app.group_memberships set role='admin' where user_id='20000000-0000-0000-0000-000000000099' and group_id=(select group_id from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
insert into app.group_memberships(group_id,user_id,role) select group_id,'20000000-0000-0000-0000-000000000001','owner' from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex');
update app.group_memberships set status='revoked' where user_id='20000000-0000-0000-0000-000000000099' and group_id=(select group_id from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
commit;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000101';
select test.denied($q$select app.accept_player_invitation(gen_random_uuid(),repeat('d',64),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'))$q$,'42501','revoked inviter cannot confer access through an outstanding invitation');
reset role;
begin;
update app.group_memberships set role='admin' where user_id='20000000-0000-0000-0000-000000000001' and group_id=(select group_id from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
update app.group_memberships set status='active',role='owner' where user_id='20000000-0000-0000-0000-000000000099' and group_id=(select group_id from private.player_invitations where token_hash=encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
commit;
