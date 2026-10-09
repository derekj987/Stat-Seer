-- NHL game-line capture — moneyline, puck line, total; every US book, every 30 minutes.
--
-- The second half of the NHL foundation, after nhl_prop_snapshots. Same reason to do it before any
-- modelling: a line that was not captured before puck drop cannot be recovered, and without the
-- pregame sweep there is no closing line to grade against and no line-shopping for Value Finder.
--
-- 🚨 THE PUCK LINE IS NOT A SPREAD, and the data says so flatly. Measured on the live feed
-- (2026-10-09, 18 games x 19 books): the `spreads` market returned 1.5 on 284 of 284 rows, with no
-- exceptions. It is a second moneyline with a goal and a half attached, not an estimate of the
-- margin. The MLB module wrote this lesson down after the board briefly treated the run line as a
-- spread and recommended +1.5 on every team (EMPIRICAL_REFERENCE §12d). Anything reading this
-- table must price the puck line as a PROBABILITY.
--
-- TOTALS COME IN THREES: 5.5, 6.0 and 6.5 were the only values on that same sweep. Note the 6.0 —
-- a whole number, so a total CAN push, and any grading of this market needs W-L-Push rather than
-- the W-L a half-point line allows. Football totals almost never do this; baseball does.
--
-- Small integers on a low-scoring, high-variance sport puts totals in the receptions regime
-- (EMPIRICAL_REFERENCE §13i), where a mean-to-median conversion cannot fix a tilt because the
-- error lives in the mean. Worth remembering before anyone reaches for the football machinery.
--
-- Written by nhl_capture.py --supabase (.github/workflows/capture-nhl-odds.yml). Same shape and the
-- same append-only guarantees as cfb_odds_snapshots / mlb_odds_snapshots.
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create table if not exists nhl_odds_snapshots (
    id            bigserial   primary key,
    snapshot_at   timestamptz not null,   -- ONE clock time per sweep (never a commence_time)
    capture_reason text       not null default 'SCHEDULED',
    event_id      text        not null,
    commence_time timestamptz,
    home_team     text,
    away_team     text,
    book          text        not null,
    market        text        not null,   -- h2h | spreads | totals
    outcome_name  text,                   -- team name, or Over/Under
    outcome_point numeric(7,2),           -- puck line (±1.5) / total; null for h2h
    price_american integer,
    collected_at  timestamptz not null default now()
);
create index if not exists nhl_odds_event_idx on nhl_odds_snapshots (event_id, market, book);
create index if not exists nhl_odds_time_idx  on nhl_odds_snapshots (snapshot_at);
-- The boards read the newest sweep for upcoming games; grading reads the last PREGAME sweep per
-- event. Both scan on commence_time, so it carries its own index.
create index if not exists nhl_odds_commence_idx on nhl_odds_snapshots (commence_time);

create unique index if not exists nhl_odds_snapshots_dedupe on nhl_odds_snapshots
    (snapshot_at, event_id, book, market, outcome_name, outcome_point) nulls not distinct;

-- Append-only: the same block_mutation() trigger every capture table carries. A captured line is a
-- historical fact and nothing should be able to edit it afterwards, including us — that property is
-- the whole basis of the published track record.
revoke update, delete on nhl_odds_snapshots from public, anon, authenticated;
drop trigger if exists no_update_nhl_odds on nhl_odds_snapshots;
create trigger no_update_nhl_odds before update or delete on nhl_odds_snapshots
    for each row execute function block_mutation();
grant select, insert on nhl_odds_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify (expect ~1,500 rows per sweep across ~15 games and ~19 books on a full slate):
--   select snapshot_at, count(*) rows, count(distinct event_id) games, count(distinct book) books
--   from nhl_odds_snapshots group by 1 order by 1 desc limit 5;
--
-- Confirm the puck line really is fixed — if this ever returns anything but 1.5, something that
-- reads this table is about to be quietly wrong:
--   select distinct abs(outcome_point) from nhl_odds_snapshots where market = 'spreads';
