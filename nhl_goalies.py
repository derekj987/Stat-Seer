"""
nhl_goalies.py -- which goalie actually started each game, from the NHL's own public API.

    python nhl_goalies.py --season 2024 --csv data/nhl_goalies.csv
    python nhl_goalies.py --seasons 2021-2024 --csv data/nhl_goalies.csv

Free, no key. One request per game (gamecenter/{id}/boxscore), whose `playerByGameStats.
{home,away}Team.goalies[].starter` flag names the starter. ~1,300 requests a season.

WHY. Derek's NHL factor list puts goaltending first, and it is the only item on that list with a
TIMING mechanism rather than a priced-variable one: starters are confirmed on the morning of the
game, so a market slow to reprice a backup start is a stale price -- Value Finder arithmetic, not a
model. §14f showed the closing total itself is efficient, so timing is the only place left to look.

Testing that needs two things this script provides:
  1. who started, to label a game as an expected-starter or a backup start;
  2. a BACKUP definition that is honest about hindsight.

🚨 THE HINDSIGHT TRAP. "Backup" cannot be defined using the season's full start counts -- that uses
information from after the game. `starts_before` / `share_before` on every row count only that
goalie's prior starts for that team IN THAT SEASON, so a label built from them is something a
bettor could have known that morning. A goalie's first start of a season has share_before 0.0 and
is correctly unknowable, not "a backup".

This script records WHO STARTED. It does not say whether the market knew -- that is
nhl_goalie_value.py's job, and it is a measurement, not an assumption.
"""
from __future__ import annotations

import argparse
import csv
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
UA = "statseer/1.0 (NHL goalie collector)"

COLS = ("game_id", "season", "game_date", "start_time_utc", "side", "team_abbrev",
        "opp_abbrev", "goalie_id", "goalie", "starts_before", "share_before",
        "toi", "save_pctg", "decision")


class TransientError(Exception):
    pass


def _get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == tries - 1:
                return None
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError as e:
            if attempt == tries - 1:
                raise TransientError(f"network error ({e.reason})")
            time.sleep(2 * (attempt + 1))
    return None


def starters(game_id):
    """[(side, goalie_id, name, toi, save_pctg, decision)] for the two starting goalies."""
    d = _get(f"{API}/gamecenter/{game_id}/boxscore")
    if not d:
        return []
    gs = (d.get("playerByGameStats") or {})
    out = []
    for side in ("awayTeam", "homeTeam"):
        for g in (gs.get(side) or {}).get("goalies", []) or []:
            if g.get("starter"):
                out.append((
                    "away" if side == "awayTeam" else "home",
                    g.get("playerId"),
                    (g.get("name") or {}).get("default", ""),
                    g.get("toi"), g.get("savePctg"), g.get("decision"),
                ))
    return out


def parse_seasons(spec):
    out = set()
    for part in str(spec).split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-"); out.update(range(int(a), int(b) + 1))
        elif part:
            out.add(int(part))
    return sorted(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--season", type=int)
    g.add_argument("--seasons")
    ap.add_argument("--results-csv", default="data/nhl_results.csv",
                    help="game list, built by nhl_results.py (free)")
    ap.add_argument("--csv", default="data/nhl_goalies.csv")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    seasons = {args.season} if args.season else set(parse_seasons(args.seasons))
    if not os.path.exists(args.results_csv):
        print(f"ERROR: {args.results_csv} not found. Run nhl_results.py first (free).",
              file=sys.stderr)
        return 1
    with open(args.results_csv, "r", encoding="utf-8") as f:
        games = [r for r in csv.DictReader(f)
                 if r.get("season") and int(r["season"]) in seasons and r.get("total_goals")]
    games.sort(key=lambda r: r["start_time_utc"] or "")
    print(f"NHL starting goalies -- season(s) {sorted(seasons)}, {len(games):,} game(s)")

    # Prior starts per (season, team, goalie) and per (season, team), walked in kickoff order so
    # every count is strictly BEFORE the game being written. This is what makes the eventual
    # "backup" label free of hindsight.
    g_starts, t_starts = {}, {}
    rows, missing = [], 0
    for i, gm in enumerate(games, 1):
        try:
            st = starters(gm["game_id"])
        except TransientError as e:
            print(f"  transient: {e} -- stopping early with {len(rows):,} row(s)", file=sys.stderr)
            break
        if len(st) < 2:
            missing += 1
            continue
        for side, gid, name, toi, svp, dec in st:
            team = gm[f"{side}_abbrev"]
            opp = gm["home_abbrev"] if side == "away" else gm["away_abbrev"]
            season = int(gm["season"])
            gk = (season, team, gid)
            tk = (season, team)
            before = g_starts.get(gk, 0)
            tbefore = t_starts.get(tk, 0)
            rows.append({
                "game_id": gm["game_id"], "season": season, "game_date": gm["game_date"],
                "start_time_utc": gm["start_time_utc"], "side": side,
                "team_abbrev": team, "opp_abbrev": opp,
                "goalie_id": gid, "goalie": name,
                "starts_before": before,
                "share_before": round(before / tbefore, 4) if tbefore else "",
                "toi": toi, "save_pctg": svp, "decision": dec,
            })
            g_starts[gk] = before + 1
            t_starts[tk] = tbefore + 1
        if i % 200 == 0:
            print(f"  {i:,}/{len(games):,} games ...")

    if not rows:
        print("nothing collected.", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(args.csv)), exist_ok=True)
    with open(args.csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)
    print(f"\nwrote {len(rows):,} starting-goalie row(s) -> {args.csv}")
    if missing:
        print(f"  {missing:,} game(s) had no starter flag (skipped)")
    uniq = len({(r['season'], r['team_abbrev'], r['goalie_id']) for r in rows})
    print(f"  {uniq:,} distinct season-team-goalie combination(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
