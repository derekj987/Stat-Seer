-- Who started in goal, and how they did. Written by nhl_goalies.py --supabase.
-- Run once in the Supabase SQL editor. Idempotent.
--
-- UNLIKE EVERY OTHER NHL TABLE IN THIS REPO, THIS ONE IS NOT APPEND-ONLY AND NOT PERISHABLE.
-- nhl_odds_snapshots and nhl_prop_snapshots record what a market said at a moment, which is gone
-- if it is not captured on the day — hence their block_mutation() triggers. This records what
-- HAPPENED in a completed game, which the NHL publishes forever. It can be rebuilt from the API at
-- any time, so the right key is (game_id, goalie_id) with an upsert, and a re-run that corrects a
-- row is a feature rather than a violation.
--
-- The NHL's public API has no projected or confirmed starter before a game — checked endpoint by
-- endpoint; `landing.matchup.goalieComparison` lists every goalie on both rosters and names no
-- starter. So this table answers "who started and how did it go", never "who is starting tonight".

create table if not exists public.nhl_goalie_starts (
  game_id         bigint  not null,
  season          integer not null,
  game_date       date,
  start_utc       timestamptz,
  team            text    not null,
  opponent        text,
  is_home         boolean,
  goalie_id       bigint  not null,
  goalie_name     text,
  -- Exactly one row per (game_id, team) carries is_starter = true. It is resolved from the
  -- play-by-play's first goalie-in-net when both goalies played, because neither boxscore order
  -- nor the larger ice time identifies the starter: measured on this season's games where both
  -- played, the goalie with more ice time is the WRONG one 45% of the time (5 of 11) — that is
  -- precisely the pulled-starter case a rest/workload model cares most about.
  is_starter      boolean not null,
  toi_seconds     integer,
  shots_against   integer,
  saves           integer,
  goals_against   integer,
  save_pct        real,
  decision        text,          -- W / L / O (overtime loss), null if neither
  rest_days       integer,       -- clear days since this TEAM's previous game, null for its first
  is_back_to_back boolean,
  primary key (game_id, goalie_id)
);

create index if not exists ix_nhlg_team   on public.nhl_goalie_starts (team, game_date desc);
create index if not exists ix_nhlg_goalie on public.nhl_goalie_starts (goalie_id, game_date desc);
create index if not exists ix_nhlg_start  on public.nhl_goalie_starts (is_starter, game_date desc);

alter table public.nhl_goalie_starts enable row level security;

-- Server-only, like the other capture tables: the writer uses the service key, and nothing on the
-- site reads this directly yet. No anon/authenticated grants, so RLS with no policy is correct —
-- a read with the service key returns 42501, which is "exists, no grant", NOT "missing".
grant select, insert, update on public.nhl_goalie_starts to service_role;
