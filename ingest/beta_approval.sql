-- =====================================================================
-- PRIVATE BETA — membership approval.
--
-- New signups land in 'pending' and can see only the public homepage until
-- the founder approves them. Everyone who already has an account (the current
-- friends-and-family testers) is grandfathered to 'approved' on first run.
--
-- Run this ONCE in the Supabase SQL editor. It is safe to re-run: the
-- grandfather step only fires when no member is approved yet.
-- =====================================================================

alter table profiles
    add column if not exists status text not null default 'pending';
-- status: 'pending' | 'approved' | 'rejected'

-- One-time grandfather: on the very first run (before anyone is approved),
-- approve every existing account so current testers aren't locked out. On any
-- later re-run an approved member already exists, so this is skipped and real
-- pending requests are left untouched.
do $$
begin
    if not exists (select 1 from public.profiles where status = 'approved') then
        update public.profiles set status = 'approved';
    end if;
end $$;

-- Signup trigger: the first account is the approved founder; everyone after is
-- a pending member awaiting approval.
create or replace function public.handle_new_user() returns trigger as $$
declare
    is_first boolean;
begin
    select count(*) = 0 into is_first from public.profiles;
    insert into public.profiles (id, username, role, title, status)
    values (
        new.id,
        coalesce(nullif(new.raw_user_meta_data->>'username', ''),
                 'member_' || substr(new.id::text, 1, 8)),
        case when is_first then 'founder'     else 'member'   end,
        case when is_first then 'The Creator' else null       end,
        case when is_first then 'approved'    else 'pending'   end
    )
    on conflict (id) do nothing;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

-- Approval action. SECURITY DEFINER so only this vetted path can change status;
-- the caller must be a founder/admin. Members cannot self-approve (there is no
-- column grant for status, and this function enforces the role check).
create or replace function public.set_member_status(target uuid, new_status text)
returns void as $$
begin
    if not exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('founder', 'admin')
    ) then
        raise exception 'not authorized';
    end if;
    if new_status not in ('pending', 'approved', 'rejected') then
        raise exception 'invalid status %', new_status;
    end if;
    update public.profiles set status = new_status where id = target;
end;
$$ language plpgsql security definer;

revoke all on function public.set_member_status(uuid, text) from public, anon;
grant execute on function public.set_member_status(uuid, text) to authenticated;
