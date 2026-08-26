-- Slip-to-wall: let a member attach a shared bet slip to a wall post.
-- Run once in Supabase (SQL editor). Idempotent. No new grants needed — the
-- existing table-level grant/insert on wall_posts covers the new column, and the
-- row-level insert policy (auth.uid() = author_id) is unchanged.

alter table wall_posts add column if not exists slip jsonb;
