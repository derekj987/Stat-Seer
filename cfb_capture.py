"""
cfb_capture.py -- NCAAF game lines (moneyline, spread, total), every US book, to Supabase.

    python cfb_capture.py                 # dry run: fetch, parse, report, write nothing
    python cfb_capture.py --supabase      # append to cfb_odds_snapshots

WHY THIS EXISTS. The college boards read their market spread and total from the exported card,
which cfb_export.py rebuilds four times a day from a MEDIAN across every book the feed returns.
Derek, reading the board beside FanDuel: "the market spread and market over/unders do not match
the current lines on FanDuel. How come this is not auto updating as the lines change?" A median is
nobody's number, and a four-times-a-day export is up to six hours stale on a line that moves all
week. This script is the NCAAF half of what mlb_capture.py does for baseball: one sweep, one clock
time, every book, appended to a table the pages read at render.

COST. One call: regions x markets = 2 x 3 = 6 credits, whatever the slate size. Every 30 minutes
through the season is ~8,600 credits a month against a five-million-credit plan.

SNAPSHOT TIME. One clock timestamp per sweep, never derived from event data -- see the NFL prop
table's lost-season bug, explained on mlb_odds_snapshots in ingest/mlb_snapshots.sql.

Stdlib only. Shares load_env / ensure_ssl_certs with odds_client.
"""
import argparse
import datetime as _dt
import json
import sys
import urllib.error
import urllib.request

import odds_client as oc

SPORT = "americanfootball_ncaaf"
BASE = f"https://api.the-odds-api.com/v4/sports/{SPORT}"
GAME_MARKETS = "h2h,spreads,totals"
TABLE = "cfb_odds_snapshots"
CONFLICT = "snapshot_at,event_id,book,market,outcome_name,outcome_point"


class TransientError(Exception):
    """A network/5xx blip: skip this run, do not fail the workflow."""


def _get(url, tries=3):
    import time
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                h = r.headers
                return (r.getcode(), json.loads(r.read()),
                        h.get("x-requests-last"), h.get("x-requests-remaining"))
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == tries - 1:
                print(f"  ! HTTP {e.code} {url.split('?')[0]}", file=sys.stderr)
                return e.code, None, None, None
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError as e:
            if attempt == tries - 1:
                raise TransientError(f"network error ({e.reason})")
            time.sleep(2 * (attempt + 1))


def within_window(commence, days):
    """Kickoff between now and `days` from now. Games under way are not shoppable, and the feed
    lists a whole season of futures-priced games that would only bloat the table."""
    try:
        kick = _dt.datetime.fromisoformat(commence.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return False
    now = _dt.datetime.now(_dt.timezone.utc)
    return now <= kick <= now + _dt.timedelta(days=days)


def game_rows(events, snapshot_at, reason):
    out = []
    for ev in events:
        for bk in ev.get("bookmakers", []):
            for m in bk.get("markets", []):
                for o in m.get("outcomes", []):
                    out.append({
                        "snapshot_at": snapshot_at, "capture_reason": reason,
                        "event_id": ev.get("id"), "commence_time": ev.get("commence_time"),
                        "home_team": ev.get("home_team"), "away_team": ev.get("away_team"),
                        "book": bk.get("key"), "market": m.get("key"),
                        "outcome_name": o.get("name"), "outcome_point": o.get("point"),
                        "price_american": o.get("price"),
                    })
    return out


def write(rows, env, batch=500):
    """Idempotent append. 4xx (schema/permission) raises so a real problem surfaces; 5xx/network
    raises TransientError so a blip skips the run instead of failing the workflow."""
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    endpoint = f"{url.rstrip('/')}/rest/v1/{TABLE}?on_conflict={CONFLICT}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "return=minimal,resolution=ignore-duplicates"}
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        req = urllib.request.Request(endpoint, data=json.dumps(chunk).encode("utf-8"),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            print(f"  ! {TABLE} batch {i // batch}: HTTP {e.code} {detail}", file=sys.stderr)
            if e.code < 500:
                raise
            raise TransientError(f"Supabase write HTTP {e.code}")
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase write network error ({e.reason})")
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--within-days", type=int, default=8,
                    help="only keep games kicking off within this many days (a college week)")
    ap.add_argument("--regions", default="us,us2")
    ap.add_argument("--reason", default="SCHEDULED",
                    choices=["SCHEDULED", "PRE_KICKOFF", "BACKFILL", "MANUAL"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--supabase", action="store_true", help="write to Supabase")
    args = ap.parse_args(argv)

    env = oc.load_env()
    key = env.get("ODDS_API_KEY")
    if not key:
        print("ERROR: ODDS_API_KEY missing", file=sys.stderr); return 1
    oc.ensure_ssl_certs()

    snapshot_at = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()
    st, data, used, remaining = _get(
        f"{BASE}/odds?apiKey={key}&regions={args.regions}&markets={GAME_MARKETS}&oddsFormat=american")
    if st != 200 or data is None:
        print(f"could not fetch odds (HTTP {st}); skipping run", file=sys.stderr)
        return 0
    slate = [e for e in data if within_window(e.get("commence_time", ""), args.within_days)]
    rows = game_rows(slate, snapshot_at, args.reason)
    books = sorted({r["book"] for r in rows})
    print(f"NCAAF {len(data)} events posted, {len(slate)} within {args.within_days}d  snapshot_at={snapshot_at}")
    print(f"  game lines : {len(rows)} rows · {len(books)} books")
    print(f"  books      : {books}")
    print(f"  credits    : {used} this run, {remaining} remaining")

    if slate and not rows:
        print("WARNING: parsed ZERO rows from a non-empty slate — market keys may have changed",
              file=sys.stderr)
        return 1
    if not slate:
        print("no games in window — nothing to capture (not an error)")
        return 0
    now = _dt.datetime.now(_dt.timezone.utc)
    if _dt.datetime.fromisoformat(snapshot_at) > now + _dt.timedelta(minutes=5):
        print(f"ERROR: snapshot_at {snapshot_at} is in the future — refusing to write", file=sys.stderr)
        return 1
    if args.dry_run or not args.supabase:
        print("\nDRY RUN — nothing written. Add --supabase to append.")
        return 0
    try:
        n = write(rows, env)
    except TransientError as e:
        print(f"transient: {e} — skipping this run", file=sys.stderr)
        return 0
    print(f"wrote {n} game-line rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
