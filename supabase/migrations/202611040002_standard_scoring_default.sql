-- PROPOSED: internal standard defaults only. Do not apply hosted without approval.
-- Existing verified version-1 rows already implement the same native scoring format.
begin;
create function private.initialize_standard_scoring() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into app.rule_versions(group_id,label,rules_status,validation_version,breaker_policy)
 select new.id,'Pule standard','verified',1,'explicit_per_frame'
 where not exists(select 1 from app.rule_versions r
                  where r.group_id=new.id and r.rules_status='verified' and r.validation_version=1);
 return new;
end $$;
revoke all on function private.initialize_standard_scoring() from public,anon,authenticated;
-- Group creation and the standard default commit/roll back together; RPCs stay unchanged.
create trigger initialize_standard_scoring after insert on app.groups
for each row execute function private.initialize_standard_scoring();
-- Existing active groups, including PonDon: preserve all historical and verified rows.
insert into app.rule_versions(group_id,label,rules_status,validation_version,breaker_policy)
select g.id,'Pule standard','verified',1,'explicit_per_frame' from app.groups g
where g.status='active' and not exists(select 1 from app.rule_versions r
  where r.group_id=g.id and r.rules_status='verified' and r.validation_version=1);
commit;
