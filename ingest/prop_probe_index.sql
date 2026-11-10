-- A week-filtered "newest capture" probe needs a COMPOSITE index. One column cannot serve it.
--
-- WHY. Every board pins its read to the newest capture with a one-row probe -- the pattern that
-- keeps a page-time read of an append-only table from scanning the whole thing. Two of those
-- probes also filter by week, and those two are the ones that break:
--
--     props.ts  sinceNewest  season=X & week=Y   order=collected_at.desc  limit 1
--     board.ts  fetchWeek    season=X & week=Y   order=snapshot_at.desc   limit 1
--
-- Measured per week against the live tables on 2026-11-10 (Supabase statement timeout ~8s):
--
--     prop_snapshots  order=collected_at.desc   wk10 0.8s  wk9 8.0s  wk8 5.0s  wk1 6.2s
--     prop_snapshots  order=snapshot_at.desc    wk10 0.9s  wk9 0.9s  wk8 500   wk1 500
--     prop_snapshots  order=id.desc             wk10 0.2s  wk9 0.6s  wk8 500   wk1 500
--     odds_snapshots  order=snapshot_at.desc    wk10 0.4s  wk9 2.8s  wk5 500   wk1 500
--
-- Two separate reasons, and between them they rule out every single-column index:
--   * `collected_at` has NO index, so that probe SORTS the week -- 5-8s, straddling the timeout,
--     which is why the failure was intermittent rather than constant.
--   * `snapshot_at` and `id` ARE indexed (prop_time_idx / the primary key) and are WORSE on older
--     weeks, because the planner scans that index backwards from the newest row and must pass
--     every later week's rows before it reaches the one asked for. Being indexed is not enough --
--     the index has to LEAD with the columns being filtered.
--
-- What it cost: /props rendered 94 characters and threw `57014 canceling statement due to
-- statement timeout`, because sinceNewest swallowed the probe's 500 and fell back to an UNBOUNDED
-- read -- 32,000+ rows and still paging when the measurement was cut off. On the game boards the
-- same shape means any PAST-week URL (/model?week=5, /lines?week=1, and the report card's links
-- into them) cannot load at all, while the current week looks perfectly healthy.
--
-- Leading with (season, week) turns both into a single index lookup: seek the prefix, take the
-- first entry. Cost to the capture jobs is one more index on an insert, against a reader that was
-- pulling 32,000+ rows per render.
--
-- NOT NEEDED, deliberately: the MLB / NBA / NHL / CFB prop and game readers run the same probe
-- with NO week filter (`?select=snapshot_at&order=snapshot_at.desc&limit=1`), so the existing
-- single-column `*_time_idx` already serves them -- a backward scan from the newest row with
-- nothing to skip. Only a FILTERED ordered probe needs the composite. Measured, not assumed:
-- cfb_odds_snapshots' one-sided `snapshot_at=lt.K&order=snapshot_at.desc&limit=1` answers in 1.6s.
--
-- Idempotent. Run in the Supabase SQL editor. CONCURRENTLY so the capture crons keep writing --
-- run each statement ON ITS OWN, as CONCURRENTLY cannot sit inside a transaction block.

create index concurrently if not exists prop_probe_idx
    on prop_snapshots (season, week, collected_at desc);

create index concurrently if not exists odds_probe_idx
    on odds_snapshots (season, week, snapshot_at desc);

-- VERIFY -- both rows present, and `idx_scan` climbing once the boards have been loaded:
--   select indexrelname, idx_scan from pg_stat_user_indexes where indexrelname like '%probe_idx';
--
-- And the behaviour the index is for -- these must all answer in well under a second afterwards:
--   select max(collected_at) from prop_snapshots where season = 2026 and week = 1;
--   select max(snapshot_at)  from odds_snapshots where season = 2026 and week = 1;
