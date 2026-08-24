"""
early_season_study.py -- is the START of the season actually more chaotic, or does it just
feel that way? Tests the folklore behind the Chaos Board's "early weeks are special":

  A. Upset rate (market dog wins outright) in weeks 1-3 vs 4-8 vs 9+, CONTROLLING for the
     spread bucket -- so we're asking "at the same price, do dogs win more early?"
  B. Dog ATS cover rate early vs late -- does the early market actually misprice dogs, or
     is it just higher variance that's still priced?
  C. The "slow start, big finish" claim -- of teams that were 1-2 or 1-3 after three games,
     how many finished with 10+ wins? Base rate + what it really is (regression/talent).

NFL from data/games.csv (nflverse), NCAAF from data/cfb.db. Stdlib + pandas + numpy.

    python analysis/early_season_study.py
"""
import sqlite3
import sys
from collections import defaultdict

import numpy as np
import pandas as pd


def wk_bucket(w):
    return "wk1-3" if w <= 3 else ("wk4-8" if w <= 8 else "wk9+")


def load_nfl(path="data/games.csv"):
    g = pd.read_csv(path, low_memory=False).dropna(subset=["home_score", "away_score", "spread_line"])
    g = g[g.game_type == "REG"] if "game_type" in g.columns else g
    sl = g.spread_line.to_numpy(); hm = (g.home_score - g.away_score).to_numpy()
    sign = 1.0 if np.corrcoef(sl, hm)[0, 1] >= 0 else -1.0
    rows = []
    for _, r in g.iterrows():
        home_fav_pts = sign * float(r.spread_line)
        line = abs(home_fav_pts)
        if line < 1:
            continue
        hmg = int(r.home_score) - int(r.away_score)
        home_is_dog = home_fav_pts < 0
        fav_margin = -hmg if home_is_dog else hmg      # favorite's realized margin
        rows.append({"season": int(r.season), "week": int(r.week), "line": line,
                     "upset": 1.0 if fav_margin < 0 else 0.0,          # dog wins outright
                     "dog_cover": None if fav_margin == line else (1.0 if fav_margin < line else 0.0)})
    return rows


def load_ncaaf(db="data/cfb.db"):
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT g.season, g.week, g.home_points, g.away_points,
                  (SELECT spread FROM lines l WHERE l.game_id=g.id AND l.provider='consensus'
                     AND l.spread IS NOT NULL) AS cons,
                  (SELECT AVG(spread) FROM lines l WHERE l.game_id=g.id AND l.spread IS NOT NULL) AS avgs
             FROM games g WHERE g.home_class='fbs' AND g.away_class='fbs'
               AND g.home_points IS NOT NULL""").fetchall()
    conn.close()
    out = []
    for s, w, hp, ap, cons, avgs in rows:
        spread = cons if cons is not None else avgs
        if spread is None:
            continue
        line = abs(float(spread))
        if line < 1:
            continue
        home_is_dog = float(spread) > 0
        hmg = hp - ap
        fav_margin = -hmg if home_is_dog else hmg
        out.append({"season": s, "week": w or 0, "line": line,
                    "upset": 1.0 if fav_margin < 0 else 0.0,
                    "dog_cover": None if fav_margin == line else (1.0 if fav_margin < line else 0.0)})
    return out


BUCKETS = [(1, 3), (3, 7), (7, 10), (10, 14), (14, 21), (21, 100)]


def test_A_B(name, rows):
    print(f"\n{'='*72}\n{name}: {len(rows)} games with a real dog")
    wkb = {"wk1-3": [], "wk4-8": [], "wk9+": []}
    for r in rows:
        wkb[wk_bucket(r["week"])].append(r)

    print("\nA. Upset rate (dog wins outright) by spread bucket x part-of-season:")
    print(f"  {'|spread|':>10} {'wk1-3':>14} {'wk4-8':>14} {'wk9+':>14}")
    for lo, hi in BUCKETS:
        cells = []
        for part in ("wk1-3", "wk4-8", "wk9+"):
            sub = [r for r in wkb[part] if lo <= r["line"] < hi]
            cells.append(f"{100*np.mean([r['upset'] for r in sub]):5.1f}% (n={len(sub):>4})" if len(sub) >= 25 else "     n/a     ")
        print(f"  {lo:>3}-{str(hi) if hi<100 else '+':<5} {cells[0]:>14} {cells[1]:>14} {cells[2]:>14}")

    # overall, and spread-matched (reweight late buckets to early bucket's spread mix)
    early = wkb["wk1-3"]; late = wkb["wk4-8"] + wkb["wk9+"]
    def rate(rs): return 100*np.mean([r["upset"] for r in rs]) if rs else float("nan")
    print(f"\n  overall upset%:  early(wk1-3) {rate(early):.1f}%  vs  later(wk4+) {rate(late):.1f}%")
    # spread-matched: bucket-weight late by early's distribution
    ew = {}
    for lo, hi in BUCKETS:
        ew[(lo, hi)] = len([r for r in early if lo <= r["line"] < hi]) / max(1, len(early))
    matched = 0.0
    for lo, hi in BUCKETS:
        ls = [r for r in late if lo <= r["line"] < hi]
        if ls:
            matched += ew[(lo, hi)] * np.mean([r["upset"] for r in ls])
    print(f"  spread-MATCHED later upset% (weighted to early's spread mix): {100*matched:.1f}%")

    print("\nB. Dog ATS cover rate (does the early market misprice dogs?):")
    for part in ("wk1-3", "wk4-8", "wk9+"):
        cov = [r["dog_cover"] for r in wkb[part] if r["dog_cover"] is not None]
        print(f"  {part:>7}: {100*np.mean(cov):5.1f}% dogs cover  (n={len(cov)})  "
              f"{'<- 52.4% breakeven' if 100*np.mean(cov) > 52.4 else ''}")


def test_C_nfl(path="data/games.csv"):
    g = pd.read_csv(path, low_memory=False).dropna(subset=["home_score", "away_score"])
    g = g[g.game_type == "REG"] if "game_type" in g.columns else g
    # long: one row per team-game with win flag + week
    recs = defaultdict(list)  # (season, team) -> [(week, win)]
    for _, r in g.iterrows():
        hw = 1 if r.home_score > r.away_score else 0
        recs[(int(r.season), r.home_team)].append((int(r.week), hw))
        recs[(int(r.season), r.away_team)].append((int(r.week), 1 - hw if r.home_score != r.away_score else 0))
    slow, slow_10 = 0, 0
    dist = defaultdict(int)
    for _, games in recs.items():
        games.sort()
        if len(games) < 10:
            continue
        first3 = [w for wk, w in games if wk <= 3]
        if len(first3) < 3:
            continue
        w3 = sum(first3)
        total = sum(w for _, w in games)
        if w3 <= 1:                      # started 1-2 or 0-3 (<=1 win in 3)
            slow += 1
            dist[total] += 1
            if total >= 10:
                slow_10 += 1
    print(f"\n{'='*72}\nC. NFL 'slow start, big finish' (teams with <=1 win through 3 games):")
    print(f"  {slow} such team-seasons; {slow_10} finished 10+ wins = {100*slow_10/max(1,slow):.1f}%")
    print("  final-win distribution:", dict(sorted(dist.items())))


def main():
    nfl = load_nfl()
    test_A_B("NFL", nfl)
    cfb = load_ncaaf()
    test_A_B("NCAAF", cfb)
    test_C_nfl()
    print("\nReading: if early upset% ~= spread-matched later%, early weeks aren't extra-chaotic "
          "at a given price -- the wider preseason lines already price the uncertainty.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
