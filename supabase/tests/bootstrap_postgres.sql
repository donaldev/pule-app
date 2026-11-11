-- Isolated plain-PostgreSQL test database ONLY. Never apply this on Supabase.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz,
 raw_user_meta_data jsonb not null default '{}',
 confirmation_sent_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,
 provider text not null,identity_data jsonb not null);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
