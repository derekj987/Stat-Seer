-- One-time username change.
--
-- Google sign-in assigns a username automatically, and it is not a name anyone would pick --
-- real examples in production: member_f315ce11, member_5ea60213. Those members currently have no
-- way to fix it: `grant update (bio, avatar_url) on profiles` deliberately excludes username, so
-- the column is not member-writable at all.
--
-- This grants exactly ONE change, enforced in the database rather than the UI. The rule cannot be
-- bypassed from the browser console, which matters because the forum, walls, DMs and the founder
-- badge all key off a stable identity -- a member who could rename freely could impersonate
-- another member or shed a moderation history.
--
-- The column grant stays as it is. Instead the change goes through a SECURITY DEFINER function, so
-- the ONLY way to write username is this function, and the function is where the once-rule lives.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

-- Null = never changed. Set on the one permitted change; also what the UI reads to decide whether
-- to offer the form at all.
alter table public.profiles add column if not exists username_changed_at timestamptz;

create or replace function public.change_username(new_username text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  cur     record;
  cleaned text := btrim(coalesce(new_username, ''));
begin
  if me is null then
    return json_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select username, username_changed_at into cur from profiles where id = me;
  if not found then
    return json_build_object('ok', false, 'error', 'no_profile');
  end if;

  -- The once-rule. Checked before anything else so a second attempt cannot even probe for which
  -- usernames are taken.
  if cur.username_changed_at is not null then
    return json_build_object('ok', false, 'error', 'already_changed',
                             'changed_at', cur.username_changed_at);
  end if;

  -- Same format the signup page and the profiles_username_format constraint enforce. Repeated
  -- here so the function returns a readable reason instead of a raw constraint violation.
  if cleaned !~ '^[A-Za-z0-9_]{3,20}$' then
    return json_build_object('ok', false, 'error', 'bad_format');
  end if;

  if lower(cleaned) = lower(cur.username) then
    return json_build_object('ok', false, 'error', 'unchanged');
  end if;

  -- Case-insensitive taken check: the unique index is case-SENSITIVE, so without this "Derek" and
  -- "derek" could both exist and read as the same person in the forum.
  if exists (select 1 from profiles where lower(username) = lower(cleaned) and id <> me) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;

  update profiles
     set username = cleaned,
         username_changed_at = now()
   where id = me;

  return json_build_object('ok', true, 'username', cleaned);
exception
  -- Loses a race for the same name between the check above and the update.
  when unique_violation then
    return json_build_object('ok', false, 'error', 'taken');
end;
$$;

revoke all on function public.change_username(text) from public;
grant execute on function public.change_username(text) to authenticated;

commit;

-- Verify:
--   select username, username_changed_at from profiles order by created_at;
--   -- members with a member_xxxxxxxx username and a null username_changed_at are the ones
--   -- who will be offered the change.
