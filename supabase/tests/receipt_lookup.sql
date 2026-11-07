-- Synthetic local fixtures only. Not a hosted verification script.
create table test.receipt_case as
 select o.operation_id,o.actor_id,o.group_id,o.request,o.response,
 (o.response#>>'{session,id}')::uuid as session_id,
 s.revision as current_revision,
 (select count(*) from private.write_operations) as receipt_count,
 (select count(*) from private.match_events) as event_count
 from private.write_operations o join app.match_sessions s on s.id=(o.response#>>'{session,id}')::uuid
 where o.actor_id='20000000-0000-0000-0000-000000000002' and o.request->>'action'='complete_frame'
 order by o.committed_at desc limit 1;
grant select on test.receipt_case to authenticated;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.ok((select app.lookup_operation_receipt(operation_id)->>'status'='confirmed_committed' from test.receipt_case),'receipt original actor authorized');
select test.ok((select app.lookup_operation_receipt(operation_id)->'command'=request from test.receipt_case),'receipt full original context retained');
select test.ok((select (app.lookup_operation_receipt(operation_id)->>'actor_id')::uuid=actor_id from test.receipt_case),'receipt actor binding');
select test.ok((select app.lookup_operation_receipt(operation_id)#>'{saved,revision}'=response#>'{session,revision}' from test.receipt_case),'receipt reports committed revision not current revision');
select test.ok(app.lookup_operation_receipt(gen_random_uuid())='{"status":"not_confirmed"}'::jsonb,'unknown UUID has uniform negative response');
select test.ok((select revision=current_revision from app.match_sessions s join test.receipt_case c on c.session_id=s.id),'lookup does not advance session revision');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select test.ok((select app.lookup_operation_receipt(operation_id)='{"status":"not_confirmed"}'::jsonb from test.receipt_case),'same-group owner cannot inspect another actor receipt');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000005';
select test.ok((select app.lookup_operation_receipt(operation_id)='{"status":"not_confirmed"}'::jsonb from test.receipt_case),'cross-group actor cannot inspect receipt');
reset role;
update app.group_memberships set status='revoked' where group_id='10000000-0000-0000-0000-000000000001' and user_id='20000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select test.ok((select app.lookup_operation_receipt(operation_id)='{"status":"not_confirmed"}'::jsonb from test.receipt_case),'revoked membership cannot confirm receipt');
reset role;
update app.group_memberships set status='active',role='viewer' where group_id='10000000-0000-0000-0000-000000000001' and user_id='20000000-0000-0000-0000-000000000002';
set role authenticated;
select test.ok((select app.lookup_operation_receipt(operation_id)='{"status":"not_confirmed"}'::jsonb from test.receipt_case),'downgraded viewer cannot confirm scoring receipt');
reset role;
update app.group_memberships set role='scorer' where group_id='10000000-0000-0000-0000-000000000001' and user_id='20000000-0000-0000-0000-000000000002';
update app.match_sessions set scorer_user_id='20000000-0000-0000-0000-000000000004' where id=(select session_id from test.receipt_case);
set role authenticated;
select test.ok((select app.lookup_operation_receipt(operation_id)='{"status":"not_confirmed"}'::jsonb from test.receipt_case),'original scorer without current assignment cannot confirm');
reset role;
update app.group_memberships set role='admin' where group_id='10000000-0000-0000-0000-000000000001' and user_id='20000000-0000-0000-0000-000000000002';
set role authenticated;
select test.ok((select app.lookup_operation_receipt(operation_id)->>'status'='confirmed_committed' from test.receipt_case),'original actor with current admin rights can confirm');
reset role;
update app.group_memberships set role='scorer' where group_id='10000000-0000-0000-0000-000000000001' and user_id='20000000-0000-0000-0000-000000000002';
update app.match_sessions set scorer_user_id='20000000-0000-0000-0000-000000000002' where id=(select session_id from test.receipt_case);
set role authenticated;
set request.jwt.claim.sub='';
select test.denied($q$select app.lookup_operation_receipt(gen_random_uuid())$q$,'42501','receipt RPC requires authenticated subject');
set role anon;
select test.denied($q$select app.lookup_operation_receipt(gen_random_uuid())$q$,'42501','anonymous receipt RPC execution denied');
reset role;
select test.ok((select receipt_count=(select count(*) from private.write_operations) and event_count=(select count(*) from private.match_events) from test.receipt_case),'lookup creates no receipts or events');
select test.ok((select p.provolatile='s' and p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid='app.lookup_operation_receipt(uuid)'::regprocedure),'receipt lookup stable definer with fixed path');
-- Explicit setup receipt support is equally actor/group scoped.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
-- Existing synthetic create_guest receipt, no new mutation to test the lookup.
reset role;
create table test.setup_receipt_case as select operation_id from private.write_operations where actor_id='20000000-0000-0000-0000-000000000002' and request->>'action'='create_guest' limit 1;
grant select on test.setup_receipt_case to authenticated;
set role authenticated;
select test.ok((select app.lookup_operation_receipt(operation_id)#>>'{saved,kind}'='setup' from test.setup_receipt_case),'setup receipt can be reconciled without old full response');
reset role;
