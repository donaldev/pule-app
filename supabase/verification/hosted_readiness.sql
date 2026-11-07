-- Read-only post-migration inspection. Run as the SQL operator, never expose as an RPC.
-- No fixture loading, Auth account creation, scoring, or migration-history mutation.
begin read only;
select current_user as operator_role, current_setting('server_version') as postgres_version;
select table_schema,table_name from information_schema.tables where table_schema in ('app','private') order by 1,2;
select schemaname,tablename,rowsecurity from pg_tables where schemaname in ('app','private') order by 1,2;
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
 where table_schema in ('app','private') and grantee in ('anon','authenticated') order by 1,2,3,4;
select n.nspname,p.proname,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('app','private') order by 1,2;
select count(*) as session_count from app.match_sessions;
select count(*) as canonical_frame_count from app.frames;
select count(*) as private_observation_count from private.legacy_frame_observations;
commit;
