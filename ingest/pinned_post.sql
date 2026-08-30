-- Pinned post: a profile owner can pin ONE of their wall posts to the top of their feed.
-- Run once in Supabase (SQL editor). Idempotent.

-- Which post is pinned (null = none). ON DELETE SET NULL so deleting the post clears the pin.
alter table profiles add column if not exists pinned_post_id uuid references wall_posts(id) on delete set null;

-- Let owners write the new column (the existing "owner updates own profile" RLS policy still
-- restricts WHICH row — you can only pin on your own profile). Column grant is additive.
grant update (pinned_post_id) on profiles to authenticated;
