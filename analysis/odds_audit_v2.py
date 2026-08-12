"""
NFL Week 1 2026 board audit, calibrated on 6,967 real games (1999-2025).

v1 of this script used a normal margin model and flagged 15 of 16 games as
"incoherent" -- because the MODEL was wrong, not the market. NFL margins are
not Gaussian (mass at 3 and 7), so a normal model understates favorite win
probability by 2-4 points at every spread. Replacing the assumption with the
empirical distribution is the whole fix.
"""
import numpy as np
import pandas as pd
from collections import defaultdict

# ------------------------------------------------- board (away first, as listed)
# (away, home, open_home_spread, home_spread, total, open_total, away_ml, home_ml)
BOARD = [
    ("NE",  "SEA", -3.5,  -3.5, 44.5, 44.5, +160, -192),
    ("SF",  "LAR", -2.5,  -3.5, 48.5, 48.5, +160, -192),
    ("ATL", "PIT", -3.0,  -3.0, 42.5, 42.5, +150, -180),
    ("BAL", "IND", +3.5,  +3.5, 48.5, 49.5, -180, +150),
    ("BUF", "HOU", +1.5,  +1.5, 44.5, 44.5, -120, +100),
    ("CHI", "CAR", +2.5,  +2.5, 46.5, 44.5, -148, +124),
    ("CLE", "JAX", -7.0,  -7.5, 40.5, 40.5, +300, -350),
    ("NO",  "DET", -7.0,  -7.0, 49.5, 48.5, +260, -325),
    ("NYJ", "TEN", -3.0,  -3.0, 38.5, 39.5, +124, -148),
    ("TB",  "CIN", -3.5,  -3.5, 51.5, 50.5, +170, -205),
    ("ARI", "LAC", -11.5, -10.5, 46.5, 45.5, +400, -535),
    ("GB",  "MIN", +1.5,  +1.5, 45.5, 44.5, -115, +105),
    ("MIA", "LV",  -3.0,  -3.5, 40.5, 41.5, +170, -205),
    ("WAS", "PHI", -5.5,  -4.5, 47.5, 46.5, +180, -218),
    ("DAL", "NYG", +2.5,  +2.5, 48.5, 48.5, -148, +124),
    ("DEN", "KC",  -2.5,  -3.0, 42.5, 42.5, +136, -162),
]


def ml_to_prob(ml):
    return (-ml) / (-ml + 100) if ml < 0 else 100 / (ml + 100)


def prob_to_ml(p):
    return -round(100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def devig(pa, ph):
    s = pa + ph
    return pa / s, ph / s, s - 1.0


# ------------------------------------------------------------- empirical curve
def load_hist():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna() & g.spread_line.notna()].copy()
    # nfldata spread_line: positive = home favored by that many
    g["margin"] = g.home_score - g.away_score
    g["fav_mag"] = g.spread_line.abs()
    # margin from the favorite's perspective
    g["fav_margin"] = np.where(g.spread_line >= 0, g.margin, -g.margin)
    return g


def empirical_winprob(g, mag, bw=1.0):
    """P(favorite wins outright | spread magnitude ~= mag), local window."""
    s = g[(g.fav_mag >= mag - bw) & (g.fav_mag <= mag + bw)]
    if len(s) < 120:
        s = g[(g.fav_mag >= mag - 2.5) & (g.fav_mag <= mag + 2.5)]
    wins = (s.fav_margin > 0).sum()
    ties = (s.fav_margin == 0).sum()
    n = len(s)
    return wins / (n - ties), n


def key_numbers(g):
    v = g.fav_margin.abs().value_counts(normalize=True).sort_index()
    return v


