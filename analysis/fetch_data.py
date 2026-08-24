"""
Download every public dataset the analysis scripts need.

All of it comes from nflverse on GitHub — no API key, no auth. Run this once
before any script in analysis/.

    python analysis/fetch_data.py

Writes to ./data/ (gitignored). Roughly 150 MB, a few minutes on a decent
connection.
"""
import os
import sys
import time
import urllib.request

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "data")
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
SEASONS = range(2016, 2026)


def get(url, dest, retries=3):
    if os.path.exists(dest) and os.path.getsize(dest) > 5000:
        return "cached"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "nfl-advice-app/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) < 5000:
                raise ValueError(f"suspiciously small: {len(data)} bytes")
            with open(dest, "wb") as f:
                f.write(data)
            return f"{len(data)//1024} KB"
        except Exception as e:
            if attempt == retries - 1:
                return f"FAILED {type(e).__name__}"
            time.sleep(2 * (attempt + 1))


def main():
    os.makedirs(DATA, exist_ok=True)
    jobs = []

    # game results with closing spreads and totals, 1999-present
    jobs.append(("games.csv",
                 "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"))
    # player id crosswalk (gsis <-> pfr) + names for the resolver
    jobs.append(("players.csv", f"{BASE}/players/players.csv"))

    for y in SEASONS:
        jobs.append((f"snaps_{y}.csv.gz", f"{BASE}/snap_counts/snap_counts_{y}.csv.gz"))
        jobs.append((f"stats_{y}.csv", f"{BASE}/stats_player/stats_player_week_{y}.csv"))
        jobs.append((f"tstats_{y}.csv", f"{BASE}/stats_team/stats_team_week_{y}.csv"))
        # injuries: gz exists for recent seasons only, plain csv for older
        jobs.append((f"inj_{y}.csv.gz", f"{BASE}/injuries/injuries_{y}.csv.gz"))

    # play-by-play (compressed) — recent seasons only, for coach tendencies
    # (4th-down aggressiveness, pass-rate-over-expected). ~19 MB/season.
    for y in range(2021, 2025):
        jobs.append((f"pbp_{y}.csv.gz", f"{BASE}/pbp/play_by_play_{y}.csv.gz"))

    failed = []
    for name, url in jobs:
        dest = os.path.join(DATA, name)
        result = get(url, dest)
        print(f"  {name:<24} {result}")
        if str(result).startswith("FAILED"):
            failed.append((name, url))

    # injuries fall back to uncompressed for seasons where .gz is absent
    for name, url in list(failed):
        if name.startswith("inj_") and name.endswith(".csv.gz"):
            alt_name = name.replace(".csv.gz", ".csv")
            alt_url = url.replace(".csv.gz", ".csv")
            result = get(alt_url, os.path.join(DATA, alt_name))
            print(f"  {alt_name:<24} {result}  (fallback)")
            if not str(result).startswith("FAILED"):
                failed.remove((name, url))
                try:
                    os.remove(os.path.join(DATA, name))
                except OSError:
                    pass

    print(f"\ndata directory: {DATA}")
    if failed:
        print(f"\n{len(failed)} file(s) still failing:")
        for name, url in failed:
            print(f"  {name}  <- {url}")
        print("\nnflverse asset names change occasionally. Check the releases page:")
        print("  https://github.com/nflverse/nflverse-data/releases")
        sys.exit(1)
    print("\nAll data present. Now run, in order:")
    print("  python analysis/build_panel.py")
    print("  python analysis/features.py")
    print("  python analysis/model.py")


if __name__ == "__main__":
    main()
