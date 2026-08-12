"""
Parlay mathematics: what actually happens when you combine legs.

The intuition being tested: "if you combine enough high-confidence bets, you get
good odds."

Key identity. For a parlay of n independent legs, each with true win probability
p_i and offered decimal odds d_i:

    parlay EV = PROD(p_i * d_i) - 1 = PROD(1 + EV_i) - 1

So parlay EV is a PRODUCT of per-leg EVs. Parlays do not create edge -- they
multiply whatever per-leg edge exists. Which cuts both ways, and that is the
part worth understanding precisely.
"""
import numpy as np
from itertools import product


def dec(ml):
    return 1 + (100 / abs(ml)) if ml < 0 else 1 + (ml / 100)


def ml_from_dec(d):
    if d >= 2:
        return f"+{round((d - 1) * 100)}"
    return f"-{round(100 / (d - 1))}"


def section1():
    print("=" * 80)
    print("1.  EV COMPOUNDING  -- the per-leg deficit multiplies")
    print("=" * 80)
    print("Each cell = parlay EV per $1 risked.\n")
    legs = [1, 2, 3, 4, 5, 6, 8, 10]
    evs = [-0.0526, -0.0300, 0.0, +0.0200, +0.0300]
    labels = ["-110 no edge", "small -EV", "exactly fair", "+2% edge", "+3% edge"]
    print(f"  {'per-leg':<16}" + "".join(f"{n:>9}" for n in legs))
    print(f"  {'':<16}" + "".join(f"{'legs':>9}" for n in legs))
    for e, lab in zip(evs, labels):
        row = "".join(f"{100*((1+e)**n - 1):>8.1f}%" for n in legs)
        print(f"  {lab:<16}{row}")
    print("""
  Read the top row. A standard -110 bet with no edge is -5.26% EV. Parlay ten of
  them and you are at -41.6%. The vig compounds multiplicatively -- every leg you
  add multiplies your disadvantage.

  Read the bottom row. Genuinely +EV legs compound the other way. So the intuition
  is not wrong in form -- it is wrong about the sign. Parlays are leverage. They
  amplify whatever you already have.""")


def section2():
    print("\n" + "=" * 80)
    print("2.  THE BOUGHT-POINTS PARLAY  -- your WAS +7.5 example")
    print("=" * 80)
    p_base, ml_base = 0.497, 101         # WAS +4.5 at +101 (fair)
    p_alt = 0.615                        # WAS +7.5, true prob
    fair_alt = -160
    print(f"  base leg   : WAS +4.5   true {100*p_base:.1f}%   at {ml_base:+d}")
    print(f"  bought leg : WAS +7.5   true {100*p_alt:.1f}%   fair {fair_alt}")
    print()
    print(f"  {'book price':>12}{'leg EV':>10}{'2-leg':>10}{'3-leg':>10}"
          f"{'4-leg':>10}{'6-leg':>10}")
    for book in (-160, -175, -184, -200, -240):
        e = p_alt * dec(book) - 1
        cells = "".join(f"{100*((1+e)**n - 1):>9.1f}%" for n in (2, 3, 4, 6))
        print(f"  {book:>12}{100*e:>9.2f}%{cells}")
    print("""
  At fair (-160) the legs are EV-neutral and so is the parlay, at any length.
  At -184 each leg is -5.3% and a 4-leg parlay is -19.4%.
  At -240 each leg is -13.1% and a 4-leg parlay is -42.8%.

  Raising each leg to 61.5% did not help. The probability gain is already paid
  for in the price. Confidence per leg is not the variable -- price versus fair
  is the only variable.""")


def section3():
    print("\n" + "=" * 80)
    print("3.  WHY THE PAYOUT LOOKS GENEROUS BUT IS NOT")
    print("=" * 80)
    p = 0.615
    for n in (2, 3, 4, 5, 6):
        true_p = p ** n
        fair_dec = 1 / true_p
        book_dec = dec(-184) ** n
        print(f"  {n}-leg at 61.5% each: true prob {100*true_p:>5.2f}%  "
              f"fair {ml_from_dec(fair_dec):>7}  book pays "
              f"{ml_from_dec(book_dec):>7}  "
              f"shortfall {100*(book_dec/fair_dec - 1):>+6.1f}%")
    print("""
  The big number next to a parlay is not a bonus. It is the fair price of a long
  shot, minus vig, compounded. A 5-leg parlay paying +773 against a fair price of
  +989 is the same bet as a straight wager at -184 against a fair -160 -- just
  five times more so.""")


def section4():
    print("\n" + "=" * 80)
    print("4.  WHERE PARLAYS GENUINELY BECOME +EV: CORRELATION MISPRICING")
    print("=" * 80)
    print("""  Books often price same-game legs as if independent. When legs are
  positively correlated, true joint probability EXCEEDS the product -- so the
  book's price is too long and the parlay is underpriced.

  Illustration: two legs each at 55% true probability, priced independently.""")
    p1 = p2 = 0.55
    indep = p1 * p2
    print(f"\n  {'correlation':>13}{'true joint P':>15}{'book implied':>15}"
          f"{'edge vs book':>15}")
    for rho in (0.0, 0.15, 0.30, 0.45, 0.60):
        # joint probability for two binaries with given phi correlation
        joint = indep + rho * np.sqrt(p1 * (1 - p1) * p2 * (1 - p2))
        edge = joint / indep - 1
        print(f"  {rho:>13.2f}{100*joint:>14.1f}%{100*indep:>14.1f}%"
              f"{100*edge:>14.1f}%")
    print("""
  At rho = 0.30 the true joint probability is 24% higher than the book's implied
  number. That can overcome a substantial vig. This is a real, documented edge
  and it is the same idea as the coherence detector: find where the book
  disagrees with itself, here about dependence between its own markets.

  Note the reverse also holds. NEGATIVELY correlated legs (e.g. both teams'
  players going over in a low-scoring game) are OVERPRICED as parlays, and
  books happily sell those.""")


def section5():
    print("\n" + "=" * 80)
    print("5.  PRODUCT IMPLICATION")
    print("=" * 80)
    print("""  A parlay recommender is only defensible if it can show, per leg,
  that the price beats fair -- and can estimate correlation between legs. Absent
  both, recommending parlays of near-fair legs makes users lose faster with the
  app's endorsement attached, which is the opposite of the stated goal.

  Two things worth knowing about the category:
    - Parlay hold for books runs far above straight-bet hold. That is why
      parlays are promoted so heavily.
    - Parlay volume is disproportionately associated with problem gambling.
      An app whose differentiator is trust has to decide deliberately how it
      handles this, not by default.

  The defensible version of the feature:
    - compute and display fair price per leg, flag overpriced legs
    - estimate leg correlation and show whether the combination is under or
      overpriced versus the book's implied independence
    - show the true probability of the full parlay next to the payout
    - never present a longer parlay as higher confidence""")


if __name__ == "__main__":
    section1()
    section2()
    section3()
    section4()
    section5()
