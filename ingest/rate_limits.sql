-- Rate limiting (ASVS L1 · V11/V13) — a Postgres fixed-window limiter, so no external service.
--
-- Finding #3 (HIGH): the paid-LLM routes (/api/assistant, /api/dashboard-chart) and the open
-- /api/feedback route have no throttle, so one member could loop them and run up the Anthropic bill
-- or flood the ops inbox. This adds an atomic increment-and-check the API routes call via the service
-- key before doing paid/side-effectful work.
--
-- Run once in the Supabase SQL editor. Idempotent.

begin;

create table if not exists public.api_rate_limits (
  bucket       text   not null,   -- e.g. 'asst:min:<uid>', 'fb:<ip>'
  window_start bigint not null,   -- epoch seconds, floored to the window size
  count        int    not null default 0,
  primary key (bucket, window_start)
);
-- Only the SECURITY DEFINER function / service_role ever touch this table (no grants, RLS on).
alter table public.api_rate_limits enable row level security;

-- Atomic fixed-window increment-and-check. Returns TRUE while the caller is still within p_limit for
-- the current window, FALSE once over. Also prunes stale windows for the key so the table stays tiny.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w bigint := (extract(epoch from now())::bigint / p_window) * p_window;
  c int;
begin
  delete from public.api_rate_limits where bucket = p_key and window_start < w;
  insert into public.api_rate_limits (bucket, window_start, count) values (p_key, w, 1)
    on conflict (bucket, window_start) do update set count = api_rate_limits.count + 1
    returning count into c;
  return c <= p_limit;
end $$;

-- Server-only: clients cannot call it directly (the routes invoke it with the service key).
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;

commit;
