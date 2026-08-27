-- Web Push subscriptions: one row per device/browser a member has opted into notifications
-- on. The sender's push endpoint + its encryption keys (p256dh, auth) come from the browser
-- PushManager. The /api/push/send route (service role) reads these to deliver a push when a
-- new chat message arrives, so notifications fire even when the app is fully closed. Run once
-- in Supabase. Idempotent.

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_sub_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
drop policy if exists "manage own push subs" on push_subscriptions;
create policy "manage own push subs" on push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on push_subscriptions to authenticated;
grant select, insert, update, delete on push_subscriptions to service_role;
