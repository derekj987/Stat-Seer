-- Repair prop_snapshots rows whose snapshot_at holds the game's KICKOFF time.
--
-- THE BUG (fixed in props_client.py):
--
--     parse_event_props(data, event_snapshot_at(data) or e["commence_time"], ...)
--
-- event_snapshot_at() returns the newest bookmaker `last_update`. The Odds API omits that field on
-- the event-odds endpoint often enough that the fallback was the normal path, not the rare one --
-- and the fallback stamped each row with the game's kickoff time as its capture time.
--
-- Two consequences, the second much worse than the first:
--
--   1. Timestamps are wrong and in the FUTURE. CLV is measured by comparing the price we saw at
--      capture time against the closing price; if every row claims it was captured at kickoff,
--      that comparison is meaningless.
--
--   2. SILENT DATA LOSS. snapshot_at is the first column of the dedupe index
--      (snapshot_at, event_id, book, market, player_name, side, line), and price_american is NOT
--      in it. With snapshot_at pinned to kickoff, every capture of a game produced the SAME key,
--      so only the first price for each player/book/market/side/line was ever kept and every
--      later price move at an unchanged line was dropped as a duplicate.
--
--      Measured on the 2026 season: 193 capture runs landed rows but only 8 distinct snapshot_at
--      values across 17 games (8 = the number of distinct kickoff times). prop_snapshots holds
--      14,008 rows for 2026; odds_snapshots, which never had this bug, holds 647,974.
--
-- Game lines were never affected -- odds_client.py has no such fallback.
--
-- WHAT THIS CAN AND CANNOT FIX. `collected_at` recorded the true capture time all along, so the
-- surviving rows can be relabelled correctly and become usable for CLV. The rows the dedupe
-- DISCARDED are gone and cannot be recovered; only re-capture from here fills that in. This is a
-- relabelling, not a restoration.
--
-- SAFETY. The update makes keys MORE unique, never less: snapshot_at goes from one value per game
-- to one value per capture run, so no two rows can collide as a result. The predicate is
-- `snapshot_at > collected_at` -- a capture cannot have happened after the row recording it was
-- written, so this is airtight and cannot catch a legitimately-stamped row.
--
-- Run once in the Supabase SQL editor. Idempotent (re-running matches nothing).

begin;

-- Look before leaping: how many rows, and over what span.
select count(*)                                as rows_to_fix,
       min(collected_at)::date                 as oldest_capture,
       max(collected_at)::date                 as newest_capture,
       count(distinct collected_at)            as capture_runs,
       count(distinct snapshot_at)             as current_distinct_timestamps
  from prop_snapshots
 where snapshot_at > collected_at;

update prop_snapshots
   set snapshot_at = collected_at
 where snapshot_at > collected_at;

commit;

-- Verify -- all three should now be true:
--   select count(*) from prop_snapshots where snapshot_at > collected_at;          -- 0
--   select count(*) from prop_snapshots where snapshot_at > now();                 -- 0
--   select count(distinct snapshot_at) from prop_snapshots where season = 2026;    -- ~193, not 8
--
-- Then confirm the capture is writing properly again -- run the prop capture and check that a
-- single sweep now lands a full set of rows rather than only the handful whose line moved:
--   select collected_at, count(*) from prop_snapshots
--    where season = 2026 group by collected_at order by collected_at desc limit 5;
