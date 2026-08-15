"""
injuries_nflverse.py — free practice / injury collector from the open nflverse feed.

The chosen path after SportsData.io was ruled out on cost. Downloads the current
season's nflverse injuries release and writes THAT DAY's practice_status into
practice_reports, tagged with the practice day. Polled Wed/Thu/Fri, the daily
snapshots accumulate the DNP -> LIMITED -> FULL trajectory that cannot be backfilled
-- IF nflverse refreshes between days (a granularity we validate live in Week 1).

Why this feed:
  * `practice_status` values ("Full/Limited/Did Not Participate in Practice") map
    cleanly onto the existing practice_reports participation vocabulary.
  * nflverse supplies `gsis_id` directly -- no name resolver / players.csv needed.
  * Open-licensed, authoritative (scraped from the official NFL report), $0.

The one perishable thing is the daily practice_status; gsis_id is stable and can be
backfilled, so this stays robust even before the `players` table is seeded: if the
gsis foreign key isn't satisfiable yet, it retries with gsis nulled rather than
dropping the row. Once seed_players runs, real gsis_ids get stored with no changes.

  python ingest/injuries_nflverse.py --season 2024 --week 5        # dry run, explicit
  python ingest/injuries_nflverse.py --current                    # infer season + week
  python ingest/injuries_nflverse.py --current --write            # write to Supabase
  python ingest/injuries_nflverse.py --current --write --day WED  # force the day tag

Stdlib only (certifi used if importable, to fix local TLS verification).
"""
import argparse
import csv
import hashlib
import io
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

INJURIES_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
                "injuries/injuries_{season}.csv")
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")

# nflverse practice_status / report_status -> our controlled vocabularies.
PARTICIPATION_MAP = {
    "did not participate in practice": "DNP",
    "limited participation in practice": "LIMITED",
    "full participation in practice": "FULL",
}
STATUS_MAP = {
    "out": "OUT", "doubtful": "DOUBTFUL", "questionable": "QUESTIONABLE",
    "": "NONE", "--": "NONE", "-": "NONE",
}


def normalise_participation(raw):
    key = " ".join((raw or "").split()).strip().lower()
    return PARTICIPATION_MAP.get(key, "NOT_LISTED")


def normalise_status(raw):
    return STATUS_MAP.get(" ".join((raw or "").split()).strip().lower(), "NONE")


def practice_day_for(d):
    # Runs are scheduled at UTC hours that share the calendar day with ET, so the
    # UTC weekday is the practice day.
    return {2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}.get(d.weekday(), "OTHER")


# --------------------------------------------------------------------------- env
def load_env(path=ENV_PATH):
    env = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                value = value.split("#", 1)[0].strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[name.strip()] = value
    for key, value in os.environ.items():
        if key in env or key.startswith(("SUPABASE_",)):
            env[key] = value
    return env


def ensure_ssl():
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
    except Exception:
        pass


def current_season(today=None):
    today = today or datetime.now(timezone.utc).date()
    # Aug-Dec -> that year; Jan-Feb (playoffs) -> prior year.
    return today.year if today.month >= 3 else today.year - 1


