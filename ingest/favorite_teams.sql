-- Profile "favorite teams": a member's favorite NFL teams, shown as color chips on their profile.
-- Run once in Supabase (SQL editor). Idempotent.

alter table profiles add column if not exists favorite_teams text[];

-- Re-grant the column-scoped UPDATE so owners can write the new column too (role/title stay locked;
-- the existing profiles RLS still governs WHICH row — you can only edit your own).
grant update (bio, avatar_url, cover_url, last_seen, accent_color, favorite_teams) on profiles to authenticated;
