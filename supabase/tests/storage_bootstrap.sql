-- Minimal RLS stand-in ONLY for disposable plain-PostgreSQL tests.
-- Does not exercise the Storage service, JWT validation, signing or file bytes.
create schema storage;
create table storage.buckets(id text primary key, public boolean not null default false);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets,name text not null,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
insert into storage.buckets(id) values('frame-replays'),('unrelated');
