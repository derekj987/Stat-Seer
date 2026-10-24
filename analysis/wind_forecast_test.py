"""
wind_forecast_test.py -- does the market price the wind it could SEE, or only the wind that
happened? The bet-time version of ATTRIBUTE_CATALOG's one live lead.

    python analysis/wind_forecast_build.py --seasons 2018-2025
    python analysis/wind_forecast_test.py

THE CLAIM BEING TESTED. The catalog measured the market under-setting totals by ~1.3 points at
15+ mph, 56.1% unders, n=647 -- using the wind RECORDED AT GAME TIME, which nobody can bet. It
named the honest version itself: "being better than the market at predicting where the forecast
lands." That splits into two questions this file answers separately, and conflating them is how a
hindsight edge gets mistaken for a real one:

  Q1  Does the market already price FORECAST wind?  Regress (actual total - closing total) on the
      forecast. A market that fully prices it leaves a coefficient of zero. This is the question
      that decides whether anything is tradeable.

  Q2  Is the realized-wind finding just forecast ERROR?  Split the high-realized-wind games into
      the ones that were FORECAST windy and the ones that blew up unexpectedly. If the edge lives
      only in the surprises, it is unbettable by construction -- nobody can bet a surprise.

🚨 THE PRIMARY TEST IS THRESHOLD-FREE ON PURPOSE. "15+ mph" was chosen on realized wind, and
re-picking a cutoff on forecast wind after seeing the data is how a dead signal comes back to life.
The regression uses every game; the bucket table is reported underneath as description, not as the
test.

🚨 AND THE FORECAST HERE IS OPTIMISTIC. The archived forecast is a SHORT lead -- nearer kickoff
than a bettor pricing the game days out. So a null result is strong (the market prices even a
better forecast than you would have had) and a positive is provisional (it would need a true
bet-time forecast before anyone acted). Stated again in the output so a reader cannot miss it.
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import statistics as st
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "wind_forecast.csv")


def ols(xs, ys):
    """slope, intercept, t-stat on the slope, r."""
    n = len(xs)
    mx, my = st.fmean(xs), st.fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx == 0:
        return 0.0, my, 0.0, 0.0
    b = sxy / sxx
    a = my - b * mx
    resid = [y - (a + b * x) for x, y in zip(xs, ys)]
    se = math.sqrt(sum(r * r for r in resid) / (n - 2) / sxx) if n > 2 else float("inf")
    sy = st.pstdev(ys)
    r = (sxy / n) / (st.pstdev(xs) * sy) if sy > 0 and st.pstdev(xs) > 0 else 0.0
    return b, a, (b / se if se else 0.0), r


def binom_p(k, n, p=0.5):
    """Two-sided exact-ish tail, normal approximation with continuity correction."""
    if n == 0:
        return 1.0
    z = (abs(k - n * p) - 0.5) / math.sqrt(n * p * (1 - p))
    return math.erfc(z / math.sqrt(2))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=DATA)
    args = ap.parse_args(argv)
    if not os.path.exists(args.csv):
        print(f"ERROR: {args.csv} missing — run analysis/wind_forecast_build.py first",
              file=sys.stderr)
        return 1
    with open(args.csv, encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("total") not in (None, "", "NA")]
    for r in rows:
        r["fc"] = float(r["fc_wind"]); r["ar"] = float(r["ar_wind"])
        r["line"] = float(r["total_line"]); r["tot"] = float(r["total"])
        r["resid"] = r["tot"] - r["line"]          # + = the game went OVER the closing number

    n = len(rows)
    seasons = sorted({r["season"] for r in rows})
    print(f"{n} outdoor games, {seasons[0]}-{seasons[-1]}, each with a closing total and a "
          f"forecast\n")

    print("FORECAST QUALITY (what a bettor could have known)")
    print(f"   forecast mean {st.fmean(r['fc'] for r in rows):.1f} mph, "
          f"realized mean {st.fmean(r['ar'] for r in rows):.1f} mph")
    print(f"   forecast MAE vs realized: {st.fmean(abs(r['fc'] - r['ar']) for r in rows):.2f} mph")
    print()

    # --- lead time: the question that decides whether any of this is tradeable ---
    # previous_dayN is the forecast for the SAME kickoff hour as it stood N days earlier
    # (verified: it is not a 24h lag of the series -- mean |difference| 2.56 mph, almost never
    # identical). A bettor pricing midweek holds roughly the d2/d3 column, not fc.
    # NB: `lead`, not `n` -- `n` is the row count used by the percentile cutoffs further down, and
    # shadowing it here silently turned the top-15% cutoff into the third-smallest value (0.2 mph
    # instead of 11.5), which quietly put every game in the "windy" group.
    leads = [("near kickoff", "fc")]
    for lead in (1, 2, 3):
        k = f"d{lead}"
        if any(r.get(f"fc_d{lead}") not in (None, "", "NA") for r in rows):
            for r in rows:
                v = r.get(f"fc_d{lead}")
                r[k] = float(v) if v not in (None, "", "NA") else None
            leads.append((f"~{lead} day(s) earlier", k))
    print("LEAD TIME — does the edge survive a forecast a bettor would actually have had?")
    print(f"   {'forecast issued':<22}{'n':>6}{'skill r':>10}{'MAE mph':>10}"
          f"{'slope':>10}{'t':>8}{'windy-group under':>20}")
    for label, key in leads:
        sel = [r for r in rows if r.get(key) is not None]
        if len(sel) < 100:
            continue
        xs = [r[key] for r in sel]
        skill, _a, _t, rr = ols(xs, [r["ar"] for r in sel])
        mae = st.fmean(abs(r[key] - r["ar"]) for r in sel)
        b, _a2, t2, _r2 = ols(xs, [r["resid"] for r in sel])
        cut = sorted(xs)[int(0.85 * len(sel))]
        g = [r for r in sel if r[key] >= cut and abs(r["resid"]) > 1e-9]
        u = sum(1 for r in g if r["resid"] < 0)
        print(f"   {label:<22}{len(sel):>6}{rr:>10.3f}{mae:>10.2f}{b:>10.4f}{t2:>8.2f}"
              f"{f'{u}-{len(g)-u} = {u/len(g):.1%}' if g else '--':>20}")
    print("   skill r / MAE are the forecast against what actually blew; slope and the windy group")
    print("   are against the market. Break-even on the under is 52.4%.")
    print()

    print("Q1. DOES THE MARKET PRICE THE FORECAST?  (actual total - closing total) ~ wind")
    print(f"   {'predictor':<22}{'slope (pts/mph)':>18}{'t':>8}{'r':>8}")
    for label, key in (("FORECAST wind", "fc"), ("realized wind", "ar")):
        b, _a, t, r = ols([x[key] for x in rows], [x["resid"] for x in rows])
        print(f"   {label:<22}{b:>18.4f}{t:>8.2f}{r:>8.3f}")
    print("   a market that fully prices wind leaves slope 0; negative = windier than priced"
          " -> under")
    print()

    print("Q2. IS THE EDGE IN THE FORECAST, OR ONLY IN THE SURPRISE?")
    # Split at the same quantile on each scale so the two groups are comparable in SIZE, rather
    # than at a number chosen on one of them.
    cut_f = sorted(r["fc"] for r in rows)[int(0.85 * n)]
    cut_a = sorted(r["ar"] for r in rows)[int(0.85 * n)]
    print(f"   top-15% cutoffs: forecast >= {cut_f:.1f} mph, realized >= {cut_a:.1f} mph")
    groups = {
        "forecast windy, and it was": [r for r in rows if r["fc"] >= cut_f and r["ar"] >= cut_a],
        "forecast windy, it was not": [r for r in rows if r["fc"] >= cut_f and r["ar"] < cut_a],
        "SURPRISE wind (not forecast)": [r for r in rows if r["fc"] < cut_f and r["ar"] >= cut_a],
        "calm by both": [r for r in rows if r["fc"] < cut_f and r["ar"] < cut_a],
    }
    print(f"   {'group':<32}{'n':>6}{'under %':>10}{'p':>8}{'mean total-line':>18}")
    for label, g in groups.items():
        if not g:
            continue
        dec = [r for r in g if abs(r["resid"]) > 1e-9]
        u = sum(1 for r in dec if r["resid"] < 0)
        print(f"   {label:<32}{len(g):>6}{(u / len(dec) if dec else 0):>9.1%}"
              f"{binom_p(u, len(dec)):>8.3f}{st.fmean(r['resid'] for r in g):>+18.2f}")
    print()

    print("DESCRIPTION ONLY — by forecast-wind bucket (NOT the test; the regression above is)")
    print(f"   {'forecast wind':<18}{'n':>6}{'under %':>10}{'mean total':>13}{'mean line':>12}")
    for lo, hi in ((0, 5), (5, 8), (8, 11), (11, 14), (14, 99)):
        g = [r for r in rows if lo <= r["fc"] < hi]
        if len(g) < 25:
            continue
        dec = [r for r in g if abs(r["resid"]) > 1e-9]
        u = sum(1 for r in dec if r["resid"] < 0)
        print(f"   {f'{lo}-{hi} mph':<18}{len(g):>6}{(u / len(dec) if dec else 0):>9.1%}"
              f"{st.fmean(r['tot'] for r in g):>13.1f}{st.fmean(r['line'] for r in g):>12.1f}")
    # --- the group a bettor could actually act on: FORECAST windy, whatever happened after ---
    print("THE BETTABLE GROUP — forecast windy at bet time, regardless of what blew")
    fw = [r for r in rows if r["fc"] >= cut_f]
    dec = [r for r in fw if abs(r["resid"]) > 1e-9]
    u = sum(1 for r in dec if r["resid"] < 0)
    print(f"   forecast >= {cut_f:.1f} mph: {u}-{len(dec) - u} to the under = "
          f"{u / len(dec):.1%}  (n={len(dec)}, p={binom_p(u, len(dec)):.4f})")
    print(f"   mean (total - line) in that group: {st.fmean(r['resid'] for r in fw):+.2f} points")
    print(f"   break-even is 52.4%; this group clears it by {u / len(dec) - 0.524:+.1%}")
    print()

    # --- the check that matters: does it hold on seasons the cutoff was not chosen on? ---
    print("HELD OUT — fit the cutoff on the EARLY seasons, test on the LATE ones")
    mid = seasons[len(seasons) // 2]
    tr = [r for r in rows if r["season"] < mid]
    te = [r for r in rows if r["season"] >= mid]
    cut_tr = sorted(r["fc"] for r in tr)[int(0.85 * len(tr))]
    print(f"   train {seasons[0]}-{int(mid) - 1} ({len(tr)} games) -> cutoff {cut_tr:.1f} mph")
    for label, g in (("train", tr), (f"HELD OUT {mid}-{seasons[-1]}", te)):
        sel = [r for r in g if r["fc"] >= cut_tr and abs(r["resid"]) > 1e-9]
        if not sel:
            continue
        uu = sum(1 for r in sel if r["resid"] < 0)
        b, _a, t, _r = ols([x["fc"] for x in g], [x["resid"] for x in g])
        print(f"   {label:<22} windy n={len(sel):>4}  under {uu / len(sel):>6.1%}  "
              f"p={binom_p(uu, len(sel)):.3f}   |  slope on ALL games {b:+.4f} (t={t:+.2f})")
    print()
    print("NOTE: the forecast used here is a SHORT lead. The CLOSING total it is compared against")
    print("  is also set near kickoff, so the two see similar information — but a bettor pricing")
    print("  days out would have a worse forecast than this. Break-even on a -110 total is 52.4%.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
