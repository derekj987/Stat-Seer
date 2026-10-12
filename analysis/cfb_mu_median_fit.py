"""Fit the NCAAF 50/50 conversion on OUR OWN MEAN, and hold it out before shipping it.

This is the fit cfb_median_fit.py says it cannot do and to_fifty_fifty's docstring asks for:

    "The real fix needs median(actual) as a function of OUR mean, which cannot be fitted until
     the pre-conversion `mu` is stored with each published row."

`mu` is stored now, and `cfb_player_proj.py --week N --all-rows` reproduces it for a played week
from what was knowable at the time, so the pairs exist.

🚨 WHY THE OLD FIT WAS WRONG, AND IT IS NOT A DETAIL. cfb_median_fit buckets (line, actual) pairs
by the BOOK'S LINE, while to_fifty_fifty picks its band with OUR MEAN. Those are different scales,
and the gap between them is precisely the error the ratio exists to remove — so an inflated mu
selects a HIGHER band, where the shrink is weaker, and the rows that most need correcting get the
least. 62% of rec_yds rows were taking a ratio fitted for a different band. Banding on mu makes the
fit and the lookup the same function of the same input, which is the whole point of this file.

THE ESTIMATOR. Inside a band of mu we want to publish the number the player beats half the time:

    ratio(band) = median(actual in band) / median(mu in band)

Applying `published = mu * ratio` then puts the band's median published number on the band's median
outcome, which is what "50/50" means. Dividing by the band's median mu rather than its mean keeps
both sides on the same statistic.

🚨 AND IT IS HELD OUT, because this exact correction has overshot before. A flat receptions ratio
fitted on line bands drove the board from 62% over to 35% — a fix that misses by 15 points in the
other direction is not a fix. So the fit trains on early weeks and is scored on later ones it never
saw, and the criterion is the HELD-OUT over-rate against the book's line, with MAE checked as a
guard so a number that balances the board by getting worse is rejected.

    python analysis/cfb_mu_median_fit.py --markets receptions,pass_tds
    python analysis/cfb_mu_median_fit.py --markets receptions,pass_tds --holdout 5,6

Reads the backtest boards written to the scratch dir by `cfb_player_proj.py --week N --all-rows`,
plus actuals from CFBD and the book's lines from cfb.db. Writes nothing; prints the curve and the
held-out score so a human decides.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import statistics as st
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

# Our short market name -> the CFBD game-log field holding the actual.
FIELD = {"receptions": "receptions", "rec_yds": "rec_yds", "rush_yds": "rush_yds",
         "pass_yds": "pass_yds", "pass_tds": "pass_tds"}
# The odds-feed market key, for pulling the book's line out of cfb_prop_snapshots.
ODDS_KEY = {"receptions": "player_receptions", "rec_yds": "player_reception_yds",
            "rush_yds": "player_rush_yds", "pass_yds": "player_pass_yds",
            "pass_tds": "player_pass_tds"}
# Candidate band edges on MU. Small-integer markets get their own: receptions runs ~0.5-9 and
# pass_tds ~0.3-3.5, so the yardage edges would drop every row into band 0 and the fit could only
# return a flat ratio — which moves the level and cannot touch a tilt.
BANDS = {
    "receptions": [0.0, 2.0, 3.0, 4.0, 5.0, 7.0],
    "pass_tds":   [0.0, 1.0, 1.5, 2.0, 2.5],
    "rec_yds":    [0.0, 18.0, 28.0, 45.0, 62.0, 80.0],
    "rush_yds":   [0.0, 18.0, 28.0, 45.0, 62.0, 80.0],
    "pass_yds":   [0.0, 120.0, 180.0, 240.0, 300.0],
}
MIN_BAND_N = 30      # thinner than this and a band borrows its neighbour rather than inventing one


def band_of(bands, v):
    i = 0
    while i + 1 < len(bands) and v >= bands[i + 1]:
        i += 1
    return i


def load_backtests(scratch):
    """{(week, market, normname): mu} from the per-week backtest boards."""
    import cfb_player_proj as C
    out = {}
    for path in sorted(glob.glob(os.path.join(scratch, "bt_w*.ts"))):
        wk = int(re.search(r"bt_w(\d+)\.ts", os.path.basename(path)).group(1))
        src = open(path, encoding="utf-8").read()
        n = 0
        for m in re.finditer(r'\{"game":.*?\}(?=,\n|\n\];|\];)', src, re.S):
            try:
                r = json.loads(m.group(0))
            except Exception:  # noqa: BLE001
                continue
            mu, mk, pl = r.get("mu"), r.get("market"), r.get("player")
            if mu is None or mk not in FIELD or not pl:
                continue
            # mu only. A --week backtest board does NOT carry the historical line (0 of 640
            # week-5 receptions rows had one) — it reprojects from what was knowable and never
            # looks the posted number back up. The line comes from cfb_prop_snapshots below.
            out[(wk, mk, C.norm(pl))] = float(mu)
            n += 1
        print(f"  week {wk}: {n} rows with mu", file=sys.stderr)
    return out


def load_actuals(weeks):
    """{(week, market, normname): actual} from CFBD game logs, joined week by week via cfb.db."""
    import cfb_player_proj as C
    import cfb_median_fit as F
    # cfb_median_fit.MARKETS covers the four yardage/reception markets it was written for and has
    # no passing-TD entry, so outcomes() silently returned zero pass_tds pairs. Extend it here
    # rather than edit that file's own fit, which bands on yardage and would print junk for a
    # 0-3 market.
    F.MARKETS = {**F.MARKETS, "player_pass_tds": "pass_tds"}
    gid_week, _ = F.week_maps()
    out = F.outcomes(gid_week)          # {(wk, odds_market_key, normname): actual}
    flat = {}
    inv = {v: k for k, v in ODDS_KEY.items()}
    for (wk, okey, nm), v in out.items():
        mk = inv.get(okey)
        if mk:
            flat[(wk, mk, nm)] = v
    return flat


def load_lines(weeks):
    """{(week, market, normname): median book line} from cfb_prop_snapshots."""
    import sqlite3
    import cfb_player_proj as C
    import cfb_median_fit as F
    gid_week, date_week = F.week_maps()
    conn = sqlite3.connect(os.path.join(ROOT, "data", "cfb.db"))
    acc = collections.defaultdict(list)
    for market, player, line, commence in conn.execute(
            "select market, player, line, commence from cfb_prop_snapshots where line is not null"):
        mk = {v: k for k, v in ODDS_KEY.items()}.get(market)
        if not mk or not player:
            continue
        # 🚨 A SATURDAY-NIGHT KICKOFF IS SUNDAY IN UTC. Keying purely on the UTC date dropped
        # every late game out of the map — it matched ~300 of 2,300 pairs. Fall back to the
        # neighbouring dates, which is enough because a college week is a contiguous block and
        # no two weeks touch the same calendar day.
        d = str(commence)[:10]
        wk = date_week.get(d)
        if wk is None:
            import datetime as _dt
            try:
                base = _dt.date.fromisoformat(d)
            except ValueError:
                continue
            for delta in (-1, 1):
                wk = date_week.get((base + _dt.timedelta(days=delta)).isoformat())
                if wk is not None:
                    break
        if wk is None:
            continue
        acc[(wk, mk, C.norm(player))].append(float(line))
    return {k: st.median(v) for k, v in acc.items()}


def fit(pairs, bands):
    """ratio per band = median(actual) / median(mu), with thin bands borrowing a neighbour."""
    byb = collections.defaultdict(list)
    for mu, act, _ in pairs:
        byb[band_of(bands, mu)].append((mu, act))
    ratios, ns = [], []
    for i in range(len(bands)):
        v = byb.get(i, [])
        ns.append(len(v))
        if len(v) >= MIN_BAND_N:
            mmu = st.median([x[0] for x in v])
            mac = st.median([x[1] for x in v])
            ratios.append(round(mac / mmu, 3) if mmu > 0 else 1.0)
        else:
            ratios.append(None)
    # Borrow from the nearest fitted neighbour, then enforce monotone non-decreasing: skew can
    # only shrink as the level rises, so a thin band must not be allowed to invert the curve.
    known = [i for i, r in enumerate(ratios) if r is not None]
    if not known:
        return None, ns
    for i in range(len(ratios)):
        if ratios[i] is None:
            j = min(known, key=lambda k: abs(k - i))
            ratios[i] = ratios[j]
    for i in range(1, len(ratios)):
        ratios[i] = max(ratios[i], ratios[i - 1])
    return ratios, ns


def score(pairs, bands, ratios):
    """Held-out: over-rate against the book's line, and MAE vs the actual, before and after."""
    o_raw = o_fit = 0
    e_raw, e_fit = [], []
    n = 0
    for mu, act, line in pairs:
        if line is None:
            continue
        n += 1
        pub = mu * (ratios[band_of(bands, mu)] if ratios else 1.0)
        o_raw += mu > line
        o_fit += pub > line
        e_raw.append(abs(mu - act))
        e_fit.append(abs(pub - act))
    if not n:
        return None
    return {"n": n, "over_raw": o_raw / n * 100, "over_fit": o_fit / n * 100,
            "mae_raw": st.mean(e_raw), "mae_fit": st.mean(e_fit)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--markets", default="receptions,pass_tds")
    ap.add_argument("--holdout", default="", help="comma weeks held out of the fit (default: the last two present)")
    ap.add_argument("--scratch", default=os.environ.get("SCRATCH") or ".")
    args = ap.parse_args(argv)

    markets = [m.strip() for m in args.markets.split(",") if m.strip()]
    print("loading backtest boards...", file=sys.stderr)
    mus = load_backtests(args.scratch)
    weeks = sorted({k[0] for k in mus})
    print(f"weeks with mu: {weeks}", file=sys.stderr)
    print("loading actuals + lines...", file=sys.stderr)
    acts = load_actuals(weeks)
    lines = load_lines(weeks)

    hold = ([int(x) for x in args.holdout.split(",") if x.strip()]
            if args.holdout else weeks[-2:])
    train_w = [w for w in weeks if w not in hold]
    print(f"\ntrain weeks {train_w}   holdout weeks {hold}\n")

    for mk in markets:
        rows = []
        for (wk, m, nm), mu in mus.items():
            if m != mk:
                continue
            act = acts.get((wk, m, nm))
            line = lines.get((wk, m, nm))
            # 🚨 FIT ON THE POPULATION THE CONVERSION IS APPLIED TO. The first cut fitted on all
            # 2,316 joined pairs and scored on the ~300 that carried a line, and the two are not
            # the same players: the unpriced rows are deep reserves with small mu and small
            # actuals, which dragged the bottom band to 0.625 and drove the held-out board to
            # 34% over. A conversion only ever touches rows the book priced, so only those rows
            # may fit it. This is the same "wrong population" error median_calibration.py made.
            if act is None or line is None:
                continue
            rows.append((wk, mu, act, float(line)))
        tr = [(mu, a, l) for w, mu, a, l in rows if w in train_w]
        ho = [(mu, a, l) for w, mu, a, l in rows if w in hold]
        bands = BANDS.get(mk, BANDS["rec_yds"])
        print(f"=== {mk} ===  joined pairs: {len(rows)}  (train {len(tr)}, holdout {len(ho)})")
        if len(tr) < MIN_BAND_N:
            print("   too few training pairs to fit — skipping\n")
            continue
        ratios, ns = fit(tr, bands)
        if ratios is None:
            print("   no band reached the minimum — skipping\n")
            continue
        print(f"   bands  {bands}")
        print(f"   n      {ns}")
        print(f"   ratio  {ratios}")
        for label, part in (("TRAIN", tr), ("HOLDOUT", ho)):
            s = score(part, bands, ratios)
            if not s:
                print(f"   {label:8} no priced rows to score")
                continue
            print(f"   {label:8} n={s['n']:4}  over {s['over_raw']:5.1f}% -> {s['over_fit']:5.1f}%"
                  f"   MAE {s['mae_raw']:.3f} -> {s['mae_fit']:.3f}"
                  f"   {'MAE WORSE' if s['mae_fit'] > s['mae_raw'] else 'MAE ok'}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
