"""
backfill_odds.py -- import TIMESTAMPED historical odds (game lines + player props) from The
Odds API's historical archive into odds_snapshots / prop_snapshots (capture_reason=BACKFILL).

You already have historical access on the paid plan (verified); this just pulls it in, so the
work that was blocked can run now: prop-edge validation, CLV vs Pinnacle, line movement, RLM.

For each past game it snapshots at a few points before kickoff (default: closing only), pulls
every book's lines in ONE call plus each game's props, and writes them. It reuses the live
parsers (odds_client.parse_snapshot / props_client.parse_event_props) so the rows are byte-for-
byte the same shape the crons write. A hard --max-credits cap means a run can never blow the
monthly budget.

  # cheap dry run — fetch + parse a couple snapshots, print what WOULD be written, no DB:
  python backfill_odds.py --season 2024 --weeks 1 --offsets 0.1 --dry-run

  # real backfill of a few weeks, closing + 24h-out, capped at 60k credits:
  python backfill_odds.py --season 2024 --weeks 1-4 --offsets 0.1,24 --max-credits 60000 --write

Cost: 10 credits per market. Game lines = 30/snapshot (all games, one call). Props = 10 x
markets per event. Discovery = 10/week. All historical calls report x-requests-last.

Reads keys/creds from .env. Reuses odds_client + props_client.
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import odds_client as oc
import props_client as pc

HIST = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_nfl"
PROP_MARKETS = ("player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,"
                "player_receptions,player_anytime_td")
_used = [0]   # running credit total (sum of x-requests-last)


def hist_get(path, params):
    """GET a historical endpoint. Returns (status, json|None). Tracks credits."""
    url = f"{HIST}{path}?" + urllib.parse.urlencode(params)
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


def parse_weeks(spec):
    out = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-"); out.update(range(int(a), int(b) + 1))
        elif part:
            out.add(int(part))
    return sorted(out)


def week_days(season, weeks):
    """{week -> sorted [gameday date strings]} for the target REG weeks, from games.csv."""
    import csv
    days = {}
    with open(oc.GAMES_LOCAL, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("game_type") == "REG" and str(r.get("season")) == str(season)
                    and r.get("week", "").isdigit() and int(r["week"]) in weeks and r.get("gameday")):
                days.setdefault(int(r["week"]), set()).add(r["gameday"])
    return {w: sorted(d) for w, d in days.items()}


def iso_z(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--weeks", default="1-18", help="e.g. 1-18 or 1,2,3")
    ap.add_argument("--offsets", default="0.1",
                    help="hours before kickoff to snapshot, comma list. 0.1=6min (closing).")
    ap.add_argument("--regions", default="us")
    ap.add_argument("--markets", default=PROP_MARKETS, help="prop markets to pull per event")
    ap.add_argument("--prop-window-hours", type=float, default=8.0,
                    help="only pull props for events kicking off within this many hours of the snapshot")
    ap.add_argument("--max-credits", type=int, default=100000, help="hard credit budget for the run")
    ap.add_argument("--max-snaps", type=int, default=None,
                    help="cap snapshots processed (default: 3 in --dry-run, unlimited otherwise)")
    ap.add_argument("--no-props", action="store_true", help="game lines only (skip props)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + parse + report, do NOT write")
    ap.add_argument("--write", action="store_true", help="write to Supabase")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    if not env.get("ODDS_API_KEY"):
        print("ERROR: ODDS_API_KEY missing", file=sys.stderr); return 1
    key = env["ODDS_API_KEY"]
    weeks = parse_weeks(args.weeks)
    offsets = [float(x) for x in args.offsets.split(",") if x.strip()]
    max_snaps = args.max_snaps if args.max_snaps is not None else (3 if args.dry_run else None)
    week_map = oc.load_week_map()
    wdays = week_days(args.season, weeks)

    # --- Discovery: one cheap 1-market call per week to learn each game's exact commence_time,
    #     then plan a snapshot at commence - offset (games in a slate share a timestamp). ---
    plan = {}   # snapshot_ts(iso) -> {events: {event_id -> event}}
    for w in weeks:
        if w not in wdays:
            continue
        first = dt.date.fromisoformat(wdays[w][0])
        last = dt.date.fromisoformat(wdays[w][-1])
        disc = iso_z(dt.datetime.combine(first - dt.timedelta(days=1), dt.time(12, 0), dt.timezone.utc))
        status, resp = hist_get("/odds", {"apiKey": key, "regions": args.regions,
                                          "markets": "h2h", "oddsFormat": "american", "date": disc})
        if status != 200 or not resp:
            print(f"  week {w}: discovery failed (HTTP {status})", file=sys.stderr); continue
        for e in resp.get("data", []):
            ct = e.get("commence_time")
            if not ct:
                continue
            d = parse_iso(ct).date()
            if not (first <= d <= last):
                continue                       # a different week's game (lines post ahead)
            for off in offsets:
                snap = iso_z((parse_iso(ct) - dt.timedelta(hours=off)).astimezone(dt.timezone.utc))
                plan.setdefault(snap, {"events": {}})["events"][e["id"]] = e

    snaps = sorted(plan)
    n_games = len({eid for s in plan.values() for eid in s["events"]})
    est = len(snaps) * 30 + (0 if args.no_props else sum(len(plan[s]["events"]) for s in snaps) * 10 * len(args.markets.split(",")))
    print(f"PLAN: {len(snaps)} snapshot timestamp(s), {n_games} game(s), "
          f"~{est:,} credits estimated (discovery already used {_used[0]}).")
    if max_snaps:
        print(f"  processing at most {max_snaps} snapshot(s) this run.")

    total_lines, total_props, done = 0, 0, 0
    for snap in snaps:
        if max_snaps and done >= max_snaps:
            print(f"\nstopping at --max-snaps ({max_snaps})."); break
        if _used[0] >= args.max_credits:
            print(f"\nstopping: credit budget {args.max_credits} reached ({_used[0]} used)."); break
        done += 1

        # game lines — one call captures every game priced at this timestamp
        st, resp = hist_get("/odds", {"apiKey": key, "regions": args.regions,
                                      "markets": "h2h,spreads,totals", "oddsFormat": "american", "date": snap})
        if st != 200 or not resp:
            continue
        snap_at = resp.get("timestamp", snap)
        rows, _unres = oc.parse_snapshot(resp.get("data", []), snap_at, "BACKFILL", week_map)
        total_lines += len(rows)

        # props — only for the target events (those kicking off soon after this snapshot)
        prop_rows = []
        if not args.no_props:
            snap_dt = parse_iso(snap_at)
            for eid, e in plan[snap]["events"].items():
                if _used[0] >= args.max_credits:
                    break
                hrs = (parse_iso(e["commence_time"]) - snap_dt).total_seconds() / 3600.0
                if hrs < -0.5 or hrs > args.prop_window_hours:
                    continue                    # already kicked off, or too far out
                pst, presp = hist_get(f"/events/{eid}/odds",
                                      {"apiKey": key, "regions": args.regions,
                                       "markets": args.markets, "oddsFormat": "american", "date": snap})
                if pst != 200 or not presp or not presp.get("data"):
                    continue
                pr, _skip = pc.parse_event_props(presp["data"], presp.get("timestamp", snap_at), "BACKFILL", week_map)
                prop_rows += pr
        total_props += len(prop_rows)

        if args.write:
            if rows:
                oc.write_supabase(rows, env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
            if prop_rows:
                pc.write_props(prop_rows, env)
        print(f"  {snap_at}  lines={len(rows):4d}  props={len(prop_rows):4d}  "
              f"credits_used={_used[0]:,}" + ("" if args.write else "  [dry-run]"))

    action = "wrote" if args.write else "parsed (dry-run, not written)"
    print(f"\n{action}: {total_lines} line row(s) + {total_props} prop row(s) across {done} snapshot(s). "
          f"Credits used this run: {_used[0]:,}.")
    if not args.write:
        print("Add --write to persist. Re-runs are idempotent (upsert on the dedupe index).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
