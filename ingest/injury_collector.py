"""
SportsDataIO practice / injury collector.

The chosen licensed-feed replacement for the HTML practice_scraper. Polls the
SportsDataIO NFL Injuries endpoint once per practice day (Wed/Thu/Fri). Each poll
captures THAT DAY's PracticeDescription, tagged with the day; three daily rows per
player accumulate into the DNP -> LIMITED -> FULL trajectory that cannot be
backfilled.

Endpoint (verified):
    https://api.sportsdata.io/v3/nfl/stats/json/Injuries/{season}/{week}?key=...

`parse_injuries()` is pure -> testable against a saved fixture. The trial fixture
scrambles injury VALUES (PracticeDescription etc. => "Scrambled" => NOT_LISTED),
but identity fields are real, so name->gsis resolution is genuinely exercised. On a
paid tier the same code yields real DNP/LIMITED/FULL with zero changes.

    python ingest/injury_collector.py --fixture fixtures/sportsdata_injuries_raw.json --day WED
    python ingest/injury_collector.py --live 2025REG 10 --day WED
    python ingest/injury_collector.py --live 2026REG 1 --write        # day inferred from today
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

# Script dir (ingest/) is on sys.path[0], so these siblings import regardless of cwd.
from player_resolver import PlayerResolver
from practice_scraper import (normalise_participation, normalise_status,
                              practice_day_for)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENDPOINT = "https://api.sportsdata.io/v3/nfl/stats/json/Injuries/{season}/{week}"


# ---------------------------------------------------------------- config / io
def load_env():
    """Repo-root .env reader (absolute path, cwd-independent). os.environ wins."""
    env = {}
    path = os.path.join(REPO_ROOT, ".env")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                value = value.split("#", 1)[0].strip()
                env[name.strip()] = value
    return {**env, **{k: v for k, v in os.environ.items() if k in env or k.startswith(("SUPABASE_", "SPORTSDATA_"))}}


def ensure_ssl():
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
    except Exception:
        pass


def fetch(season, week, key):
    ensure_ssl()
    url = ENDPOINT.format(season=season, week=week) + f"?key={key}"
    req = urllib.request.Request(url, headers={"User-Agent": "nfl-advice-app/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


# ------------------------------------------------------------------- parsing
def parse_injuries(records, season, week, practice_day, report_date, resolver, source_url):
    """Pure transform: SportsDataIO injury records -> practice_reports rows.

    One row per player for the given practice_day. Returns (rows, unresolved).
    Unresolved names are collected (queued), never dropped.
    """
    rows, unresolved = [], []
    src_hash = hashlib.sha256(source_url.encode()).hexdigest()[:16]
    for r in records:
        name = (r.get("Name") or "").strip()
        if not name:
            continue
        team = r.get("Team")
        pos = r.get("Position")
        gsis, _score, _method = resolver.resolve(name, team, pos)
        if gsis is None:
            unresolved.append({"scraped_name": name, "team": team, "position": pos})
        rows.append(dict(
            season=int(season), week=int(week), team=team, gsis_id=gsis,
            scraped_name=name, report_date=report_date.isoformat(),
            practice_day=practice_day,
            participation=normalise_participation(r.get("PracticeDescription")),
            injury_primary=r.get("BodyPart"),
            injury_secondary=None,
            game_status=normalise_status(r.get("Status")),
            source_url=source_url, source_hash=src_hash,
        ))
    return rows, unresolved


# ------------------------------------------------------------------- writing
def _post(table, records, on_conflict, env):
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key and records):
        return 0
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={on_conflict}"
    req = urllib.request.Request(
        endpoint, data=json.dumps(records).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=ignore-duplicates"},
        method="POST")
    ensure_ssl()
    with urllib.request.urlopen(req, timeout=60) as r:
        return len(records) if r.getcode() in (200, 201, 204) else 0


# ----------------------------------------------------------------- reporting
def summarize(rows, unresolved):
    from collections import Counter
    part = Counter(r["participation"] for r in rows)
    gs = Counter(r["game_status"] for r in rows)
    resolved = sum(1 for r in rows if r["gsis_id"])
    print(f"  rows            : {len(rows)}")
    print(f"  gsis resolved   : {resolved}/{len(rows)} "
          f"({100*resolved/len(rows):.1f}%)" if rows else "  rows: 0")
    print(f"  participation   : {dict(part)}")
    print(f"  game_status     : {dict(gs)}")
    if rows:
        r = next((x for x in rows if x["gsis_id"]), rows[0])
        print(f"  sample resolved : {r['scraped_name']} ({r['team']}) -> "
              f"{r['gsis_id']} | {r['practice_day']}={r['participation']} "
              f"status={r['game_status']}")
    if unresolved:
        print(f"  UNRESOLVED ({len(unresolved)}): "
              + ", ".join(u["scraped_name"] for u in unresolved[:8])
              + (" ..." if len(unresolved) > 8 else ""))


# -------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--fixture", metavar="PATH", help="parse a saved injuries fixture")
    src.add_argument("--live", nargs=2, metavar=("SEASON", "WEEK"),
                     help="fetch live, e.g. --live 2025REG 10")
    ap.add_argument("--day", choices=["WED", "THU", "FRI", "SAT", "SUN", "OTHER"],
                    help="practice day tag (default: inferred from today)")
    ap.add_argument("--write", action="store_true", help="write to practice_reports")
    args = ap.parse_args(argv)

    env = load_env()
    today = datetime.now(timezone.utc).date()
    practice_day = args.day or practice_day_for(today)

    players_csv = os.path.join(REPO_ROOT, "data", "players.csv")
    resolver = PlayerResolver(__import__("pandas").read_csv(players_csv, low_memory=False))

    if args.live:
        season, week = args.live
        key = env.get("SPORTSDATA_API_KEY")
        if not key:
            print("ERROR: SPORTSDATA_API_KEY missing in .env", file=sys.stderr)
            return 1
        status, data = fetch(season, week, key)
        if status != 200:
            print(f"ERROR: HTTP {status}: {data}", file=sys.stderr)
            return 1
        source_url = ENDPOINT.format(season=season, week=week)
        print(f"LIVE {season}/{week}  day={practice_day}  {len(data)} records")
    else:
        with open(args.fixture, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        season = str(data[0]["Season"]) if data else "0"
        week = str(data[0]["Week"]) if data else "0"
        source_url = f"fixture:{os.path.basename(args.fixture)}"
        print(f"FIXTURE {args.fixture}  season={season} week={week} day={practice_day}  "
              f"{len(data)} records")

    rows, unresolved = parse_injuries(data, season, week, practice_day, today,
                                      resolver, source_url)
    print("PARSED")
    summarize(rows, unresolved)

    if not args.write:
        print("\nDRY RUN — nothing written. Add --write to insert into practice_reports.")
        return 0

    n = _post("practice_reports", rows,
              "season,week,team,scraped_name,practice_day", env)
    print(f"\nwrote {n} rows to practice_reports")
    if unresolved:
        q = _post("player_alias_queue",
                  [dict(scraped_name=u["scraped_name"], team=u["team"],
                        position=u["position"], source="injury_feed")
                   for u in unresolved], "scraped_name,team", env)
        print(f"queued {q} unresolved names")
    return 0


if __name__ == "__main__":
    sys.exit(main())
