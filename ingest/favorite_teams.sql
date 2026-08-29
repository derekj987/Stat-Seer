-- Profile "favorite teams": a member's favorite NFL teams, shown as color chips on their profile.
-- Run once in Supabase (SQL editor). Idempotent.

alter table profiles add column if not exists favorite_teams text[];

-- Grant the column-scoped UPDATE for just this column (role/title stay locked; the existing profiles
-- RLS still governs WHICH row — you can only edit your own). Granting one column is additive, so this
-- does NOT depend on the other profile-upgrade columns existing yet.
grant update (favorite_teams) on profiles to authenticated;
