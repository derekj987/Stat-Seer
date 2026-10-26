"""
nba_props.py -- capture NBA PLAYER PROP snapshots from The Odds API.

🚨 THIS IS THE ONLY PART OF AN NBA MODULE THAT CANNOT WAIT. Prop history cannot be backfilled:
books post these the morning of the game and the number moves until tip-off, so a snapshot exists
only if it was taken that day. Every day this is not running is a day of validation data gone for
good -- the lesson the NFL, CFB and NHL prop pipelines each learned separately, and the reason the
CFB note in memory still reads "schedule it, prop history can't be backfilled". The model can be
built later from a season of captures; it cannot be built later from nothing.

The 2026-27 NBA season was already a week old when this was written (first captures 2026-10-26), so
this is the piece that loses value while anything else is discussed.

MARKETS -- Derek's list, verified against the live feed before this was written. One event
(Wizards @ Hornets, 2026-10-26) returned, across 9 US books including FanDuel:

    player_points                    346 outcomes   VOLUME x RATE. The headline market.
    player_rebounds                  214
    player_assists                   154
    player_threes                    140
    player_blocks                     16            THIN -- see below
    player_steals                     12            THIN -- see below
    player_points_rebounds_assists   200            the combined market
    player_double_double              57            a PROBABILITY market (Yes/No), null line
    player_first_basket               50            a PROBABILITY market (Yes/No), null line

🚨 STEALS AND BLOCKS ARE THIN, AND THAT IS A PROPERTY OF THE MARKET, NOT A CAPTURE BUG. Twelve
outcomes against points' 346 means a book prices one or two players a night, not a slate. Derek
named steals explicitly so it is captured, but nothing downstream should treat an empty steals panel
as a defect, and a backtest on it will be sample-starved for a long time. Each costs 1 credit per
event per sweep, which is cheap enough that capturing now and deciding later is the right trade --
again because the history is not recoverable.

🚨 ALTERNATE LADDERS ARE DELIBERATELY NOT CAPTURED YET. `player_points_alternate` alone returned
1,305 outcomes on that single event and `player_rebounds_alternate` 843, against ~880 rows for all
nine markets above combined. Adding the two would roughly quadruple the table for a panel that does
not exist yet. They are the FIRST thing to add when alternate-line fair value is built, because that
panel is pure de-vig arithmetic and the ladders are what it reads -- but capturing them before then
buys storage, not information.

    python nba_props.py --within-days 2 --dry-run      # see what it would capture
    python nba_props.py --within-days 2                # local SQLite (data/nba.db)
    python nba_props.py --within-days 2 --supabase     # durable, for CI

Storage mirrors nhl_props.py / cfb_props.py: local SQLite by default, --supabase for scheduled
runs, because a SQLite file on a GitHub runner is discarded when the job ends.

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

SPORT = "basketball_nba"
MARKETS = ["player_points", "player_rebounds", "player_assists", "player_threes",
           "player_steals", "player_blocks", "player_points_rebounds_assists",
           "player_double_double", "player_first_basket"]
REGIONS = "us"
DB = os.path.join(ROOT, "data", "nba.db")

# What makes two captured rows THE SAME OFFER, and therefore the only thing either store may
# collapse. It must match the unique index in ingest/nba_prop_snapshots.sql exactly -- PostgREST
# resolves ?on_conflict= against that index and rejects any list it cannot find.
#
# `player` is a name, and a name is not an identity. The NHL table learned this the expensive way:
# Vancouver rosters two Elias Petterssons, the feed sends no id, and under a key without line and
# price their two anytime-scorer offers collapsed to one index entry and killed four consecutive
# sweeps. The NBA has the same exposure (two Jaylen/Jalen spellings, juniors, and in-season
# ten-day signings), so this starts with the wide key rather than earning it back later.
CONFLICT = "snapshot_at,event_id,book,market,player,side,line,price"

SCHEMA = """
CREATE TABLE IF NOT EXISTS nba_prop_snapshots (
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
  -- Same key as CONFLICT / the Supabase index. On this path the narrow version is arguably worse,
  -- because INSERT OR IGNORE drops the colliding row SILENTLY instead of raising, so one of two
  -- same-named players would simply vanish with no error anywhere.
  PRIMARY KEY (snapshot_at, event_id, book, market, player, side, line, price)
);
CREATE INDEX IF NOT EXISTS ix_nbaprops_event ON nba_prop_snapshots(event_id);
CREATE INDEX IF NOT EXISTS ix_nbaprops_commence ON nba_prop_snapshots(commence);
"""


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()), r.headers.get("x-requests-last"), r.headers.get(
            "x-requests-remaining")


def events(key, within_days):
    """Upcoming NBA events inside the window. Free — the events list costs no credits."""
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
    # Sort by tip-off BEFORE any cap is applied. The CFB capture polled an UNSORTED list and
    # truncated it, so which games got polled was arbitrary — tonight's could be dropped while next
    # week's were captured. Ordering first makes a cap mean "the soonest N", which is the only
    # ordering that is defensible. It matters more here than anywhere: the NBA runs 10-14 games a
    # night against the NHL's ~8, so --max-events is reached on an ordinary Tuesday, not an outlier.
    out.sort(key=lambda e: e["commence_time"])
    return out


def pull(key, ev, snap):
    """One event's props, flattened to rows. Returns (rows, credits_used, remaining)."""
    url = (f"https://api.the-odds-api.com/v4/sports/{SPORT}/events/{ev['id']}/odds"
           f"?apiKey={key}&regions={REGIONS}&markets={','.join(MARKETS)}&oddsFormat=american")
    # 🚨 A TRANSIENT BLIP MUST NOT FAIL THE JOB, AND A REAL OUTAGE MUST. Per the workflow-triage
    # rules: upstream 5xx and network errors skip the event and the run carries on (the next sweep
    # picks it up a few hours later), while 401 (bad key) and 429 (quota) still raise, because those
    # are real and must email once rather than be silently retried forever.
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
    # 🚨 `snap` IS PASSED IN, NOT TAKEN HERE. Generating it per event gives every game in one sweep
    # a different snapshot_at, and any "newest sweep" read (max(snapshot_at), then rows AT that
    # value, which is how board.ts and every grader work) would then return ONE game instead of the
    # slate. This is the lost-season bug mlb_snapshots.sql documents on the NFL prop table, and the
    # reason the rule is one clock time per sweep, never derived from event data.
    rows = []
    for b in data.get("bookmakers", []):
        for m in b.get("markets", []):
            if m.get("key") not in MARKETS:
                continue
            for o in m.get("outcomes", []):
                # The O/U markets put the player in `description` and the side in `name`; the
                # Yes/No markets (double-double, first basket) use the same shape with a null
                # point, so one branch handles both.
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
        "INSERT OR IGNORE INTO nba_prop_snapshots "
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
    # 🚨 resolution=ignore-duplicates IS A NO-OP WITHOUT ?on_conflict=. nhl_props.py sent the
    # Prefer header for weeks while omitting the query parameter, so PostgREST had no arbiter to
    # apply it to and a unique violation came back as a bare 409 that killed the whole sweep.
    endpoint = f"{url.rstrip('/')}/rest/v1/nba_prop_snapshots?on_conflict={CONFLICT}"
    # Collapse exact repeats in-process first. A sweep can list the same offer twice (two books'
    # feeds echoing one line), and dropping it here is free, shrinks the POST, and means the
    # on_conflict path is only needed for genuine overlap with what is already stored.
    seen, deduped = set(), []
    for p in payload:
        sig = tuple(p[c] for c in CONFLICT.split(","))
        if sig in seen:
            continue
        seen.add(sig)
        deduped.append(p)
    if len(deduped) < len(payload):
        print(f"  {len(payload) - len(deduped)} exact-duplicate offer(s) collapsed before sending")
    sent = 0
    for i in range(0, len(deduped), 500):     # chunked: one oversized POST is a 413
        chunk = deduped[i:i + 500]
        body = json.dumps(chunk).encode("utf-8")

        def post(target):
            req = urllib.request.Request(
                target, data=body,
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json",
                         "Prefer": "return=minimal,resolution=ignore-duplicates"},
                method="POST")
            with urllib.request.urlopen(req, timeout=90) as r:
                if r.getcode() not in (200, 201, 204):
                    raise SystemExit(f"Supabase write failed: {r.getcode()}")

        try:
            post(endpoint)
        except urllib.error.HTTPError as e:
            # The on_conflict list must match a real unique index, and DDL is run by hand -- so if
            # this lands before ingest/nba_prop_snapshots.sql does, PostgREST answers 400/42P10
            # ("no unique or exclusion constraint matching the ON CONFLICT specification"), or
            # PGRST205 if the table itself is absent. Say exactly what to run; do NOT fall back to
            # the bare endpoint on a missing table, because there is nothing to write to.
            detail = (e.read() or b"").decode("utf-8", "replace")[:300] if e.code == 400 else ""
            if e.code == 400 and ("42P10" in detail or "ON CONFLICT" in detail):
                print("  WARNING: the dedupe index is not in place yet — run "
                      "ingest/nba_prop_snapshots.sql in the Supabase SQL editor.\n"
                      "  Posting without on_conflict; a repeated player NAME will still 409.",
                      file=sys.stderr)
                post(f"{url.rstrip('/')}/rest/v1/nba_prop_snapshots")
            else:
                raise
        sent += len(chunk)
    return sent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--within-days", type=float, default=2.0,
                    help="poll events tipping off inside this window (default 2)")
    # 24, not the NHL's 20: a full NBA night is 10-14 games and a two-day window spans two nights,
    # so a cap of 20 would silently drop the back of tomorrow's slate. See the sort note in
    # events() -- the cap means "the soonest N", so what it drops is always the furthest out.
    ap.add_argument("--max-events", type=int, default=24)
    ap.add_argument("--supabase", action="store_true", help="append to Supabase instead of SQLite")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        raise SystemExit("ODDS_API_KEY missing from .env")

    all_evs = events(key, args.within_days)
    evs = all_evs[:args.max_events]
    print(f"{len(all_evs)} NBA event(s) tipping off inside {args.within_days} day(s)"
          + (f" — capturing the soonest {len(evs)}" if len(evs) < len(all_evs) else ""))
    if len(evs) < len(all_evs):
        # Not silent: a dropped game is a game with no prop history, and that is unrecoverable.
        print(f"  NOTE: {len(all_evs) - len(evs)} event(s) beyond --max-events were NOT captured; "
              f"raise it or shorten --within-days")
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
        print(f"  {m:32} {by_market.get(m, 0)}")

    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        return 0
    if not rows:
        print("no rows to write")
        return 0
    n = write_supabase(rows) if args.supabase else write_sqlite(rows)
    print(f"\nwrote {n} rows to {'Supabase nba_prop_snapshots' if args.supabase else DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
