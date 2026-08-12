"""
NFL Week 1 2026 - odds board coherence audit.

This does NOT predict games. It audits the BOARD for internal inconsistency,
which is the one edge available without a game model: find where the market
disagrees with ITSELF.

Four checks:
  C1  two-way moneyline overround (is the vig plausible?)
  C2  spread <-> moneyline coherence (do the two markets imply the same team strength?)
  C3  cross-game consistency (identical spread+total should imply identical ML)
  C4  line movement open -> current (real information, free on the board)

TRANSCRIPTION WARNING: the board below was read off a screenshot by eye.
Treat every number as suspect until re-pulled from an API. See notes at bottom.
"""
import numpy as np
from scipy.stats import norm

# ---------------------------------------------------------------- the board
# (away, home, open_home_spread, home_spread, home_spread_px, away_spread_px,
#  total, open_total, away_ml, home_ml)
BOARD = [
    ("NE",  "SEA", -3.5,  -3.5, -110, -110, 44.5, 44.5,  160, -192),
    ("SF",  "LAR", -2.5,  -3.5, -110, -120, 48.5, 48.5,  160, -192),
    ("ATL", "PIT", -3.0,  -3.0, -120, +100, 42.5, 42.5,  150, -180),
    ("BAL", "IND", +3.5,  +3.5, -110, -110, 48.5, 49.5,  150, -180),  # BAL fav
    ("BUF", "HOU", +1.5,  +1.5, -112, -108, 44.5, 44.5,  100, -120),  # BUF fav
    ("CHI", "CAR", +2.5,  +2.5, -102, -118, 46.5, 44.5,  124, -148),  # CHI fav
    ("CLE", "JAX", -7.0,  -7.5, -110, -110, 40.5, 40.5,  300, -350),
    ("NO",  "DET", -7.0,  -7.0, -110, -110, 49.5, 48.5,  260, -325),
    ("NYJ", "TEN", -3.0,  -3.0, +100, -110, 38.5, 39.5,  124, -148),
    ("TB",  "CIN", -3.5,  -3.5, -115, -105, 51.5, 50.5,  170, -205),
    ("ARI", "LAC", -11.5, -10.5, -110, -110, 46.5, 45.5,  400, -535),
    ("GB",  "MIN", +1.5,  +1.5, -120, +100, 45.5, 44.5,  105, -115),  # GB fav
    ("MIA", "LV",  -3.0,  -3.5, -110, -110, 40.5, 41.5,  170, -205),
    ("WAS", "PHI", -5.5,  -4.5, -110, -110, 47.5, 46.5,  180, -218),
    ("DAL", "NYG", +2.5,  +2.5, -105, -115, 48.5, 48.5,  124, -148),  # DAL fav
    ("DEN", "KC",  -2.5,  -3.0, -110, -110, 42.5, 42.5,  136, -162),
]

SIGMA_BASE = 13.2      # NFL margin SD, well-established
TOTAL_REF = 44.5       # reference total for variance scaling
TIE_RATE = 0.002


def ml_to_prob(ml):
    return (-ml) / (-ml + 100) if ml < 0 else 100 / (ml + 100)


def prob_to_ml(p):
    if p >= 0.5:
        return -round(100 * p / (1 - p))
    return round(100 * (1 - p) / p)


def devig(p_a, p_b):
    """Multiplicative (proportional) de-vig."""
    s = p_a + p_b
    return p_a / s, p_b / s, s - 1.0


def sigma_for(total):
    """Margin SD scales with sqrt of expected scoring."""
    return SIGMA_BASE * np.sqrt(total / TOTAL_REF)


def spread_to_fav_winprob(spread_mag, total):
    """P(favorite wins outright) implied by the spread, under a normal margin."""
    s = sigma_for(total)
    p = norm.cdf(spread_mag / s)
    return (p - TIE_RATE / 2) / (1 - TIE_RATE)


