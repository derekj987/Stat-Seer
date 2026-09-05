-- Let a signed-in member READ their own username_changed_at.
--
-- ingest/username_change.sql added the column and the change_username() function, and both are live
-- — but the settings page still showed no Username card, because a member could not read the column
-- to find out whether their one change was still available.
--
-- Why: roster_privacy_authed.sql locks profiles down to an explicit column allow-list —
--
--   revoke select on public.profiles from authenticated;
--   grant  select (id, username, role, title, created_at, favorite_teams, pinned_post_id,
--                  cover_url, last_seen, accent_color, bio, avatar_url) on public.profiles
--          to authenticated;
--
-- and `username_changed_at` was added to the table AFTER that list was written, so it was never
-- granted. The client's `select("username,username_changed_at")` returned permission-denied, the
-- page treated that as "column not available yet" and hid the card entirely.
--
-- That is the trap with a column allow-list: adding a column DENIES it by default, silently, and
-- the failure shows up as missing UI rather than an error. Any future `alter table profiles add
-- column` that the client needs must be added here too.
--
-- Read-only. It exposes nothing sensitive: it is a timestamp saying whether that member has already
-- used their rename, and the RLS row policy still applies. The WRITE stays locked to
-- change_username(), which is where the once-rule is enforced.
--
-- Run once in the Supabase SQL editor. Idempotent.

begin;

grant select (username_changed_at) on public.profiles to authenticated;

commit;

-- Verify (as a signed-in member, not the service key — service_role bypasses these grants):
--   select username, username_changed_at from profiles where id = auth.uid();
