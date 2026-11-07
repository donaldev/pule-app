-- Focused disposable checks only; no real addresses/links/invites.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
do $$ declare x jsonb; y jsonb; op uuid:=gen_random_uuid(); g uuid:='10000000-0000-0000-0000-000000000001'; begin
 perform test.denied(format('select app.create_guest(gen_random_uuid(),%L,%L)',g,'Alex'),'22023','new name-only creation rejected');
 perform test.denied(format('select app.create_guest_with_email(gen_random_uuid(),%L,%L,%L)',g,'Alex',''),'22023','blank email rejected');
 x:=app.create_guest_with_email(op,g,'Alex','  One@Example.invalid ');
 y:=app.create_guest_with_email(gen_random_uuid(),g,'Alex','two@example.invalid');
 perform test.ok(x->>'id'<>y->>'id','same display name can identify distinct people');
 perform test.ok(x=app.create_guest_with_email(op,g,'Alex','one@example.invalid'),'same operation replays without duplicate email/player');
 perform test.denied(format('select app.create_guest_with_email(gen_random_uuid(),%L,%L,%L)',g,'Another name','ONE@example.invalid'),'23505','normalized email cannot create another UUID');
 perform test.ok(app.find_guest_by_email(' ONE@example.invalid ')->>'player_id'=x->>'id','authorized lookup offers original UUID');
