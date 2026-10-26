-- NBA game lines — moneyline, spread, total; every US book, every few hours.
--
-- Written by nba_capture.py --supabase (.github/workflows/capture-nba-odds.yml).
-- Same shape and the same append-only guarantees as nhl_odds_snapshots / cfb_odds_snapshots.
--
-- 🚨 THE NBA SPREAD *IS* A SPREAD — AND THAT IS THE TRAP, NOT THE REASSURANCE. The puck line and
-- the run line are ±1.5 on every game, so both of those tables carry a warning not to read them as
-- a margin estimate. Basketball is the opposite: the spread is a genuine estimate of the margin,
-- which makes it tempting to port football's key-number machinery onto it. DO NOT.
--
--   NFL margins land on exactly 3 in 15.0% of games and 7 in 9.1%, so a half point at 3 is worth
--   ~9% of win probability — larger than any model edge realistically claimable on a game line.
--   BASKETBALL HAS NO SUCH NUMBERS. Margins are near-continuous, so "key numbers", Sweet Spots and
--   the half-point-at-3 arithmetic have no basketball analogue and must not be built on this table.
--
-- What does port is line shopping and de-vigged fair price (the Pick Auditor): pure arithmetic,
-- sport-agnostic, and the reason this table is worth having before any model exists.
--
-- TOTALS are ~220-240 — a large number with a large spread, so the law-of-large-numbers regime, NOT
-- the small-integer regime (EMPIRICAL_REFERENCE §13i) that the NHL's 5.5 goals and MLB's run line
-- sit in. A Gaussian is defensible on an NBA total in a way it never is on a puck total.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create table if not exists nba_odds_snapshots (
    id             bigserial   primary key,
    snapshot_at    timestamptz not null,   -- ONE clock time per sweep (never a commence time)
    capture_reason text,                   -- SCHEDULED | PRE_KICKOFF | BACKFILL | MANUAL
    event_id       text        not null,
    commence_time  timestamptz,
    home_team      text,
    away_team      text,
    book           text        not null,
    market         text        not null,   -- h2h | spreads | totals
    outcome_name   text,                   -- team name, or Over / Under
    outcome_point  numeric(6,2),           -- the spread or total; null on h2h
    price_american integer,
    collected_at   timestamptz not null default now()
);
create index if not exists nba_odds_event_idx    on nba_odds_snapshots (event_id, market, book);
create index if not exists nba_odds_time_idx     on nba_odds_snapshots (snapshot_at);
create index if not exists nba_odds_commence_idx on nba_odds_snapshots (commence_time);

-- `nulls not distinct`: outcome_point is NULL on every h2h row, and without it Postgres treats
-- each NULL as distinct so the dedupe index would never fire on the moneyline.
drop index if exists nba_odds_snapshots_dedupe;
create unique index if not exists nba_odds_snapshots_dedupe on nba_odds_snapshots
    (snapshot_at, event_id, book, market, outcome_name, outcome_point) nulls not distinct;

-- Append-only: the same block_mutation() trigger every capture table carries. A captured line is a
-- historical fact; nothing should be able to edit it after the fact, including us.
revoke update, delete on nba_odds_snapshots from public, anon, authenticated;
drop trigger if exists no_update_nba_odds on nba_odds_snapshots;
create trigger no_update_nba_odds before update or delete on nba_odds_snapshots
    for each row execute function block_mutation();
grant select, insert on nba_odds_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify (measured 2026-10-26: 1,026 rows from 9 games across 19 books, 6 credits a sweep):
--   select snapshot_at, count(*) rows, count(distinct event_id) games, count(distinct book) books
--   from nba_odds_snapshots group by 1 order by 1 desc limit 5;
--
--   select market, count(*) from nba_odds_snapshots group by 1 order by 2 desc;
