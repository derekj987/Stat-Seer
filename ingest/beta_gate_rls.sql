-- Beta-approval gate, enforced in the DATABASE (ASVS L1 · V4 Access Control).
--
-- Finding #1 (HIGH): a signed-in but status='pending' member holds a fully valid Supabase session.
-- The /pending redirect lives only in web/proxy.ts and guards HTML navigation — it does NOT cover the
-- API layer or direct PostgREST, and no RLS policy checked approval. So a pending user could, from the
-- browser console / curl, post to the forum, DM, add walls, send friend requests, chat, follow, and
-- post stories — the redirect was cosmetic.
--
-- Fix: enforce approval in RLS. Postgres AND's a RESTRICTIVE policy with the existing permissive ones,
-- so a write now requires BOTH the current rule AND an approved account. The existing policies are left
-- completely untouched (lowest-risk change), and `service_role` (the server's service key) bypasses RLS
-- so all server-side writes are unaffected. status is NOT NULL default 'pending' and existing testers
-- were grandfathered to 'approved' (beta_approval.sql), so no current member is locked out.
--
-- Idempotent; run once in the Supabase SQL editor. Pair with the API-route approval checks (server code).

begin;

-- Approval predicate — SECURITY DEFINER + stable + pinned search_path, mirroring is_conv_member().
create or replace function public.is_approved(uid uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and status = 'approved');
$$;
revoke all on function public.is_approved(uuid) from public, anon;
grant execute on function public.is_approved(uuid) to authenticated;

-- One restrictive INSERT gate per member-content table. Every one already has a permissive INSERT
-- policy (so the restrictive layer only ADDs the approval requirement; it never denies on its own).
do $$
declare t text;
begin
  foreach t in array array[
    'threads','replies','reports','wall_posts','wall_comments','wall_reactions',
    'friendships','direct_messages','conversations','conversation_members','conversation_messages',
    'follows','stories','story_reactions'
  ] loop
    execute format('drop policy if exists "approved members only (write)" on public.%I', t);
    execute format(
      'create policy "approved members only (write)" on public.%I ' ||
      'as restrictive for insert to authenticated with check (public.is_approved(auth.uid()))', t);
  end loop;
end $$;

commit;
