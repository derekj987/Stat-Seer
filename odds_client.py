"""
odds_client.py

Turn The Odds API v4 NFL responses into rows for the `odds_snapshots` table.

Three modes, so it is fully testable without live credentials or a database:

    # Parse the golden fixture and print what WOULD be written (no network, no DB):
    python odds_client.py --fixture

    # Make a live API call, print the parsed rows + credit cost, but do NOT write:
    python odds_client.py --live

    # Make a live call and write to Supabase:
    python odds_client.py --live --write --reason SCHEDULED

Design notes
------------
* `parse_snapshot()` is a pure function — (events JSON -> rows). That is the piece
  the fixture exercises, and the piece a test pins.
* `season` is derived from commence_time. `week` is NOT in the odds payload, so it
  is resolved from the authoritative nflverse schedule (`data/games.csv` if present,
  else fetched). Key: (season, home_abbr, away_abbr) — verified unique per season.
* Teams are stored as nflverse ABBREVIATIONS so rows join cleanly downstream. Note
  the Rams are `LA` in nflverse, not `LAR`.
* Every live call logs x-requests-last / used / remaining. Cost is markets x regions,
  never per game.
* An event whose teams don't resolve to a week is COLLECTED and reported, never
  silently dropped — a hole in the board must be visible (same principle as the
  player_alias_queue).

Stdlib only, except certifi is used (if importable) to fix local TLS verification.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ODDS_ENDPOINT = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds"
GAMES_LOCAL = os.path.join("data", "games.csv")
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
ENV_PATH = ".env"

# Odds API full team name -> nflverse abbreviation. Verified against 2026 games.csv:
# all 32 present, and the Rams are LA (not LAR).
TEAM_ABBR = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LA", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}


# --------------------------------------------------------------------------- env
def load_env(path=ENV_PATH):
    """Config from a local .env, with real environment variables taking precedence.
    The .env path is for local dev; CI/deploys (GitHub Actions, Vercel) set real env
    vars and have no .env file, so os.environ must win."""
    env = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                value = value.split("#", 1)[0].strip()  # drop inline comment
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[name.strip()] = value
    # Real env vars override .env (and supply config when no .env exists).
    for key, value in os.environ.items():
        if key in env or key.startswith(("ODDS_", "SUPABASE_", "SPORTSDATA_",
                                         "CRON_", "ANTHROPIC_")):
            env[key] = value
    return env


def ensure_ssl_certs():
    """Point urllib at certifi's CA bundle. This python.org build can't verify
    GitHub's release/CDN chain otherwise. No-op if certifi is absent or already set."""
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
    except Exception:
        pass


# ----------------------------------------------------------------- season / week
def derive_season(commence_time_iso):
    """NFL season label from an ISO-8601 UTC kickoff. Aug-Dec -> that year;
    Jan-Feb (playoffs) -> prior year."""
    year = int(commence_time_iso[:4])
    month = int(commence_time_iso[5:7])
    if month <= 2:
        return year - 1
    return year


