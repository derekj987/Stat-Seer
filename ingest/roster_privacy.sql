-- Roster privacy — restrict what the ANONYMOUS (signed-out) role can read from profiles (ASVS L1 · V4/V8).
--
-- Finding #6 (MEDIUM): `grant select on profiles to anon` + a `using (true)` policy meant a signed-out
-- visitor could hit rest/v1/profiles directly and read every member's role, status (beta approval
-- state), request_notified, and last_seen — enumerating the whole roster and the founder/admins with
-- no login. The app itself gates all profile-viewing pages behind auth, so the only thing anon needs
-- from profiles is the signup username-availability check.
--
-- This closes the ANONYMOUS half: anon may read only basic public identity (id, username, avatar).
-- The authenticated-tier tightening (hiding status/request_notified from other logged-in members, which
-- requires moving the ~5 status readers to SECURITY DEFINER functions incl. the founder admin flow) is
-- a separate, larger change — see the review notes.
--
-- Run once in the Supabase SQL editor. Idempotent. The RLS row policy is unchanged; this is grant-only.

begin;

revoke select on public.profiles from anon;
grant  select (id, username, avatar_url) on public.profiles to anon;

commit;
