"""
Travel and body clock -- does a long trip, or an early body-clock kickoff, beat the closing line?

ATTRIBUTE_CATALOG P1: "Travel distance and time zones -- west->east early kicks is the specific
case. Computable today."

MECHANISM, STATED IN ADVANCE: a Pacific-time team kicking off at 1pm Eastern is playing at 10am by
its own body clock, and three time zones of travel costs sleep and routine. Folklore says the
visitor underperforms. The question is not whether that is true -- it is whether it is true BEYOND
what the spread already prices, which is where every other candidate in this project has died.

THE COORDINATES ARE IMPORTED, NOT COPIED. weather_capture.STADIUMS already maps every team to its
venue's latitude and longitude, and a second copy would drift from it the first time a team moves.

TWO VARIABLES, tested separately because they are not the same claim:
  * travel distance -- great-circle km from the away team's home stadium to the venue.
  * body-clock hour -- what the away team's home clock reads at kickoff. 10 or earlier is the
    west->east early case folklore is actually about.

Neutral-site games are DROPPED rather than modelled: London, Munich and Melbourne are a different
question (both teams travel, one is nominally home) and there are too few to answer it.

CHOOSE on 2016-2022, CONFIRM on held-out 2023-2025, and run --placebo. This repo has a case where
shuffled values scored HIGHER on train than the real variable (EMPIRICAL_REFERENCE 9e), so a
train-only number in the 53-60% range means nothing on samples this size.

    python analysis/travel_study.py
    python analysis/travel_study.py --placebo
"""
import argparse
import csv
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import weather_capture as wc   # noqa: E402  -- the one copy of the stadium coordinates

TRAIN = set(range(2016, 2023))
TEST = set(range(2023, 2026))
VIG = 52.38


def tz_offset(lon):
    """Hours behind UTC for a US longitude. Bands, not a database -- and the per-team result is
    PRINTED so it can be eyeballed, because a silently wrong time zone would invent the exact
    effect this script is looking for."""
    if lon <= -115: return 8     # Pacific
    if lon <= -101: return 7     # Mountain
    if lon <= -87:  return 6     # Central
    return 5                     # Eastern


