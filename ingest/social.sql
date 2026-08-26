-- Social layer: friendships + direct messages (with optional slip attachments) for the
-- member-to-member chat. Run once in Supabase (SQL editor). Idempotent.
--
-- friendships: a request/accept graph. requester sends, addressee accepts. One row per
--   ordered pair; "are A and B friends" = an accepted row in either direction.
-- direct_messages: 1:1 messages, each carrying text and/or a bet slip (jsonb). You may
--   only message an ACCEPTED friend (enforced in the insert policy, not just the UI).

create table if not exists friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  unique (requester_id, addressee_id),
  constraint no_self_friend check (requester_id <> addressee_id)
);
create index if not exists friendships_addressee_idx on friendships (addressee_id, status);
create index if not exists friendships_requester_idx on friendships (requester_id, status);

alter table friendships enable row level security;
drop policy if exists "see own friendships" on friendships;
create policy "see own friendships" on friendships for select using (
  auth.uid() = requester_id or auth.uid() = addressee_id);
drop policy if exists "send friend request" on friendships;
create policy "send friend request" on friendships for insert to authenticated
  with check (auth.uid() = requester_id);
drop policy if exists "accept friend request" on friendships;
create policy "accept friend request" on friendships for update using (
  auth.uid() = addressee_id or auth.uid() = requester_id);
drop policy if exists "remove friendship" on friendships;
create policy "remove friendship" on friendships for delete using (
  auth.uid() = requester_id or auth.uid() = addressee_id);
grant select, insert, update, delete on friendships to authenticated;
grant select, insert, update, delete on friendships to service_role;

create table if not exists direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body         text check (body is null or char_length(body) between 1 and 4000),
  slip         jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint dm_has_content check (body is not null or slip is not null)
);
create index if not exists dm_pair_idx on direct_messages (sender_id, recipient_id, created_at);
create index if not exists dm_recipient_idx on direct_messages (recipient_id, read_at);

alter table direct_messages enable row level security;
drop policy if exists "see own dms" on direct_messages;
create policy "see own dms" on direct_messages for select using (
  auth.uid() = sender_id or auth.uid() = recipient_id);
-- Insert only as yourself, and only to someone you're ACCEPTED friends with.
drop policy if exists "send dm to a friend" on direct_messages;
create policy "send dm to a friend" on direct_messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = recipient_id)
          or (f.addressee_id = auth.uid() and f.requester_id = recipient_id))));
-- Recipient can mark messages read.
drop policy if exists "mark dm read" on direct_messages;
create policy "mark dm read" on direct_messages for update using (auth.uid() = recipient_id);
grant select, insert, update on direct_messages to authenticated;
grant select, insert, update, delete on direct_messages to service_role;

-- Live delivery for the chat widget (safe to re-run if the table is already published).
do $$ begin
  alter publication supabase_realtime add table direct_messages;
exception when duplicate_object then null; end $$;