end $$;
select test.denied('select * from private.player_guest_emails','42501','guest emails have no client table access');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok(app.find_guest_by_email('one@example.invalid') is null,'private email match never exposes an unauthorized identity');
select test.denied($q$select app.create_guest_with_email(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','Alex','one@example.invalid')$q$,'42501','creation authority is checked before email collision lookup');
set role anon;
select test.denied($q$select app.find_guest_by_email('one@example.invalid')$q$,'42501','anonymous email lookup denied');
reset role;
select test.ok((select count(*)=2 from private.player_guest_emails),'duplicates and retries insert no extra email associations');
select test.denied($q$update private.player_guest_emails set normalized_email='changed@example.invalid' where normalized_email='one@example.invalid'$q$,'55000','email reassignment is not a public correction path');
-- A genuinely committed old operation can still be replayed with its exact old payload.
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select private.setup_command('create_guest','60000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','{"name":"Synthetic legacy"}');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.ok(app.create_guest('60000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','Synthetic legacy')->>'display_name'='Synthetic legacy','old committed intent remains replayable without payload rewriting');
reset role;
-- Historical association goes through verified, linked owner invitation authority only.
update auth.users set email=case when id='20000000-0000-0000-0000-000000000099' then 'owner@example.invalid' else 'reviewer@example.invalid' end,
 confirmation_sent_at=now()-interval '2 hours',email_confirmed_at=now()-interval '1 hour'
 where id in('20000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001');
insert into auth.identities(user_id,provider,identity_data) select id,'email',jsonb_build_object('email',email,'email_verified',true) from auth.users where email is not null;
select private.link_historical_owner('20000000-0000-0000-0000-000000000099','owner@example.invalid','20000000-0000-0000-0000-000000000001','synthetic explicit owner approval');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.denied($q$select app.create_player_invitation(gen_random_uuid(),'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','sean@example.invalid',repeat('a',64))$q$,'42501','scoring permission cannot associate a historical guest email');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select app.create_player_invitation(gen_random_uuid(),'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','Sean@Example.invalid',repeat('a',64));
select test.ok(app.find_guest_by_email('sean@example.invalid')->>'player_id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','owner association preserves historical Sean UUID');
select test.denied($q$select app.create_player_invitation(gen_random_uuid(),'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','other@example.invalid',repeat('b',64))$q$,'23505','existing historical email cannot be reassigned');
reset role;
select test.ok((select source='reviewed_invitation' from private.player_guest_emails where player_id='5c575a65-aa80-590a-843a-0dfc7d5c1d89'),'association retains authorized provenance');
-- Google discovery: canonical email PLUS a fresh owner-authorized grant, never email alone.
insert into auth.users(id,email,email_confirmed_at) values
 ('20000000-0000-0000-0000-000000000100','sean@example.invalid',now()),
 ('20000000-0000-0000-0000-000000000101','nobody@example.invalid',now());
insert into auth.identities(user_id,provider,identity_data) values
 ('20000000-0000-0000-0000-000000000100','email','{"email":"sean@example.invalid","email_verified":true}'),
 ('20000000-0000-0000-0000-000000000101','google','{"email":"nobody@example.invalid","email_verified":true}');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000100';
select test.ok(app.get_guest_email_claim()->>'status'='none','non-Google evidence cannot discover a Google claim');
reset role;
insert into auth.identities(user_id,provider,identity_data) values('20000000-0000-0000-0000-000000000100','google','{"email":"sean@example.invalid","email_verified":true}');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000101';
select test.ok(app.get_guest_email_claim()='{"status":"none"}'::jsonb,'no matching email continues normally without disclosing a player');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$ declare a uuid; g uuid; begin
 a:=(app.create_guest_with_email(gen_random_uuid(),'383bd6df-9050-4d1c-b48f-d2a0f3349517','Synthetic Alan','alan@example.invalid')->>'id')::uuid;
 g:=(app.resolve_matchup(gen_random_uuid(),array['acc51043-01a0-507d-8fdd-ae0729e9fe68','5c575a65-aa80-590a-843a-0dfc7d5c1d89',a]::uuid[],'UTC')->>'group_id')::uuid;
 perform app.create_player_invitation(gen_random_uuid(),g,'5c575a65-aa80-590a-843a-0dfc7d5c1d89','sean@example.invalid',repeat('c',64));
 -- Another context containing Sean, with no authorized invitation: must remain private.
 perform app.resolve_matchup(gen_random_uuid(),array['5c575a65-aa80-590a-843a-0dfc7d5c1d89',a]::uuid[],'UTC');
end $$;
reset role;
create table test.google_claim_before as select (select count(*) from private.players) players,
 (select md5(string_agg(to_jsonb(r)::text,',' order by r.session_id,r.player_id)) from app.legacy_session_results r) result_hash;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000100';
select test.ok(app.get_guest_email_claim()->>'status'='eligible' and app.get_guest_email_claim()->>'player_id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89' and (app.get_guest_email_claim()->>'matchup_count')::int=2,'one canonical guest with two eligible grants is offered');
select test.denied($q$select app.claim_guest_email(gen_random_uuid(),'acc51043-01a0-507d-8fdd-ae0729e9fe68')$q$,'42501','caller cannot substitute another player UUID');
reset role;
update private.player_invitations set revoked_at=now() where recipient_email='sean@example.invalid';
set role authenticated;
select test.ok(app.get_guest_email_claim()='{"status":"needs_invitation"}'::jsonb,'an email match without fresh permission exposes no name and grants nothing');
select test.denied($q$select app.claim_guest_email(gen_random_uuid(),'5c575a65-aa80-590a-843a-0dfc7d5c1d89')$q$,'42501','revoked grants cannot be used after discovery');
reset role;
update private.player_invitations set revoked_at=null where recipient_email='sean@example.invalid'; -- restore synthetic grants only
set role authenticated;
do $$ declare op uuid:=gen_random_uuid(); x jsonb; begin
 x:=app.claim_guest_email(op,'5c575a65-aa80-590a-843a-0dfc7d5c1d89');
 perform test.ok(x->>'id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','confirmation retains the existing historical UUID');
 perform test.ok(x=app.claim_guest_email(op,'5c575a65-aa80-590a-843a-0dfc7d5c1d89'),'confirmation replay is idempotent');
 perform test.ok(app.lookup_operation_receipt(op)->>'status'='confirmed_committed','claim uses existing actor-bound receipt recovery');
end $$;
select test.ok(app.get_guest_email_claim()->>'status'='connected','an already linked account is not offered a second identity');
select test.ok(jsonb_array_length(app.get_my_matchups()->'matchups')=2,'only the two explicitly eligible matchups become accessible');
reset role;
select test.ok((select count(*)=(select players from test.google_claim_before) from private.players),'claim creates no duplicate player');
select test.ok((select md5(string_agg(to_jsonb(r)::text,',' order by r.session_id,r.player_id))=(select result_hash from test.google_claim_before) from app.legacy_session_results r),'Google claim leaves reported historical scores unchanged');
set role anon;
select test.denied('select app.get_guest_email_claim()','42501','anonymous candidate discovery denied');
reset role;
