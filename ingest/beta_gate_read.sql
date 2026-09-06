-- Beta-approval gate, READ side. The other half of beta_gate_rls.sql.
--
-- That file fixed WRITES: a pending member could post to the forum, DM, add walls and follow people
-- straight from the console, because the /pending redirect in proxy.ts only guards HTML navigation.
-- It added one RESTRICTIVE policy per table -- but `for insert` only. Reads were left open.
--
-- So a signed-up, NOT-yet-approved member still holds a valid Supabase JWT and can read the entire
-- private beta from curl: every forum thread, every wall post, every member's username. The app
-- redirects them to /pending, but the app is not the boundary -- PostgREST is. This is the same
-- shape as the anon finding in anon_lockdown.sql ("the redirect was cosmetic"), one role over:
-- that one closed `anon`, this one closes `authenticated but unapproved`.
--
-- Nothing is at risk from the CURRENT membership: all 18 profiles are status='approved', so this
-- locks nobody out today. It is the next signup that would otherwise be able to read everything
-- between hitting the signup button and being approved.
--
-- HOW IT WORKS. Postgres AND's restrictive policies with the permissive ones, so each table now
-- needs BOTH its existing rule AND an approved account. Existing policies are untouched.
-- `service_role` bypasses RLS entirely, so every server-rendered page is unaffected -- lib/forum.ts
-- and lib/profile.ts read with the service key and keep working exactly as before.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

-- The 14 member-content tables -- the same list beta_gate_rls.sql gates for INSERT, so the read and
-- write halves stay symmetric. A pending member has no legitimate reason to read any of them: the
-- only page they can reach is /pending, which reads its state from my_beta_state() (SECURITY
-- DEFINER, unaffected by RLS).
do $$
declare t text;
begin
  foreach t in array array[
    'threads','replies','reports','wall_posts','wall_comments','wall_reactions',
    'friendships','direct_messages','conversations','conversation_members','conversation_messages',
    'follows','stories','story_reactions'
  ] loop
    execute format('drop policy if exists "approved members only (read)" on public.%I', t);
    execute format(
      'create policy "approved members only (read)" on public.%I ' ||
      'as restrictive for select to authenticated using (public.is_approved(auth.uid()))', t);
  end loop;
end $$;

-- profiles needs an EXCEPTION, which is why it is not in the loop above.
--
-- A pending member must still be able to read their OWN row, or three things break for them:
--   /pending          -- the waiting room they are redirected to
--   /welcome          -- the Google username picker (reads username to see if it is a placeholder)
--   the site nav      -- "Logged in as <name>"
-- and /settings, if they ever reach it. What they must NOT get is the roster: every username in the
-- beta, which is exactly what anon_lockdown.sql took away from anonymous visitors.
--
-- So: approved members read profiles as before; a pending member reads only themselves.
drop policy if exists "approved members only (read)" on public.profiles;
create policy "approved members only (read)" on public.profiles
  as restrictive for select to authenticated
  using (public.is_approved(auth.uid()) or id = auth.uid());

commit;

-- DELIBERATELY NOT GATED, and why:
--   consents, feedback        -- their permissive policies are already scoped to the owner's own
--                                row, so a pending member can only ever see their own record.
--   our analysis tables       -- closing_lines, prop_snapshots, players, cfb_*, tailgate_buzz,
--                                public_calibration, ref_assignments etc. are content we generate,
--                                not member data. A pending member seeing the model is harmless.
--
-- Verify -- as a PENDING member (not the service key, which bypasses RLS):
--   curl -s "$SUPABASE_URL/rest/v1/threads?select=id&limit=1" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $THEIR_JWT"
--   -- should return [] (RLS filters the rows) rather than a thread.
--   The same call for profiles should return exactly ONE row: their own.
--
-- To re-check the write half is still in place:
--   select tablename, policyname, cmd, permissive from pg_policies
--    where schemaname='public' and policyname like 'approved members only%'
--    order by tablename, cmd;
--   -- expect two rows per table: one INSERT, one SELECT, both permissive='RESTRICTIVE'.
