-- Profile page upgrade: cover photo, online presence, and betslip "stories".
-- Run once in Supabase (SQL editor). Idempotent.

-- 1) New profile columns: a Facebook-style cover image, a presence heartbeat, and a
--    per-user accent color (drives the cover gradient + story rings).
alter table profiles add column if not exists cover_url text;
alter table profiles add column if not exists last_seen timestamptz;
alter table profiles add column if not exists accent_color text;

-- The profiles UPDATE grant is column-scoped (role/title are locked). Re-grant so owners can
-- write the new columns too. (Existing bio/avatar_url stay editable.)
grant update (bio, avatar_url, cover_url, last_seen, accent_color) on profiles to authenticated;

-- 2) Stories: an ephemeral betslip a member shares to their "story" (shown for 24h as an
--    Instagram-style circle on their profile + friends' feeds).
create table if not exists stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  slip       jsonb not null,
  caption    text check (caption is null or char_length(caption) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists stories_user_idx on stories (user_id, created_at desc);
create index if not exists stories_recent_idx on stories (created_at desc);

alter table stories enable row level security;
-- Any signed-in member can see stories from the last 24h (they're a social feed); owners
-- manage their own.
drop policy if exists "see recent stories" on stories;
create policy "see recent stories" on stories for select to authenticated
  using (created_at > now() - interval '24 hours');
drop policy if exists "post own story" on stories;
create policy "post own story" on stories for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "delete own story" on stories;
create policy "delete own story" on stories for delete using (auth.uid() = user_id);

grant select, insert, delete on stories to authenticated;
grant select, insert, delete on stories to service_role;

-- 3) Story reactions: a quick emoji on a friend's story slip.
create table if not exists story_reactions (
  story_id uuid not null references stories(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  emoji    text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (story_id, user_id, emoji)
);
create index if not exists story_reactions_story_idx on story_reactions (story_id);

alter table story_reactions enable row level security;
drop policy if exists "see story reactions" on story_reactions;
create policy "see story reactions" on story_reactions for select to authenticated using (true);
drop policy if exists "react to a story" on story_reactions;
create policy "react to a story" on story_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "unreact" on story_reactions;
create policy "unreact" on story_reactions for delete using (auth.uid() = user_id);

grant select, insert, delete on story_reactions to authenticated, service_role;
