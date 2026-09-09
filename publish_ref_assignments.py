"""
Capture NFL referee (crew chief) assignments per game into ref_assignments.

Source: the nflverse games.csv `referee` field — free, already fetched elsewhere,
no scraping. Assignments appear during game week; scheduled runs then populate the
table, which the Context page reads to show each game's crew as a *factor* (its real
penalty tendency), never fused into a pick.

    python publish_ref_assignments.py --season 2025 --no-fetch   # dry test on history
    python publish_ref_assignments.py --write                    # upsert current season

That caveat came true, so the source is now ESPN, with nflverse as the backfill:

  * MEASURED: nflverse fills `referee` only for games that have been PLAYED. 272 of 272 games
    carry a crew for 2023, 2024 and 2025 — all complete — and 0 of 272 for 2026. A crew known
    only after kickoff is worthless as pre-game context, and this job had been running daily
    and writing nothing while reporting success.
  * ESPN publishes the assigned crew BEFORE kickoff, in the game summary's
    `gameInfo.officials`. Verified on 2026 Week 1 NE @ SEA hours before kick: Adrian Hill.
  * nflverse is still read for COMPLETED seasons, because it is the cleaner source of the
    history that REF_STATS' penalty tendencies are computed from.

Take the official whose position is "Referee" — the crew chief REF_STATS is keyed on. The array
is not ordered by seniority; on the game checked, `officials[0]` was a Field Judge.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import pandas as pd

import odds_client as oc

GAMES_LOCAL = "data/games.csv"


def fetch_games():
    """Download the schedule. Returns a DataFrame, or None on a transient fetch
    failure (network / 5xx) so the caller can fall back to a local copy or skip."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(oc.GAMES_URL, headers={"User-Agent": "statseer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        return None
    # `data/` is gitignored, so on a fresh CI checkout the DIRECTORY does not exist and this open()
    # raised FileNotFoundError -- which the transient guard above doesn't catch (it only covers
    # network errors), so the run died with a traceback and emailed a FAILURE even though the
    # download had succeeded. Every other script writing under data/ already does this.
    os.makedirs(os.path.dirname(GAMES_LOCAL) or ".", exist_ok=True)
    with open(GAMES_LOCAL, "wb") as fh:
        fh.write(data)
    return pd.read_csv(GAMES_LOCAL, low_memory=False)


ESPN_BOARD = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
              "?year=%d&seasontype=2&week=%d")
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=%s"
# ESPN abbreviates two clubs differently from nflverse (which is what ref_assignments stores).
ESPN_ALIAS = {"LAR": "LA", "WSH": "WAS"}


def _espn_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001 — ESPN is a best-effort supplement, never fatal
        print(f"  ESPN unavailable ({e})", file=sys.stderr)
        return None


def fetch_espn_crews(season, weeks=range(1, 19)):
    """[{season, week, home_team, away_team, referee}] for games ESPN has assigned a crew to."""
    out = []
    for wk in weeks:
        board = _espn_json(ESPN_BOARD % (season, wk))
        if not board:
            continue
        for ev in board.get("events", []) or []:
            comps = (ev.get("competitions") or [{}])[0].get("competitors") or []
            home = next((c for c in comps if c.get("homeAway") == "home"), {})
            away = next((c for c in comps if c.get("homeAway") == "away"), {})
            ha = (home.get("team") or {}).get("abbreviation")
            aa = (away.get("team") or {}).get("abbreviation")
            if not ha or not aa or not ev.get("id"):
                continue
            summary = _espn_json(ESPN_SUMMARY % ev["id"])
            officials = ((summary or {}).get("gameInfo") or {}).get("officials") or []
            ref = next((o.get("fullName") for o in officials
                        if ((o.get("position") or {}).get("name") == "Referee")), None)
            if not ref:
                continue
            out.append({"season": int(season), "week": int(wk),
                        "home_team": ESPN_ALIAS.get(ha, ha),
                        "away_team": ESPN_ALIAS.get(aa, aa), "referee": ref})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--no-fetch", action="store_true", help="use local games.csv (don't download)")
    args = ap.parse_args(argv)

    env = oc.load_env()
    if args.no_fetch:
        g = pd.read_csv(GAMES_LOCAL, low_memory=False)
    else:
        g = fetch_games()
        if g is None:   # transient fetch failure — use the local copy, or skip today
            if os.path.exists(GAMES_LOCAL):
                print("games.csv fetch failed (transient) — using local copy")
                g = pd.read_csv(GAMES_LOCAL, low_memory=False)
            else:
                print("games.csv fetch failed (transient) and no local copy — skipping today")
                return 0
    s = g[(g.season == args.season) & (g.game_type == "REG") & g.referee.notna()]
    rows = [{"season": int(r.season), "week": int(r.week), "home_team": r.home_team,
             "away_team": r.away_team, "referee": r.referee} for _, r in s.iterrows()]
    print(f"{args.season}: {len(rows)} games with a crew from nflverse (played games only)")

    # Anything nflverse has not filled is either unplayed or missing — ask ESPN, which assigns
    # pre-game. Keyed on (week, home_team) so an ESPN row never overwrites a played-game record.
    have = {(r["week"], r["home_team"]) for r in rows}
    espn_rows = fetch_espn_crews(args.season)
    added = [r for r in espn_rows if (r["week"], r["home_team"]) not in have]
    rows += added
    print(f"{args.season}: +{len(added)} pre-game crews from ESPN")

    print(f"{args.season}: {len(rows)} games with an assigned crew")
    for r in rows[:5]:
        print(f"  W{r['week']} {r['away_team']}@{r['home_team']}: {r['referee']}")

    if not args.write:
        print("\nDRY RUN — add --write to upsert.")
        return 0
    if not rows:
        print("\nnothing to write (no assignments yet).")
        return 0

    endpoint = (f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/ref_assignments"
                "?on_conflict=season,week,home_team")
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        endpoint, data=json.dumps(rows).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = r.getcode() in (200, 201, 204)
        print(f"\nupserted {len(rows)} assignments" if ok else "\nwrite failed")
    except urllib.error.HTTPError as e:
        print(f"\nWRITE FAILED {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
