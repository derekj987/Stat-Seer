-- NCAAF game-line capture — moneyline, spread, total, every US book, every 30 minutes.
--
-- WHY. The college boards read their market spread and total from the exported card
-- (web/app/ncaaf/model-data.ts), which cfb_export.py rebuilds four times a day from a MEDIAN across
-- every book the feed returns. Derek, reading the board beside FanDuel: "the market spread and
-- market over/unders do not match the current lines on FanDuel. How come this is not auto updating
-- as the lines change?" Two reasons, both fixed by this table: a median is nobody's number, and a
-- four-times-a-day export is up to six hours stale on a line that moves all week.
--
-- With this table the NCAAF pages read the newest sweep at render (ISR 120s) exactly as the NFL
-- and MLB boards do — FanDuel's own spread and total where FanDuel posts one — and the Value
-- Finder gets per-book shopping on college game lines, the one piece it has been promising.
--
-- Same shape as mlb_odds_snapshots, for the same reasons (its header explains them). Written by
-- cfb_capture.py --supabase on a schedule (.github/workflows/capture-cfb-odds.yml).
--
-- Idempotent. Run once in the Supabase SQL editor.

begin;

create table if not exists cfb_odds_snapshots (
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
    outcome_point numeric(7,2),           -- spread / total; null for h2h
    price_american integer,
    collected_at  timestamptz not null default now()
);
create index if not exists cfb_odds_event_idx on cfb_odds_snapshots (event_id, market, book);
create index if not exists cfb_odds_time_idx  on cfb_odds_snapshots (snapshot_at);
create unique index if not exists cfb_odds_snapshots_dedupe on cfb_odds_snapshots
    (snapshot_at, event_id, book, market, outcome_name, outcome_point) nulls not distinct;

-- Append-only: the same block_mutation() trigger every capture table carries.
revoke update, delete on cfb_odds_snapshots from public, anon, authenticated;
drop trigger if exists no_update_cfb_odds on cfb_odds_snapshots;
create trigger no_update_cfb_odds before update or delete on cfb_odds_snapshots
    for each row execute function block_mutation();
grant select, insert on cfb_odds_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Verify:
--   select snapshot_at, count(*), count(distinct event_id) games, count(distinct book) books
--   from cfb_odds_snapshots group by 1 order by 1 desc limit 5;
