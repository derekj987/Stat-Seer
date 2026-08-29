-- Follows: a directed follow graph for profiles (modern social, alongside mutual friends).
-- Run once in Supabase (SQL editor). Idempotent.

create table if not exists follows (
  follower_id  uuid not null references profiles(id) on delete cascade,
  following_id uuid not null references profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on follows (following_id);  -- follower counts
create index if not exists follows_follower_idx  on follows (follower_id);   -- following counts

alter table follows enable row level security;
-- Follow counts are public to signed-in members; you may only create/remove your OWN follow rows.
drop policy if exists "see follows" on follows;
create policy "see follows" on follows for select to authenticated using (true);
drop policy if exists "follow" on follows;
create policy "follow" on follows for insert to authenticated with check (auth.uid() = follower_id);
drop policy if exists "unfollow" on follows;
create policy "unfollow" on follows for delete using (auth.uid() = follower_id);

grant select, insert, delete on follows to authenticated, service_role;