def load_week_map(source=None):
    """Return {(season:int, home_abbr, away_abbr): week:int} from nflverse games.csv.
    Uses local data/games.csv if present, else fetches GAMES_URL."""
    import csv
    import io

    text = None
    path = source or GAMES_LOCAL
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    else:
        ensure_ssl_certs()
        req = urllib.request.Request(GAMES_URL, headers={"User-Agent": "nfl-advice-app/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8")

    week_map = {}
    for row in csv.DictReader(io.StringIO(text)):
        if not row.get("week") or not row.get("season"):
            continue
        try:
            key = (int(row["season"]), row["home_team"], row["away_team"])
            week_map[key] = int(row["week"])
        except ValueError:
            continue
    return week_map


# --------------------------------------------------------------------- parsing
def _abbr(team_name):
    return TEAM_ABBR.get(team_name)


def parse_snapshot(events, snapshot_at, capture_reason, week_map):
    """Pure transform: Odds API events -> (rows, unresolved).

    rows: list of dicts matching odds_snapshots columns.
    unresolved: list of (event_id, matchup, reason) for events we could not place
                on the schedule — collected, never silently dropped.
    """
    rows, unresolved = [], []
    for ev in events:
        eid = ev.get("id")
        commence = ev.get("commence_time")
        home_full, away_full = ev.get("home_team"), ev.get("away_team")
        home, away = _abbr(home_full), _abbr(away_full)

        if home is None or away is None:
            unresolved.append((eid, f"{away_full} @ {home_full}", "unmapped team name"))
            continue

        season = derive_season(commence)
        week = week_map.get((season, home, away))
        if week is None:
            unresolved.append((eid, f"{away} @ {home}", f"no {season} schedule row"))
            continue

        for book in ev.get("bookmakers", []):
            bkey = book.get("key")
            for market in book.get("markets", []):
                mkey = market.get("key")
                for oc in market.get("outcomes", []):
                    name = oc.get("name")
                    # Store team outcomes as abbreviations; keep Over/Under literal.
                    outcome_name = TEAM_ABBR.get(name, name)
                    point = oc.get("point")
                    rows.append({
                        "snapshot_at": snapshot_at,
                        "capture_reason": capture_reason,
                        "season": season,
                        "week": week,
                        "event_id": eid,
                        "commence_time": commence,
                        "home_team": home,
                        "away_team": away,
                        "book": bkey,
                        "market": mkey,
                        "outcome_name": outcome_name,
                        "outcome_point": None if point is None else float(point),
                        "price_american": None if oc.get("price") is None else int(oc["price"]),
                    })
    return rows, unresolved


def snapshot_time_from_events(events):
    """Deterministic capture time for a payload: the newest bookmaker last_update.
    All rows from one call share it, which is what closing_lines depends on."""
    stamps = [b.get("last_update") for ev in events for b in ev.get("bookmakers", [])
              if b.get("last_update")]
    return max(stamps) if stamps else None


def filter_commence_window(rows, within_min, now_iso=None):
    """Keep only rows whose game kicks off within the next `within_min` minutes.
    Used by the pre-kickoff sweep to capture a tight closing line without writing
    every upcoming game on every 15-minute run. `now_iso` is injectable for tests."""
    from datetime import datetime, timezone, timedelta

    if now_iso is None:
        now = datetime.now(timezone.utc)
    else:
        now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    horizon = now + timedelta(minutes=within_min)

    kept = []
    for r in rows:
        kickoff = datetime.fromisoformat(r["commence_time"].replace("Z", "+00:00"))
        if now <= kickoff <= horizon:
            kept.append(r)
    return kept


# ------------------------------------------------------------------- live fetch
def fetch_live(api_key, markets, regions, odds_format="american"):
    """One GET. Returns (status, headers, events, credit) where credit is a dict of
    the x-requests-* header values. Raises on network failure."""
    ensure_ssl_certs()
    params = {
        "apiKey": api_key, "regions": regions, "markets": markets,
        "oddsFormat": odds_format,
    }
    url = ODDS_ENDPOINT + "?" + urllib.parse.urlencode(params)
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=60)
    except urllib.error.HTTPError as e:
        resp = e
    status = resp.getcode()
    headers = resp.headers
    body = resp.read().decode("utf-8", errors="replace")
    credit = {
        "last": headers.get("x-requests-last"),
        "used": headers.get("x-requests-used"),
        "remaining": headers.get("x-requests-remaining"),
    }
    events = json.loads(body) if status == 200 else body
    return status, headers, events, credit


# ---------------------------------------------------------------- supabase write
def write_supabase(rows, url, service_key, batch=500):
    """POST rows to PostgREST. Idempotent ONLY once odds_snapshots has a matching
    unique index (see the note printed by main()). Returns rows accepted."""
    # Name the dedupe index as the ON CONFLICT target so ignore-duplicates actually
    # ignores unique-index dupes (a bare ON CONFLICT only covers the primary key).
    endpoint = (url.rstrip("/") + "/rest/v1/odds_snapshots"
                "?on_conflict=snapshot_at,event_id,book,market,outcome_name,outcome_point")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        data = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:500]
            print(f"  ! batch {i//batch} failed: HTTP {e.code} {detail}", file=sys.stderr)
            raise
    return written


