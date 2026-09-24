-- News-driven NFL availability — the feed that moves before the league files.
--
-- WHY THIS EXISTS. Derek, on the week-3 board: "I'm not seeing Jaxson Dart major injury in the NYG
-- game (he's out for the season)... Also the same for Caleb Williams for the Bears." Both were
-- genuinely absent, and not from a bug. Every availability source we had is a version of the
-- OFFICIAL game-status report, and that report has two structural blind spots:
--
--   1. No designation lands before Friday. Dart was in our week-3 data with practice_status
--      "Did Not Participate In Practice" and report_status NULL — a full DNP reading as nothing.
--   2. Anyone moved to injured reserve drops OFF the report entirely rather than being marked,
--      because he is no longer on the active roster. Caleb Williams had zero rows.
--
-- Measured against Sleeper the same morning: it had Dart "Out — Knee - MCL, Surgery" and Williams
-- "Doubtful — Hamstring", both timestamped the previous evening, plus Jayden Daniels out. Sleeper
-- is a fantasy platform aggregating the same beat reporting the wires carry: free, no API key, and
-- the only feed found that moves on NEWS instead of on the league's filing schedule.
--
-- WHY A TABLE RATHER THAN A REQUEST-TIME FETCH. The first cut read Sleeper directly from the web
-- layer. The endpoint is every player in the league — 2.6MB gzipped, 14.7MB parsed — which is a lot
-- to do on a page render, and Sleeper asks that it not be polled hard. A cron writes; the board
-- reads ~450 small rows.
--
-- APPEND ON CHANGE, not one snapshot per run. A full snapshot every four hours would be ~450 rows
-- x 6 x 150 days = 400k rows a season, and this project has hit its storage limit once already
-- (see capture-odds.yml). Only a CHANGE is written — a new designation, a changed one, or a
-- clearing — which is on the order of a hundred rows a day. That also makes the table a genuine
-- history rather than a sampling of one: the lead time Sleeper gives over the official report is
-- measurable from it later, and like the practice trajectory in CLAUDE.md it cannot be
-- reconstructed after the fact. Nothing is modelled off the history yet; this is the recording.
--
-- Run once in the Supabase SQL editor. Idempotent.

begin;

create table if not exists sleeper_availability (
    id          bigserial   primary key,
    captured_at timestamptz not null default now(),
    -- The key the board joins on: normalised name + our team abbreviation. Sleeper carries a
    -- gsis_id on only ~20% of active skill players (and some values have leading whitespace), so
    -- it cannot be the join. Name alone would collide; the team has to agree too.
    player_key  text        not null,
    player      text        not null,   -- as Sleeper spells it, which is what the board prints
    team        text        not null,   -- OUR abbreviation: Sleeper's LAR -> LA, stale OAK -> LV
    pos         text        not null,
    -- OUT / IR / PUP / NFI / DNR / SUS / DOUBTFUL / QUESTIONABLE.
    -- NULL means CLEARED: he carried a designation at the last capture and no longer does. The row
    -- has to be written, or the board would go on showing a player who has been activated.
    status      text,
    body_part   text,
    sleeper_id  text        not null,
    gsis_id     text,                   -- when Sleeper happens to have it; never relied upon
    -- Sleeper's own news_updated. Kept so the lead time over the official report can be measured
    -- rather than asserted — that is the whole case for this source.
    news_at     timestamptz
);

-- The current-state read: newest row per player. Covers the view's DISTINCT ON directly.
create index if not exists sleeper_avail_key_idx  on sleeper_availability (player_key, captured_at desc);
create index if not exists sleeper_avail_time_idx on sleeper_availability (captured_at desc);
create index if not exists sleeper_avail_team_idx on sleeper_availability (team, captured_at desc);

-- What the board actually reads: one row per player, the latest. Rows whose status is NULL are
-- cleared players and the reader skips them — they are kept here so "he was out and now is not" is
-- one query rather than a join against history.
-- security_invoker so the base table's RLS applies to whoever selects, instead of the view's owner.
create or replace view sleeper_availability_current
    with (security_invoker = true) as
select distinct on (player_key)
       player_key, player, team, pos, status, body_part, sleeper_id, gsis_id, news_at, captured_at
  from sleeper_availability
 order by player_key, captured_at desc;

alter table sleeper_availability enable row level security;
-- Service-role only. The web server already holds SUPABASE_SERVICE_KEY for practice_reports and
-- reads this the same way, so there is no anon or authenticated grant and the table cannot be
-- enumerated from the browser.
grant select, insert on sleeper_availability to service_role;
grant usage, select on sequence sleeper_availability_id_seq to service_role;
grant select on sleeper_availability_current to service_role;

commit;

-- Once there are a few weeks of it — how much earlier did the news feed know than the league's
-- own report? This is the measurement that justifies keeping the source, and it needs the history:
--
--   select a.player, a.team, a.status, a.captured_at as news_had_it, p.report_date as report_had_it
--     from sleeper_availability a
--     join practice_reports p
--       on p.team = a.team
--      and lower(p.game_status) = lower(a.status)
--    where a.status in ('OUT','DOUBTFUL')
--    order by (p.report_date - a.captured_at) desc;
