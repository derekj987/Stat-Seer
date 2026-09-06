-- Let a Google sign-up CHOOSE its username instead of being handed one.
--
-- The problem. handle_new_user() (ingest/beta_signup_fields.sql) builds the profile from the
-- signup metadata:
--
--     coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'member_' || substr(new.id::text,1,8))
--
-- The email signup form collects a username and puts it in that metadata, so it lands correctly.
-- Google OAuth carries no such field -- Supabase populates name/email/avatar_url and nothing else --
-- so every Google member falls through to the placeholder and is named member_f315ce11 forever.
-- That is their identity in the forum, on their wall, and in DMs.
--
-- Why not just reuse change_username(). Because that is the ONE-TIME rename, and spending it to
-- fix a name the member never chose is not a change -- it is the first choice they should have had
-- at signup. An email signup picks a name for free and still keeps its one rename; a Google signup
-- should get the same deal.
--
-- So: a SEPARATE function that only works while the username is still the generated placeholder,
-- and that deliberately does NOT set username_changed_at. Everything else about the identity rules
-- is unchanged -- the column grant still excludes username, so these two functions remain the only
-- way it can ever be written, and change_username() still enforces the once-rule afterwards.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create or replace function public.claim_username(new_username text)
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

  -- The whole gate. Only an auto-generated name may be claimed; a member who already has a real
  -- username must go through change_username() and spend their one rename. Without this check the
  -- function would be an unlimited rename and would quietly void the once-rule -- which exists
  -- because the forum, walls, DMs and the founder badge all key off a stable identity.
  if cur.username !~ '^member_[0-9a-f]{8}$' then
    return json_build_object('ok', false, 'error', 'not_placeholder');
  end if;

  -- Same format as the signup page and the profiles_username_format constraint.
  if cleaned !~ '^[A-Za-z0-9_]{3,20}$' then
    return json_build_object('ok', false, 'error', 'bad_format');
  end if;

  -- Nobody may claim a name shaped like the placeholder -- that would let them impersonate
  -- another member's generated handle, and would leave their own row still claimable.
  if cleaned ~* '^member_[0-9a-f]{8}$' then
    return json_build_object('ok', false, 'error', 'bad_format');
  end if;

  -- Case-insensitive: the unique index is case-SENSITIVE, so without this "Derek" and "derek"
  -- could both exist and read as the same person in the forum.
  if exists (select 1 from profiles where lower(username) = lower(cleaned) and id <> me) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;

  -- NOTE: username_changed_at is deliberately left NULL. This was the member's first choice of
  -- name, not their one change -- they keep that.
  update profiles set username = cleaned where id = me;

  return json_build_object('ok', true, 'username', cleaned);
exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'taken');
end;
$$;

revoke all on function public.claim_username(text) from public;
grant execute on function public.claim_username(text) to authenticated;

commit;

-- Verify:
--   select username, username_changed_at from profiles
--    where username ~ '^member_[0-9a-f]{8}$';
--   -- these are the members who will be asked to pick a name on their next sign-in.
--
-- Existing Google members are covered: /welcome checks the placeholder pattern on every sign-in,
-- not just on the first one, so the next time they log in they get the picker.
