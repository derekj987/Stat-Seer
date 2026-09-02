-- Beta signup fields: capture a first name + "how did you hear about us" so the founder knows who
-- they're approving and which channels drive signups. Kept STAFF-ONLY (not added to the public/
-- authenticated grant), surfaced via the definer functions below. Run once in the Supabase SQL editor.

begin;

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists referral   text;

-- Signup trigger: also write first_name + referral from the signup metadata (options.data on signUp).
create or replace function public.handle_new_user() returns trigger as $$
declare is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, username, role, title, status, first_name, referral)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'member_' || substr(new.id::text, 1, 8)),
    case when is_first then 'founder'     else 'member'  end,
    case when is_first then 'The Creator' else null      end,
    case when is_first then 'approved'    else 'pending' end,
    nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'referral'),   '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Roster for /admin/members — now includes first_name + referral (return type changed, so drop first).
drop function if exists public.list_members();
create or replace function public.list_members()
  returns table (id uuid, username text, status text, role text, created_at timestamptz, first_name text, referral text)
  language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.status, p.role, p.created_at, p.first_name, p.referral
  from public.profiles p where public.is_staff() order by p.created_at desc;
$$;
grant execute on function public.list_members() to authenticated;

-- One member's signup detail for the /admin/approve screen (staff-only).
create or replace function public.member_detail(target uuid)
  returns table (username text, status text, first_name text, referral text)
  language sql stable security definer set search_path = public as $$
  select p.username, p.status, p.first_name, p.referral
  from public.profiles p where public.is_staff() and p.id = target;
$$;
grant execute on function public.member_detail(uuid) to authenticated;

commit;
