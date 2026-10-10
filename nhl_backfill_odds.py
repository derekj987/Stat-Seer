"""
nhl_backfill_odds.py -- import TIMESTAMPED historical NHL game lines (closing total, puck line,
moneyline) from The Odds API's historical archive into nhl_odds_snapshots (capture_reason=BACKFILL).

    # what it would cost and do, no calls spent beyond discovery:
    python nhl_backfill_odds.py --season 2024 --plan-only

    # cheap proof: three snapshots, parsed and printed, nothing written
    python nhl_backfill_odds.py --season 2024 --max-snaps 3 --dry-run

    # the real thing, capped
    python nhl_backfill_odds.py --season 2024 --max-credits 20000 --write

WHY. The live capture (nhl_capture.py) started 2026-10-09, so there was exactly one snapshot of
NHL closing totals in the database -- nothing to score a model against. The project's standing rule
is that a candidate only enters The Model if it beats the CLOSING LINE out of sample, so without
this history no NHL totals work can be validated at all. Historical access is already on the plan.

DISCOVERY IS FREE. Unlike backfill_odds.py (which spends a credit-costing call per NFL week to
learn kickoff times), the NHL schedule comes from the NHL's own public API via nhl_results.py. So
every credit this script spends buys actual odds. One call per distinct puck-drop time captures
every game dropping at that time, whatever the slate size -- the bulk endpoint is priced per CALL.
Measured: ~765 distinct puck-drop times per season, so ~7,700 credits for a full season of closing
lines at 10 credits a call.

CLOSING MEANS CLOSING. A snapshot is planned a few minutes before each distinct puck-drop time, and
only events that have NOT yet started at that snapshot are kept. Without that filter the historical
endpoint happily returns games already in progress, and an in-progress price recorded as a closing
line would quietly corrupt every backtest built on this table. See also no-live-bets: every number
in this app is pregame.

🚨 THE PUCK LINE IS NOT A SPREAD -- it is ±1.5 on essentially every game. nhl_capture.py has the
full note; whatever reads this table must price it as a probability, never as a projected margin.

Rows are written through nhl_capture.game_rows / nhl_capture.write, so they are the same shape the
live cron writes and the on-conflict index makes re-runs idempotent.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import nhl_capture as nc  # noqa: E402  -- reuse game_rows + write + TransientError
import odds_client as oc  # noqa: E402

SPORT = "icehockey_nhl"
HIST = f"https://api.the-odds-api.com/v4/historical/sports/{SPORT}"
_used = [0]   # running credit total (sum of x-requests-last)


def hist_get(params):
    """GET the historical odds endpoint. Returns (status, json|None). Tracks credits."""
    url = f"{HIST}/odds?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=60)
            used = r.headers.get("x-requests-last")
            _used[0] += int(used) if used and used.isdigit() else 0
            return r.getcode(), json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if 500 <= e.code < 600 and attempt < 2:
                time.sleep(2 * (attempt + 1)); continue
            print(f"  HTTP {e.code}: {body}", file=sys.stderr)
            return e.code, None
        except urllib.error.URLError as e:
            if attempt < 2:
                time.sleep(2 * (attempt + 1)); continue
            print(f"  network error: {e.reason}", file=sys.stderr)
            return 0, None
    return 0, None


def parse_iso(s):
    return _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso_z(d):
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def schedule(csv_path, seasons):
    """Distinct puck-drop times for the target seasons, from the free NHL feed via nhl_results.py.

    Returns {start_time_utc -> n_games}. One odds call per key covers all of them."""
    if not os.path.exists(csv_path):
        print(f"ERROR: {csv_path} not found. Build it first (free, no credits):\n"
              f"  python nhl_results.py --seasons {min(seasons)}-{max(seasons)} --csv {csv_path}",
              file=sys.stderr)
        return None
    drops = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("season") and int(r["season"]) in seasons and r.get("start_time_utc"):
                drops[r["start_time_utc"]] = drops.get(r["start_time_utc"], 0) + 1
    return dict(sorted(drops.items()))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--season", type=int, help="one season by start year (2024 = 2024-25)")
    g.add_argument("--seasons", help="range or list, e.g. 2021-2025")
    ap.add_argument("--results-csv", default="data/nhl_results.csv",
                    help="schedule source, built by nhl_results.py (free)")
    ap.add_argument("--offset-minutes", type=float, default=6.0,
                    help="snapshot this many minutes before puck drop (default 6 = closing)")
    ap.add_argument("--window-minutes", type=float, default=30.0,
                    help="keep events dropping within this long after the snapshot -- the games "
                         "this snapshot was planned for")
    ap.add_argument("--regions", default="us")
    ap.add_argument("--markets", default="h2h,spreads,totals")
    ap.add_argument("--max-credits", type=int, default=100000, help="hard budget for the run")
    ap.add_argument("--max-snaps", type=int, default=None,
                    help="cap snapshots processed (default: 3 with --dry-run, unlimited otherwise)")
    ap.add_argument("--plan-only", action="store_true",
                    help="print the plan + credit estimate and stop; spends nothing")
    ap.add_argument("--dry-run", action="store_true", help="fetch + parse + report, do NOT write")
    ap.add_argument("--write", action="store_true", help="write to Supabase")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    if not env.get("ODDS_API_KEY"):
        print("ERROR: ODDS_API_KEY missing", file=sys.stderr); return 1
    key = env["ODDS_API_KEY"]

    seasons = {args.season} if args.season else set(
        int(x) for part in args.seasons.split(",") for x in (
            range(int(part.split("-")[0]), int(part.split("-")[1]) + 1) if "-" in part else [int(part)]))
    drops = schedule(args.results_csv, seasons)
    if drops is None:
        return 1
    if not drops:
        print(f"no scheduled games found for season(s) {sorted(seasons)} in {args.results_csv}",
              file=sys.stderr)
        return 1

    n_games = sum(drops.values())
    per_call = 10 * len(args.markets.split(",")) * len(args.regions.split(","))
    est = len(drops) * per_call
    print(f"PLAN: season(s) {sorted(seasons)} -- {n_games:,} game(s) across "
          f"{len(drops):,} distinct puck-drop time(s).")
    print(f"      {per_call} credits per call x {len(drops):,} calls = ~{est:,} credits "
          f"(markets={args.markets}, regions={args.regions}).")
    print(f"      discovery cost 0 -- schedule came from the NHL feed, not the odds API.")
    if args.plan_only:
        print("\n--plan-only: nothing fetched.")
        return 0

    max_snaps = args.max_snaps if args.max_snaps is not None else (3 if args.dry_run else None)
    if max_snaps:
        print(f"      processing at most {max_snaps} snapshot(s) this run.")
    if not (args.write or args.dry_run):
        print("\nneither --write nor --dry-run given; treating as --dry-run.")
        args.dry_run = True

    total_rows, done, empty, in_progress_skipped = 0, 0, 0, 0
    for drop, n_at in drops.items():
        if max_snaps and done >= max_snaps:
            print(f"\nstopping at --max-snaps ({max_snaps})."); break
        if _used[0] >= args.max_credits:
            print(f"\nstopping: credit budget {args.max_credits:,} reached ({_used[0]:,} used)."); break
        done += 1
        snap_req = iso_z(parse_iso(drop) - _dt.timedelta(minutes=args.offset_minutes))
        st, resp = hist_get({"apiKey": key, "regions": args.regions, "markets": args.markets,
                             "oddsFormat": "american", "date": snap_req})
        if st != 200 or not resp:
            continue
        # The API snaps to the nearest archived snapshot at or before the request; its own
        # `timestamp` is the real capture time, so record THAT, never the time we asked for.
        snap_at = resp.get("timestamp", snap_req)
        snap_dt = parse_iso(snap_at)

        keep = []
        for e in resp.get("data", []):
            ct = e.get("commence_time")
            if not ct:
                continue
            mins = (parse_iso(ct) - snap_dt).total_seconds() / 60.0
            if mins < 0:
                in_progress_skipped += 1      # already under way: NOT a closing line
                continue
            if mins > args.window_minutes:
                continue                      # a later game; its own snapshot will catch it
            keep.append(e)
        if not keep:
            empty += 1
        rows = nc.game_rows(keep, snap_at, "BACKFILL")
        total_rows += len(rows)

        if args.write and rows:
            try:
                nc.write(rows, env)
            except nc.TransientError as e:
                print(f"  {snap_at}: transient on write ({e}) -- skipped", file=sys.stderr)
                continue
        if done <= 5 or done % 50 == 0:
            print(f"  {snap_at}  games={len(keep):>2}/{n_at}  rows={len(rows):>4}  "
                  f"credits={_used[0]:,}" + ("" if args.write else "  [dry-run]"))

    action = "wrote" if args.write else "parsed (dry-run, not written)"
    print(f"\n{action}: {total_rows:,} row(s) across {done:,} snapshot(s). "
          f"Credits used: {_used[0]:,}.")
    if empty:
        print(f"  {empty:,} snapshot(s) matched no event -- normal at the edges of the archive's "
              f"coverage.")
    if in_progress_skipped:
        print(f"  {in_progress_skipped:,} in-progress event(s) skipped (not closing lines).")
    if not args.write:
        print("Add --write to persist. Re-runs are idempotent (on-conflict index).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
