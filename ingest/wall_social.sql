-- Wall social: comments + emoji reactions on feed (wall) posts.
-- Run once in Supabase (SQL editor). Idempotent. Mirrors the wall_posts RLS shape:
-- everything is public-read; you may write only your own rows; deletes also allow the
-- wall owner and mods (founder/admin).

-- ---- Comments -------------------------------------------------------------
create table if not exists wall_comments (
    id         uuid primary key default gen_random_uuid(),
    post_id    uuid not null references wall_posts(id) on delete cascade,
    author_id  uuid not null references profiles(id)   on delete cascade,
    body       text not null check (char_length(body) between 1 and 2000),
    created_at timestamptz not null default now()
);
create index if not exists wall_comments_post_idx on wall_comments (post_id, created_at);

alter table wall_comments enable row level security;

drop policy if exists "wall comments readable by all" on wall_comments;
create policy "wall comments readable by all" on wall_comments for select using (true);

drop policy if exists "members comment" on wall_comments;
create policy "members comment" on wall_comments for insert to authenticated
    with check (auth.uid() = author_id);

-- Delete your own comment, or (as the wall owner) any comment on your wall, or as a mod.
drop policy if exists "delete own comment, or as wall owner or mod" on wall_comments;
create policy "delete own comment, or as wall owner or mod" on wall_comments for delete using (
    auth.uid() = author_id
    or exists (select 1 from wall_posts p where p.id = wall_comments.post_id and p.profile_id = auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('founder','admin')));

grant select on wall_comments to anon, authenticated;
grant insert, delete on wall_comments to authenticated;
grant select, insert, delete on wall_comments to service_role;

-- ---- Reactions ------------------------------------------------------------
-- One row per (post, user, emoji): a user may leave several distinct reactions on a
-- post but never the same emoji twice. emoji is constrained to a small allowed set.
create table if not exists wall_reactions (
    post_id    uuid not null references wall_posts(id) on delete cascade,
    user_id    uuid not null references profiles(id)   on delete cascade,
    emoji      text not null check (emoji in ('👍','🔥','💰','😂','😮','💯')),
    created_at timestamptz not null default now(),
    primary key (post_id, user_id, emoji)
);
create index if not exists wall_reactions_post_idx on wall_reactions (post_id);

alter table wall_reactions enable row level security;

drop policy if exists "wall reactions readable by all" on wall_reactions;
create policy "wall reactions readable by all" on wall_reactions for select using (true);

drop policy if exists "react as self" on wall_reactions;
create policy "react as self" on wall_reactions for insert to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "unreact own" on wall_reactions;
create policy "unreact own" on wall_reactions for delete using (auth.uid() = user_id);

grant select on wall_reactions to anon, authenticated;
grant insert, delete on wall_reactions to authenticated;
grant select, insert, delete on wall_reactions to service_role;
