"""
cfb_card_backtest.py -- score the number the CARD actually publishes, against results.

cfb_ats.py scores the RAW rating (ratings[home] - ratings[away] + hfa). The board does not
publish that: build_card runs it through CARD_SCALE, a market anchor on big spreads, and a
per-slate de-bias. None of that had ever been scored, so the number members read had no
measured record of its own -- only the rating underneath it did.

Written for one question (EMPIRICAL_REFERENCE §13e): the card inflates HOME FAVOURITES by a
median 4.10 points against the market while leaving away favourites flat at -0.20, and the
suspect is HFA sitting INSIDE the scaled term --

    m = CARD_SCALE * (rh - ra + hfa)        # effective home edge 1.33 * 3.2 = 4.26

so the de-compression meant to widen margins is also inflating home advantage by a third.
`--hfa-outside` scales only the rating difference and adds HFA after it.

🚨 This mirrors build_card's arithmetic step for step, including the anchor and BOTH de-bias
passes, because a validator that predicts differently from production is measuring a model
nobody ships -- which is exactly how the NFL backtest reported a model that was not ours
(grade_predictions, same repo). Any change to anchored_margin must be made here too.

    python analysis/cfb_card_backtest.py --start 2021 --end 2025
    python analysis/cfb_card_backtest.py --start 2021 --end 2025 --hfa-outside
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from cfb_ats import load                      # noqa: E402  (same game loader + line convention)
from cfb_power import fit_ratings             # noqa: E402
import cfb_export as ce                       # noqa: E402  (CARD_SCALE, ANCHOR_*, DISPLAY_CAP)


def card_margin(rh, ra, neu, hfa, hsp, hfa_outside):
    """build_card.anchored_margin, verbatim apart from the flag."""
    core = (rh - ra) if neu else (rh - ra + hfa)
    if hfa_outside:
        core = ce.CARD_SCALE * (rh - ra) + (0.0 if neu else hfa)
    else:
        core = ce.CARD_SCALE * core
    m = max(-ce.DISPLAY_CAP, min(ce.DISPLAY_CAP, core))
    if hsp is not None:
        line = abs(float(hsp))
        w = 0.0 if line <= ce.ANCHOR_LO else min(
            ce.ANCHOR_MAX, ce.ANCHOR_MAX * (line - ce.ANCHOR_LO) / (ce.ANCHOR_HI - ce.ANCHOR_LO))
        if w > 0.0:
            m = max(-ce.DISPLAY_CAP, min(ce.DISPLAY_CAP, (1.0 - w) * m + w * (-float(hsp))))
    return m


def run(games, lam, cap, from_week, decay, hfa_outside, debias_mode="market"):
    """Walk-forward exactly as cfb_ats does; score the CARD margin per slate.

    `debias_mode` picks what the big-spread correction is centred on:
      "market"  — production: the median of (ours − market) over THIS slate's anchored games.
      "none"    — no correction, so the anchor alone carries it.
      "results" — the median of (ours − ACTUAL) over anchored games already PLAYED. Strictly
                  out of sample: only weeks before the one being predicted feed it, which is the
                  whole difficulty — on the live board the result does not exist yet, so this
                  variant has to earn its place against a market number that is available now.
    """
    rows = []
    prior = {}
    hist = []            # (pred_before_debias − actual) on anchored games, past weeks only
    for s in sorted({g["season"] for g in games}):
        sg = [g for g in games if g["season"] == s]
        for w in sorted({g["week"] for g in sg if g["week"] >= from_week}):
            train = [g for g in sg if g["week"] < w]
            test = [g for g in sg if g["week"] == w]
            if len(train) < 50:
                continue
            ratings, hfa = fit_ratings(train, lam, cap, prior)
            slate = [g for g in test if g["home"] in ratings and g["away"] in ratings]
            if not slate:
                continue
            raw = {id(g): card_margin(ratings[g["home"]], ratings[g["away"]], g["neutral"], hfa,
                                      g["spread"], hfa_outside) for g in slate}
            anch = [g for g in slate if abs(float(g["spread"])) > ce.ANCHOR_LO]
            # "fav"/"favside" centre in FAVOURITE space instead of home-margin space. The shipped
            # correction subtracts a constant from the home margin, which SHRINKS a home favourite
            # and GROWS an away one — so a single constant pushes the two groups in opposite
            # directions on "does the favourite cover", and no value of it can centre both.
            fav_d = {}
            if debias_mode in ("fav", "favside"):
                def fr(g):
                    return abs(raw[id(g)]) - abs(float(g["spread"]))
                if debias_mode == "fav":
                    v = statistics.median([fr(g) for g in anch]) if anch else 0.0
                    fav_d = {"h": v, "a": v}
                else:
                    h = [fr(g) for g in anch if float(g["spread"]) < 0]
                    a = [fr(g) for g in anch if float(g["spread"]) > 0]
                    fav_d = {"h": statistics.median(h) if h else 0.0,
                             "a": statistics.median(a) if a else 0.0}
                debias = 0.0
            elif debias_mode == "none":
                debias = 0.0
            elif debias_mode == "results":
                debias = statistics.median(hist) if len(hist) >= 30 else 0.0
            else:
                debias = statistics.median([raw[id(g)] - (-float(g["spread"])) for g in anch]) \
                    if anch else 0.0
            for g in slate:
                m = raw[id(g)]
                if abs(float(g["spread"])) > ce.ANCHOR_LO:
                    if fav_d:
                        d = fav_d["h"] if float(g["spread"]) < 0 else fav_d["a"]
                        mag = max(0.0, abs(m) - d)          # correct the FAVOURITE's margin
                        m = mag if m >= 0 else -mag          # ...keeping the side we picked
                    else:
                        m = m - debias
                    m = max(-ce.DISPLAY_CAP, min(ce.DISPLAY_CAP, m))
                rows.append({"pred": m, "actual": float(g["margin"]),
                             "spread": float(g["spread"]), "neutral": g["neutral"],
                             "anchored": abs(float(g["spread"])) > ce.ANCHOR_LO})
            # only AFTER predicting does this week's truth become usable
            hist += [raw[id(g)] - float(g["margin"]) for g in anch]
        final, _ = fit_ratings(sg, lam, cap, prior)
        prior = {t: decay * r for t, r in final.items()}
    return rows


def report(rows, label):
    mae = statistics.mean(abs(r["pred"] - r["actual"]) for r in rows)
    bias = statistics.mean(r["pred"] - r["actual"] for r in rows)
    book_mae = statistics.mean(abs(-r["spread"] - r["actual"]) for r in rows)
    # the §13e split: |ours| vs |market| by which side the MARKET favours
    hf = [abs(r["pred"]) - abs(r["spread"]) for r in rows if r["spread"] < 0]
    af = [abs(r["pred"]) - abs(r["spread"]) for r in rows if r["spread"] > 0]
    # ATS on every game (edge = pred + spread, home basis)
    w = l = 0
    for r in rows:
        edge, cover = r["pred"] + r["spread"], r["actual"] + r["spread"]
        if cover == 0 or edge == 0:
            continue
        w += (edge > 0) == (cover > 0)
        l += (edge > 0) != (cover > 0)
    ats = 100.0 * w / max(w + l, 1)
    # The thing the de-bias exists for: on ANCHORED (big-spread) games it should not read
    # "dog covers" far more often than dogs actually cover. Both numbers on the same games.
    anch = [r for r in rows if r.get("anchored")]
    def fav_cover(v, r):
        return (v + r["spread"] > 0) if r["spread"] < 0 else (v + r["spread"] < 0)
    proj_fc = 100.0 * sum(fav_cover(r["pred"], r) for r in anch) / max(len(anch), 1)
    real_fc = 100.0 * sum(fav_cover(r["actual"], r) for r in anch) / max(len(anch), 1)
    print(f"  {label:16} n={len(rows):5}  MAE {mae:6.2f} (book {book_mae:5.2f})  bias {bias:+6.2f}  "
          f"ATS {ats:5.1f}%   home-fav infl {statistics.median(hf):+5.2f}  "
          f"away-fav {statistics.median(af):+5.2f}   big-spread: we say fav covers "
          f"{proj_fc:4.1f}% vs {real_fc:4.1f}% actual (n={len(anch)})")
    return mae


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2021)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--cap", type=int, default=28)
    ap.add_argument("--lam", type=float, default=5.0)
    ap.add_argument("--from-week", type=int, default=6)
    ap.add_argument("--decay", type=float, default=0.6)
    ap.add_argument("--debias", action="store_true",
                    help="sweep what the big-spread de-bias is centred on (market/none/results)")
    ap.add_argument("--split", type=int, default=None,
                    help="choose on seasons <= this, confirm after it")
    args = ap.parse_args(argv)

    games = load(args.db, args.start, args.end)
    print(f"{len(games):,} games with a closing line, {args.start}-{args.end}\n")
    split = args.split or (args.start + args.end) // 2
    for era, sel in (("CHOOSE  <=%d" % split, [g for g in games if g["season"] <= split]),
                     ("CONFIRM  >%d" % split, [g for g in games if g["season"] > split])):
        if not sel:
            continue
        print(f"{era}   ({len({g['season'] for g in sel})} seasons)")
        if args.debias:
            for mode in ("market", "none", "results", "fav", "favside"):
                report(run(sel, args.lam, args.cap, args.from_week, args.decay, True, mode),
                       "debias=" + mode)
        else:
            for lab, flag in (("hfa inside", False), ("hfa outside", True)):
                report(run(sel, args.lam, args.cap, args.from_week, args.decay, flag), lab)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
