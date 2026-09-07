"""
mlb_capture.py -- capture MLB GAME LINES and PLAYER PROPS from The Odds API into Supabase
(mlb_odds_snapshots / mlb_prop_snapshots). The first piece of the MLB build.

    python mlb_capture.py --dry-run                 # fetch + report, write nothing
    python mlb_capture.py --supabase                # scheduled/CI use
    python mlb_capture.py --supabase --props-only   # skip game lines

WHY LIVE CAPTURE. A book's number moves through the day, and a snapshot of that movement exists
only if taken at the time. Historical odds ARE purchasable on the current plan, so this is not the
hard cliff practice trajectory was -- but the live series is free and the archive is not a
substitute for knowing what we saw when we saw it.

MARKET COVERAGE, measured against the live API on 2026-09-07 across 5 games (us region):
    draftkings 14/15 · betmgm 12 · fanatics 12 · bovada 8 · betrivers/williamhill/betonline 5
    fanduel 3   (batter_stolen_bases, pitcher_outs, pitcher_strikeouts ONLY)
FanDuel's board is far richer on their own site than what the API exposes, so the coverage backbone
is DraftKings/BetMGM/Fanatics and FanDuel contributes where it has data. Nothing here should depend
on one book -- that is the Value Finder premise anyway.

COST. Charged per market RETURNED x regions, not per market requested, so asking for markets a book
does not carry is free. MEASURED on a live dry run: 57 credits for 3 games plus one game-lines call,
i.e. ~18 credits per game per sweep and 3 for the game lines. A 15-game slate is ~273 a sweep, four
sweeps a day ~1,100, a month ~33k -- against ~5,000,000 remaining. Events with no props cost 0.

Auth: ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY in .env. Stdlib + odds_client (env + TLS).
"""
import argparse
import datetime as _dt
import json
import sys
import urllib.error
import urllib.request

import odds_client as oc


class TransientError(Exception):
    """A network blip / upstream 5xx that should make the run skip cleanly (exit 0) rather than
    fail. Genuine problems (bad key -> 401, quota -> 429, Supabase 4xx) still surface non-zero."""


SPORT = "baseball_mlb"
BASE = f"https://api.the-odds-api.com/v4/sports/{SPORT}"

GAME_MARKETS = "h2h,spreads,totals"

# Batting then pitching -- the two families a sportsbook splits its baseball board into.
# Which are MODELLABLE is a different question from which are popular: K% and batters-faced
# persist (pitcher_strikeouts is the strongest candidate), barrel/fly-ball rate persist (home
# runs next), and hits are BABIP-driven and close to noise. Capture all of them anyway; coverage
# is cheap and a negative result is worth having.
BATTING = ["batter_home_runs", "batter_first_home_run", "batter_hits", "batter_total_bases",
           "batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis", "batter_singles",
           "batter_doubles", "batter_triples", "batter_walks", "batter_stolen_bases"]
PITCHING = ["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_earned_runs",
            "pitcher_walks", "pitcher_record_a_win"]
DEFAULT_MARKETS = ",".join(BATTING + PITCHING)


