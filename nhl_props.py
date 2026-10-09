"""
nhl_props.py -- capture NHL PLAYER PROP snapshots from The Odds API.

The markets Derek asked for, and nothing else yet:

    player_goal_scorer_anytime   a PROBABILITY market (Yes/No), like anytime TD
    player_shots_on_goal         Over/Under on a small integer line (1.5, 2.5, 3.5)
    player_points                Over/Under, small integer
    player_assists               Over/Under, small integer

🚨 THIS IS THE ONLY PART OF AN NHL MODULE THAT CANNOT WAIT. Prop history cannot be backfilled:
books post these a day or two before puck drop and the number moves, so a snapshot exists only if
it was taken that day. Every day this is not running is a day of validation data gone for good --
the same lesson the NFL and CFB prop pipelines both learned the hard way, and the reason the CFB
note in memory still says "schedule it, prop history can't be backfilled". The model can be built
later from a season of captures; it cannot be built later from nothing.

Verified against the live feed before this was written (2026-10-09, one Penguins/Blue Jackets
event): 249 goal-scorer outcomes, 172 shots-on-goal, 96 points, 58 assists, across 8 US books
including FanDuel. 4 credits per event that has props (markets x regions); events with none cost 0.

    python nhl_props.py --within-days 2 --dry-run      # see what it would capture
    python nhl_props.py --within-days 2                # local SQLite (data/nhl.db)
    python nhl_props.py --within-days 2 --supabase     # durable, for CI

Storage mirrors cfb_props.py: local SQLite by default, --supabase for scheduled runs, because a
SQLite file on a GitHub runner is discarded when the job ends.

Auth: ODDS_API_KEY (+ SUPABASE_URL / SUPABASE_SERVICE_KEY for --supabase) in .env.
Stdlib + odds_client (env + TLS).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402

SPORT = "icehockey_nhl"
MARKETS = ["player_goal_scorer_anytime", "player_shots_on_goal",
           "player_points", "player_assists"]
REGIONS = "us"
DB = os.path.join(ROOT, "data", "nhl.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS nhl_prop_snapshots (
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
CREATE INDEX IF NOT EXISTS ix_nhlprops_event ON nhl_prop_snapshots(event_id);
CREATE INDEX IF NOT EXISTS ix_nhlprops_commence ON nhl_prop_snapshots(commence);
"""


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()), r.headers.get("x-requests-last"), r.headers.get(
            "x-requests-remaining")


def events(key, within_days):
    """Upcoming NHL events inside the window. Free — the events list costs no credits."""
    data, _, _ = _get(f"https://api.the-odds-api.com/v4/sports/{SPORT}/events?apiKey={key}")
    now = dt.datetime.now(dt.timezone.utc)
    out = []
    for e in data:
        try:
            t = dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            continue
        if now - dt.timedelta(hours=3) <= t <= now + dt.timedelta(days=within_days):
            out.append(e)
    # Sort by puck drop BEFORE any cap is applied. The CFB capture polled an UNSORTED list and
    # truncated it, so which games got polled was arbitrary — tonight's could be dropped while next
    # week's were captured. Ordering first makes a cap mean "the soonest N", which is the only
    # ordering that is defensible.
    out.sort(key=lambda e: e["commence_time"])
    return out


