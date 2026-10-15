"""Fit the NCAAF receptions mean->median conversion against GRADED RESULTS, and backtest it.

    python analysis/cfb_receptions_fit.py

WHY THIS EXISTS. `to_fifty_fifty` converts a projected mean to the point a player is as likely to
beat as not. Receptions has never shipped a conversion, and its docstring says exactly what was
missing: "the real fix needs median(actual) as a function of OUR mean, which cannot be fitted until
the pre-conversion `mu` is stored with each published row."

That blocker is gone, and for receptions it never applied: the conversion is OFF, so the published
`proj` IS the pre-conversion mean. Every graded receptions row is therefore already a (our mean,
what happened) pair — which is the fit, available now, with no new plumbing.

WHAT IT IS FIXING, measured on 655 graded rows (weeks 1-3, 5-6):

    line band    n    our proj   actual   actual clears OURS
    0-2.5      120      2.51      2.15         33.3%
    2.5-3.5    173      3.13      2.92         35.3%
    3.5-4.5    183      3.80      3.62         41.5%
    4.5+       179      4.99      5.25         48.6%

Fair is 50%. The board-wide mean error is -0.10 and says nothing, because the bands cancel — this
is a TILT, not a level, which is why the earlier flat-ratio attempt moved the average to 50 and
left the gradient untouched (EMPIRICAL_REFERENCE §13a). The gradient is the small-count mean/median
gap: at an expected 2.5 catches the median is 2, at 5.0 it is 5.

🚨 BANDED ON OUR OWN PROJECTION, NOT ON THE BOOK'S LINE. `to_fifty_fifty`'s existing markets are
fitted on bands of the LINE and then looked up with `mu`, and its own docstring calls that the
defect: the lookup lands a band too high exactly where the projection is most inflated. Banding on
our own number is both line-blind and self-consistent — the band that is fitted is the band that is
used.

TRAIN / TEST BY WEEK, because that is the split the model actually faces: fit on the earlier weeks,
score on the later ones. Pooling would let the confirmation weeks vote on their own ratio.
"""
from __future__ import annotations

import json
import os
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "web", "lib", "reportCards.ts")

# Bands on OUR projection. Matches PUBLISH_BANDS_BY_MARKET["receptions"] so a fitted curve drops
# straight in: the i-th ratio applies to projections in [BANDS[i], BANDS[i+1]).
BANDS = [0.0, 2.0, 3.0, 4.0, 5.0, 7.0]
TRAIN_WEEKS = {1, 2, 3}
TEST_WEEKS = {5, 6}
MIN_BAND = 25           # below this a band borrows its neighbour rather than fitting noise


def load():
    src = open(CARDS, encoding="utf-8").read().splitlines()
    start = next(i for i, l in enumerate(src) if "REPORT_CARDS" in l)
    cards = json.loads("\n".join(src[start:]).split("= ", 1)[1].rstrip().rstrip(";"))
    out = []
    for c in cards:
        if c.get("sport") != "ncaaf":
            continue
        for p in c.get("props", []):
            if (p.get("market") != "receptions" or p.get("actual") is None
                    or p.get("proj") is None or not p.get("line")):
                continue
            out.append({"week": c["week"], "proj": float(p["proj"]),
                        "line": float(p["line"]), "actual": float(p["actual"])})
    return out


def band_of(proj):
    i = 0
    while i + 1 < len(BANDS) and proj >= BANDS[i + 1]:
        i += 1
    return i


def fit(rows):
    """One ratio per band: the r that puts the 50/50 point where it belongs.

    r = median(actual) / mean(proj) in the band. Using the MEDIAN of what happened is the whole
    point — the conversion exists to publish a median, so it is fitted against one.

    🚨 A MEDIAN OF A SMALL COUNT SNAPS TO AN INTEGER (§13k), so a band whose median lands exactly
    on 2 or 3 produces a ratio that jumps. Forced monotone afterwards for the same reason the other
    markets are: the mean/median gap can only shrink as the count rises, so a non-monotone fit is
    sampling noise and a monotone one cannot invert the curve.
    """
    ratios = {}
    for i in range(len(BANDS)):
        g = [r for r in rows if band_of(r["proj"]) == i]
        if len(g) < MIN_BAND:
            continue
        med = st.median([r["actual"] for r in g])
        mean_proj = st.mean(r["proj"] for r in g)
        ratios[i] = med / mean_proj if mean_proj else 1.0
    if not ratios:
        return None
    # Fill unfitted bands from the nearest fitted one, then force monotone non-decreasing.
    full = []
    for i in range(len(BANDS)):
        if i in ratios:
            full.append(ratios[i])
        else:
            near = min(ratios, key=lambda k: abs(k - i))
            full.append(ratios[near])
    for i in range(1, len(full)):
        full[i] = max(full[i], full[i - 1])
    return [round(x, 3) for x in full]


def score(rows, ratios, label):
    """Over-rate against OUR number per band, plus MAE. Fair is 50%."""
    conv = (lambda p: round(p * ratios[band_of(p)], 1)) if ratios else (lambda p: p)
    n = len(rows)
    over = sum(1 for r in rows if r["actual"] > conv(r["proj"]))
    mae = st.mean(abs(conv(r["proj"]) - r["actual"]) for r in rows)
    print(f"  {label:26s} n={n:4d}  actual clears ours {100.0 * over / n:5.1f}%  MAE {mae:5.3f}")
    for i in range(len(BANDS)):
        g = [r for r in rows if band_of(r["proj"]) == i]
        if len(g) < 15:
            continue
        o = 100.0 * sum(1 for r in g if r["actual"] > conv(r["proj"])) / len(g)
        hi = BANDS[i + 1] if i + 1 < len(BANDS) else 99
        print(f"       proj {BANDS[i]:.0f}-{hi:.0f}: n={len(g):3d}  over {o:5.1f}%"
              f"  mean ours {st.mean(conv(r['proj']) for r in g):4.2f}"
              f"  actual {st.mean(r['actual'] for r in g):4.2f}")
    return 100.0 * over / n, mae


def main():
    rows = load()
    tr = [r for r in rows if r["week"] in TRAIN_WEEKS]
    te = [r for r in rows if r["week"] in TEST_WEEKS]
    print(f"graded rows {len(rows)}   train {len(tr)} (weeks {sorted(TRAIN_WEEKS)})"
          f"   test {len(te)} (weeks {sorted(TEST_WEEKS)})\n")

    fitted = fit(tr)
    # The curve already prepared in cfb_player_proj.py behind CFB_RECEPTIONS=on, scored here for
    # the first time — it was committed "gated until backtested" and never backtested.
    prepared = [0.852, 0.852, 0.876, 0.876, 0.905, 0.905]
    print(f"fitted on TRAIN: {fitted}")
    print(f"prepared (gated): {prepared}\n")

    print("TRAIN")
    for lab, r in (("no conversion (ships)", None), ("prepared curve", prepared),
                   ("fitted curve", fitted)):
        score(tr, r, lab)
    print("\nHELD-OUT")
    best = None
    for lab, r in (("no conversion (ships)", None), ("prepared curve", prepared),
                   ("fitted curve", fitted)):
        o, m = score(te, r, lab)
        if best is None or abs(o - 50) < abs(best[1] - 50):
            best = (lab, o, m)
    print(f"\nclosest to a fair 50% on held-out: {best[0]} ({best[1]:.1f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
