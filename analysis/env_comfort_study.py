"""
env_comfort_study.py -- is there an edge in an away underdog's ENVIRONMENT comfort?

Not weather (no forecast wind/precip) -- STRUCTURAL: does a team play in a venue like its
own home? A dome team (New Orleans) at another dome (Detroit) is in its element; a
warm/indoor team dropped into a cold outdoor stadium is not. Question: do away teams in a
FAMILIAR environment beat the number more than those in a hostile one -- and is any of it
unpriced (an edge) or already in the line (context)?

Method:
  * Each team gets a static home profile from its own home games: roof class (indoor if
    dome/closed, else outdoor) + climate (controlled if indoor; else warm/cold by mean home
    outdoor temp).
  * The venue's profile = the HOME team's profile. Away "comfort" (0-100) starts at 100 and
    is docked when the away team is out of its element: a controlled/warm team in a cold
    outdoor venue (-50), an indoor team playing outdoors at all (-15), a surface flip (-10).
  * Then away ATS cover% and straight-up win% by comfort bucket, CONTROLLING for the spread,
    and the away-DOG subset -- the Chaos Board's target.

    python analysis/env_comfort_study.py

Stdlib + pandas + numpy. NFL only (CFB stadium metadata isn't in cfb.db).
"""
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

INDOOR = {"dome", "closed"}      # climate-controlled at kickoff
COLD_MAX = 55.0                  # mean home outdoor temp below this = a cold-weather team
WARM_MIN = 64.0                  # above this = a warm-weather team


def turf_class(s):
    s = (str(s) or "").strip().lower()
    return "grass" if s.startswith("grass") or s == "dessograss" else "turf"


def team_profiles(g):
    """Each team's home-stadium profile from its own home games."""
    prof = {}
    for team, h in g.groupby("home_team"):
        roofs = h.roof.dropna()
        indoor = (roofs.isin(INDOOR).mean() >= 0.5) if len(roofs) else False
        out_temps = h.loc[~h.roof.isin(INDOOR), "temp"].dropna()
        mean_t = out_temps.mean() if len(out_temps) else np.nan
        climate = ("controlled" if indoor
                   else "warm" if (mean_t >= WARM_MIN)
                   else "cold" if (mean_t <= COLD_MAX)
                   else "mild")
        surf = h.surface.map(turf_class).mode()
        prof[team] = {"indoor": indoor, "climate": climate,
                      "surface": surf.iloc[0] if len(surf) else "grass"}
    return prof


def comfort(away_p, venue_p):
    """0-100 how much the venue resembles the away team's home. High = in its element."""
    c = 100
    venue_outdoor_cold = (not venue_p["indoor"]) and venue_p["climate"] == "cold"
    if venue_outdoor_cold and away_p["climate"] in ("controlled", "warm"):
        c -= 50                       # warm/dome team dropped into the cold -- the big one
    if away_p["indoor"] and not venue_p["indoor"]:
        c -= 15                       # indoor team exposed to the elements at all
    if away_p["surface"] != venue_p["surface"]:
        c -= 10                       # grass<->turf flip
    return max(0, c)


