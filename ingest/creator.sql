-- Site-visit counter for the Creator dashboard (/creator).
-- Run this ONCE in the Supabase SQL editor to enable the "Site visits" stat. Until it
-- exists the dashboard just shows "—" for visits; everything else works without it.
--
-- One row per day; the app bumps today's row once per browser session via /api/visit,
-- which calls bump_visits() with the service key. No public access — service_role only.

create table if not exists site_visits (
    day  date primary key default current_date,
    hits integer not null default 0
);

alter table site_visits enable row level security;  -- no public policies; service_role only
grant select, insert, update on site_visits to service_role;

-- Atomic increment of today's counter (insert the day, or +1 if it already exists).
create or replace function bump_visits() returns void
language sql
as $$
  insert into site_visits (day, hits) values (current_date, 1)
  on conflict (day) do update set hits = site_visits.hits + 1;
$$;

grant execute on function bump_visits() to service_role;
