-- Photo posts: let wall posts carry images, stored in a public 'wall-media' storage bucket.
-- Run once in Supabase (SQL editor). Idempotent.

-- Image URLs attached to a wall post (public storage URLs). Table-level grants already cover the
-- new column, so no extra grant is needed for insert/select.
alter table wall_posts add column if not exists media text[];

-- Public bucket for post images (public read like avatars; writes are RLS-scoped below).
insert into storage.buckets (id, name, public)
values ('wall-media', 'wall-media', true)
on conflict (id) do nothing;

-- Anyone may read (bucket is public); a member may only write/overwrite/delete objects under
-- their OWN uid folder (first path segment = auth.uid()).
drop policy if exists "wall-media public read" on storage.objects;
create policy "wall-media public read" on storage.objects
  for select using (bucket_id = 'wall-media');

drop policy if exists "wall-media owner upload" on storage.objects;
create policy "wall-media owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wall-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wall-media owner update" on storage.objects;
create policy "wall-media owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'wall-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wall-media owner delete" on storage.objects;
create policy "wall-media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wall-media' and (storage.foldername(name))[1] = auth.uid()::text);
