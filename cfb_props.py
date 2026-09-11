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

    python cfb_props.py --within-days 8            # poll games kicking off within 8 days (SQLite)
    python cfb_props.py --within-days 8 --dry-run
    python cfb_props.py --supabase --within-days 8 # write to Supabase (scheduled/CI use)

Storage: local SQLite (data/cfb.db) by default; pass --supabase to append to the
Supabase table cfb_prop_snapshots instead (durable across ephemeral CI runners, the
way the NFL prop capture works -- a SQLite file on a GitHub runner is discarded when
the job ends, so scheduled capture MUST write somewhere durable).

Cost (Odds API): markets x regions per event that HAS props (events with none cost 0).
Auth: ODDS_API_KEY (+ SUPABASE_URL / SUPABASE_SERVICE_KEY for --supabase) in .env.
Stdlib + odds_client (env + TLS).
"""
import argparse
import datetime as _dt
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

import odds_client as oc


class TransientError(Exception):
    """A network blip / upstream 5xx that should make the run skip cleanly (exit 0)
    rather than fail. Genuine problems (bad key -> 401, quota -> 429, Supabase 4xx
    schema/permission) are NOT transient and still surface as a non-zero exit."""

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


def _get(url, tries=3):
    """GET with transient-retry -> (status, remaining, last, data). A 5xx or network
    error is retried with backoff; a persistent network failure surfaces as status 0.
    On any non-200 the data is None so callers skip that event/run cleanly."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return (r.getcode(), r.headers.get("x-requests-remaining"),
                        r.headers.get("x-requests-last"), json.loads(r.read()))
        except urllib.error.HTTPError as e:
            if 500 <= e.code < 600 and attempt < tries - 1:
                time.sleep(2 * (attempt + 1)); continue
            return (e.code, None, None, None)
        except urllib.error.URLError:   # timeout / DNS / reset
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1)); continue
            return (0, None, None, None)
    return (0, None, None, None)


def list_events(key):
    status, _, _, ev = _get(f"{BASE}/events?apiKey={key}")
    if status == 200:
        return ev
    if status == 0 or 500 <= status <= 599:   # transient -> skip the run, don't fail
        raise TransientError(f"events list HTTP {status}")
    raise RuntimeError(f"events HTTP {status}")  # 401 (bad key) / 429 (quota) = genuine


def event_props(key, eid, markets, regions):
    url = (f"{BASE}/events/{eid}/odds?apiKey={key}&regions={regions}"
           f"&markets={markets}&oddsFormat=american")
    return _get(url)


# Column order shared by the SQLite tuple insert and the Supabase dict rows.
COLS = ["snapshot_at", "event_id", "commence", "home_team", "away_team",
        "book", "market", "player", "side", "line", "price"]


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


def write_supabase(rows, env, batch=500):
    """Append the captured tuples to the Supabase cfb_prop_snapshots table (durable,
    unlike a SQLite file on an ephemeral CI runner). Idempotent upsert on the same key
    as the SQLite PK. Transient 5xx/network errors raise TransientError (skip the run);
    a 4xx (schema/permission) raises so a genuine problem still surfaces."""
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (needed for --supabase)")
    endpoint = (url.rstrip("/") + "/rest/v1/cfb_prop_snapshots"
                "?on_conflict=snapshot_at,event_id,book,market,player,side")
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "return=minimal,resolution=ignore-duplicates"}
    dict_rows = [dict(zip(COLS, r)) for r in rows]
    written = 0
    for i in range(0, len(dict_rows), batch):
        chunk = dict_rows[i:i + batch]
        req = urllib.request.Request(endpoint, data=json.dumps(chunk).encode("utf-8"),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            print(f"  ! cfb props batch {i // batch}: HTTP {e.code} {detail}", file=sys.stderr)
            if e.code < 500:
                raise   # 4xx = genuine schema/permission problem
            raise TransientError(f"Supabase write HTTP {e.code} (transient)")
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase write network error ({e.reason})")
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--within-days", type=int, default=8,
                    help="only poll games kicking off within this many days")
    ap.add_argument("--max-events", type=int, default=40, help="safety cap on events polled")
    ap.add_argument("--markets", default=DEFAULT_MARKETS)
    ap.add_argument("--regions", default="us,us2")
    ap.add_argument("--dry-run", action="store_true", help="fetch + report, but do not write")
    ap.add_argument("--supabase", action="store_true",
                    help="write to the Supabase cfb_prop_snapshots table instead of SQLite "
                         "(use this for scheduled/CI runs -- a runner's SQLite file is ephemeral)")
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
    env = oc.load_env()
    key = env.get("ODDS_API_KEY")
    if not key:
        print("ERROR: ODDS_API_KEY missing in .env", file=sys.stderr)
        return 1

    now = _dt.datetime.now(_dt.timezone.utc)
    snapshot_at = now.replace(microsecond=0).isoformat()
    horizon = now + _dt.timedelta(days=args.within_days)

    try:
        events = list_events(key)
    except TransientError as e:
        print(f"transient: {e}; skipping this run (no failure)", file=sys.stderr)
        return 0
    upcoming = []
    for e in events:
        try:
            ct = _dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
        except Exception:
            continue
        if now <= ct <= horizon:
            upcoming.append(e)
    # SORT before truncating. This list arrives in whatever order the API returns it, so slicing it
    # raw meant the cap could drop TODAY's games while polling next weekend's — which is how the
    # player board ended up with 5 of the 8 games being played today. Soonest kickoff first, so the
    # cap always spends itself on the most imminent slate.
    upcoming.sort(key=lambda e: e.get("commence_time") or "9999")
    upcoming = upcoming[:args.max_events]
    emit(f"[{snapshot_at}] {len(events)} NCAAF events posted; {len(upcoming)} kick off "
         f"within {args.within_days} days (polling those).")

    # Collect every event's rows first, then write once to the chosen sink. One flaky
    # event (transient HTTP/network) is skipped, not fatal -- the rest still capture.
    all_rows, with_props, remaining = [], 0, None
    for e in upcoming:
        status, remaining, cost, data = event_props(key, e["id"], args.markets, args.regions)
        if status != 200 or not data:
            continue   # transient/blank for this event -- skip, keep going
        rows = rows_from(data, snapshot_at)
        if rows:
            with_props += 1
            all_rows.extend(rows)

    total_rows = len(all_rows)
    stored = "(dry-run, not written)" if args.dry_run else "(none to store)"
    if not args.dry_run and all_rows:
        if args.supabase:
            try:
                n = write_supabase(all_rows, env)
                stored = f"stored to Supabase ({n})"
            except TransientError as e:
                print(f"transient: {e}; skipping write this run (no failure)", file=sys.stderr)
                return 0
        else:
            os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
            conn = sqlite3.connect(args.db)
            conn.executescript(SCHEMA)
            conn.executemany(
                "INSERT OR REPLACE INTO cfb_prop_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?)", all_rows)
            conn.commit()
            conn.close()
            stored = f"stored to {args.db}"

    emit(f"  {with_props}/{len(upcoming)} games had props; {total_rows} prop rows {stored}. "
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
