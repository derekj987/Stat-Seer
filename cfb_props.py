"""
cfb_props.py -- capture College Football PLAYER PROP snapshots from The Odds API into
data/cfb.db. This is the CFB pivot: game lines are efficiently priced (see cfb_ats.py),
but props are priced across hundreds of semi-independent markets, so any real edge is
likelier there -- the same reasoning as the NFL prop work.

Prop history CANNOT be backfilled: books post props a few days before kickoff and the
number moves, so a snapshot exists only if captured that day. This script is meant to
run on a schedule from now through the season; each run appends a timestamped snapshot.
Until enough history accrues (or timestamped odds history is purchased), prop EDGE
validation is blocked -- exactly the blocker the NFL prop pipeline hit.

    python cfb_props.py --within-days 8            # poll games kicking off within 8 days
    python cfb_props.py --within-days 8 --max-events 20 --dry-run

Cost (Odds API): markets x regions per event that HAS props (events with none cost 0).
Auth: ODDS_API_KEY in .env. Stdlib + odds_client (env + TLS).
"""
import argparse
import datetime as _dt
import json
import os
import sqlite3
import sys
import urllib.request

import odds_client as oc

SPORT = "americanfootball_ncaaf"
BASE = f"https://api.the-odds-api.com/v4/sports/{SPORT}"
# Volume + yardage + scoring props -- the same families that mattered for NFL.
DEFAULT_MARKETS = ",".join([
    "player_pass_yds", "player_pass_tds", "player_pass_attempts", "player_pass_completions",
    "player_rush_yds", "player_rush_attempts",
    "player_reception_yds", "player_receptions",
    "player_anytime_td",
])

SCHEMA = """
CREATE TABLE IF NOT EXISTS cfb_prop_snapshots (
  snapshot_at TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  commence    TEXT,
  home_team   TEXT,
  away_team   TEXT,
  book        TEXT NOT NULL,
  market      TEXT NOT NULL,
  player      TEXT,
  side        TEXT,
  line        REAL,
  price       INTEGER,
  PRIMARY KEY (snapshot_at, event_id, book, market, player, side)
);
CREATE INDEX IF NOT EXISTS ix_cfbprops_event ON cfb_prop_snapshots(event_id);
"""


def _get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return (r.getcode(), r.headers.get("x-requests-remaining"),
                r.headers.get("x-requests-last"), json.loads(r.read()))


def list_events(key):
    _, _, _, ev = _get(f"{BASE}/events?apiKey={key}")
    return ev


def event_props(key, eid, markets, regions):
    url = (f"{BASE}/events/{eid}/odds?apiKey={key}&regions={regions}"
           f"&markets={markets}&oddsFormat=american")
    return _get(url)


def rows_from(ev, snapshot_at):
    out = []
    for bk in ev.get("bookmakers", []):
        book = bk.get("key")
        for m in bk.get("markets", []):
            mk = m.get("key")
            for o in m.get("outcomes", []):
                out.append((
                    snapshot_at, ev.get("id"), ev.get("commence_time"),
                    ev.get("home_team"), ev.get("away_team"),
                    book, mk, o.get("description"), o.get("name"),
                    o.get("point"), o.get("price"),
                ))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--within-days", type=int, default=8,
                    help="only poll games kicking off within this many days")
    ap.add_argument("--max-events", type=int, default=40, help="safety cap on events polled")
    ap.add_argument("--markets", default=DEFAULT_MARKETS)
    ap.add_argument("--regions", default="us")
    ap.add_argument("--dry-run", action="store_true", help="fetch + report, but do not write")
    ap.add_argument("--log", default=None,
                    help="append the run summary here (default: <db dir>/cfb_props.log)")
    args = ap.parse_args(argv)

    # Self-log so a scheduled run records what it did without relying on shell
    # stdout redirection (Task Scheduler doesn't reliably capture it).
    log_path = args.log or os.path.join(os.path.dirname(os.path.abspath(args.db)), "cfb_props.log")
    log_lines = []

    def emit(msg):
        print(msg)
        log_lines.append(msg)

    oc.ensure_ssl_certs()
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        print("ERROR: ODDS_API_KEY missing in .env", file=sys.stderr)
        return 1

    now = _dt.datetime.now(_dt.timezone.utc)
    snapshot_at = now.replace(microsecond=0).isoformat()
    horizon = now + _dt.timedelta(days=args.within_days)

    events = list_events(key)
    upcoming = []
    for e in events:
        try:
            ct = _dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
        except Exception:
            continue
        if now <= ct <= horizon:
            upcoming.append(e)
    upcoming = upcoming[:args.max_events]
    emit(f"[{snapshot_at}] {len(events)} NCAAF events posted; {len(upcoming)} kick off "
         f"within {args.within_days} days (polling those).")

    conn = None
    if not args.dry_run:
        os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
        conn = sqlite3.connect(args.db)
        conn.executescript(SCHEMA)

    total_rows, with_props, remaining = 0, 0, None
    for e in upcoming:
        _, remaining, cost, data = event_props(key, e["id"], args.markets, args.regions)
        rows = rows_from(data, snapshot_at)
        if rows:
            with_props += 1
            total_rows += len(rows)
            if conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO cfb_prop_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    if conn:
        conn.commit()
        conn.close()

    emit(f"  {with_props}/{len(upcoming)} games had props; {total_rows} prop rows "
         f"{'(dry-run, not written)' if args.dry_run else 'stored'}. "
         f"credits remaining: {remaining}")
    if with_props == 0:
        emit("  No props posted yet (normal >3-4 days out). Schedule this daily as the "
             "openers approach -- prop history only exists if captured on the day.")

    try:
        os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("\n".join(log_lines) + "\n")
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
