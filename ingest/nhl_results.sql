-- ============================================================================
-- NHL final scores + exact puck-drop times  (nhl_results.py --supabase)
-- ----------------------------------------------------------------------------
-- The NHL analogue of nflverse games.csv: the benchmark side of every totals
-- question. Without it there is nothing to grade a closing total against, and
-- the standing rule (CLAUDE.md) is that nothing enters The Model unless it beats
-- the closing line out of sample.
--
-- Source is the NHL's own public JSON feed (api-web.nhle.com) -- free, no key,
-- no scraping. A season is ~30 requests because the schedule endpoint returns a
-- whole week at a time.
--
-- 🚨 A SHOOTOUT ADDS EXACTLY ONE GOAL TO THE FINAL SCORE, and books grade the
-- posted total on the final score. So:
--   * an NHL game can never finish tied;
--   * total_goals is NOT a clean count of goals scored in play -- 22.2% of games
--     (measured, 6,560 games, 2021-2025) get a goal from OT/SO instead.
-- Measured consequence: realised totals are 68.2% ODD vs 31.8% even, stable in
-- every one of five seasons, and a fitted Poisson overstates the push on a 6.0
-- total by 5.0 points (16.0% vs 11.0% actual). See nhl_totals_study.py. This is
-- the NHL analogue of the NFL key-number rule -- never price an NHL total off a
-- smooth distribution. `last_period_type` is kept on every row so the in-play
-- goals and the OT/SO goal can be separated.
--
-- game_type 2 = regular season, 3 = playoffs. The collector defaults to regular
-- season only; playoff hockey is a different scoring regime (no shootout -- OT
-- runs until someone scores), so pooling them would blur what we measure.
--
-- Goals are NULL until a game is final, so a game collected while still
-- scheduled is not mistaken for a 0-0 result. The writer upserts with
-- merge-duplicates for exactly that reason.
--
-- Run once in Supabase (SQL editor). Idempotent.
-- ============================================================================
create table if not exists nhl_results (
    game_id          bigint      primary key,         -- NHL feed id, e.g. 2024021055
    season           smallint    not null,            -- start year: 2024 = 2024-25
    season_id        integer,                         -- feed form, e.g. 20242025
    game_type        smallint    not null,            -- 2 = regular season, 3 = playoffs
    game_date        date,                            -- schedule date (feed's own day grouping)
    start_time_utc   timestamptz,                     -- exact puck drop; plans the odds snapshot
    away_abbrev      text        not null,
    home_abbrev      text        not null,
    away_team        text,
    home_team        text,
    away_goals       smallint,                        -- null until final
    home_goals       smallint,                        -- null until final
    total_goals      smallint,                        -- null until final; INCLUDES the OT/SO goal
    last_period_type text        check (last_period_type in ('REG','OT','SO')),
    neutral_site     boolean     not null default false,
    venue            text,
    updated_at       timestamptz not null default now()
);

-- Grading joins odds snapshots to results on puck-drop time, and the totals
-- study filters to completed regular-season games.
create index if not exists nhl_results_start_idx on nhl_results (start_time_utc);
create index if not exists nhl_results_season_type_idx on nhl_results (season, game_type);

alter table nhl_results enable row level security;

drop policy if exists "nhl results readable by all" on nhl_results;
create policy "nhl results readable by all" on nhl_results for select using (true);

grant select on nhl_results to anon, authenticated;
grant select, insert, update, delete on nhl_results to service_role;
