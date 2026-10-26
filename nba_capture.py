"""
nba_capture.py -- NBA game lines (moneyline, spread, total), every US book, to Supabase.

    python nba_capture.py                 # dry run: fetch, parse, report, write nothing
    python nba_capture.py --supabase      # append to nba_odds_snapshots
    python nba_capture.py --supabase --reason PRE_KICKOFF --within-days 0.25

Mirrors nhl_capture.py / cfb_capture.py line for line, deliberately: same sweep shape, same
one-clock-time rule, same transient/real error split. If you change the error handling or the write
path here, change it there too -- these have not been merged into one module because they are stable
and a refactor of a live capture is a worse risk than the duplication.

🚨 THE NBA SPREAD *IS* A SPREAD -- AND THAT IS THE TRAP, NOT THE REASSURANCE. The puck line and the
run line are ±1.5 on every game, so both tables carry a warning not to read them as a margin
estimate. Basketball is the opposite: the spread is a genuine estimate of the margin, which makes it
tempting to port football's key-number machinery onto it. DO NOT.

    NFL margins land on exactly 3 in 15.0% of games and 7 in 9.1%, so a half point at 3 is worth
    ~9% of win probability -- larger than any model edge realistically claimable. BASKETBALL HAS NO
    SUCH NUMBERS. Margins are near-continuous and the most common one carries a few percent, so
    "key numbers", Sweet Spots, and the half-point-at-3 arithmetic have no basketball analogue.

What survives from football is line shopping and de-vigged fair price, both of which are pure
arithmetic and work on any sport. What does not survive is every panel built on a margin histogram.

TOTALS are ~220-240 -- a large number with a large spread, so the law-of-large-numbers regime, NOT
the small-integer receptions/puck-total regime (EMPIRICAL_REFERENCE §13i) that NHL and MLB sit in.
A Gaussian is defensible on an NBA total in a way it never is on a 5.5-goal line.

COST. One call: regions x markets = 2 x 3 = 6 credits, whatever the slate size -- the bulk odds
endpoint is priced per CALL, never per game. Every 3 hours through the season is a rounding error
against the plan (measured 2026-10-26: 4.81M of 5M credits remaining).

SNAPSHOT TIME. One clock timestamp per sweep, never derived from event data -- see the NFL prop
table's lost-season bug, explained on mlb_odds_snapshots in ingest/mlb_snapshots.sql.

Stdlib only. Shares load_env / ensure_ssl_certs with odds_client.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402

SPORT = "basketball_nba"
BASE = f"https://api.the-odds-api.com/v4/sports/{SPORT}"
GAME_MARKETS = "h2h,spreads,totals"
TABLE = "nba_odds_snapshots"
CONFLICT = "snapshot_at,event_id,book,market,outcome_name,outcome_point"


class TransientError(Exception):
    """A network/5xx blip: skip this run, do not fail the workflow."""


def _get(url, tries=3):
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
    """Tip-off between now and `days` from now. Games under way are not shoppable, and the feed
    lists futures-priced games that would only bloat the table."""
    try:
        tip = _dt.datetime.fromisoformat(commence.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return False
    now = _dt.datetime.now(_dt.timezone.utc)
    return now <= tip <= now + _dt.timedelta(days=days)


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
            if e.code >= 500:
                raise TransientError(f"Supabase {e.code}: {detail}") from e
            raise RuntimeError(f"Supabase {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase network error ({e.reason})") from e
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--within-days", type=float, default=2.0,
                    help="only games tipping off inside this window (default 2)")
    ap.add_argument("--regions", default="us,us2")
    ap.add_argument("--reason", default="SCHEDULED",
                    choices=["SCHEDULED", "PRE_KICKOFF", "BACKFILL", "MANUAL"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--supabase", action="store_true", help="write to Supabase")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    key = env.get("ODDS_API_KEY")
    if not key:
        raise SystemExit("ODDS_API_KEY missing from .env")

    # ONE clock time for the whole sweep, taken before the call and reused for every row.
    snapshot_at = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()
    url = (f"{BASE}/odds?apiKey={key}&regions={args.regions}"
           f"&markets={GAME_MARKETS}&oddsFormat=american")
    try:
        code, data, used, remaining = _get(url)
    except TransientError as e:
        print(f"transient: {e} — skipping this sweep")
        return 0
    if code != 200 or data is None:
        if code and code >= 500:
            print(f"transient HTTP {code} — skipping this sweep")
            return 0
        raise SystemExit(f"odds fetch failed: HTTP {code}")

    events = [e for e in data if within_window(e.get("commence_time", ""), args.within_days)]
    rows = game_rows(events, snapshot_at, args.reason)
    books = {r["book"] for r in rows}
    by_market = {}
    for r in rows:
        by_market[r["market"]] = by_market.get(r["market"], 0) + 1

    print(f"sweep {snapshot_at}  reason={args.reason}")
    print(f"  {len(events)} game(s) inside {args.within_days} day(s) of tip-off, "
          f"{len(books)} book(s), {len(rows)} rows")
    for m in ("h2h", "spreads", "totals"):
        print(f"    {m:8} {by_market.get(m, 0)}")
    print(f"  credits: {used} used, {remaining} remaining")

    # A SHAPE CHECK, not a model check. NBA spreads run roughly ±1 to ±20 and totals roughly
    # 190-260; anything outside that is either an alternate line that slipped into the main market
    # or the feed changing shape, and whatever reads this table would be wrong in a way nobody
    # notices. The NHL capture does the same thing with ±1.5. Report, never filter: the row is
    # still a real captured offer and this table is append-only history.
    sp = [abs(r["outcome_point"]) for r in rows
          if r["market"] == "spreads" and r["outcome_point"] is not None]
    tot = [r["outcome_point"] for r in rows
           if r["market"] == "totals" and r["outcome_point"] is not None]
    if sp and max(sp) > 30:
        print(f"  NOTE: spread magnitudes up to {max(sp)} — alternate lines, or the feed changed")
    if tot and (min(tot) < 180 or max(tot) > 270):
        print(f"  NOTE: totals outside 180-270 present ({min(tot)}-{max(tot)}) "
              f"— alternate lines, or the feed changed")

    if args.dry_run or not args.supabase:
        print("\nDRY RUN — nothing written." if args.dry_run else
              "\nno --supabase flag — nothing written.")
        return 0
    if not rows:
        print("nothing to write (no games in the window) — not an error")
        return 0
    try:
        n = write(rows, env)
    except TransientError as e:
        print(f"transient on write: {e} — skipping this sweep")
        return 0
    print(f"\nwrote {n} rows to {TABLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
