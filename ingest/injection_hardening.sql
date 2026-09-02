-- Injection/XSS-audit hardening (ASVS L1 · V5/V14). Run once in the Supabase SQL editor. Idempotent.
-- Verified against live data before writing: all 10 existing profiles already satisfy both CHECKs
-- (no username violates the format, the only accent_color in use is '#2f6fed'), so this cannot fail
-- on existing rows.

begin;

-- MEDIUM — stored CSS injection via profiles.accent_color. The column is plain text with no
-- constraint and IS granted to `authenticated`, so the 8-swatch UI picker is a convention, not a
-- control: a member could PATCH it to
--   red;background-image:url(https://evil.tld/log);position:fixed;inset:0;z-index:99999
-- which lands inside style="--paccent:…" on their profile and fires an attacker-controlled request
-- for every member who views it (visitor logging / defacement). Not script execution — but not ours
-- to allow either. Restrict to a plain hex colour.
alter table public.profiles drop constraint if exists profiles_accent_hex;
alter table public.profiles add  constraint profiles_accent_hex
  check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');

-- LOW — username format is enforced only by a client-side regex on the signup page, so a direct
-- call to the Supabase auth endpoint can set an arbitrary username. It is then interpolated into the
-- founder's approval email (now HTML-escaped in code as well) and shown across the site.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add  constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_]{3,20}$');

-- LOW — SECURITY DEFINER functions without a pinned search_path (Supabase's linter flags this as
-- function_search_path_mutable). set_member_status is the privilege-granting one, so it matters most.
-- Bodies are unchanged — only the search_path setting is added.
alter function public.handle_new_user()                    set search_path = public;
alter function public.set_member_status(uuid, text)        set search_path = public;

-- MEDIUM — storage buckets accept any MIME type, including image/svg+xml. An SVG can carry <script>;
-- it's inert inside the <img> tags the app renders, but it is live if opened directly, so the bucket
-- becomes a script/phishing host on a trusted-looking domain (and real XSS if ever proxied under the
-- app origin). Restrict both public buckets to raster image types.
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
 where id in ('avatars','wall-media');

commit;
