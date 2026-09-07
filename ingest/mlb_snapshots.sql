-- MLB capture tables — game lines + player props.
--
-- The baseball analogue of odds_snapshots / cfb_prop_snapshots, and the first piece of the MLB
-- build. Written by mlb_capture.py --supabase on a schedule
-- (.github/workflows/capture-mlb.yml). Supabase rather than a local SQLite file, because a GitHub
-- runner's filesystem is discarded when the job ends.
--
-- WHY NOW. There are roughly three weeks of the 2026 regular season left. Live prop capture is the
-- only way to observe a book's number moving through the day, and a snapshot exists only if taken
-- at the time. (Historical odds ARE purchasable on the current plan, so this is not the absolute
-- cliff that practice trajectory was -- but the live series is free, and the archive is not a
-- substitute for knowing what we saw when we saw it.)
--
-- SEPARATE TABLES, not a sport column on the NFL ones. Same reasoning as cfb_prop_snapshots: the
-- NFL tables are append-only, heavily indexed and read by live boards, and adding a discriminator
-- column to them would touch a hot path for no gain. MLB gets its own pair.
--
-- MARKET COVERAGE, measured against the live API on 2026-09-07 across 5 games (us region):
--   draftkings 14/15 markets · betmgm 12 · fanatics 12 · bovada 8 · fanduel 3
-- FanDuel carries only batter_stolen_bases, pitcher_outs and pitcher_strikeouts through the API,
-- so the coverage backbone is DraftKings/BetMGM/Fanatics and FanDuel is one book among many.
-- Do not design anything to depend on a single book.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

-- ============================================================================
-- MLB GAME LINES  (moneyline, run line, totals)
-- ----------------------------------------------------------------------------
-- Note the baseball shape: the run line is a fixed -1.5/+1.5 rather than a moving spread, so the
-- real game markets are h2h and totals, with spreads carrying the run-line price. Margin-of-1 is
-- the modal result (~a third of games), so key-number logic here is nothing like football's 3 and 7.
-- ============================================================================
create table if not exists mlb_odds_snapshots (
    id            bigserial   primary key,
    snapshot_at   timestamptz not null,   -- ONE clock time per sweep. Never a commence_time:
                                          -- see the props_client kickoff-fallback bug, which put
                                          -- capture times in the future and, because snapshot_at
                                          -- leads the dedupe key, silently discarded a season of
                                          -- price movement.
    capture_reason text       not null default 'SCHEDULED',
    event_id      text        not null,
    commence_time timestamptz,
    home_team     text,
    away_team     text,
    book          text        not null,
    market        text        not null,   -- h2h | spreads | totals
    outcome_name  text,                   -- team name, or Over/Under
    outcome_point numeric(7,2),           -- run line / total; null for h2h
    price_american integer,
    collected_at  timestamptz not null default now()
);
create index if not exists mlb_odds_event_idx on mlb_odds_snapshots (event_id, market, book);
create index if not exists mlb_odds_time_idx  on mlb_odds_snapshots (snapshot_at);
create unique index if not exists mlb_odds_snapshots_dedupe on mlb_odds_snapshots
    (snapshot_at, event_id, book, market, outcome_name, outcome_point) nulls not distinct;

revoke update, delete on mlb_odds_snapshots from public, anon, authenticated;
drop trigger if exists no_update_mlb_odds on mlb_odds_snapshots;
create trigger no_update_mlb_odds before update or delete on mlb_odds_snapshots
    for each row execute function block_mutation();
grant select, insert on mlb_odds_snapshots to service_role;

-- ============================================================================
-- MLB PLAYER PROPS
-- ----------------------------------------------------------------------------
-- Batting and pitching, the two families FanDuel splits its board into. Which of these are
-- MODELLABLE is a separate question from which are popular, and baseball answers it unusually
-- clearly: K% and batters-faced persist, so pitcher_strikeouts is the strongest candidate; barrel
-- and fly-ball rate persist, so home runs are next; hits are BABIP-driven and close to noise.
-- Capture all of them regardless -- coverage is cheap and the negative result is worth having.
--
-- price_american is deliberately OUTSIDE the dedupe key, matching prop_snapshots: two captures at
-- the same line but a different price are two observations we want, and that only works because
-- snapshot_at differs per sweep.
-- ============================================================================
create table if not exists mlb_prop_snapshots (
    id            bigserial   primary key,
    snapshot_at   timestamptz not null,
    capture_reason text       not null default 'SCHEDULED',
    event_id      text        not null,
    commence_time timestamptz,
    home_team     text,
    away_team     text,
    book          text        not null,
    market        text        not null,   -- batter_hits, pitcher_strikeouts, …
    player        text,                    -- as posted by the book (outcome.description)
    side          text,                    -- Over / Under / Yes / No
    line          numeric(7,2),            -- null on yes/no markets (first home run)
    price_american integer,
    collected_at  timestamptz not null default now()
);
create index if not exists mlb_prop_event_idx  on mlb_prop_snapshots (event_id, market, book);
create index if not exists mlb_prop_time_idx   on mlb_prop_snapshots (snapshot_at);
create index if not exists mlb_prop_player_idx on mlb_prop_snapshots (player);
create unique index if not exists mlb_prop_snapshots_dedupe on mlb_prop_snapshots
    (snapshot_at, event_id, book, market, player, side, line) nulls not distinct;

revoke update, delete on mlb_prop_snapshots from public, anon, authenticated;
drop trigger if exists no_update_mlb_props on mlb_prop_snapshots;
create trigger no_update_mlb_props before update or delete on mlb_prop_snapshots
    for each row execute function block_mutation();
grant select, insert on mlb_prop_snapshots to service_role;

grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify:
--   select count(*) from mlb_odds_snapshots;
--   select count(*) from mlb_prop_snapshots;
--   -- after the first capture run, and then that a SECOND run adds rows rather than deduping
--   -- away (which is what the NFL prop bug did for a season):
--   select snapshot_at, count(*) from mlb_prop_snapshots
--    group by snapshot_at order by snapshot_at desc limit 5;
--   -- expect one row per sweep with a real clock time, never a game's start time.