def haversine(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def load():
    rows = []
    path = "data/games.csv"
    if not os.path.exists(path):
        print("data/games.csv missing — run analysis/fetch_data.py", file=sys.stderr)
        return rows
    skipped_neutral = skipped_nostadium = skipped_notime = 0
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                yr, wk = int(r["season"]), int(r["week"])
            except (ValueError, KeyError):
                continue
            if yr not in TRAIN and yr not in TEST:
                continue
            if (r.get("game_type") or "REG") != "REG":
                continue
            if (r.get("location") or "Home") != "Home":
                skipped_neutral += 1
                continue
            home, away = r["home_team"], r["away_team"]
            if home not in wc.STADIUMS or away not in wc.STADIUMS:
                skipped_nostadium += 1
                continue
            gt = (r.get("gametime") or "").strip()
            if ":" not in gt:
                skipped_notime += 1
                continue
            try:
                et_hour = int(gt.split(":")[0]) + int(gt.split(":")[1]) / 60.0
                margin = float(r["home_score"]) - float(r["away_score"])
                spread = float(r["spread_line"])
            except (ValueError, TypeError, KeyError):
                continue

            hv, av = wc.STADIUMS[home], wc.STADIUMS[away]
            venue, home_pt = (hv[3], hv[4]), (av[3], av[4])
            km = haversine(home_pt, venue)
            # gametime is EASTERN. The away team's own clock reads this at kickoff:
            body = et_hour - (tz_offset(av[4]) - 5)
            rows.append({"season": yr, "week": wk, "home": home, "away": away,
                         "margin": margin, "spread": spread,
                         "resid": margin - spread,          # + = HOME beat the number
                         "km": km, "body": body,
                         "away_tz": tz_offset(av[4]), "home_tz": tz_offset(hv[4])})
    print(f"  {len(rows)} games  (dropped: {skipped_neutral} neutral-site, "
          f"{skipped_nostadium} unknown stadium, {skipped_notime} no kickoff time)")
    return rows


def wilson(w, n):
    if not n:
        return (0.0, 0.0)
    p, z = w / n, 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (100 * (c - m), 100 * (c + m))


def bet(rs, label, pick_away):
    """pick_away(r) -> True to back the AWAY side, False the home side, None to pass."""
    sel = [(r, pick_away(r)) for r in rs]
    sel = [(r, p) for r, p in sel if p is not None]
    if len(sel) < 40:
        print(f"      {label:<42} n={len(sel):<4} (too few)")
        return
    dec = [(r, p) for r, p in sel if r["resid"] != 0]
    w = sum(1 for r, p in dec if (r["resid"] < 0) == p)   # away covers when resid < 0
    lo, hi = wilson(w, len(dec))
    verdict = "BEATS vig" if lo > VIG else "cannot rule out" if hi > VIG else "no edge"
    print(f"      {label:<42} {w}-{len(dec)-w} = {100*w/len(dec):5.2f}%  "
          f"CI [{lo:.1f}, {hi:.1f}]  -> {verdict}")


def report(name, rs):
    print(f"\n  {name}  n={len(rs)}")
    if not rs:
        return
    print("    mean residual by the AWAY team's body-clock hour at kickoff:")
    for lab, f in (("<= 10am (west->east early)", lambda r: r["body"] <= 10.0),
                   ("10-12", lambda r: 10.0 < r["body"] <= 12.0),
                   ("12-15", lambda r: 12.0 < r["body"] <= 15.0),
                   ("> 15 (night / west-coast late)", lambda r: r["body"] > 15.0)):
        sel = [r for r in rs if f(r)]
        if len(sel) < 25:
            print(f"      {lab:<34} n={len(sel):>4}  (too few)"); continue
        mr = sum(r["resid"] for r in sel) / len(sel)
        acov = sum(1 for r in sel if r["resid"] < 0)
        lo, hi = wilson(acov, len(sel))
        print(f"      {lab:<34} n={len(sel):>4}  home resid {mr:+6.2f}   away covers "
              f"{100*acov/len(sel):5.1f}%  CI [{lo:.1f}, {hi:.1f}]")

    print("    the bets:")
    bet(rs, "fade the away team, body clock <= 10am", lambda r: False if r["body"] <= 10.0 else None)
    bet(rs, "fade the away team, travel >= 2500km", lambda r: False if r["km"] >= 2500 else None)
    bet(rs, "fade the away team, >=2 tz crossed east",
        lambda r: False if (r["away_tz"] - r["home_tz"]) >= 2 else None)
    bet(rs, "fade any away team (control)", lambda r: False)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--placebo", action="store_true", help="shuffle body clock + distance")
    args = ap.parse_args(argv)

    rows = load()
    if not rows:
        return 1
    seen = {}
    for r in rows:
        seen.setdefault(r["away"], r["away_tz"])
    print("  team -> UTC offset (eyeball this; a wrong zone would invent the effect):")
    for tzv in (8, 7, 6, 5):
        names = sorted(t for t, z in seen.items() if z == tzv)
        print(f"    UTC-{tzv}: {' '.join(names)}")

    if args.placebo:
        rnd = random.Random(20261127)
        vals = [(r["body"], r["km"], r["away_tz"]) for r in rows]
        rnd.shuffle(vals)
        for r, v in zip(rows, vals):
            r["body"], r["km"], r["away_tz"] = v
        print("\n*** PLACEBO: body clock, distance and time zone shuffled ***")

    report("TRAIN 2016-2022", [r for r in rows if r["season"] in TRAIN])
    report("HELD OUT 2023-2025", [r for r in rows if r["season"] in TEST])
    print(f"\nBreak-even is {VIG}%. An interval straddling it means the sample cannot answer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
