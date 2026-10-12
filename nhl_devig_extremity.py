"""
nhl_devig_extremity.py -- is the "value is in the lopsided games" gradient real, or is it our
own de-vig error?

    python nhl_devig_extremity.py --selftest            # no network; checks the Shin solver
    python nhl_devig_extremity.py --season 2024

§14g found that the share of book quotes beating the de-vigged consensus rises monotonically with
how lopsided the price is -- 0.5% near an even moneyline to 2.7% at 25%+ from even, a 5x gradient.
Taken at face value that is a free shopping filter: when shopping NHL moneylines, look at the
lopsided games.

🚨 BUT IT WAS MEASURED WITH PROPORTIONAL DE-VIG, WHICH IS BIASED IN EXACTLY THAT REGIME.
Proportional de-vig splits the overround in proportion to each side's raw implied probability. The
favourite-longshot bias says books do not price that way: longshots are over-bet, so more of the
margin sits on the longshot. Proportional de-vig therefore leaves the longshot's fair probability
overstated and the favourite's understated, and the error GROWS with lopsidedness. So a gradient
that grows with lopsidedness is exactly what a de-vig artifact would look like.

THE TEST. Recompute the identical measurement under Shin de-vig, which models a proportion z of
insider money and attributes the overround accordingly. If the gradient is real it survives. If it
collapses, §14g's lead was our arithmetic and there is nothing to ship.

SHIN (Shin 1993; inverse as in Strumbelj 2014). With raw implied probabilities r_i and booksum
S = sum(r_i):

    p_i(z) = [ sqrt( z^2 + 4(1-z) * r_i^2 / S ) - z ] / ( 2(1-z) )

z is chosen so sum(p_i) = 1. At z = 0 the sum is sqrt(S) > 1 and it decreases in z, so a bisection
is safe and needs no derivatives. z is the implied insider share -- 0 recovers something close to
proportional, larger z pushes more of the margin onto the longshot.

Reuses nhl_goalie_value's Supabase paging, team normalisation and lead-time bands so this is the
SAME data and the same join as §14g -- only the de-vig changes.
"""
from __future__ import annotations

import argparse
import collections
import csv
import math
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import nhl_goalie_value as gv  # noqa: E402  -- shared paging / join / bands
import odds_client as oc  # noqa: E402


# ------------------------------------------------------------------------- de-vig
def prop_devig(raws):
    """Proportional: split the overround in proportion to raw implied probability."""
    s = sum(raws)
    return [r / s for r in raws] if s else None


def _shin_p(raws, s, z):
    out = []
    for r in raws:
        inner = z * z + 4.0 * (1.0 - z) * r * r / s
        out.append((math.sqrt(inner) - z) / (2.0 * (1.0 - z)))
    return out


def shin_devig(raws, tol=1e-12, max_iter=200):
    """Shin de-vig. Returns fair probabilities summing to 1, or None if degenerate.

    Bisects z on [0, 1): sum(p_i(0)) = sqrt(S) >= 1 and the sum is decreasing in z, so the root
    is bracketed whenever there IS an overround. A book with no overround (S <= 1) has nothing to
    remove, so it is normalised and returned as-is."""
    s = sum(raws)
    if s <= 0:
        return None
    if s <= 1.0 + 1e-12:
        return [r / s for r in raws]
    lo, hi = 0.0, 0.999999
    if sum(_shin_p(raws, s, hi)) > 1.0:
        return prop_devig(raws)        # no root in range; fall back rather than invent one
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        if sum(_shin_p(raws, s, mid)) > 1.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    p = _shin_p(raws, s, 0.5 * (lo + hi))
    t = sum(p)
    return [x / t for x in p] if t else None


DEVIGS = {"proportional": prop_devig, "shin": shin_devig}


