-- NBA player-prop capture — points, rebounds, assists, threes, steals, blocks, PRA,
-- double-double, first basket; every US book, every few hours.
--
-- WHY THIS GOES IN BEFORE ANY NBA MODELLING. Prop history cannot be backfilled. Books post these
-- the morning of the game and the number moves until tip-off, so a snapshot exists only if it was
-- taken that day. Every day this table does not exist is a day of validation data gone for good.
-- The CFB module learned this the expensive way and its note still reads "schedule it, prop history
-- can't be backfilled"; the NFL and NHL prop pipelines each hit the same wall. A model can be built
-- later from a season of captures. It cannot be built later from nothing.
--
-- The 2026-27 NBA season was already a week old when this was written (first captures 2026-10-26),
-- so this is the piece that is losing value while anything else is discussed.
--
-- MARKETS, verified against the live feed before this was written. One event (Wizards @ Hornets,
-- 2026-10-26) across 9 US books including FanDuel:
--   player_points                    346 outcomes   VOLUME x RATE — the headline market
--   player_rebounds                  214
--   player_assists                   154
--   player_threes                    140
--   player_blocks                     16            THIN — see below
--   player_steals                     12            THIN — see below
--   player_points_rebounds_assists   200            the combined market
--   player_double_double              57            a PROBABILITY market (Yes/No), null line
--   player_first_basket               50            a PROBABILITY market (Yes/No), null line
-- A whole 9-game slate measured 9,351 rows for 73 credits.
--
-- 🚨 STEALS AND BLOCKS ARE THIN, AND THAT IS A PROPERTY OF THE MARKET, NOT A CAPTURE BUG. Across
-- nine games the whole slate produced 42 steals rows and 50 blocks rows, against 2,749 for points.
-- A book prices one or two players a night. Derek named steals explicitly so it is captured, but
-- nothing downstream should read an empty steals panel as a defect, and a backtest on it will be
-- sample-starved for a long time.
--
-- 🚨 ALTERNATE LADDERS ARE DELIBERATELY NOT CAPTURED YET. `player_points_alternate` alone returned
-- 1,305 outcomes on one event and `player_rebounds_alternate` 843, against ~880 rows for all nine
-- markets above combined. They are the FIRST thing to add when alternate-line fair value is built —
-- that panel is pure de-vig arithmetic and the ladders are exactly what it reads — but capturing
-- them before the panel exists buys storage, not information.
--
-- Written by nba_props.py --supabase (.github/workflows/capture-nba-props.yml).
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create table if not exists nba_prop_snapshots (
    id            bigserial   primary key,
    snapshot_at   timestamptz not null,   -- ONE clock time per sweep (never a commence time)
    event_id      text        not null,
    commence      timestamptz,
    home_team     text,
    away_team     text,
    book          text        not null,
    market        text        not null,   -- player_points | player_rebounds | player_assists
                                          -- | player_threes | player_steals | player_blocks
                                          -- | player_points_rebounds_assists
                                          -- | player_double_double | player_first_basket
    player        text,
    side          text,                   -- Over / Under, or Yes / No on the probability markets
    line          numeric(6,2),           -- null on double-double and first basket (no line)
    price         integer,
    collected_at  timestamptz not null default now()
);
create index if not exists nba_props_event_idx    on nba_prop_snapshots (event_id, market, book);
create index if not exists nba_props_time_idx     on nba_prop_snapshots (snapshot_at);
-- Grading and backtests both scan by player across games, so that pair earns its own index.
create index if not exists nba_props_player_idx   on nba_prop_snapshots (player, market);
create index if not exists nba_props_commence_idx on nba_prop_snapshots (commence);

-- `nulls not distinct` matters here: double-double and first basket carry a NULL line on every row,
-- and without it Postgres would treat each NULL as distinct and the dedupe index would never fire.
--
-- 🚨 THE KEY INCLUDES line AND price, AND IT STARTS THAT WAY RATHER THAN EARNING IT BACK LATER.
-- `player` is a NAME, and a name is not an identity. The NHL table learned this at full price:
-- Vancouver rosters two different Elias Petterssons, the odds feed supplies no id, and under a
-- narrow key their two anytime-scorer offers (+275 and +1700) produced the SAME index entry while
-- being genuinely different offers. Postgres rejected the insert, and because a whole sweep is one
-- POST, EVERY row in it was lost — captures failed 2026-10-19 20:38 through 2026-10-20 14:23, and
-- prop history cannot be backfilled, so those sweeps are gone for good. The NBA has the same
-- exposure (duplicate surnames, juniors, and ten-day signings arriving mid-season).
--
-- Including line and price makes the key mean "this exact offer, recorded twice", which is the only
-- thing a snapshot table should ever collapse. Two prices for one name are two offers and both are
-- kept. The remaining ambiguity is real and is NOT fixed here: a graded prop cannot be attributed
-- to the right same-named player from this table alone, so grading must either skip duplicate names
-- or resolve them against the roster. Flagged rather than papered over.
drop index if exists nba_prop_snapshots_dedupe;
create unique index if not exists nba_prop_snapshots_dedupe on nba_prop_snapshots
    (snapshot_at, event_id, book, market, player, side, line, price) nulls not distinct;

-- Append-only: the same block_mutation() trigger every capture table carries. A captured line is a
-- historical fact; nothing should be able to edit it after the fact, including us.
revoke update, delete on nba_prop_snapshots from public, anon, authenticated;
drop trigger if exists no_update_nba_props on nba_prop_snapshots;
create trigger no_update_nba_props before update or delete on nba_prop_snapshots
    for each row execute function block_mutation();
grant select, insert on nba_prop_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify (expect ~1,000 rows per priced game; a 9-game slate measured 9,351):
--   select snapshot_at, count(*) rows, count(distinct event_id) games, count(distinct player) players
--   from nba_prop_snapshots group by 1 order by 1 desc limit 5;
--
--   select market, count(*) from nba_prop_snapshots group by 1 order by 2 desc;
