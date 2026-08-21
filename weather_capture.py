"""
weather_capture.py — game-site weather for the current NFL week, from Open-Meteo (free,
no API key). Writes web/lib/weatherData.ts, which the Context (Special Considerations) page
and the game-line cards read.

Discipline: weather is CONTEXT, not a pick. Wind is the one measured lead (the market
under-sets totals ~1.3 pts at 15+ mph) but it fails the vig bar and uses realized wind — the
real edge would be forecasting better than the market. So we display it, flag high wind, and
never call it an edge.

Two honest limits, handled explicitly:
  * Forecasts run ~16 days out. Games beyond that show status "pending" until the window opens.
  * Domed / roofed stadiums are indoor — weather is a non-factor (shown immediately, no fetch).

    python weather_capture.py            # build + write web/lib/weatherData.ts
    python weather_capture.py --probe    # just print what it would write
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass

# team (nflverse/odds abbrev) -> (venue, city, state, lat, lon, roof)
# roof: "outdoor" | "dome" (fixed indoor) | "retractable" (usually closed for weather)
STADIUMS = {
    "ARI": ("State Farm Stadium", "Glendale", "AZ", 33.5277, -112.2626, "retractable"),
    "ATL": ("Mercedes-Benz Stadium", "Atlanta", "GA", 33.7554, -84.4009, "retractable"),
    "BAL": ("M&T Bank Stadium", "Baltimore", "MD", 39.2780, -76.6227, "outdoor"),
    "BUF": ("Highmark Stadium", "Orchard Park", "NY", 42.7738, -78.7870, "outdoor"),
    "CAR": ("Bank of America Stadium", "Charlotte", "NC", 35.2258, -80.8528, "outdoor"),
    "CHI": ("Soldier Field", "Chicago", "IL", 41.8623, -87.6167, "outdoor"),
    "CIN": ("Paycor Stadium", "Cincinnati", "OH", 39.0955, -84.5161, "outdoor"),
    "CLE": ("Huntington Bank Field", "Cleveland", "OH", 41.5061, -81.6995, "outdoor"),
    "DAL": ("AT&T Stadium", "Arlington", "TX", 32.7473, -97.0945, "retractable"),
    "DEN": ("Empower Field at Mile High", "Denver", "CO", 39.7439, -105.0201, "outdoor"),
    "DET": ("Ford Field", "Detroit", "MI", 42.3400, -83.0456, "dome"),
    "GB": ("Lambeau Field", "Green Bay", "WI", 44.5013, -88.0622, "outdoor"),
    "HOU": ("NRG Stadium", "Houston", "TX", 29.6847, -95.4107, "retractable"),
    "IND": ("Lucas Oil Stadium", "Indianapolis", "IN", 39.7601, -86.1639, "retractable"),
    "JAX": ("EverBank Stadium", "Jacksonville", "FL", 30.3239, -81.6373, "outdoor"),
    "KC": ("Arrowhead Stadium", "Kansas City", "MO", 39.0489, -94.4839, "outdoor"),
    "LA": ("SoFi Stadium", "Inglewood", "CA", 33.9535, -118.3392, "dome"),   # fixed roof
    "LAC": ("SoFi Stadium", "Inglewood", "CA", 33.9535, -118.3392, "dome"),
    "LAR": ("SoFi Stadium", "Inglewood", "CA", 33.9535, -118.3392, "dome"),
    "LV": ("Allegiant Stadium", "Las Vegas", "NV", 36.0909, -115.1833, "dome"),
    "MIA": ("Hard Rock Stadium", "Miami Gardens", "FL", 25.9580, -80.2389, "outdoor"),
    "MIN": ("U.S. Bank Stadium", "Minneapolis", "MN", 44.9737, -93.2578, "dome"),
    "NE": ("Gillette Stadium", "Foxborough", "MA", 42.0909, -71.2643, "outdoor"),
    "NO": ("Caesars Superdome", "New Orleans", "LA", 29.9511, -90.0812, "dome"),
    "NYG": ("MetLife Stadium", "East Rutherford", "NJ", 40.8135, -74.0745, "outdoor"),
    "NYJ": ("MetLife Stadium", "East Rutherford", "NJ", 40.8135, -74.0745, "outdoor"),
    "PHI": ("Lincoln Financial Field", "Philadelphia", "PA", 39.9008, -75.1675, "outdoor"),
    "PIT": ("Acrisure Stadium", "Pittsburgh", "PA", 40.4468, -80.0158, "outdoor"),
    "SEA": ("Lumen Field", "Seattle", "WA", 47.5952, -122.3316, "outdoor"),
    "SF": ("Levi's Stadium", "Santa Clara", "CA", 37.4030, -121.9700, "outdoor"),
    "TB": ("Raymond James Stadium", "Tampa", "FL", 27.9759, -82.5033, "outdoor"),
    "TEN": ("Nissan Stadium", "Nashville", "TN", 36.1665, -86.7713, "outdoor"),
    "WAS": ("Northwest Stadium", "Landover", "MD", 38.9077, -76.8645, "outdoor"),
}

# International / neutral-site games — the home team's stadium is WRONG for these, so we
# override by (week, away, home). Venue, city, country, lat, lon, roof. (2026 slate.)
NEUTRAL_OVERRIDES = {
    (1, "SF", "LA"):   ("Melbourne Cricket Ground", "Melbourne", "Australia", -37.8200, 144.9834, "outdoor"),
    (3, "BAL", "DAL"): ("Maracanã Stadium", "Rio de Janeiro", "Brazil", -22.9121, -43.2302, "outdoor"),
    (4, "IND", "WAS"): ("Tottenham Hotspur Stadium", "London", "England", 51.6043, -0.0665, "outdoor"),
    (6, "HOU", "JAX"): ("Wembley Stadium", "London", "England", 51.5560, -0.2795, "outdoor"),
    (7, "PIT", "NO"):  ("Stade de France", "Saint-Denis", "France", 48.9245, 2.3601, "outdoor"),
    (9, "CIN", "ATL"): ("Santiago Bernabéu", "Madrid", "Spain", 40.4531, -3.6883, "retractable"),
    (10, "NE", "DET"): ("Allianz Arena", "Munich", "Germany", 48.2188, 11.6247, "outdoor"),
    (11, "MIN", "SF"): ("Estadio Banorte", "Monterrey", "Mexico", 25.6693, -100.2447, "outdoor"),
}

# WMO weather codes -> short label (Open-Meteo `weathercode`)
WMO = {0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
       45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
       61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
       71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow",
       80: "Rain showers", 81: "Rain showers", 82: "Heavy showers",
       85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"}

WIND_FLAG_MPH = 15   # the measured threshold where the market's total edge shows up


def load_env(path=".env"):
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def sb(path):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(f"{url}/rest/v1/{path}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.loads(urllib.request.urlopen(req, timeout=45).read())


def current_week_games(season, week):
    latest = sb(f"odds_snapshots?season=eq.{season}&week=eq.{week}"
                f"&capture_reason=in.(SCHEDULED,MANUAL)&select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not latest:
        return []
    snap = urllib.parse.quote(latest[0]["snapshot_at"])
    rows = sb(f"odds_snapshots?season=eq.{season}&week=eq.{week}&snapshot_at=eq.{snap}"
              f"&select=event_id,home_team,away_team,commence_time&limit=5000")
    seen, games = set(), []
    for r in rows:
        if r["event_id"] in seen:
            continue
        seen.add(r["event_id"])
        games.append(r)
    games.sort(key=lambda r: r["commence_time"])
    return games


def fetch_weather(lat, lon, when):
    """Hourly forecast at the venue; return the hour nearest kickoff, or None if out of range."""
    day = when.strftime("%Y-%m-%d")
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={lat}&longitude={lon}"
           "&hourly=temperature_2m,precipitation_probability,weathercode,wind_speed_10m,wind_gusts_10m"
           "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT"
           f"&start_date={day}&end_date={day}")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read())
    except Exception:
        return None
    h = data.get("hourly") or {}
    times = h.get("time") or []
    if not times:
        return None
    target = when.strftime("%Y-%m-%dT%H:00")
    idx = min(range(len(times)), key=lambda i: abs(_hr(times[i]) - when.hour)) if target not in times else times.index(target)
    def g(k):
        v = h.get(k) or []
        return v[idx] if idx < len(v) else None
    return {
        "tempF": _round(g("temperature_2m")),
        "windMph": _round(g("wind_speed_10m")),
        "gustMph": _round(g("wind_gusts_10m")),
        "precipPct": _int(g("precipitation_probability")),
        "conditions": WMO.get(g("weathercode"), None),
    }


def _hr(iso):
    try:
        return int(iso[11:13])
    except Exception:
        return 0

def _round(v):
    return None if v is None else round(float(v))

def _int(v):
    return None if v is None else int(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", default="web/lib/weatherData.ts")
    args = ap.parse_args()
    load_env()

    # current week = the earliest week still on the board (matches the lines page default)
    wk = sb(f"odds_snapshots?season=eq.{args.season}&select=week&order=week.asc&limit=1")
    week = wk[0]["week"] if wk else 1
    games = current_week_games(args.season, week)
    now = datetime.now(timezone.utc)
    print(f"season={args.season} week={week}: {len(games)} games")

    out = []
    for gm in games:
        home, away = gm["home_team"], gm["away_team"]
        ov = NEUTRAL_OVERRIDES.get((week, away, home))
        if ov:
            venue, city, state, lat, lon, roof = ov
            neutral = True
        else:
            venue, city, state, lat, lon, roof = STADIUMS.get(home, (home, None, None, None, None, "outdoor"))
            neutral = False
        commence = gm["commence_time"]
        kick = datetime.fromisoformat(commence.replace("Z", "+00:00"))
        indoor = roof in ("dome", "retractable")
        row = {
            "eventId": gm["event_id"], "game": f'{away} @ {home}',
            "home": home, "away": away, "commence": commence, "neutral": neutral,
            "venue": venue, "city": city, "state": state, "roof": roof, "indoor": indoor,
            "status": "indoor" if indoor else "pending",
            "tempF": None, "windMph": None, "gustMph": None, "precipPct": None,
            "conditions": None, "windFlag": False,
        }
        if not indoor and lat is not None:
            days_out = (kick - now).days
            if 0 <= days_out <= 15:
                w = fetch_weather(lat, lon, kick)
                if w:
                    row.update(w)
                    row["status"] = "ok"
                    wind = w["windMph"] or 0
                    row["windFlag"] = wind >= WIND_FLAG_MPH or (w["gustMph"] or 0) >= WIND_FLAG_MPH + 5
        out.append(row)

    ind = sum(1 for r in out if r["indoor"])
    ok = sum(1 for r in out if r["status"] == "ok")
    print(f"  {ind} indoor · {ok} with live forecast · {len(out)-ind-ok} pending (>16 days out)")
    if args.probe:
        for r in out:
            extra = "INDOOR" if r["indoor"] else (f'{r["tempF"]}F wind {r["windMph"]}mph {r["conditions"]}' if r["status"] == "ok" else "pending")
            print(f'  {r["game"]:10s} {r["roof"]:11s} {extra}')
        return

    ts = "// AUTO-GENERATED by weather_capture.py — do not edit by hand.\n"
    ts += "// Game-site weather (Open-Meteo). CONTEXT, not a pick. Forecasts land ~16 days out.\n"
    ts += "export interface GameWeather { eventId: string; game: string; home: string; away: string;\n"
    ts += "  commence: string; neutral: boolean; venue: string; city: string|null; state: string|null;\n"
    ts += "  roof: 'outdoor'|'dome'|'retractable'; indoor: boolean;\n"
    ts += "  status: 'ok'|'pending'|'indoor'; tempF: number|null; windMph: number|null;\n"
    ts += "  gustMph: number|null; precipPct: number|null; conditions: string|null; windFlag: boolean }\n"
    ts += f"export const WEATHER_SEASON = {args.season};\nexport const WEATHER_WEEK = {week};\n"
    ts += f'export const WEATHER_UPDATED = "{now.strftime("%Y-%m-%dT%H:%MZ")}";\n'
    ts += "export const GAME_WEATHER: GameWeather[] = [\n"
    for r in out:
        ts += "  " + json.dumps(r) + ",\n"
    ts += "];\n"
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"wrote {len(out)} games -> {args.out}")


if __name__ == "__main__":
    main()
