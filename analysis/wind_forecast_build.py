"""
wind_forecast_build.py -- assemble FORECAST wind beside realized wind and the closing total, so
the one live lead in ATTRIBUTE_CATALOG can finally be tested at bet time.

    python analysis/wind_forecast_build.py --seasons 2024          # pilot
    python analysis/wind_forecast_build.py --seasons 2015-2025     # the full set

🚨 WHY THIS EXISTS. The catalog's wind finding -- the market under-sets totals by ~1.3 points at
15+ mph, 56.1% unders, n=647 -- uses the wind RECORDED AT GAME TIME. Nobody can bet that. The
catalog says so itself: "The genuine version of this edge is not 'high wind -> under' -- it's being
better than the market at predicting where the forecast lands." This file builds the forecast
column that sentence requires.

TWO FREE OPEN-METEO ENDPOINTS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT:
  * historical-forecast-api -- what was PREDICTED for that hour, archived.
  * archive-api             -- what actually HAPPENED that hour (ERA5 reanalysis).
Measured on one Buffalo date while writing this: forecast peak 15.7 mph, actual 13.6. They are not
the same number, which is exactly why the catalog's caveat matters.

🚨 THE LEAD TIME IS THE CAVEAT TO STATE OUT LOUD. The historical-forecast endpoint returns the most
recent archived forecast for each hour, which is a SHORT lead -- closer to kickoff than a bettor
pricing the game days earlier. So this column is an UPPER BOUND on forecast skill at bet time. That
makes a negative result strong (if the market already prices even this optimistic forecast, it
certainly prices a worse one) and a positive result provisional (it would need a true bet-time
forecast before anyone traded it). Do not report a positive from this file as tradeable.

Realized wind comes from the ARCHIVE rather than nflverse's `wind` column, because the two are not
the same measurement -- nflverse carries the stadium's reported number, which is missing on ~8% of
outdoor games and is not a defined height or averaging window. The archive is one consistent
series. nflverse `wind` is carried through anyway so the two can be compared.

Stadium coordinates are imported from weather_capture.py rather than copied, so a venue move is
fixed in one place. Neutral-site games (London, Munich, Sao Paulo) are DROPPED: the home team's
coordinates would be wrong, and they are a handful of games.

Caches each (stadium, season) response under data/wind_cache/ -- completed seasons never change,
so a re-run costs nothing.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from weather_capture import STADIUMS  # noqa: E402  -- one source of venue coordinates

GAMES = os.path.join(ROOT, "data", "games.csv")
CACHE = os.path.join(ROOT, "data", "wind_cache")
OUT = os.path.join(ROOT, "data", "wind_forecast.csv")
FORECAST_API = "https://historical-forecast-api.open-meteo.com/v1/forecast"
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
# The near-kickoff forecast plus the SAME hour as forecast 1, 2 and 3 days earlier.
FC_VARS = ("wind_speed_10m,wind_speed_10m_previous_day1,"
           "wind_speed_10m_previous_day2,wind_speed_10m_previous_day3")


def _get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # 429 is Open-Meteo's rate limit: back off rather than drop the stadium, or the
            # resulting file is silently short in a way nothing downstream can detect.
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(8 * (attempt + 1)); continue
            raise
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(5 * (attempt + 1)); continue
            raise
    return None


def hourly(api, lat, lon, start, end, tag, variables="wind_speed_10m"):
    """{var: {iso_hour: wind_mph}} for one venue-season, cached on disk.

    `variables` may name several: the forecast endpoint also serves `wind_speed_10m_previous_dayN`,
    which is the forecast for the SAME hour as it stood N days earlier. That is what turns a
    near-kickoff number into a genuine bet-time one -- previous_day3 on a Sunday game is the
    Thursday forecast."""
    os.makedirs(CACHE, exist_ok=True)
    key = f"{tag}_{lat:.4f}_{lon:.4f}_{start}_{end}.json"
    path = os.path.join(CACHE, key)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
        "hourly": variables, "wind_speed_unit": "mph", "timezone": "America/New_York"})
    d = _get(f"{api}?{q}")
    h = (d or {}).get("hourly", {})
    times = h.get("time", [])
    out = {var: {t: v for t, v in zip(times, h.get(var, [])) if v is not None}
           for var in variables.split(",")}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    return out


def nearest(series, when):
    """Wind at the hour closest to kickoff; None when the series does not cover it."""
    key = when.strftime("%Y-%m-%dT%H:00")
    if key in series:
        return series[key]
    for delta in (1, -1, 2, -2):
        k = (when + dt.timedelta(hours=delta)).strftime("%Y-%m-%dT%H:00")
        if k in series:
            return series[k]
    return None


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
    ap.add_argument("--seasons", default="2024")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)
    seasons = parse_seasons(args.seasons)

    with open(GAMES, encoding="utf-8") as fh:
        games = [g for g in csv.DictReader(fh)
                 if g.get("season", "").isdigit() and int(g["season"]) in seasons
                 and g.get("game_type") == "REG"
                 and g.get("roof") in ("outdoors", "open")
                 and g.get("total_line") not in (None, "", "NA")
                 and g.get("result") not in (None, "", "NA")]
    print(f"{len(games)} outdoor games with a closing total, seasons {seasons[0]}-{seasons[-1]}")

    # One fetch per venue-season rather than per game: 17 weeks of hourly data is a single
    # response, and completed seasons are immutable so the cache is permanent.
    need = {}
    for g in games:
        home = g["home_team"]
        if home not in STADIUMS:
            continue
        need.setdefault((home, int(g["season"])), []).append(g)

    rows, skipped_neutral, no_cover = [], 0, 0
    for i, ((home, season), gs) in enumerate(sorted(need.items()), 1):
        _v, _c, _s, lat, lon, _roof = STADIUMS[home]
        start, end = f"{season}-09-01", f"{season + 1}-02-20"
        try:
            fc = hourly(FORECAST_API, lat, lon, start, end, "fc2", FC_VARS)
            ar = hourly(ARCHIVE_API, lat, lon, start, end, "ar2")
        except Exception as e:  # noqa: BLE001
            print(f"  {home} {season}: fetch failed ({type(e).__name__}) — skipped", file=sys.stderr)
            continue
        for g in gs:
            # A neutral-site game is played somewhere else entirely; the home venue's wind would be
            # fiction. nflverse marks it on stadium_id, not on a flag we can trust.
            if g.get("stadium_id") and STADIUMS[home][0] and g.get("location") == "Neutral":
                skipped_neutral += 1
                continue
            try:
                kick = dt.datetime.strptime(f"{g['gameday']} {g.get('gametime') or '13:00'}",
                                            "%Y-%m-%d %H:%M")
            except ValueError:
                continue
            f = nearest(fc["wind_speed_10m"], kick)
            a = nearest(ar["wind_speed_10m"], kick)
            leads = {f"fc_d{n}": nearest(fc.get(f"wind_speed_10m_previous_day{n}", {}), kick)
                     for n in (1, 2, 3)}
            if f is None or a is None:
                no_cover += 1
                continue
            rows.append({
                "season": g["season"], "week": g["week"], "gameday": g["gameday"],
                "away": g["away_team"], "home": home,
                "fc_wind": round(f, 1), "ar_wind": round(a, 1),
                **{k: (round(v, 1) if v is not None else "") for k, v in leads.items()},
                "nflverse_wind": g.get("wind") or "",
                "total_line": g["total_line"], "total": g.get("total") or "",
                "temp": g.get("temp") or "",
            })
        if i % 20 == 0:
            print(f"  {i}/{len(need)} venue-seasons")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print(f"\nwrote {len(rows)} rows -> {args.out}")
    if skipped_neutral:
        print(f"  {skipped_neutral} neutral-site game(s) dropped (home coordinates would be wrong)")
    if no_cover:
        print(f"  {no_cover} game(s) had no wind series covering kickoff")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