def main():
    g = load_hist()
    print("=" * 92)
    print(f"EMPIRICAL CALIBRATION  ({len(g):,} regular-season games, "
          f"{g.season.min()}-{g.season.max()})")
    print("=" * 92)
    kn = key_numbers(g)
    print("Most common absolute margins (this is why a normal model misprices):")
    for m in kn.sort_values(ascending=False).head(8).index:
        print(f"    margin {int(m):>2}: {100*kn[m]:>5.2f}% of games")
    print(f"\n  margin exactly 3: {100*kn.get(3,0):.2f}%   "
          f"exactly 7: {100*kn.get(7,0):.2f}%   "
          f"(a normal model spreads this mass smoothly and gets both wrong)")

    print("\nEmpirical P(favorite wins outright) by spread:")
    print(f"    {'spread':>7}{'emp P(win)':>13}{'n':>8}{'normal model':>15}")
    from scipy.stats import norm
    for mag in [1.5, 2.5, 3.0, 3.5, 4.5, 7.0, 7.5, 10.5]:
        p, n = empirical_winprob(g, mag)
        nm = norm.cdf(mag / 13.2)
        print(f"    {mag:>7.1f}{100*p:>12.1f}%{n:>8}{100*nm:>14.1f}%")
    print("\n  -> the normal model is low at every spread. It was my model that was")
    print("     wrong in v1, not the board.")

    # ------------------------------------------------------------ the audit
    print("\n" + "=" * 92)
    print("BOARD AUDIT")
    print("=" * 92)
    print(f"{'game':<11}{'favorite':>12}{'tot':>6}{'vig':>7}"
          f"{'ML fair':>9}{'empirical':>11}{'gap':>7}  flag")
    rows = []
    for (a, h, o_sp, sp, tot, o_tot, a_ml, h_ml) in BOARD:
        pa, ph = ml_to_prob(a_ml), ml_to_prob(h_ml)
        fa, fh, vig = devig(pa, ph)
        fav_home = sp < 0
        mag = abs(sp)
        p_ml = fh if fav_home else fa
        p_emp, n = empirical_winprob(g, mag)
        gap = p_ml - p_emp
        flag = ""
        if vig < 0.015 or vig > 0.065:
            flag += "VIG "
        if abs(gap) > 0.030:
            flag += "REVIEW"
        elif abs(gap) > 0.018:
            flag += "watch"
        fav = h if fav_home else a
        rows.append(dict(game=f"{a}@{h}", fav=fav, mag=mag, tot=tot, vig=vig,
                         p_ml=p_ml, p_emp=p_emp, gap=gap,
                         o_sp=o_sp, sp=sp, o_tot=o_tot, n=n))
        print(f"{a+'@'+h:<11}{fav+' -'+f'{mag:g}':>12}{tot:>6.1f}"
              f"{100*vig:>6.1f}%{100*p_ml:>8.1f}%{100*p_emp:>10.1f}%"
              f"{100*gap:>+6.1f}  {flag}")

    # -------------------------------------------- cross-game consistency
    print("\n" + "=" * 92)
    print("CROSS-GAME CONSISTENCY  (same spread => same win prob; "
          "lower total => favorite MORE likely)")
    print("=" * 92)
    by = defaultdict(list)
    for r in rows:
        by[r["mag"]].append(r)
    for mag, grp in sorted(by.items()):
        if len(grp) < 2:
            continue
        grp = sorted(grp, key=lambda x: x["tot"])
        print(f"\n  spread {mag:g}  (empirical baseline {100*grp[0]['p_emp']:.1f}%)")
        for r in grp:
            print(f"    {r['game']:<10} total {r['tot']:>5.1f}   "
                  f"ML implies {100*r['p_ml']:>5.1f}%")
        rng = max(x["p_ml"] for x in grp) - min(x["p_ml"] for x in grp)
        ordered = all(grp[i]["p_ml"] >= grp[i+1]["p_ml"] - 0.005
                      for i in range(len(grp)-1))
        verdict = "consistent" if rng < 0.025 and ordered else "INCONSISTENT"
        print(f"    -> range {100*rng:.1f} pts, variance ordering "
              f"{'OK' if ordered else 'VIOLATED'}  => {verdict}")

    # -------------------------------------------------------- line movement
    print("\n" + "=" * 92)
    print("LINE MOVEMENT  (open -> current)  -- free information on the board")
    print("=" * 92)
    moves = []
    for r in rows:
        d_sp = r["sp"] - r["o_sp"]
        d_tot = r["tot"] - r["o_tot"]
        if abs(d_sp) < 0.01 and abs(d_tot) < 0.01:
            continue
        parts = []
        if abs(d_sp) > 0.01:
            # did the line move toward or away from the favorite?
            toward_fav = (abs(r["sp"]) > abs(r["o_sp"]))
            parts.append(f"spread {r['o_sp']:+g} -> {r['sp']:+g} "
                         f"({'toward FAVORITE' if toward_fav else 'toward DOG'})")
        if abs(d_tot) > 0.01:
            parts.append(f"total {r['o_tot']:g} -> {r['tot']:g} "
                         f"({'up' if d_tot > 0 else 'down'})")
        moves.append((r["game"], "; ".join(parts)))
    for gname, txt in moves:
        print(f"  {gname:<11} {txt}")
    print(f"\n  {len(moves)} of {len(rows)} games have moved off their open.")

    # ------------------------------------------------------------ break-even
    print("\n" + "=" * 92)
    print("BREAK-EVEN REALITY CHECK")
    print("=" * 92)
    print(f"  spread at -110: need {100*ml_to_prob(-110):.2f}% (fair = 50.00%)"
          f"  => {100*(ml_to_prob(-110)-0.5):.2f} pts of edge required")
    print(f"  mean ML overround on this board: "
          f"{100*np.mean([r['vig'] for r in rows]):.2f}%")
    mx = max(rows, key=lambda r: abs(r["gap"]))
    print(f"  largest single ML/empirical gap: {mx['game']} "
          f"{100*mx['gap']:+.1f} pts")
    return rows


if __name__ == "__main__":
    main()
