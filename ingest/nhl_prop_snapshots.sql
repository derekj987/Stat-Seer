-- NHL player-prop capture — goals, shots on goal, points, assists; every US book, every few hours.
--
-- WHY THIS GOES IN BEFORE ANY NHL MODELLING. Prop history cannot be backfilled. Books post these a
-- day or two before puck drop and the number moves until it, so a snapshot exists only if it was
-- taken that day. Every day this table does not exist is a day of validation data gone for good.
-- The CFB module learned this the expensive way and its note still reads "schedule it, prop history
-- can't be backfilled"; the NFL prop pipeline hit the same wall. A model can be built later from a
-- season of captures. It cannot be built later from nothing.
--
-- The 2026-27 NHL season is already under way (first captures 2026-10-09), so this is the piece
-- that is losing value while anything else is discussed.
--
-- MARKETS, and why these four (Derek's list, and it happens to split cleanly):
--   player_goal_scorer_anytime   a PROBABILITY market (Yes/No) — the anytime-TD analogue
--   player_shots_on_goal         VOLUME. The project's standing finding is that volume persists
--                                and efficiency does not, so this is the one most likely to carry
--                                a signal.
--   player_points                goals + assists
--   player_assists               the most linemate-dependent of the four
-- Shots are stored with their line; goal-scorer rows carry a null line and a price only.
--
-- Written by nhl_props.py --supabase (.github/workflows/capture-nhl-props.yml).
-- Same shape and the same append-only guarantees as cfb_prop_snapshots / cfb_odds_snapshots.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create table if not exists nhl_prop_snapshots (
    id            bigserial   primary key,
    snapshot_at   timestamptz not null,   -- ONE clock time per sweep (never a commence time)
    event_id      text        not null,
    commence      timestamptz,
    home_team     text,
    away_team     text,
    book          text        not null,
    market        text        not null,   -- player_goal_scorer_anytime | player_shots_on_goal
                                          -- | player_points | player_assists
    player        text,
    side          text,                   -- Over / Under, or Yes / No for goal scorer
    line          numeric(6,2),           -- null on the goal-scorer market (it has no line)
    price         integer,
    collected_at  timestamptz not null default now()
);
create index if not exists nhl_props_event_idx    on nhl_prop_snapshots (event_id, market, book);
create index if not exists nhl_props_time_idx     on nhl_prop_snapshots (snapshot_at);
-- Grading and backtests both scan by player across games, so that pair earns its own index.
create index if not exists nhl_props_player_idx   on nhl_prop_snapshots (player, market);
create index if not exists nhl_props_commence_idx on nhl_prop_snapshots (commence);

-- `nulls not distinct` matters here: the goal-scorer market has a NULL line on every row, and
-- without it Postgres would treat each NULL as distinct and the dedupe index would never fire.
--
-- 🚨 THE KEY MUST INCLUDE line AND price, and leaving them out cost four consecutive sweeps.
-- `player` is a NAME, and a name is not an identity. Vancouver currently rosters two different
-- Elias Petterssons -- the forward (#40, nhl id 8480012) and the defenceman (#25, id 8483678) --
-- and the odds feed supplies no id, only the string. Both are priced in the anytime-scorer market,
-- at +275 and +1700, so under the old narrow key they produced the SAME index entry while being
-- genuinely different offers. Postgres rejected the insert, and because the whole sweep is one
-- POST, EVERY row in it was lost: captures failed 2026-10-19 20:38 through 2026-10-20 14:23. Prop
-- history cannot be backfilled (see the header), so those sweeps are gone for good.
--
-- Including line and price makes the key mean "this exact offer, recorded twice", which is the only
-- thing a snapshot table should ever collapse. Two prices for one name are two offers and both are
-- kept. The remaining ambiguity is real and is NOT fixed here: a graded Pettersson prop cannot be
-- attributed to the right player from this table alone, so grading must either skip duplicate names
-- or resolve them against the roster by position/market. Flagged rather than papered over.
drop index if exists nhl_prop_snapshots_dedupe;
create unique index if not exists nhl_prop_snapshots_dedupe on nhl_prop_snapshots
    (snapshot_at, event_id, book, market, player, side, line, price) nulls not distinct;

-- Append-only: the same block_mutation() trigger every capture table carries. A captured line is a
-- historical fact; nothing should be able to edit it after the fact, including us.
revoke update, delete on nhl_prop_snapshots from public, anon, authenticated;
drop trigger if exists no_update_nhl_props on nhl_prop_snapshots;
create trigger no_update_nhl_props before update or delete on nhl_prop_snapshots
    for each row execute function block_mutation();
grant select, insert on nhl_prop_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify (expect ~2,800 rows per sweep across ~10 priced games on a full slate):
--   select snapshot_at, count(*) rows, count(distinct event_id) games, count(distinct player) players
--   from nhl_prop_snapshots group by 1 order by 1 desc limit 5;
--
--   select market, count(*) from nhl_prop_snapshots group by 1 order by 2 desc;
