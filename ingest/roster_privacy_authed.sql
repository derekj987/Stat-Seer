-- Roster privacy, authenticated tier (ASVS L1 · V4/V8) — hide status/request_notified from OTHER
-- logged-in members. Finding #6, second half: any authenticated member could read every member's
-- approval status via direct REST. Only the owner (their own row) and staff (founder/admin) should.
--
-- Postgres RLS is row-level, not column-level, and there is no "grant all columns except X", so we
-- revoke table SELECT from `authenticated` and re-grant every column EXCEPT status/request_notified.
-- The few legitimate readers of those two columns go through SECURITY DEFINER functions below.
--
-- ⚠️ MAINTENANCE: if you add a new NON-sensitive column to profiles later, add it to the grant list
-- or authenticated clients won't be able to read it.
--
-- Run once in the Supabase SQL editor. The app tolerates this running before OR after the code deploy
-- (each changed read tries the RPC and falls back to a direct select).

begin;

-- Staff predicate (founder/admin).
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('founder','admin'));
$$;
grant execute on function public.is_staff() to authenticated;

-- Own beta state — /api/beta/notify, /pending.
create or replace function public.my_beta_state()
  returns table (status text, request_notified boolean)
  language sql stable security definer set search_path = public as $$
  select p.status, p.request_notified from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.my_beta_state() to authenticated;

-- Staff-only: full member list with status — /admin/members.
create or replace function public.list_members()
  returns table (id uuid, username text, status text, role text, created_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.status, p.role, p.created_at
  from public.profiles p where public.is_staff() order by p.created_at desc;
$$;
grant execute on function public.list_members() to authenticated;

-- Staff-only: one member's status — /admin/approve.
create or replace function public.member_status(target uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then (select status from public.profiles where id = target) end;
$$;
grant execute on function public.member_status(uuid) to authenticated;

-- Staff-only: count of pending members — /api/awaiting.
create or replace function public.pending_member_count() returns integer
  language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then (select count(*)::int from public.profiles where status = 'pending') else 0 end;
$$;
grant execute on function public.pending_member_count() to authenticated;

-- Lock down: authenticated may read every column EXCEPT status/request_notified.
revoke select on public.profiles from authenticated;
grant select (
  id, username, role, title, created_at,
  favorite_teams, pinned_post_id, cover_url, last_seen, accent_color, bio, avatar_url
) on public.profiles to authenticated;

commit;
