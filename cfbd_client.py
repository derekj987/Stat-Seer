"""
cfbd_client.py — pull College Football (CFB) data from the CollegeFootballData (CFBD)
API v2, the college equivalent of nflverse. First step of the CFB module: schedule +
results (and, later, team/advanced stats) that feed a CFB power-rating model — our
pre-NFL-Week-1 measuring stick. Odds come from The Odds API (americanfootball_ncaaf),
not here.

    python cfbd_client.py --year 2024                    # regular-season games (dry print)
    python cfbd_client.py --year 2025 --week 1
    python cfbd_client.py --year 2024 --fields            # dump one game's full field list

Auth: CFBD uses a Bearer API key. Secret in .env: CFBD_API_KEY
      (free/patreon key at https://collegefootballdata.com/key)
Stdlib only (certifi via odds_client for local TLS). This is intentionally read-only /
print-first so we can eyeball the real payload before wiring storage + a model.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

import odds_client as oc  # reuse load_env() + ensure_ssl_certs()

CFBD_BASE = "https://api.collegefootballdata.com"


def cfbd_get(path, params, api_key):
    """One authenticated GET against the CFBD v2 API -> parsed JSON. Raises on non-200."""
    oc.ensure_ssl_certs()
    url = CFBD_BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "statseer-cfbd/0.1",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.getcode(), json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def fetch_games(api_key, year, season_type="regular", week=None):
    params = {"year": year, "seasonType": season_type}
    if week:
        params["week"] = week
    return cfbd_get("/games", params, api_key)


def _g(g, *keys):
    """First present key (handles v2 camelCase and any v1 snake_case fallbacks)."""
    for k in keys:
        if g.get(k) is not None:
            return g.get(k)
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, required=True, help="season year, e.g. 2024")
    ap.add_argument("--week", type=int, help="single week (else the whole season type)")
    ap.add_argument("--season-type", default="regular",
                    choices=["regular", "postseason", "both"])
    ap.add_argument("--fields", action="store_true", help="dump one game's full field list + JSON")
    args = ap.parse_args(argv)

    env = oc.load_env()
    api_key = env.get("CFBD_API_KEY")
    if not api_key:
        print("ERROR: CFBD_API_KEY missing in .env — get one at "
              "https://collegefootballdata.com/key", file=sys.stderr)
        return 1

    status, games = fetch_games(api_key, args.year, args.season_type, args.week)
    if status != 200:
        print(f"CFBD returned HTTP {status}: {str(games)[:400]}", file=sys.stderr)
        return 1
    if not isinstance(games, list):
        print(f"unexpected payload (not a list): {str(games)[:400]}", file=sys.stderr)
        return 1

    print(f"{len(games)} games — {args.year} {args.season_type}"
          + (f" week {args.week}" if args.week else ""))
    played = [g for g in games if _g(g, "homePoints", "home_points") is not None]
    print(f"  {len(played)} with a final score\n")

    for g in games[:10]:
        home = _g(g, "homeTeam", "home_team")
        away = _g(g, "awayTeam", "away_team")
        hp = _g(g, "homePoints", "home_points")
        ap_ = _g(g, "awayPoints", "away_points")
        wk = _g(g, "week")
        date = (_g(g, "startDate", "start_date") or "")[:16]
        score = f"{ap_}-{hp}" if hp is not None else "—"
        print(f"  W{wk:<2} {away} @ {home:<24} {score:<8} {date}")

    if args.fields and games:
        print("\nFIELDS:", ", ".join(sorted(games[0].keys())))
        print("\nSAMPLE GAME:")
        print(json.dumps(games[0], indent=2)[:1600])
    return 0


if __name__ == "__main__":
    sys.exit(main())
