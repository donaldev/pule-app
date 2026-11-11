-- Minimal RLS stand-in ONLY for disposable plain-PostgreSQL tests.
-- Does not exercise the Storage service, JWT validation, signing or file bytes.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema storage;
create table storage.buckets(id text primary key, public boolean not null default false,file_size_limit bigint default 262144000,allowed_mime_types text[] default array['video/mp4']);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets,name text not null,owner_id text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
insert into storage.buckets(id) values('frame-replays'),('unrelated');
