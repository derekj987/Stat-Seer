"""
Alternate line ("buy points") fair-value engine.

Books let you move a line and charge you for it. The app's job is NOT to say
"move it to +7.5" -- it is to say what that move is WORTH and whether the book
is charging more or less than fair.

Method: for a game with closing spread S, use the empirical margin distribution
from historically similar spreads to get P(cover) at any alternate line, then
convert to fair American odds. Same for totals.

Key point this quantifies: buying points changes VARIANCE, not EDGE. If you
have no edge at the base line you have no edge at the alternate either -- you
have paid to raise win probability and lower payout. Whether that is good or
bad depends entirely on the price versus fair.
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
    return g


def prob_to_ml(p):
    if p <= 0 or p >= 1:
        return None
    return -round(100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def fmt_ml(ml):
    return f"{ml:+d}" if ml is not None else "n/a"


def ev_at(p, ml):
    """EV per $1 risked at American odds ml with true win prob p (no pushes)."""
    payout = (100 / abs(ml)) if ml < 0 else (ml / 100)
    return p * payout - (1 - p)


# --------------------------------------------------------------- spread ladder
def spread_ladder(g, base_spread, dog_side=True, window=1.5, moves=(0, 1, 2, 3, 4)):
    """P(dog covers) at base and alternate lines, from similar historical games."""
    s = g[(g.fav_mag >= base_spread - window) & (g.fav_mag <= base_spread + window)]
    fm = s.fav_margin.values
    n = len(fm)
    out = []
    for m in moves:
        line = base_spread + m
        if dog_side:
            # dog +line covers when favourite's margin < line
            win = (fm < line).mean()
            push = (fm == line).mean() if float(line).is_integer() else 0.0
        else:
            win = (fm > line).mean()
            push = (fm == line).mean() if float(line).is_integer() else 0.0
        # exclude pushes from the win/loss decision
        p = win / (1 - push) if push < 1 else np.nan
        out.append(dict(line=line, move=m, p=p, push=push, n=n))
    return out


def total_ladder(g, base_total, over=True, window=2.5, moves=(0, 1, 2, 3, 4)):
    s = g[(g.total_line >= base_total - window) & (g.total_line <= base_total + window)]
    tp = s.total_pts.values
    n = len(tp)
    out = []
    for m in moves:
        line = base_total - m if over else base_total + m
        if over:
            win = (tp > line).mean()
        else:
            win = (tp < line).mean()
        push = (tp == line).mean() if float(line).is_integer() else 0.0
        p = win / (1 - push) if push < 1 else np.nan
        out.append(dict(line=line, move=m, p=p, push=push, n=n))
    return out


def show_spread(g, label, base, dog_team, base_price=-110):
    print(f"\n{label}")
    lad = spread_ladder(g, base, dog_side=True)
    p0 = lad[0]["p"]
    print(f"  historical comparison set: n={lad[0]['n']} games with spread "
          f"{base-1.5:g} to {base+1.5:g}")
    print(f"  {'line':>10}{'P(cover)':>11}{'fair odds':>12}"
          f"{'cost of move':>15}{'EV @ fair':>11}")
    for row in lad:
        ml = prob_to_ml(row["p"])
        cost = ""
        if row["move"] > 0:
            gain = row["p"] - p0
            cost = f"+{100*gain:.1f}pts win prob"
        print(f"  {dog_team}+{row['line']:<5g}{100*row['p']:>10.1f}%"
              f"{fmt_ml(ml):>12}{cost:>15}{'0.0%':>11}")
    return lad


def show_total(g, label, base, over=True):
    print(f"\n{label}")
    lad = total_ladder(g, base, over=over)
    p0 = lad[0]["p"]
    side = "over" if over else "under"
    print(f"  historical comparison set: n={lad[0]['n']} games with total "
          f"{base-2.5:g} to {base+2.5:g}")
    print(f"  {'line':>12}{'P(win)':>10}{'fair odds':>12}{'cost of move':>18}")
    for row in lad:
        ml = prob_to_ml(row["p"])
        cost = ""
        if row["move"] > 0:
            cost = f"+{100*(row['p']-p0):.1f}pts win prob"
        print(f"  {side} {row['line']:<6g}{100*row['p']:>9.1f}%"
              f"{fmt_ml(ml):>12}{cost:>18}")
    return lad


def breakeven_check(lad, base_price=-110):
    """What would you need the book to offer for the move to be EV-neutral?"""
    p0 = lad[0]["p"]
    ev0 = ev_at(p0, base_price)
    print(f"\n  Base bet at {base_price}: true P={100*p0:.1f}%, "
          f"EV = {100*ev0:+.2f}% per $1")
    print(f"  {'alternate':>12}{'fair odds':>12}{'break-even price':>19}"
          f"{'  <- book must beat this to be worth it'}")
    for row in lad[1:]:
        fair = prob_to_ml(row["p"])
        # price at which the alternate has the SAME EV as the base bet
        p = row["p"]
        # solve p*payout - (1-p) = ev0  ->  payout = (ev0 + 1 - p)/p
        payout = (ev0 + 1 - p) / p
        be_ml = -round(100 / payout) if payout < 1 else round(100 * payout)
        print(f"  {row['line']:>12g}{fmt_ml(fair):>12}{fmt_ml(be_ml):>19}")


def main():
    g = load()
    print("=" * 84)
    print(f"ALTERNATE LINE FAIR VALUE  ({len(g):,} games, "
          f"{g.season.min()}-{g.season.max()})")
    print("=" * 84)

    print("\n" + "#" * 84)
    print("# YOUR EXAMPLE 1: Washington +4.5 -> +7.5  (WAS@PHI)")
    print("#" * 84)
    lad = show_spread(g, "Washington as the underdog, base line +4.5", 4.5, "WAS")
    breakeven_check(lad)

    print("\n" + "#" * 84)
    print("# YOUR EXAMPLE 2: total 48.5 -> over 45.5")
    print("#" * 84)
    lad2 = show_total(g, "Buying the over down from 48.5", 48.5, over=True)
    breakeven_check(lad2)

    print("\n" + "#" * 84)
    print("# THE KEY-NUMBER CASE: why -3 is different (DEN@KC, ATL@PIT, NYJ@TEN)")
    print("#" * 84)
    lad3 = show_spread(g, "Underdog +3, buying up", 3.0, "DOG")
    print("\n  Note the jump from +3 to +4: that half-and-half point crosses the")
    print("  most common margin in football. Compare to the +4.5 ladder above,")
    print("  where the same 1-point move buys much less.")

    print("\n" + "=" * 84)
    print("WHAT THIS MEANS FOR THE FEATURE")
    print("=" * 84)
    print("""
  Buying points raises win probability and lowers payout. Fair pricing makes it
  EV-neutral; the book adds vig on top, which makes it EV-NEGATIVE by default.

  So the honest feature is NOT "we think you should move this to +7.5."
  It is:

      base line  WAS +4.5   -110      true 60.6%   EV -5.2%
      alternate  WAS +7.5   book -240  fair -154   OVERPRICED by 86c

  ...or, when the book is generous:

      alternate  WAS +7.5   book -140  fair -154   UNDERPRICED - worth taking

  The app's value is the fair-price column. That is a computation users cannot
  do themselves and can verify after the fact. Recommending a move without
  showing the price is recommending a worse bet.
""")


if __name__ == "__main__":
    main()
