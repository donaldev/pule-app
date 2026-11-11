-- Synthetic identities only; exercise the same trusted Auth evidence as guest claiming.
insert into auth.users(id,email,email_confirmed_at,confirmation_sent_at,raw_user_meta_data)
select ('21000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'init'||n||'@example.invalid',case when n<>5 then now() end,now()-interval '1 hour',
 case when n=1 then '{"full_name":"Google Person"}'::jsonb when n=2 then '{"display_name":"Email Person"}'::jsonb else '{}'::jsonb end
from generate_series(1,8)n;
insert into auth.identities(user_id,provider,identity_data)
select id,case when email='init1@example.invalid' then 'google' else 'email' end,
 jsonb_build_object('email',email,'email_verified',true) from auth.users where email like 'init%@example.invalid';
create table test.identity_snapshot as select
 (select jsonb_agg(to_jsonb(f)) from app.frames f) frames,
 (select jsonb_agg(to_jsonb(s)) from app.match_sessions s) sessions,
 (select jsonb_agg(to_jsonb(m)) from app.group_memberships m) memberships,
 (select jsonb_agg(to_jsonb(p)) from app.group_players p) profiles;
set role authenticated;
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000001';
select test.ok(app.get_my_player_initialization()->>'name'='Google Person','Google profile name available');
select app.initialize_my_player('61000000-0000-0000-0000-000000000001');
select test.ok(app.get_my_player_initialization()->>'status'='linked','Google identity initialized');
select test.ok(app.initialize_my_player('61000000-0000-0000-0000-000000000001')=app.initialize_my_player('61000000-0000-0000-0000-000000000002','Ignored rename'),'repeat login preserves UUID and origin');
select test.denied($q$select app.initialize_my_player('61000000-0000-0000-0000-000000000001','Changed')$q$,'22023','operation payload reuse rejected');
select test.ok(app.lookup_operation_receipt('61000000-0000-0000-0000-000000000001')->>'status'='confirmed_committed','initialization receipt recoverable');
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000002';
select test.ok(app.lookup_operation_receipt('61000000-0000-0000-0000-000000000001')->>'status'='not_confirmed','other actor cannot recover receipt');
select test.ok(app.get_my_player_initialization()->>'name'='Email Person','confirmed email profile name available');
select app.initialize_my_player('61000000-0000-0000-0000-000000000003');
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000003';
select test.ok(app.get_my_player_initialization()->>'status'='name_required','unlinked account without name asks minimally');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'   ')$q$,'22023','invalid name rolls back');
select test.ok(app.get_my_player_initialization()->>'status'='name_required','invalid name creates no identity');
select app.initialize_my_player(gen_random_uuid(),'Chosen name');
select test.ok(app.get_my_player_initialization()->>'status'='linked','existing unlinked account initializes');
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000005';
select test.ok(app.get_my_player_initialization()->>'status'='confirmation_required','unconfirmed email cannot initialize');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'Forged')$q$,'42501','metadata verification cannot bypass Auth confirmation');
select test.denied($q$select private.player_initialization_state('21000000-0000-0000-0000-000000000001')$q$,'42501','private identity helper unavailable');
reset role;
-- Associate a guest through the existing owner-authorized path, never a name match.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select app.create_guest_with_email(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','Existing guest','init4@example.invalid');
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000004';
select test.ok(app.get_my_player_initialization()->>'status'='claim_required','existing guest association defers initialization');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'Duplicate')$q$,'55000','guest email never authorizes automatic claiming');
reset role;
select test.ok(not exists(select 1 from private.player_account_links where user_id='21000000-0000-0000-0000-000000000004'),'guest conflict creates no link');
select test.ok((select count(*)=3 from private.player_account_links where user_id::text like '21000000%'),'exactly one link per initialized account');
select test.ok((select display_name='Google Person' from app.group_players where player_id=(select player_id from private.player_account_links where user_id='21000000-0000-0000-0000-000000000001')),'repeat operation does not rename player');
select test.ok((select frames is not distinct from (select jsonb_agg(to_jsonb(f)) from app.frames f) and sessions is not distinct from (select jsonb_agg(to_jsonb(s)) from app.match_sessions s) from test.identity_snapshot),'existing frames and sessions unchanged');
select test.ok((select (select jsonb_agg(to_jsonb(m)) from app.group_memberships m) @> memberships and (select jsonb_agg(to_jsonb(p)) from app.group_players p) @> profiles from test.identity_snapshot),'original memberships and player names preserved');
-- Old invitations without a guest-email association must also prevent duplicates.
insert into private.player_invitations(group_id,player_id,issuer_id,recipient_email,token_hash,created_at,expires_at)
values('10000000-0000-0000-0000-000000000001','5c575a65-aa80-590a-843a-0dfc7d5c1d89','20000000-0000-0000-0000-000000000001','init8@example.invalid',repeat('e',64),now()-interval '3 days',now()-interval '1 day');
set role authenticated;
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000008';
select test.ok(app.get_my_player_initialization()->>'status'='claim_required','expired unresolved invitation still prevents a duplicate');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'Duplicate')$q$,'55000','unresolved legacy invitation needs explicit resolution');
reset role;
-- Trusted synthetic linkage mirrors an established account, then uses the real invitation flow.
update auth.users set email='owner-init@example.invalid',email_confirmed_at=now(),confirmation_sent_at=now()-interval '1 hour' where id='20000000-0000-0000-0000-000000000099';
insert into auth.identities(user_id,provider,identity_data) values('20000000-0000-0000-0000-000000000099','email','{"email":"owner-init@example.invalid","email_verified":true}');
insert into private.player_account_links(player_id,user_id,verified_by,verification_reference)
values('acc51043-01a0-507d-8fdd-ae0729e9fe68','20000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000099','synthetic established link');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select test.ok(app.initialize_my_player(gen_random_uuid(),'Do not rename')->>'id'='acc51043-01a0-507d-8fdd-ae0729e9fe68','established account preserves sporting UUID');
select app.create_player_invitation(gen_random_uuid(),'383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','init7@example.invalid',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
set request.jwt.claim.sub='21000000-0000-0000-0000-000000000007';
select test.ok(app.get_my_player_initialization()->>'status'='claim_required','pending invitation defers initialization');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'No duplicate')$q$,'55000','pending invitation blocks duplicate player');
select test.ok(app.accept_player_invitation(gen_random_uuid(),repeat('d',64),encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'))->>'id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','authorized acceptance preserves guest UUID');
select test.ok(app.initialize_my_player(gen_random_uuid())->>'id'='5c575a65-aa80-590a-843a-0dfc7d5c1d89','initialization after claim preserves historical player');
reset role;
set role anon;
select test.denied($q$select app.get_my_player_initialization()$q$,'42501','anonymous initialization read denied');
select test.denied($q$select app.initialize_my_player(gen_random_uuid(),'Anonymous')$q$,'42501','anonymous initialization write denied');
reset role;
