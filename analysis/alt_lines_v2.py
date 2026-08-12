"""
Alternate line ("buy points") fair-value engine -- corrected.

v1 used a +/-1.5 spread window, which put games with spreads of 3 into the
comparison set for a 4.5 line and produced a base cover rate of 53.9%. An
efficient line must sit near 50%. Tightening to +/-0.5 gives 50.3%. The error
was mine, not the market's, and the sanity check below now enforces it.

Approach:
  spreads -> tight conditional window (key numbers 3 and 7 matter, so the
             distribution must be conditioned on the actual spread)
  totals  -> error distribution (total_pts - total_line), which is centred and
             uses all 6,967 games; totals lack the strong key-number structure
             that spreads have
"""
import numpy as np
import pandas as pd


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna() & g.total_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    g["total_pts"] = g.home_score + g.away_score
    g["fav_mag"] = g.spread_line.abs()
    g["fav_margin"] = np.where(g.spread_line >= 0, g.margin, -g.margin)
    g["tot_err"] = g.total_pts - g.total_line
    return g


def prob_to_ml(p):
    if not (0 < p < 1):
        return None
    return -round(100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def fmt(ml):
    return f"{ml:+d}" if ml is not None else "n/a"


def ev(p, ml):
    payout = (100 / abs(ml)) if ml < 0 else (ml / 100)
    return p * payout - (1 - p)


def breakeven_price(p_alt, ev_target):
    """Price at which the alternate has the same EV as the base bet."""
    payout = (ev_target + 1 - p_alt) / p_alt
    return -round(100 / payout) if payout < 1 else round(100 * payout)


# ------------------------------------------------------------------- spreads
def dog_ladder(g, base, moves=(0, 1, 2, 3), window=0.5):
    s = g[(g.fav_mag >= base - window) & (g.fav_mag <= base + window)]
    fm = s.fav_margin.values
    rows = []
    for m in moves:
        L = base + m
        win = (fm < L).mean()
        push = (fm == L).mean() if float(L).is_integer() else 0.0
        rows.append(dict(line=L, move=m, p=win / (1 - push), push=push, n=len(fm)))
    return rows


# -------------------------------------------------------------------- totals
def over_ladder(g, base, moves=(0, 1, 2, 3)):
    e = g.tot_err.values          # centred error distribution, full sample
    rows = []
    for m in moves:
        L = base - m              # buying the over DOWN
        thresh = L - base         # need total_pts > L  <=>  err > L - base
        win = (e > thresh).mean()
        push = (e == thresh).mean()
        rows.append(dict(line=L, move=m, p=win / (1 - push), push=push, n=len(e)))
    return rows


def report(title, rows, label, base_price=-110, sanity=True):
    print(f"\n{title}")
    p0 = rows[0]["p"]
    if sanity:
        ok = abs(p0 - 0.5) < 0.035
        print(f"  sanity check: base line P(win) = {100*p0:.1f}%  "
              f"{'OK (near 50%, line is efficient)' if ok else '<-- WINDOW BIAS'}")
    print(f"  comparison set n={rows[0]['n']:,}")
    base_ev = ev(p0, base_price)
    print(f"  base bet at {base_price}: EV = {100*base_ev:+.2f}% per $1 risked\n")
    print(f"  {'line':>14}{'P(win)':>9}{'fair price':>12}"
          f"{'gain':>9}{'break-even price':>19}")
    for r in rows:
        f = prob_to_ml(r["p"])
        if r["move"] == 0:
            print(f"  {label(r['line']):>14}{100*r['p']:>8.1f}%{fmt(f):>12}"
                  f"{'--':>9}{'(base)':>19}")
        else:
            be = breakeven_price(r["p"], base_ev)
            print(f"  {label(r['line']):>14}{100*r['p']:>8.1f}%{fmt(f):>12}"
                  f"{100*(r['p']-p0):>+8.1f}{fmt(be):>19}")
    print("\n  'break-even price' = the worst price at which the move is still")
    print("  as good as the base bet. If the book charges more, the move loses EV.")
    return rows


def main():
    g = load()
    print("=" * 80)
    print(f"ALTERNATE LINE FAIR VALUE  ({len(g):,} games, "
          f"{g.season.min()}-{g.season.max()})")
    print("=" * 80)

    print("\n" + "#" * 80)
    print("# EXAMPLE 1: Washington +4.5 -> +7.5   (WAS@PHI)")
    print("#" * 80)
    report("Buying points as the underdog from +4.5",
           dog_ladder(g, 4.5), lambda L: f"WAS +{L:g}")

    print("\n" + "#" * 80)
    print("# EXAMPLE 2: total 48.5 -> over 45.5")
    print("#" * 80)
    report("Buying the over down from 48.5",
           over_ladder(g, 48.5), lambda L: f"over {L:g}", sanity=True)

    print("\n" + "#" * 80)
    print("# THE KEY-NUMBER CONTRAST: +3 vs +4.5, same 1-point purchase")
    print("#" * 80)
    a = dog_ladder(g, 3.0, moves=(0, 1))
    b = dog_ladder(g, 4.5, moves=(0, 1))
    print(f"\n  from +3   to +4   : {100*(a[1]['p']-a[0]['p']):+.1f} pts of win prob"
          f"   (n={a[0]['n']:,})")
    print(f"  from +4.5 to +5.5 : {100*(b[1]['p']-b[0]['p']):+.1f} pts of win prob"
          f"   (n={b[0]['n']:,})")
    print("\n  The same one point is worth substantially more when it crosses 3.")
    print("  A flat 'buy points' price ignores this; your app should not.")


if __name__ == "__main__":
    main()
