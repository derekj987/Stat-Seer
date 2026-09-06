-- Close the last two things a signed-out stranger can read.
--
-- Found by hitting the REST API directly with the anon key (which is PUBLIC by design — it ships in
-- the browser bundle, so anything granted to `anon` is readable by anyone who views source). Of 26
-- tables probed, three came back readable:
--
--   threads             the FORUM -- title, body, author of every post            <- closed here
--   replies             forum replies                                             <- closed here
--   wall_posts          profile walls                                             <- closed here
--   wall_comments       comments on those walls                                    <- closed here
--   wall_reactions      who reacted to what                                        <- closed here
--   profiles            id, username, avatar_url for every member                  <- closed here
--   cfb_tailgate_buzz   our own derived analysis content                           <- left open
--   tailgate_buzz       our own derived analysis content                           <- left open
--
-- Correctly blocked already, and left alone: direct_messages, conversations,
-- conversation_messages, stories, follows, reports, consents, feedback. The genuinely private
-- layer was private; it is the SOCIAL layer that was open.
--
-- The buzz tables are output we generate, not member data, so they stay readable.
--
-- 1) The forum and the walls. A member posting inside an approval-gated private beta reasonably
--    expects it to stay inside it. web/proxy.ts already redirects a signed-out visitor away from
--    every page — but that only covers HTML navigation, not PostgREST, so `curl` with the public
--    anon key read straight past it. This is the same shape as the HIGH finding in
--    beta_gate_rls.sql ("the redirect was cosmetic"), which fixed WRITES and left READS open.
--
--    Little has leaked yet -- one forum thread, two auto-generated slip shares -- but the exposure
--    grows with every post, and it is the whole premise of a private beta.
--
--    Pages are unaffected: lib/profile.ts and lib/forum.ts read with the SERVICE key.
--
-- 2) profiles. anon could read (id, username, avatar_url) for all 18 members — a complete roster
--    dump for anyone who wants one, and the raw material for targeted phishing of a beta tester.
--
--    roster_privacy.sql granted this on the grounds that "the only thing anon needs from profiles
--    is the signup username-availability check". That check does not exist: the signup page calls
--    supabase.auth.signUp() and nothing else, and a duplicate username is caught by the unique
--    constraint. The grant was paying for a feature that was never built.
--
--    Verified before revoking — every profiles read in the app is by an AUTHENTICATED user
--    (each filters on auth.uid() or is an admin page), and /u/[username] uses the service key.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

revoke select on public.threads        from anon;
revoke select on public.replies        from anon;
revoke select on public.wall_posts     from anon;
revoke select on public.wall_comments  from anon;
revoke select on public.wall_reactions from anon;
revoke select on public.profiles       from anon;

commit;

-- Verify (as anon, from a terminal — the anon key is in web/.env.local):
--   curl -s "$SUPABASE_URL/rest/v1/wall_posts?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--   curl -s "$SUPABASE_URL/rest/v1/profiles?select=id&limit=1"   -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--   -- both should return a 401, not a row.
--
-- If a genuine username-availability check is ever added, do NOT restore this grant. Expose a
-- SECURITY DEFINER function returning a boolean instead, so the answer is "taken / not taken"
-- rather than the whole roster.
