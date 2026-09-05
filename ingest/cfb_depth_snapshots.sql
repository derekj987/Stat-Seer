-- Weekly NCAAF depth-chart snapshots — starting a clock that cannot be started retroactively.
--
-- WHY THIS EXISTS. College football has no mandatory injury report, so there is no pre-kickoff
-- availability feed to model from (verified: CFBD /player/injuries and /injuries both 404, ESPN's
-- injuries endpoints 403 for college and pro alike). See EMPIRICAL_REFERENCE 9e.
--
-- The one substitute we can build ourselves is a CHANGE HISTORY of the scraped depth chart: if a
-- starter drops off or down the chart between weeks, that is a signal something happened to him.
-- It is noisy and it lags — Ourlads is slow on the transfer portal, which is how Malachi Toney was
-- missed — but it is the only availability-shaped data available to this project.
--
-- The point is that it is only available IF CAPTURED ON THE DAY. Today's chart says nothing about
-- who was listed last week. This is the same shape as the practice-trajectory feed in CLAUDE.md:
-- the Wed/Thu/Fri sequence exists only if recorded as it happens, and no amount of later effort
-- reconstructs it. Nothing here is modelled yet, and nothing should be until there are enough
-- snapshots to validate against — this is the recording, not the feature.
--
-- COST. A full snapshot is ~2,541 rows (138 teams). Weekly across a 22-week season is ~56k rows,
-- about 4% of the current database. DAILY would be ~391k, which is the kind of growth that put
-- this project over its storage limit once already (see capture-odds.yml) — so: weekly.
--
-- Run once in the Supabase SQL editor. Idempotent.

begin;

create table if not exists cfb_depth_snapshots (
    id           bigserial primary key,
    snapshot_at  timestamptz not null default now(),
    -- The DAY is the natural grain, not the week: the existing daily refresh already commits
    -- cfb_depth.json, so backfilling from git recovers day-level history that a week-grained key
    -- would collapse into a single row. The weekly cron simply writes one day per week.
    snapshot_day date        not null,
    season       smallint    not null,
    week         smallint    not null,
    team         text        not null,   -- CFBD school name
    pos          text        not null,   -- QB / RB / WR / TE
    rank         smallint    not null,   -- 1 = listed starter
    player       text        not null,
    player_norm  text        not null,   -- ascii-alpha key, matches cfb_player_proj.norm()
    source       text        not null default 'ourlads',
    -- One row per player-slot per DAY. A retried workflow on the same day overwrites rather than
    -- duplicating, so a re-run cannot inflate the history; a different day is a new observation.
    unique (snapshot_day, team, pos, rank, source)
);

create index if not exists cfb_depth_snap_week_idx on cfb_depth_snapshots (season, week);
create index if not exists cfb_depth_snap_day_idx  on cfb_depth_snapshots (snapshot_day);
create index if not exists cfb_depth_snap_team_idx on cfb_depth_snapshots (team, season, week);
create index if not exists cfb_depth_snap_name_idx on cfb_depth_snapshots (player_norm, season, week);

alter table cfb_depth_snapshots enable row level security;
-- Service-role only: this is pipeline data, not something the app reads. No anon/authenticated
-- grant, so it cannot be enumerated from the browser.
grant select, insert, update, delete on cfb_depth_snapshots to service_role;
grant usage, select on sequence cfb_depth_snapshots_id_seq to service_role;

commit;

-- What it is for, once there are a few weeks of it — who left a starting slot between weeks:
--
--   with a as (select * from cfb_depth_snapshots where season=2026 and week=5 and rank=1),
--        b as (select * from cfb_depth_snapshots where season=2026 and week=6 and rank=1)
--   select a.team, a.pos, a.player as was, b.player as now
--     from a join b using (team, pos)
--    where a.player_norm <> b.player_norm;