# --------------------------------------------------------------------- self-tests
def selftest():
    ok = True

    def check(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'PASS' if cond else 'FAIL'}  {label}{(' -- ' + detail) if detail else ''}")

    a2p = gv.american_to_prob
    # 1. a balanced book must come out 50/50 under both methods
    r = [a2p(-110), a2p(-110)]
    for name, fn in DEVIGS.items():
        p = fn(r)
        check(f"{name}: balanced -110/-110 -> 50/50",
              abs(p[0] - 0.5) < 1e-9, f"got {p[0]:.6f}")
    # 2. fair probabilities must sum to 1
    for label, prices in (("-400/+300", (-400, 300)), ("-1000/+650", (-1000, 650)),
                          ("+120/-140", (120, -140))):
        for name, fn in DEVIGS.items():
            p = fn([a2p(x) for x in prices])
            check(f"{name}: {label} sums to 1", abs(sum(p) - 1) < 1e-9, f"got {sum(p):.12f}")
    # 3. THE PROPERTY THAT MATTERS: on a lopsided book Shin must put the favourite HIGHER than
    #    proportional does (it moves margin onto the longshot). If this is backwards the whole
    #    test below is backwards.
    for label, prices in (("-400/+300", (-400, 300)), ("-1000/+650", (-1000, 650))):
        r = [a2p(prices[0]), a2p(prices[1])]
        pp, ps = prop_devig(r), shin_devig(r)
        check(f"shin favourite > proportional favourite ({label})", ps[0] > pp[0],
              f"prop {pp[0]:.4f} vs shin {ps[0]:.4f}")
        check(f"shin longshot < proportional longshot ({label})", ps[1] < pp[1],
              f"prop {pp[1]:.4f} vs shin {ps[1]:.4f}")
    # 4. and the correction must GROW with lopsidedness -- otherwise it cannot explain a gradient
    gaps = []
    for prices in ((-110, -110), (-200, 170), (-400, 300), (-1000, 650)):
        r = [a2p(prices[0]), a2p(prices[1])]
        gaps.append(shin_devig(r)[0] - prop_devig(r)[0])
    check("shin-vs-proportional gap grows with lopsidedness",
          all(gaps[i] <= gaps[i + 1] + 1e-12 for i in range(len(gaps) - 1)),
          ", ".join(f"{g:+.4f}" for g in gaps))
    print("\nSELFTEST " + ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


# ----------------------------------------------------------------------- analysis
def stats_for(rows, market, devig_fn, min_books=4):
    """Per-book fair probability and consensus-beating quotes, under one de-vig method.

    Deliberately mirrors nhl_goalie_value.quote_stats -- same modal-line rule, same four-book
    minimum, same both-sides edge test -- so the ONLY difference is the de-vig."""
    if market == "totals":
        lines = collections.Counter(float(r["outcome_point"]) for r in rows
                                    if r["outcome_point"] is not None)
        if not lines:
            return None
        line = lines.most_common(1)[0][0]
        sel = [r for r in rows if r["outcome_point"] is not None
               and float(r["outcome_point"]) == line]
        a, b = "over", "under"
        key = lambda r: (r["outcome_name"] or "").strip().lower()  # noqa: E731
    else:
        sel = rows
        names = sorted({gv.norm_team(r["outcome_name"]) for r in sel})
        if len(names) != 2:
            return None
        a, b = names
        key = lambda r: gv.norm_team(r["outcome_name"])            # noqa: E731

    per_book = collections.defaultdict(dict)
    for r in sel:
        k = key(r)
        if k in (a, b) and r.get("price_american") is not None:
            per_book[r["book"]][k] = float(r["price_american"])

    fair_a, raw = {}, {}
    for bk, sides in per_book.items():
        if a in sides and b in sides:
            p = devig_fn([gv.american_to_prob(sides[a]), gv.american_to_prob(sides[b])])
            if p:
                fair_a[bk] = p[0]
                raw[bk] = (sides[a], sides[b])
    if len(fair_a) < min_books:
        return None
    cons = statistics.fmean(fair_a.values())
    beats = 0
    for _bk, (pa, pb) in raw.items():
        if cons - gv.american_to_prob(pa) > 0:
            beats += 1
        if (1 - cons) - gv.american_to_prob(pb) > 0:
            beats += 1
    return {"consensus": cons, "n_quotes": 2 * len(fair_a), "beat": beats}


def run(args):
    oc.ensure_ssl_certs()
    env = oc.load_env()
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1
    with open(args.results_csv, "r", encoding="utf-8") as f:
        results = {r["game_id"]: r for r in csv.DictReader(f)
                   if str(r.get("season")) == str(args.season) and r.get("total_goals")}
    if not results:
        print(f"no completed {args.season} games in {args.results_csv}", file=sys.stderr)
        return 1

    lo = min(r["start_time_utc"] for r in results.values())
    hi = max(r["start_time_utc"] for r in results.values())
    q = (f"?capture_reason=eq.BACKFILL&market=eq.{args.market}"
         f"&commence_time=gte.{lo}&commence_time=lte.{hi}"
         "&select=snapshot_at,commence_time,home_team,market,book,outcome_name,"
         "outcome_point,price_american")
    print(f"NHL de-vig extremity check -- season {args.season}, market {args.market}")
    print("fetching backfilled odds ...")
    odds = gv.sb_get(env, "nhl_odds_snapshots", q)
    print(f"  {len(odds):,} book-level row(s)")

    idx = collections.defaultdict(list)
    for r in results.values():
        idx[gv.norm_team(r["home_team"])].append((gv.parse_iso(r["start_time_utc"]), r))

    grouped = collections.defaultdict(list)
    for r in odds:
        ct = gv.parse_iso(r["commence_time"])
        best, bestgap = None, None
        for st, res in idx.get(gv.norm_team(r["home_team"]), []):
            gap = abs((st - ct).total_seconds()) / 3600.0
            if bestgap is None or gap < bestgap:
                best, bestgap = res, gap
        if best is None or bestgap > 6:
            continue
        band = gv.band_of((ct - gv.parse_iso(r["snapshot_at"])).total_seconds() / 60.0)
        if band is None:
            continue
        grouped[(best["game_id"], band)].append(r)
    print(f"  {len(grouped):,} (game, band) group(s)\n")

    # beat-rate by distance from an even price, under each de-vig
    tally = {m: collections.defaultdict(lambda: [0, 0]) for m in DEVIGS}
    zs = []
    for rows in grouped.values():
        for name, fn in DEVIGS.items():
            s = stats_for(rows, args.market, fn)
            if not s:
                continue
            k = min(int(abs(s["consensus"] - 0.5) / 0.05), 5)
            tally[name][k][0] += s["beat"]
            tally[name][k][1] += s["n_quotes"]
    print(f"{'consensus from even':<22}{'quotes':>9}"
          f"{'proportional':>14}{'shin':>9}{'difference':>12}")
    kept = sorted(set(tally['proportional']) | set(tally['shin']))
    for k in kept:
        bp, qp = tally["proportional"][k]
        bs, qs = tally["shin"][k]
        if not qp or not qs:
            continue
        rng = f"{k * 5}-{(k + 1) * 5}%" if k < 5 else "25%+"
        print(f"{rng:<22}{qp:>9,}{bp / qp:>13.1%}{bs / qs:>9.1%}"
              f"{(bs / qs) - (bp / qp):>+12.1%}")

    # the headline: does the gradient survive?
    def grad(name):
        t = tally[name]
        lows = [k for k in t if k <= 0 and t[k][1]]
        highs = [k for k in t if k >= 4 and t[k][1]]
        if not lows or not highs:
            return None
        lb = sum(t[k][0] for k in lows) / sum(t[k][1] for k in lows)
        hb = sum(t[k][0] for k in highs) / sum(t[k][1] for k in highs)
        return lb, hb
    print()
    for name in ("proportional", "shin"):
        g = grad(name)
        if g:
            lb, hb = g
            ratio = (hb / lb) if lb else float("inf")
            print(f"{name:<14} near-even {lb:.2%}  ->  lopsided (20%+) {hb:.2%}"
                  f"   = {ratio:.1f}x")
    print("\nIf the gradient collapses under Shin, §14g's lead was our own de-vig error and there\n"
          "is nothing to ship. If it survives at a similar ratio, it is a real shopping filter.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true",
                    help="check the Shin solver against known properties; no network")
    ap.add_argument("--season", type=int)
    ap.add_argument("--market", default="h2h", choices=["h2h", "totals"])
    ap.add_argument("--results-csv", default="data/nhl_results.csv")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    if not args.season:
        ap.error("--season is required (or use --selftest)")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