def run():
    print("=" * 88)
    print("C1 + C2  MONEYLINE VIG  and  SPREAD <-> MONEYLINE COHERENCE")
    print("=" * 88)
    print(f"{'game':<12}{'line':>10}{'tot':>6}{'vig':>7}"
          f"{'ML fair':>9}{'spread implies':>15}{'gap':>8}  flag")
    rows = []
    for (a, h, o_sp, sp, hpx, apx, tot, o_tot, a_ml, h_ml) in BOARD:
        pa, ph = ml_to_prob(a_ml), ml_to_prob(h_ml)
        fa, fh, vig = devig(pa, ph)
        fav_is_home = sp < 0
        mag = abs(sp)
        p_fav_ml = fh if fav_is_home else fa
        p_fav_sp = spread_to_fav_winprob(mag, tot)
        gap = p_fav_ml - p_fav_sp
        flag = ""
        if abs(vig) > 0.06 or vig < 0.015:
            flag += "VIG? "
        if abs(gap) > 0.020:
            flag += "INCOHERENT"
        elif abs(gap) > 0.012:
            flag += "watch"
        fav = h if fav_is_home else a
        rows.append(dict(game=f"{a}@{h}", fav=fav, mag=mag, tot=tot,
                         p_ml=p_fav_ml, p_sp=p_fav_sp, gap=gap, vig=vig,
                         o_sp=o_sp, sp=sp, o_tot=o_tot))
        print(f"{a+'@'+h:<12}{fav+' -'+str(mag):>10}{tot:>6.1f}"
              f"{100*vig:>6.1f}%{100*p_fav_ml:>8.1f}%{100*p_fav_sp:>14.1f}%"
              f"{100*gap:>+7.1f}  {flag}")

    print("\n  'ML fair' = de-vigged moneyline win prob for the favorite.")
    print("  'spread implies' = win prob from the spread under a normal margin")
    print(f"  model (sigma={SIGMA_BASE} scaled by total). Gap > 2pts = the two")
    print("  markets disagree about the same team.")

    # ------------------------------------------------ C3 cross-game consistency
    print("\n" + "=" * 88)
    print("C3  CROSS-GAME CONSISTENCY")
    print("=" * 88)
    print("Games with the SAME spread should imply near-identical win prob.")
    print("Lower total => less variance => favorite should be MORE likely to win.\n")
    from collections import defaultdict
    by_spread = defaultdict(list)
    for r in rows:
        by_spread[r["mag"]].append(r)
    for mag, grp in sorted(by_spread.items()):
        if len(grp) < 2:
            continue
        print(f"  spread {mag}:")
        grp = sorted(grp, key=lambda x: x["tot"])
        for r in grp:
            print(f"    {r['game']:<10} total {r['tot']:>5.1f}  "
                  f"ML implies {100*r['p_ml']:>5.1f}%   "
                  f"spread implies {100*r['p_sp']:>5.1f}%")
        spread_range = max(x["p_ml"] for x in grp) - min(x["p_ml"] for x in grp)
        # correct ordering: lowest total should have the HIGHEST p_ml
        ordered = all(grp[i]["p_ml"] >= grp[i + 1]["p_ml"] for i in range(len(grp) - 1))
        print(f"    -> ML spread across identical lines: {100*spread_range:.1f} pts"
              f"   variance ordering: {'OK' if ordered else 'VIOLATED'}\n")

    # ------------------------------------------------------ C4 line movement
    print("=" * 88)
    print("C4  LINE MOVEMENT  (open -> current)")
    print("=" * 88)
    print(f"{'game':<12}{'spread move':>26}{'total move':>18}")
    for r in rows:
        d_sp = r["sp"] - r["o_sp"]
        d_tot = r["tot"] - r["o_tot"]
        if abs(d_sp) < 0.01 and abs(d_tot) < 0.01:
            continue
        sp_txt = ""
        if abs(d_sp) > 0.01:
            direction = "toward FAV" if (d_sp < 0) == (r["sp"] < 0) else "toward DOG"
            sp_txt = f"{r['o_sp']:+.1f} -> {r['sp']:+.1f}  ({direction})"
        tot_txt = f"{r['o_tot']:.1f} -> {r['tot']:.1f}" if abs(d_tot) > 0.01 else ""
        print(f"{r['game']:<12}{sp_txt:>26}{tot_txt:>18}")

    # ------------------------------------------------------------ break-even
    print("\n" + "=" * 88)
    print("BREAK-EVEN REALITY CHECK")
    print("=" * 88)
    for px in (-110, -105, -115, -120):
        print(f"  at {px}: you must win {100*ml_to_prob(px):.2f}% "
              f"to break even (fair coin = 50.00%)")
    avg_vig = np.mean([r["vig"] for r in rows])
    print(f"\n  mean two-way ML overround on this board: {100*avg_vig:.2f}%")
    print(f"  => average edge you must find just to break even on ML: "
          f"{100*avg_vig/2:.2f} pts of win probability")
    return rows


if __name__ == "__main__":
    run()