# ------------------------------------------------------------------ fetch / parse
def fetch_injuries(season):
    """Download the season injuries CSV. Returns (rows|None, note). None = not yet
    published (404 before Week 1), which is a normal off-season state, not an error."""
    ensure_ssl()
    url = INJURIES_URL.format(season=season)
    req = urllib.request.Request(url, headers={"User-Agent": "nfl-advice-app/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, f"no injuries file for {season} yet (404 — pre-Week-1)"
        raise
    return list(csv.DictReader(io.StringIO(text))), url


def latest_week(rows):
    weeks = [int(r["week"]) for r in rows if r.get("week", "").isdigit()]
    return max(weeks) if weeks else None


def parse(rows, season, week, practice_day, report_date, source_url):
    """Pure transform: nflverse injury rows (for one week) -> practice_reports rows."""
    src_hash = hashlib.sha256(f"{source_url}#{season}w{week}".encode()).hexdigest()[:16]
    out = []
    for r in rows:
        if r.get("week", "").strip() != str(week):
            continue
        name = (r.get("full_name") or "").strip()
        if not name:
            continue
        gsis = (r.get("gsis_id") or "").strip() or None
        out.append({
            "season": season, "week": week, "team": r.get("team"),
            "gsis_id": gsis, "scraped_name": name,
            "report_date": report_date.isoformat(), "practice_day": practice_day,
            "participation": normalise_participation(r.get("practice_status")),
            "injury_primary": (r.get("practice_primary_injury")
                               or r.get("report_primary_injury") or None),
            "injury_secondary": (r.get("practice_secondary_injury")
                                 or r.get("report_secondary_injury") or None),
            "game_status": normalise_status(r.get("report_status")),
            "source_url": source_url, "source_hash": src_hash,
        })
    return out


# ---------------------------------------------------------------- supabase write
def _post(rows, url, key):
    """POST to practice_reports. Returns (written, fk_error). fk_error is True when
    the batch failed only because a gsis_id isn't in the players table yet."""
    endpoint = (url.rstrip("/") + "/rest/v1/practice_reports"
                "?on_conflict=season,week,team,scraped_name,practice_day")
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
    import json
    req = urllib.request.Request(endpoint, data=json.dumps(rows).encode("utf-8"),
                                 headers=headers, method="POST")
    ensure_ssl()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return (len(rows) if r.getcode() in (200, 201, 204) else 0), False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if "23503" in body or "foreign key" in body.lower():
            return 0, True   # gsis FK not satisfiable yet
        print(f"  ! write failed: HTTP {e.code} {body[:400]}", file=sys.stderr)
        raise


def write_practice(rows, url, key):
    written, fk = _post(rows, url, key)
    if fk:
        print("  players table not seeded yet — storing rows with gsis_id=NULL "
              "(gsis is stable and backfillable).")
        for r in rows:
            r["gsis_id"] = None
        written, _ = _post(rows, url, key)
    return written


# ----------------------------------------------------------------------- report
def summarize(rows):
    from collections import Counter
    part = Counter(r["participation"] for r in rows)
    gs = Counter(r["game_status"] for r in rows)
    with_gsis = sum(1 for r in rows if r["gsis_id"])
    print(f"  rows          : {len(rows)}")
    print(f"  gsis present  : {with_gsis}/{len(rows)}")
    print(f"  participation : {dict(part)}")
    print(f"  game_status   : {dict(gs)}")
    if rows:
        r = next((x for x in rows if x["participation"] != "NOT_LISTED"), rows[0])
        print(f"  sample        : {r['scraped_name']} ({r['team']}) "
              f"{r['practice_day']}={r['participation']} status={r['game_status']}")


# -------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--current", action="store_true", help="infer season + latest week")
    src.add_argument("--season", type=int, help="explicit season (with --week)")
    src.add_argument("--fixture", metavar="PATH", help="parse a saved injuries CSV")
    ap.add_argument("--week", type=int, help="explicit week (with --season)")
    ap.add_argument("--day", choices=["WED", "THU", "FRI", "SAT", "SUN", "OTHER"],
                    help="practice-day tag (default: inferred from today)")
    ap.add_argument("--write", action="store_true", help="write to practice_reports")
    args = ap.parse_args(argv)

    env = load_env()
    today = datetime.now(timezone.utc).date()
    practice_day = args.day or practice_day_for(today)

    # 1. Acquire rows + resolve (season, week).
    if args.fixture:
        with open(args.fixture, "r", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        source_url = f"fixture:{os.path.basename(args.fixture)}"
        season = int(rows[0]["season"]) if rows else 0
        week = args.week or latest_week(rows)
    else:
        season = current_season(today) if args.current else args.season
        rows, note = fetch_injuries(season)
        if rows is None:
            print(note)
            return 0
        source_url = note
        week = args.week or (latest_week(rows) if args.current else None)
        if week is None:
            print("ERROR: --season needs --week (or use --current)", file=sys.stderr)
            return 1

    print(f"nflverse injuries  season={season}  week={week}  day={practice_day}")
    parsed = parse(rows, season, week, practice_day, today, source_url)
    print("PARSED")
    summarize(parsed)

    if not args.write:
        print("\nDRY RUN — nothing written. Add --write to insert into practice_reports.")
        return 0

    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1
    written = write_practice(parsed, url, key)
    print(f"\nwrote {written} rows to practice_reports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
