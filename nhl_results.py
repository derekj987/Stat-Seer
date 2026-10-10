"""
nhl_results.py -- NHL final scores + exact puck-drop times, from the NHL's own public API.

    python nhl_results.py --season 2024                     # dry run: fetch, report, write nothing
    python nhl_results.py --season 2024 --csv data/nhl_results_2024.csv
    python nhl_results.py --season 2024 --supabase           # upsert into nhl_results
    python nhl_results.py --seasons 2021-2024 --supabase

This is the NHL analogue of nflverse games.csv: the benchmark side of every totals question.
Without it there is nothing to grade a closing total against.

Free, no key, no scraping -- api-web.nhle.com is the NHL's own JSON feed. The `schedule/{date}`
endpoint returns a WHOLE WEEK per request (plus that season's regularSeasonStartDate /
regularSeasonEndDate), so one season costs ~30 requests and the date range is discovered rather
than hardcoded.

🚨 A SHOOTOUT ADDS EXACTLY ONE GOAL TO THE FINAL SCORE, and books grade the posted total on the
final score. Two consequences that matter before anyone models an NHL total:

  - An NHL game can never finish tied. A 2-2 game through regulation finishes 3-2.
  - So the realised total is NOT a clean count of goals scored in play. Roughly a quarter of games
    get a goal that no scoring model would ever predict, awarded by a skills competition.

That is a key-number fact in the same family as "NFL margins land on exactly 3 in 15.0% of games"
(CLAUDE.md): a structural lump in the distribution that a smooth scoring model cannot see. Whatever
grades a total must use total_goals as recorded here, and whatever MODELS one must account for the
shootout goal separately from goals scored in play -- `last_period_type` is kept on every row so
both views are available.

gameType 2 = regular season, 3 = playoffs. Default is regular season only; playoff hockey is a
different scoring regime (tighter checking, no shootout -- OT runs until someone scores) and
pooling the two would blur exactly what we are trying to measure.

Stdlib only. Shares load_env / ensure_ssl_certs with odds_client.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import odds_client as oc  # noqa: E402

API = "https://api-web.nhle.com/v1"
UA = "statseer/1.0 (NHL results collector)"
TABLE = "nhl_results"
CONFLICT = "game_id"

COLS = ("game_id", "season", "season_id", "game_type", "game_date", "start_time_utc",
        "away_abbrev", "home_abbrev", "away_team", "home_team",
        "away_goals", "home_goals", "total_goals", "last_period_type",
        "neutral_site", "venue")


class TransientError(Exception):
    """A network/5xx blip: skip, do not fail the workflow."""


def _get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == tries - 1:
                print(f"  ! HTTP {e.code} {url}", file=sys.stderr)
                return None
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError as e:
            if attempt == tries - 1:
                raise TransientError(f"network error ({e.reason})")
            time.sleep(2 * (attempt + 1))
    return None


def _name(team):
    """'Buffalo Sabres' from the feed's split place/common name."""
    place = (team.get("placeName") or {}).get("default", "")
    common = (team.get("commonName") or {}).get("default", "") or (team.get("name") or {}).get("default", "")
    return " ".join(x for x in (place, common) if x).strip() or team.get("abbrev", "")


def season_bounds(season):
    """(start, end) dates for a season's regular season, from the feed itself.

    Asked at Oct 1 of the season year, the schedule endpoint reports that season's own
    regularSeasonStartDate / regularSeasonEndDate -- so a lockout-shortened or
    pandemic-shifted season comes back right instead of being clipped by a guess."""
    probe = _get(f"{API}/schedule/{season}-10-01")
    if not probe:
        return None, None
    start = probe.get("regularSeasonStartDate")
    end = probe.get("regularSeasonEndDate") or probe.get("playoffEndDate")
    if not (start and end):
        return None, None
    return _dt.date.fromisoformat(start), _dt.date.fromisoformat(end)


def game_row(g, game_date):
    home, away = g.get("homeTeam") or {}, g.get("awayTeam") or {}
    hg, ag = home.get("score"), away.get("score")
    # gameOutcome only appears once a game is complete -- it is the "is this final?" test.
    # A scheduled-but-unplayed game keeps null goals rather than a misleading 0-0.
    outcome = (g.get("gameOutcome") or {}).get("lastPeriodType")
    final = outcome is not None and hg is not None and ag is not None
    sid = g.get("season")                       # e.g. 20242025
    return {
        "game_id": g.get("id"),
        "season": int(str(sid)[:4]) if sid else None,
        "season_id": sid,
        "game_type": g.get("gameType"),
        "game_date": game_date,
        "start_time_utc": g.get("startTimeUTC"),
        "away_abbrev": away.get("abbrev"), "home_abbrev": home.get("abbrev"),
        "away_team": _name(away), "home_team": _name(home),
        "away_goals": ag if final else None,
        "home_goals": hg if final else None,
        "total_goals": (hg + ag) if final else None,
        "last_period_type": outcome,
        "neutral_site": bool(g.get("neutralSite")),
        "venue": (g.get("venue") or {}).get("default"),
    }