# ----------------------------------------------------------------------- report
def summarize(rows, unresolved, snapshot_at):
    books = sorted({r["book"] for r in rows})
    markets = sorted({r["market"] for r in rows})
    events = sorted({r["event_id"] for r in rows})
    print(f"  snapshot_at   : {snapshot_at}")
    print(f"  rows          : {len(rows)}")
    print(f"  events placed : {len(events)}")
    print(f"  markets       : {', '.join(markets)}")
    print(f"  books ({len(books):>2})    : {', '.join(books)}")
    if rows:
        r = rows[0]
        print(f"  sample row    : wk{r['week']} {r['away_team']}@{r['home_team']} "
              f"{r['book']} {r['market']} {r['outcome_name']} "
              f"pt={r['outcome_point']} price={r['price_american']}")
    if unresolved:
        print(f"  UNRESOLVED ({len(unresolved)}) — collected, not written:")
        for eid, matchup, why in unresolved:
            print(f"    - {matchup:<12} {why}  ({eid})")


# -------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--fixture", nargs="?", const="fixtures/odds_v4_raw.json",
                     metavar="PATH", help="parse a saved fixture (default: the golden one)")
    src.add_argument("--live", action="store_true", help="make one live API call")
    ap.add_argument("--markets", default="h2h,spreads,totals", help="live markets")
    ap.add_argument("--regions", default="us", help="live regions")
    ap.add_argument("--reason", default="MANUAL",
                    choices=["SCHEDULED", "PRE_KICKOFF", "BACKFILL", "MANUAL"])
    ap.add_argument("--write", action="store_true", help="write to Supabase (else dry-run)")
    ap.add_argument("--commence-within", type=int, default=None, metavar="MIN",
                    help="only keep games kicking off within MIN minutes (pre-kickoff sweep)")
    args = ap.parse_args(argv)

    env = load_env()

    # 1. Acquire events.
    if args.live:
        api_key = env.get("ODDS_API_KEY")
        if not api_key:
            print("ERROR: ODDS_API_KEY missing in .env", file=sys.stderr)
            return 1
        print(f"LIVE  markets={args.markets} regions={args.regions}")
        status, _, events, credit = fetch_live(api_key, args.markets, args.regions)
        print(f"  HTTP {status}  |  credit cost (x-requests-last): {credit['last']}"
              f"  used={credit['used']} remaining={credit['remaining']}")
        if status != 200:
            print(f"  API returned non-200; body: {events}", file=sys.stderr)
            return 1
    else:
        print(f"FIXTURE  {args.fixture}")
        with open(args.fixture, "r", encoding="utf-8") as fh:
            events = json.load(fh)

    # 2. Parse.
    week_map = load_week_map()
    snapshot_at = snapshot_time_from_events(events)
    rows, unresolved = parse_snapshot(events, snapshot_at, args.reason, week_map)
    if args.commence_within is not None:
        rows = filter_commence_window(rows, args.commence_within)
        print(f"  filtered to {len(rows)} rows within {args.commence_within} min of kickoff")

    print("PARSED")
    summarize(rows, unresolved, snapshot_at)

    # 3. Write, or explain the dry run.
    if not args.write:
        print("\nDRY RUN — nothing written. Add --write to insert into Supabase.")
        return 0

    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env", file=sys.stderr)
        return 1
    print(f"\nWRITING {len(rows)} rows to {url} ...")
    written = write_supabase(rows, url, key)
    print(f"  accepted: {written}")
    print("  NOTE: dedupe is only enforced once odds_snapshots has a unique index "
          "(see README follow-up).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
