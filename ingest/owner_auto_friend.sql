-- Owner auto-friend: every member is friends with the founder, automatically.
--
-- Why: direct_messages enforces "you may only message an ACCEPTED friend" in its INSERT policy
-- (see social.sql), so during the private beta the founder could not reach a new member without
-- them accepting a request first. New members should be reachable the moment they are approved.
--
-- What this does:
--   1) Backfills an ACCEPTED friendship between the founder and every existing profile.
--   2) Adds a trigger so every profile created from here on gets the same row automatically.
--
-- The founder is resolved from profiles.role = 'founder' (set by the signup trigger in
-- beta_approval.sql — the first account). No UUID is hardcoded, so this is safe to re-run and
-- stays correct if the founder row ever changes.
--
-- Direction matters: the founder is stored as the REQUESTER and the member as the ADDRESSEE, which
-- matches the shape the app already reads ("are A and B friends" = an accepted row in either
-- direction) and keeps the existing RLS policies untouched.
--
-- Idempotent. Run once in the Supabase SQL editor.
--
-- TWO THINGS TO KNOW, because this is a change to what members can be assumed to have agreed to:
--   * The existing "remove friendship" DELETE policy still applies, so a member CAN unfriend and
--     stop the DMs. If it must be non-removable, that is a second, deliberate change — say so and
--     it can be added, but it is worth deciding on purpose rather than inheriting it.
--   * Members are not told this happens. For a private, approval-gated beta that is defensible,
--     but the signup copy or privacy policy should say the founder can message members.

begin;

-- 1) Backfill: founder <-> every existing member.
insert into friendships (requester_id, addressee_id, status)
select f.id, p.id, 'accepted'
  from profiles f
  cross join profiles p
 where f.role = 'founder'
   and p.id <> f.id
on conflict (requester_id, addressee_id) do update set status = 'accepted';

-- Any pre-existing friendship stored the OTHER way round (member requested the founder) is
-- promoted too, so nobody is left pending.
update friendships f
   set status = 'accepted'
  from profiles o
 where o.role = 'founder'
   and f.addressee_id = o.id
   and f.status <> 'accepted';

-- 2) Trigger: auto-friend every new profile.
create or replace function public.auto_friend_founder()
returns trigger
language plpgsql
security definer                 -- runs as owner: the new member is not the one inserting this row
set search_path = public
as $$
declare
  founder_id uuid;
begin
  select id into founder_id from profiles where role = 'founder' limit 1;
  -- No founder yet means THIS row is the first account (it becomes the founder), so nothing to do.
  if founder_id is null or founder_id = new.id then
    return new;
  end if;
  insert into friendships (requester_id, addressee_id, status)
  values (founder_id, new.id, 'accepted')
  on conflict (requester_id, addressee_id) do update set status = 'accepted';
  return new;
end;
$$;

drop trigger if exists auto_friend_founder_trg on profiles;
create trigger auto_friend_founder_trg
  after insert on profiles
  for each row execute function public.auto_friend_founder();

commit;

-- Verify:
--   select count(*) from friendships f join profiles o on o.id = f.requester_id
--    where o.role = 'founder' and f.status = 'accepted';
--   -- should equal (select count(*) - 1 from profiles)
