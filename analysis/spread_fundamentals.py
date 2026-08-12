"""
Spread and total fundamentals for the Week 1 2026 board.

This does not predict games. It quantifies four things that are verifiable and
immediately useful to a spread/total bettor:

  A  Key numbers: the empirical margin distribution, conditional on the spread
  B  Push probability: at integer spreads you can tie. That changes EV.
  C  Half-point value: exactly what a -3 vs -3.5 is worth, in probability
  D  Base rates: do favorites/dogs/overs/unders show any real bias, with
     honest significance testing and a multiple-comparisons warning

Data: 6,967 regular-season games with closing spreads, 1999-2025.
"""
import numpy as np
import pandas as pd
from scipy import stats

BOARD = [
    ("NE@SEA",  "SEA", 3.5,  44.5),
    ("SF@LAR",  "LAR", 3.5,  48.5),
    ("ATL@PIT", "PIT", 3.0,  42.5),
    ("BAL@IND", "BAL", 3.5,  48.5),
    ("BUF@HOU", "BUF", 1.5,  44.5),
    ("CHI@CAR", "CHI", 2.5,  46.5),
    ("CLE@JAX", "JAX", 7.5,  40.5),
    ("NO@DET",  "DET", 7.0,  49.5),
    ("NYJ@TEN", "TEN", 3.0,  38.5),
    ("TB@CIN",  "CIN", 3.5,  51.5),
    ("ARI@LAC", "LAC", 10.5, 46.5),
    ("GB@MIN",  "GB",  1.5,  45.5),
    ("MIA@LV",  "LV",  3.5,  40.5),
    ("WAS@PHI", "PHI", 4.5,  47.5),
    ("DAL@NYG", "DAL", 2.5,  48.5),
    ("DEN@KC",  "KC",  3.0,  42.5),
]


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna() & g.total_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    g["total_pts"] = g.home_score + g.away_score
    g["fav_mag"] = g.spread_line.abs()
    g["fav_margin"] = np.where(g.spread_line >= 0, g.margin, -g.margin)
    g["ats"] = g.fav_margin - g.fav_mag          # >0 favorite covered
    g["ou"] = g.total_pts - g.total_line         # >0 over
    return g


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    return (c - h, c + h)


def section_a(g):
    print("=" * 86)
    print("A.  KEY NUMBERS - the empirical margin distribution")
    print("=" * 86)
    v = g.fav_margin.abs().value_counts(normalize=True).sort_index()
    top = v.sort_values(ascending=False).head(12)
    cum = 0
    print(f"  {'margin':>7}{'freq':>9}{'cumulative':>13}")
    for m in top.index:
        cum += v[m]
        print(f"  {int(m):>7}{100*v[m]:>8.2f}%{100*cum:>12.1f}%")
    print(f"\n  Margins of 3 or 7 alone account for "
          f"{100*(v.get(3,0)+v.get(7,0)):.1f}% of all games.")
    print("  This is why -2.5 / -3 / -3.5 are not small differences.")


def section_bc(g):
    print("\n" + "=" * 86)
    print("B + C.  PUSH RISK AND HALF-POINT VALUE, conditional on the spread")
    print("=" * 86)
    print("For each spread on your board: given a closing spread near this number,")
    print("how often does the margin land exactly there (push), and what is the")
    print("half point worth?\n")
    print(f"  {'spread':>7}{'n':>7}{'P(push)':>10}{'fav cover':>11}"
          f"{'-0.5 worth':>12}{'+0.5 worth':>12}")
    for mag in [1.5, 2.5, 3.0, 3.5, 4.5, 7.0, 7.5, 10.5]:
        s = g[(g.fav_mag >= mag - 0.75) & (g.fav_mag <= mag + 0.75)]
        n = len(s)
        if n < 100:
            s = g[(g.fav_mag >= mag - 1.5) & (g.fav_mag <= mag + 1.5)]
            n = len(s)
        # push only possible at integer spreads
        push = (s.fav_margin == mag).mean() if float(mag).is_integer() else 0.0
        cover = (s.ats > 0).mean()
        # value of a half point in each direction: mass at the adjacent integers
        lo = int(np.floor(mag))
        hi = int(np.ceil(mag))
        gain_down = (s.fav_margin == lo).mean() if not float(mag).is_integer() else 0.0
        gain_up = (s.fav_margin == hi).mean() if not float(mag).is_integer() else 0.0
        # for integer spreads, moving off the number converts push->win or push->loss
        if float(mag).is_integer():
            gain_down = push       # -3 -> -2.5 turns the push into a win
            gain_up = push         # -3 -> -3.5 turns the push into a loss
        print(f"  {mag:>7.1f}{n:>7}{100*push:>9.1f}%{100*cover:>10.1f}%"
              f"{100*gain_down:>11.1f}%{100*gain_up:>11.1f}%")
    print("\n  Read: at spread 3, a push happens ~10% of the time. Buying to -2.5")
    print("  converts those pushes to wins; selling to -3.5 converts them to losses.")
    print("  That is the single largest half-point in football.")