def _get(url, tries=3):
    """GET with transient retry -> (status, data, used, remaining). Non-200 returns data None so
    callers skip that event cleanly rather than writing a partial sweep."""
    import time
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return (r.getcode(), json.load(r),
                        r.headers.get("x-requests-last"), r.headers.get("x-requests-remaining"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200]
            if e.code >= 500 and attempt < tries - 1:
                time.sleep(2 ** attempt); continue
            print(f"  ! HTTP {e.code} {body}", file=sys.stderr)
            return (e.code, None, None, None)
        except urllib.error.URLError as e:
            if attempt < tries - 1:
                time.sleep(2 ** attempt); continue
            raise TransientError(f"network error ({e.reason})")
    return (0, None, None, None)


def within_window(commence, days):
    kick = _dt.datetime.fromisoformat(commence.replace("Z", "+00:00"))
    now = _dt.datetime.now(_dt.timezone.utc)
    return now <= kick <= now + _dt.timedelta(days=days)


ODDS_COLS = ["snapshot_at", "capture_reason", "event_id", "commence_time", "home_team",
             "away_team", "book", "market", "outcome_name", "outcome_point", "price_american"]
PROP_COLS = ["snapshot_at", "capture_reason", "event_id", "commence_time", "home_team",
             "away_team", "book", "market", "player", "side", "line", "price_american"]


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


def prop_rows(ev, snapshot_at, reason):
    out = []
    for bk in ev.get("bookmakers", []):
        for m in bk.get("markets", []):
            for o in m.get("outcomes", []):
                out.append({
                    "snapshot_at": snapshot_at, "capture_reason": reason,
                    "event_id": ev.get("id"), "commence_time": ev.get("commence_time"),
                    "home_team": ev.get("home_team"), "away_team": ev.get("away_team"),
                    "book": bk.get("key"), "market": m.get("key"),
                    "player": o.get("description"), "side": o.get("name"),
                    "line": o.get("point"), "price_american": o.get("price"),
                })
    return out


def write(rows, table, conflict, env, batch=500):
    """Idempotent append. 4xx (schema/permission) raises so a real problem surfaces; 5xx/network
    raises TransientError so a blip skips the run instead of failing the workflow."""
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={conflict}"
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
            print(f"  ! {table} batch {i // batch}: HTTP {e.code} {detail}", file=sys.stderr)
            if e.code < 500:
                raise
            raise TransientError(f"Supabase write HTTP {e.code}")
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase write network error ({e.reason})")
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--within-days", type=int, default=2,
                    help="only poll games starting within this many days (MLB props post ~a day out)")
    ap.add_argument("--max-events", type=int, default=20, help="safety cap (a full slate is ~15)")
    ap.add_argument("--markets", default=DEFAULT_MARKETS)
    ap.add_argument("--regions", default="us")
    ap.add_argument("--reason", default="SCHEDULED",
                    choices=["SCHEDULED", "PRE_FIRST_PITCH", "BACKFILL", "MANUAL"])
    ap.add_argument("--props-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--supabase", action="store_true", help="write to Supabase")
    args = ap.parse_args(argv)

    env = oc.load_env()
    key = env.get("ODDS_API_KEY")
    if not key:
        print("ERROR: ODDS_API_KEY missing", file=sys.stderr); return 1
    oc.ensure_ssl_certs()

    # ONE clock timestamp for the whole sweep, shared by game lines and every event's props.
    # It is what makes "one complete snapshot" a groupable thing, and it must never be derived
    # from event data -- deriving it from commence_time is precisely the bug that cost the NFL
    # prop table a season of price history.
    snapshot_at = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()

    status, events, used, remaining = _get(f"{BASE}/events?apiKey={key}")
    if status != 200 or events is None:
        print(f"could not list events (HTTP {status}); skipping run", file=sys.stderr)
        return 0
    slate = [e for e in events if within_window(e["commence_time"], args.within_days)][:args.max_events]
    print(f"MLB {len(events)} upcoming, {len(slate)} within {args.within_days}d  snapshot_at={snapshot_at}")
    if not slate:
        print("no games in window — nothing to capture (not an error)")
        return 0

    spent = 0
    game_out, prop_out = [], []

    if not args.props_only:
        st, data, u, remaining = _get(
            f"{BASE}/odds?apiKey={key}&regions={args.regions}&markets={GAME_MARKETS}&oddsFormat=american")
        spent += int(u or 0)
        if st == 200 and data:
            ids = {e["id"] for e in slate}
            game_out = game_rows([e for e in data if e["id"] in ids], snapshot_at, args.reason)
        print(f"  game lines : {len(game_out)} rows")

    for e in slate:
        st, data, u, remaining = _get(
            f"{BASE}/events/{e['id']}/odds?apiKey={key}&regions={args.regions}"
            f"&markets={args.markets}&oddsFormat=american")
        spent += int(u or 0)
        if st != 200 or not data:
            continue
        prop_out += prop_rows(data, snapshot_at, args.reason)

    books = sorted({r["book"] for r in prop_out})
    markets = sorted({r["market"] for r in prop_out})
    players = len({r["player"] for r in prop_out if r["player"]})
    print(f"  props      : {len(prop_out)} rows · {players} players · {len(markets)} markets · {len(books)} books")
    print(f"  markets    : {markets}")
    print(f"  books      : {books}")
    print(f"  credits    : {spent} this run, {remaining} remaining")

    # An empty parse is a CLAIM and needs the same proof as a non-empty one -- a silent zero is how
    # a broken market list or a renamed field goes unnoticed for a season.
    if slate and not prop_out and not game_out:
        print("WARNING: parsed ZERO rows from a non-empty slate — market keys may have changed",
              file=sys.stderr)
        return 1

    # snapshot_at is ours and taken from the clock, so this can only fail if the clock is wrong --
    # but it is the check that would have caught the NFL bug on day one, so it stays.
    now = _dt.datetime.now(_dt.timezone.utc)
    if _dt.datetime.fromisoformat(snapshot_at) > now + _dt.timedelta(minutes=5):
        print(f"ERROR: snapshot_at {snapshot_at} is in the future — refusing to write", file=sys.stderr)
        return 1

    if args.dry_run or not args.supabase:
        print("\nDRY RUN — nothing written. Add --supabase to append.")
        return 0

    n1 = write(game_out, "mlb_odds_snapshots",
               "snapshot_at,event_id,book,market,outcome_name,outcome_point", env) if game_out else 0
    n2 = write(prop_out, "mlb_prop_snapshots",
               "snapshot_at,event_id,book,market,player,side,line", env) if prop_out else 0
    print(f"\nwrote {n1} game-line rows, {n2} prop rows")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except TransientError as e:
        print(f"transient: {e}; skipping this run (no email)", file=sys.stderr)
        sys.exit(0)
