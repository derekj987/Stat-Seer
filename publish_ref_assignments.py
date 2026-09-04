"""
Capture NFL referee (crew chief) assignments per game into ref_assignments.

Source: the nflverse games.csv `referee` field — free, already fetched elsewhere,
no scraping. Assignments appear during game week; scheduled runs then populate the
table, which the Context page reads to show each game's crew as a *factor* (its real
penalty tendency), never fused into a pick.

    python publish_ref_assignments.py --season 2025 --no-fetch   # dry test on history
    python publish_ref_assignments.py --write                    # upsert current season

Caveat: if nflverse turns out to fill `referee` only post-game, we swap the source
to a game-week assignments scrape — the table + UI stay the same.
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