def section_d(g):
    print("\n" + "=" * 86)
    print("D.  BASE RATES - does anything actually beat 50%?")
    print("=" * 86)
    print("Break-even at -110 is 52.38%. A base rate must clear that, and its")
    print("confidence interval must clear it too.\n")

    tests = []
    ats = g[g.ats != 0]
    tests.append(("Favorites ATS (all)", (ats.ats > 0).sum(), len(ats)))
    tests.append(("Underdogs ATS (all)", (ats.ats < 0).sum(), len(ats)))

    ou = g[g.ou != 0]
    tests.append(("Overs (all)", (ou.ou > 0).sum(), len(ou)))
    tests.append(("Unders (all)", (ou.ou < 0).sum(), len(ou)))

    hd = ats[ats.spread_line < 0]      # home team is the underdog
    tests.append(("Home underdogs ATS", (hd.margin + hd.fav_mag > 0).sum(), len(hd)))

    for lo, hi, lbl in [(0, 3.5, "spread 0-3.5"), (4, 7, "spread 4-7"),
                        (7.5, 13, "spread 7.5-13"), (13.5, 30, "spread 13.5+")]:
        s = ats[(ats.fav_mag >= lo) & (ats.fav_mag <= hi)]
        tests.append((f"Favorites ATS, {lbl}", (s.ats > 0).sum(), len(s)))

    for lo, hi, lbl in [(0, 40, "total <=40"), (40.5, 45, "total 40.5-45"),
                        (45.5, 50, "total 45.5-50"), (50.5, 70, "total 50.5+")]:
        s = ou[(ou.total_line >= lo) & (ou.total_line <= hi)]
        tests.append((f"Overs, {lbl}", (s.ou > 0).sum(), len(s)))

    w1 = g[g.week == 1]
    w1a = w1[w1.ats != 0]
    w1o = w1[w1.ou != 0]
    tests.append(("WEEK 1: favorites ATS", (w1a.ats > 0).sum(), len(w1a)))
    tests.append(("WEEK 1: overs", (w1o.ou > 0).sum(), len(w1o)))

    print(f"  {'test':<32}{'hit':>8}{'n':>7}{'rate':>8}{'95% CI':>18}  verdict")
    n_tests = len(tests)
    for lbl, k, n in tests:
        if n < 50:
            continue
        p = k / n
        lo_ci, hi_ci = wilson(k, n)
        beats = lo_ci > 0.5238
        verdict = "BEATS VIG" if beats else ("above 50%" if p > 0.5 else "-")
        print(f"  {lbl:<32}{k:>8}{n:>7}{100*p:>7.1f}%"
              f"{'['+f'{100*lo_ci:.1f}'+', '+f'{100*hi_ci:.1f}'+']':>18}  {verdict}")

    print(f"\n  {n_tests} tests run. At p<0.05 you expect "
          f"~{n_tests*0.05:.1f} false positives by chance alone.")
    print("  Any 'system' found here needs out-of-sample confirmation before use.")

    # Week 1 scoring vs rest of season
    print("\n" + "-" * 86)
    print("  Is Week 1 actually different?")
    w1p, rest = g[g.week == 1].total_pts, g[g.week > 1].total_pts
    t, pv = stats.ttest_ind(w1p, rest, equal_var=False)
    print(f"    Week 1 mean total points: {w1p.mean():.2f}  (n={len(w1p)})")
    print(f"    Weeks 2+  mean total points: {rest.mean():.2f}  (n={len(rest)})")
    print(f"    difference {w1p.mean()-rest.mean():+.2f} pts, p={pv:.3f}"
          f"  => {'significant' if pv < 0.05 else 'not significant'}")
    w1m = g[g.week == 1].ats.abs()
    rm = g[g.week > 1].ats.abs()
    t2, pv2 = stats.ttest_ind(w1m, rm, equal_var=False)
    print(f"\n    Mean |margin - spread| (how far off the line games land):")
    print(f"      Week 1: {w1m.mean():.2f}   Weeks 2+: {rm.mean():.2f}"
          f"   p={pv2:.3f} => {'significant' if pv2 < 0.05 else 'not significant'}")


def section_board(g):
    print("\n" + "=" * 86)
    print("YOUR WEEK 1 BOARD - push risk and where the half point matters most")
    print("=" * 86)
    print(f"  {'game':<10}{'line':>12}{'total':>7}{'P(push spr)':>13}"
          f"{'P(push tot)':>13}  note")
    rows = []
    for name, fav, mag, tot in BOARD:
        s = g[(g.fav_mag >= mag - 0.75) & (g.fav_mag <= mag + 0.75)]
        push_s = (s.fav_margin == mag).mean() if float(mag).is_integer() else 0.0
        st = g[(g.total_line >= tot - 1.5) & (g.total_line <= tot + 1.5)]
        push_t = (st.total_pts == tot).mean() if float(tot).is_integer() else 0.0
        note = ""
        if push_s > 0.08:
            note = "KEY NUMBER - half point is expensive here"
        elif float(mag).is_integer():
            note = "push possible"
        rows.append((name, push_s))
        print(f"  {name:<10}{fav+' -'+f'{mag:g}':>12}{tot:>7.1f}"
              f"{100*push_s:>12.1f}%{100*push_t:>12.1f}%  {note}")
    key = [r[0] for r in rows if r[1] > 0.08]
    print(f"\n  Games sitting ON a key number: {', '.join(key) if key else 'none'}")
    print("  For these, shopping for the extra half point is worth real money;")
    print("  for the -3.5 and -7.5 games it matters much less.")


if __name__ == "__main__":
    g = load()
    print(f"loaded {len(g):,} games, {g.season.min()}-{g.season.max()}\n")
    section_a(g)
    section_bc(g)
    section_d(g)
    section_board(g)