def collect(season, game_types, verbose=True):
    """Every game of the requested types in one season, walking the schedule a week at a time."""
    start, end = season_bounds(season)
    if not start:
        print(f"  season {season}: could not read season bounds from the feed", file=sys.stderr)
        return []
    if verbose:
        print(f"  season {season}: regular season {start} -> {end}")
    rows, seen, cursor, requests = [], set(), start, 0
    while cursor <= end:
        data = _get(f"{API}/schedule/{cursor.isoformat()}")
        requests += 1
        if not data:
            cursor += _dt.timedelta(days=7)
            continue
        for day in data.get("gameWeek", []) or []:
            d = day.get("date")
            for g in day.get("games", []) or []:
                if g.get("gameType") not in game_types or g.get("id") in seen:
                    continue
                seen.add(g["id"])
                rows.append(game_row(g, d))
        # The feed tells us where the next week starts; trust it over date arithmetic so a
        # schedule gap (all-star break, Olympic break) doesn't silently skip games.
        nxt = data.get("nextStartDate")
        cursor = (_dt.date.fromisoformat(nxt) if nxt else cursor + _dt.timedelta(days=7))
        if not nxt and not data.get("gameWeek"):
            cursor += _dt.timedelta(days=7)
    if verbose:
        print(f"           {len(rows)} game(s) in {requests} request(s)")
    return sorted(rows, key=lambda r: (r["start_time_utc"] or "", r["game_id"]))


def write(rows, env, batch=500):
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    endpoint = f"{url.rstrip('/')}/rest/v1/{TABLE}?on_conflict={CONFLICT}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               # merge-duplicates, not ignore: a game collected while still scheduled must be
               # UPDATED with its score once it is played.
               "Prefer": "return=minimal,resolution=merge-duplicates"}
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


def parse_seasons(spec):
    out = set()
    for part in str(spec).split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-"); out.update(range(int(a), int(b) + 1))
        elif part:
            out.add(int(part))
    return sorted(out)


def summarise(rows):
    """What the collected totals actually look like -- the first honest look at the benchmark."""
    final = [r for r in rows if r["total_goals"] is not None]
    if not final:
        print("\nno completed games collected.")
        return
    n = len(final)
    ends = {}
    for r in final:
        ends[r["last_period_type"]] = ends.get(r["last_period_type"], 0) + 1
    tots = sorted(r["total_goals"] for r in final)
    mean = sum(tots) / n
    print(f"\n{n} completed game(s). Mean total {mean:.3f} goals.")
    print("  ended in: " + ", ".join(f"{k} {v} ({v / n:.1%})" for k, v in sorted(ends.items())))
    beyond_reg = sum(v for k, v in ends.items() if k != "REG")
    print(f"  {beyond_reg / n:.1%} of games got a goal from OT/SO rather than from play.")
    print("  total distribution:")
    for t in range(min(tots), max(tots) + 1):
        c = tots.count(t)
        if c:
            print(f"    {t:>2} goals  {c:>5}  {c / n:>6.1%}  {'#' * round(c / n * 120)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--season", type=int, help="one season, by start year (2024 = 2024-25)")
    g.add_argument("--seasons", help="range or list, e.g. 2021-2024 or 2021,2023")
    ap.add_argument("--playoffs", action="store_true",
                    help="include playoff games (gameType 3). Off by default -- a different "
                         "scoring regime, and playoff OT has no shootout.")
    ap.add_argument("--csv", help="also write a local CSV (for analysis scripts)")
    ap.add_argument("--supabase", action="store_true", help=f"upsert into {TABLE}")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    seasons = [args.season] if args.season else parse_seasons(args.seasons)
    types = {2, 3} if args.playoffs else {2}

    print(f"NHL results -- season(s) {', '.join(str(s) for s in seasons)}, "
          f"gameType {sorted(types)}")
    rows = []
    for s in seasons:
        try:
            rows += collect(s, types)
        except TransientError as e:
            print(f"  season {s}: transient ({e}) -- skipped", file=sys.stderr)
    if not rows:
        print("nothing collected.", file=sys.stderr)
        return 1

    summarise(rows)

    if args.csv:
        os.makedirs(os.path.dirname(os.path.abspath(args.csv)), exist_ok=True)
        with open(args.csv, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS)
            w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows)} row(s) -> {args.csv}")

    if not args.supabase:
        print("\nno --supabase flag -- nothing written to the database.")
        return 0
    try:
        n = write(rows, env)
    except TransientError as e:
        print(f"transient on write: {e} -- skipping")
        return 0
    print(f"\nupserted {n} row(s) into {TABLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
