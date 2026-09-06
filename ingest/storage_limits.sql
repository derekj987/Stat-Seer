-- Cap upload size on the two public storage buckets.
--
-- injection_hardening.sql restricted allowed_mime_types on both buckets (blocking image/svg+xml,
-- which can carry <script>). It did not set file_size_limit, and both buckets are still NULL --
-- meaning unlimited.
--
-- Measured on production:
--   bucket=avatars      public=True  size_limit=None  mime=[png, jpeg, webp, gif]
--   bucket=wall-media   public=True  size_limit=None  mime=[png, jpeg, webp, gif]
--
-- The app already says 5 MB: WallForm.tsx sets MAX_IMG_BYTES = 5 * 1024 * 1024 and refuses anything
-- larger. That check runs in the BROWSER. An approved member can open the console and call
-- supabase.storage.from('wall-media').upload(...) with their own session and any size they like --
-- the bucket policy is what actually decides, and it currently decides "yes".
--
-- Why it matters on a PUBLIC bucket specifically: the objects are world-readable by design (avatars
-- and wall photos render on profile pages), so an oversized upload is not just stored, it is served
-- -- a free CDN on a domain that looks like ours, billed to us for both storage and egress. This is
-- a cost/abuse issue rather than a data-exposure one; nothing private is at stake.
--
-- 5 MB matches what the UI already promises, so no legitimate upload changes behaviour. The client
-- check stays as the friendly error message; this is the one that cannot be bypassed.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

update storage.buckets
   set file_size_limit = 5242880          -- 5 MB, same number WallForm.tsx already enforces
 where id in ('avatars', 'wall-media');

commit;

-- Verify:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--   -- both rows should read 5242880, not null.
--
-- A rejected upload surfaces to the member as a storage error rather than the app's own "Each image
-- must be under 5 MB." message. That only happens to someone bypassing the client check, so the
-- less friendly message is the correct outcome.
