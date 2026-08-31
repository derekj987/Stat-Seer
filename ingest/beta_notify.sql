-- Beta access-request email alerts. One flag so we email the ops inbox once per pending member.
-- Run once in the Supabase SQL editor.
alter table profiles
    add column if not exists request_notified boolean not null default false;
