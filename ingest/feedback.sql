-- Feedback mailbox for the global "Tell us what's up?" widget.
-- Run once in the Supabase SQL editor. Anyone (signed-in or anonymous) can SUBMIT;
-- only founders/admins can READ (the /feedback inbox). Nobody can update/delete via the
-- anon/authenticated API.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message    text not null check (char_length(message) between 1 and 4000),
  email      text,                       -- optional reply-to the submitter typed
  user_id    uuid references auth.users(id) on delete set null,  -- null if anonymous
  path       text,                       -- the page they were on
  status     text not null default 'new' -- 'new' | 'reviewed' (for later triage)
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);

-- Table-level privileges. A table made with raw SQL does NOT inherit these, so grant them
-- explicitly (RLS below still governs which ROWS each role may touch).
grant insert on public.feedback to anon, authenticated;  -- anyone may submit
grant select on public.feedback to authenticated;        -- staff read (RLS restricts to founders)

alter table public.feedback enable row level security;

-- Anyone may submit a piece of feedback.
drop policy if exists "anyone can submit feedback" on public.feedback;
create policy "anyone can submit feedback"
  on public.feedback for insert
  to anon, authenticated
  with check (true);

-- Only founders/admins may read the inbox.
drop policy if exists "staff can read feedback" on public.feedback;
create policy "staff can read feedback"
  on public.feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('founder', 'admin')
    )
  );