def main():
    g = pd.read_csv("data/games.csv", low_memory=False).dropna(subset=["home_score", "away_score", "spread_line"])
    g = g[g.game_type == "REG"] if "game_type" in g.columns else g
    g = g[g.season >= 2010]
    prof = team_profiles(g)

    sl = g.spread_line.to_numpy(); hm = (g.home_score - g.away_score).to_numpy()
    sign = 1.0 if np.corrcoef(sl, hm)[0, 1] >= 0 else -1.0

    rows = []
    for _, r in g.iterrows():
        ap, vp = prof.get(r.away_team), prof.get(r.home_team)
        if not ap or not vp:
            continue
        home_fav_pts = sign * float(r.spread_line)      # >0 home favored
        line = abs(home_fav_pts)
        hmg = int(r.home_score) - int(r.away_score)
        away_win = 1.0 if hmg < 0 else 0.0
        # away covers iff away_margin + (points they're getting) > 0; away_line = +home_fav_pts
        away_cover = None if (-hmg) == -home_fav_pts else (1.0 if (-hmg) > -home_fav_pts else 0.0)
        outdoor = str(r.roof) not in INDOOR
        cold_game = outdoor and pd.notna(r.temp) and float(r.temp) < 40
        rows.append({"line": line, "away_dog": home_fav_pts > 0, "away_win": away_win,
                     "away_cover": away_cover, "comfort": comfort(ap, vp),
                     "venue_cold": (not vp["indoor"]) and vp["climate"] == "cold",
                     "cold_game": cold_game,
                     "away_soft": ap["climate"] in ("controlled", "warm")})
    print(f"NFL 2010-2025: {len(rows)} away-team games with profiles\n")

    def rate(rs, k):
        v = [x[k] for x in rs if x[k] is not None]
        return (100 * np.mean(v), len(v)) if v else (float("nan"), 0)

    # --- A. away performance by comfort bucket (all away teams) ---
    buckets = [("hostile <=50", lambda c: c <= 50), ("mixed 55-85", lambda c: 55 <= c <= 85),
               ("at-home 90+", lambda c: c >= 90)]
    print("A. All away teams by comfort:")
    print(f"  {'comfort':<14}{'n':>6}{'SU win%':>10}{'ATS cover%':>12}")
    for lab, f in buckets:
        rs = [x for x in rows if f(x["comfort"])]
        su, _ = rate(rs, "away_win"); ats, na = rate(rs, "away_cover")
        print(f"  {lab:<14}{len(rs):>6}{su:>9.1f}%{ats:>11.1f}% (n={na})")

    # --- B. the specific case: soft (warm/dome) away team in a cold outdoor venue ---
    # NOTE: uses the venue's STATIC 'cold' label, which over-counts mild early-season games at
    # northern stadiums. The honest magnitude comes from B2 below (realized game temp), which
    # is what the live Chaos Board approximates by gating the cold penalty to late season.
    print("\nB. Soft (warm/dome) away team IN a cold-labelled venue vs elsewhere (static — overstates):")
    hostile = [x for x in rows if x["away_soft"] and x["venue_cold"]]
    other = [x for x in rows if not (x["away_soft"] and x["venue_cold"])]
    for lab, rs in (("soft-in-cold", hostile), ("everyone else", other)):
        su, _ = rate(rs, "away_win"); ats, na = rate(rs, "away_cover")
        print(f"  {lab:<14}{len(rs):>6}  SU {su:5.1f}%   ATS {ats:5.1f}% (n={na})")

    # --- B2. the HONEST version: realized game temp < 40F (a truly cold game) ---
    print("\nB2. Soft away team in a TRULY cold game (realized temp <40F) -- the real magnitude:")
    for lab, keep in (("soft-in-cold", True), ("everyone else", False)):
        rs = [x for x in rows if bool(x["away_soft"] and x["cold_game"]) == keep]
        su, _ = rate(rs, "away_win"); ats, na = rate(rs, "away_cover")
        print(f"  {lab:<14}{len(rs):>6}  SU {su:5.1f}%   ATS {ats:5.1f}% (n={na})")
    print("  reading: a modest, mostly-priced effect that only shows up in genuinely cold games "
          "-- so the live board only docks comfort late in the season, not in mild September.")

    # --- C. controlling for the spread: away-DOG cover% by comfort, within spread buckets ---
    print("\nC. AWAY UNDERDOGS only -- ATS cover% by comfort, within spread buckets\n"
          "   (does comfort beat the number BEYOND the price? >52.4% = clears vig):")
    dogs = [x for x in rows if x["away_dog"]]
    sb = [(1, 3), (3, 7), (7, 14)]
    print(f"  {'|spread|':<10}{'hostile<=50':>18}{'at-home 90+':>18}")
    for lo, hi in sb:
        cell = []
        for f in (lambda c: c <= 50, lambda c: c >= 90):
            rs = [x for x in dogs if lo <= x["line"] < hi and f(x["comfort"])]
            ats, na = rate(rs, "away_cover")
            cell.append(f"{ats:5.1f}% (n={na:>4})" if na >= 30 else f"  n/a (n={na:>4})")
        print(f"  {lo}-{hi:<7}{cell[0]:>18}{cell[1]:>18}")
    # overall away-dog comfort split
    for lab, f in (("hostile<=50", lambda c: c <= 50), ("at-home90+", lambda c: c >= 90)):
        rs = [x for x in dogs if f(x["comfort"])]
        su, _ = rate(rs, "away_win"); ats, na = rate(rs, "away_cover")
        print(f"  all away dogs {lab:<12} SU {su:5.1f}%  ATS {ats:5.1f}% (n={na})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