def pull(key, ev, snap):
    """One event's props, flattened to rows. Returns (rows, credits_used)."""
    url = (f"https://api.the-odds-api.com/v4/sports/{SPORT}/events/{ev['id']}/odds"
           f"?apiKey={key}&regions={REGIONS}&markets={','.join(MARKETS)}&oddsFormat=american")
    # 🚨 A TRANSIENT BLIP MUST NOT FAIL THE JOB, AND A REAL OUTAGE MUST. The very first live run
    # of this hit `HTTP 502 Bad Gateway` from the Odds API. Per the workflow-triage rules: upstream
    # 5xx and network errors skip the event and the run carries on (the next sweep picks it up a
    # few hours later), while 401 (bad key) and 429 (quota) still raise, because those are real and
    # must email once rather than be silently retried forever.
    try:
        data, used, remaining = _get(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return [], 0, None    # no props posted for this event yet — normal, and free
        if e.code >= 500:
            print(f"    transient HTTP {e.code} — skipping this event")
            return [], 0, None
        raise                     # 401 / 429 / 4xx: a real problem, let it fail loudly
    except urllib.error.URLError as e:
        print(f"    transient network error ({e.reason}) — skipping this event")
        return [], 0, None
    # 🚨 `snap` IS PASSED IN, NOT TAKEN HERE. Generating it per event gave every game in one sweep
    # a different snapshot_at — the first live capture produced four timestamps 20:01:42 to :45 for
    # a single run. Any "newest sweep" read (max(snapshot_at), then rows AT that value, which is
    # how board.ts and every grader work) would then return ONE game instead of the slate. This is
    # the lost-season bug mlb_snapshots.sql documents on the NFL prop table, and the reason the
    # rule is one clock time per sweep, never derived from event data.
    rows = []
    for b in data.get("bookmakers", []):
        for m in b.get("markets", []):
            if m.get("key") not in MARKETS:
                continue
            for o in m.get("outcomes", []):
                # Goal-scorer is Yes/No with the player in `description`; the O/U markets put the
                # player there too and the side in `name`. Same shape, so one branch handles both.
                rows.append((snap, ev["id"], ev.get("commence_time"),
                             ev.get("home_team"), ev.get("away_team"),
                             b.get("key"), m.get("key"),
                             o.get("description"), o.get("name"),
                             o.get("point"), o.get("price")))
    return rows, int(used or 0), remaining


def write_sqlite(rows):
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)
    conn.executemany(
        "INSERT OR IGNORE INTO nhl_prop_snapshots "
        "(snapshot_at,event_id,commence,home_team,away_team,book,market,player,side,line,price) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    n = conn.total_changes
    conn.close()
    return n


def write_supabase(rows):
    env = oc.load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise SystemExit("--supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY in .env")
    payload = [dict(zip(("snapshot_at", "event_id", "commence", "home_team", "away_team",
                         "book", "market", "player", "side", "line", "price"), r)) for r in rows]
    endpoint = url.rstrip("/") + "/rest/v1/nhl_prop_snapshots"
    sent = 0
    for i in range(0, len(payload), 500):     # chunked: one oversized POST is a 413
        chunk = payload[i:i + 500]
        req = urllib.request.Request(
            endpoint, data=json.dumps(chunk).encode("utf-8"),
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "Prefer": "return=minimal,resolution=ignore-duplicates"},
            method="POST")
        with urllib.request.urlopen(req, timeout=90) as r:
            if r.getcode() not in (200, 201, 204):
                raise SystemExit(f"Supabase write failed: {r.getcode()}")
        sent += len(chunk)
    return sent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--within-days", type=float, default=2.0,
                    help="poll events with puck drop inside this window (default 2)")
    ap.add_argument("--max-events", type=int, default=20)
    ap.add_argument("--supabase", action="store_true", help="append to Supabase instead of SQLite")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        raise SystemExit("ODDS_API_KEY missing from .env")

    evs = events(key, args.within_days)[:args.max_events]
    print(f"{len(evs)} NHL event(s) with puck drop inside {args.within_days} day(s)")
    if not evs:
        print("nothing to capture (no games in the window) — not an error")
        return 0

    # ONE clock time for the whole sweep, taken before any call and reused for every row.
    snap = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    rows, credits, remaining = [], 0, None
    priced = 0
    for e in evs:
        r, used, rem = pull(key, e, snap)
        credits += used
        remaining = rem or remaining
        if r:
            priced += 1
        rows += r
        print(f"  {e['away_team']} @ {e['home_team']}  {e['commence_time']}  rows={len(r):5}")

    by_market = {}
    for r in rows:
        by_market[r[6]] = by_market.get(r[6], 0) + 1
    print(f"\n{len(rows)} rows from {priced}/{len(evs)} events that had props; "
          f"{credits} credits used, {remaining} remaining")
    for m in MARKETS:
        print(f"  {m:30} {by_market.get(m, 0)}")

    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        return 0
    if not rows:
        print("no rows to write")
        return 0
    n = write_supabase(rows) if args.supabase else write_sqlite(rows)
    print(f"\nwrote {n} rows to {'Supabase nhl_prop_snapshots' if args.supabase else DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
