-- Access-control hardening — LOW/INFO items from the ASVS L1 review. Run once in the Supabase SQL
-- editor. Idempotent. Tightens the `authenticated` role only; service_role is unaffected.

begin;

-- LOW — conversations UPDATE was a full-row grant, so any member could rewrite group metadata,
-- including created_by. Scope the grant to the fields the app actually updates (title on create,
-- is_group when a 1:1 becomes a group, last_message_at on each send) — created_by can no longer move.
revoke update on public.conversations from authenticated;
grant  update (title, is_group, last_message_at) on public.conversations to authenticated;

-- INFO — defense in depth for privilege escalation. Today a member can't set their own role/status/
-- title/request_notified only because those columns aren't in any UPDATE grant. This trigger makes it
-- explicit: a non-staff actor with an auth context cannot change those fields, even if a future
-- migration accidentally widens the grant. Staff (founder/admin) and the service key (auth.uid() null,
-- e.g. the request_notified write in /api/beta/notify) and set_member_status still work.
create or replace function public.guard_profile_privileged() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.role            is distinct from old.role
   or new.title           is distinct from old.title
   or new.status          is distinct from old.status
   or new.request_notified is distinct from old.request_notified)
     and auth.uid() is not null      -- service_role / migrations run with no auth context → allowed
     and not public.is_staff() then
    raise exception 'not authorized to change privileged profile fields';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_privileged on public.profiles;
create trigger guard_profile_privileged before update on public.profiles
  for each row execute function public.guard_profile_privileged();

commit;
