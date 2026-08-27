"""
cfb_ats_slices.py -- the CFB ATS walk-forward (same as cfb_ats.py) sliced to answer one
question: is there ANY beatable subset? The prior stated in advance is that books allocate
less attention to Group-of-5 / early-season / lopsided lines than to marquee P5 games, so an
edge -- if one survives anywhere in college football -- is likeliest there. We report ATS%
by conference tier, week bucket, and spread size, at all bets and at |edge|>=2.

Discipline: a slice is only an edge if it clears 52.38% on a MEANINGFUL sample. A couple of
points over on a few hundred bets is noise; a durable, sizeable, mechanistically-motivated
gap is the finding. Same fit as cfb_ats.py (ridge, cap 28, lambda 5, decay 0.6, from week 6).

    python cfb_ats_slices.py --start 2020 --end 2025
"""
import argparse
import sqlite3
import sys

import numpy as np

from cfb_power import fit_ratings

BREAKEVEN = 100.0 / 1.9090909
P5 = {"SEC", "Big Ten", "Big 12", "ACC", "Pac-12", "FBS Independents"}


def tier(hc, ac):
    hp, ap = hc in P5, ac in P5
    return "P5-P5" if hp and ap else ("G5-G5" if not hp and not ap else "mixed")


def wk_bucket(w):
    return "early(6-8)" if w <= 8 else ("mid(9-11)" if w <= 11 else "late(12+)")


def sp_bucket(s):
    a = abs(s)
    return "close(<7)" if a < 7 else ("mid(7-14)" if a < 14 else "big(14+)")


def load(db, start, end):
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT g.season, g.week, g.home_team, g.away_team, g.home_conf, g.away_conf,
                  g.home_points, g.away_points, g.neutral_site,
                  (SELECT spread FROM lines l WHERE l.game_id=g.id
                     AND l.provider='consensus' AND l.spread IS NOT NULL) AS cons,
                  (SELECT AVG(spread) FROM lines l WHERE l.game_id=g.id
                     AND l.spread IS NOT NULL) AS avgs
             FROM games g
             WHERE g.season BETWEEN ? AND ? AND g.home_class='fbs' AND g.away_class='fbs'
               AND g.home_points IS NOT NULL
             ORDER BY g.season, g.week""", (start, end)).fetchall()
    conn.close()
    out = []
    for s, w, h, a, hc, ac, hp, ap, neu, cons, avgs in rows:
        spread = cons if cons is not None else avgs
        if spread is None:
            continue
        out.append({"season": s, "week": w or 0, "home": h, "away": a, "hc": hc, "ac": ac,
                    "margin": hp - ap, "neutral": 1 if neu else 0, "spread": float(spread)})
    return out


def collect(games, lam, cap, from_week, decay):
    """Walk-forward, returning one record per graded bet: {won(1/0/None push), edge, week,
    spread, tier}."""
    seasons = sorted({g["season"] for g in games})
    bets, prior = [], {}
    for s in seasons:
        sg = [g for g in games if g["season"] == s]
        for w in sorted({g["week"] for g in sg if g["week"] >= from_week}):
            train = [g for g in sg if g["week"] < w]
            if len(train) < 50:
                continue
            ratings, hfa = fit_ratings(train, lam, cap, prior)
            for g in [x for x in sg if x["week"] == w]:
                if g["home"] not in ratings or g["away"] not in ratings:
                    continue
                pred = ratings[g["home"]] - ratings[g["away"]] + hfa * (0.0 if g["neutral"] else 1.0)
                edge = pred + g["spread"]
                cover = g["margin"] + g["spread"]
                won = None if cover == 0 else (1 if np.sign(edge) == np.sign(cover) else 0)
                bets.append({"won": won, "edge": edge, "week": g["week"], "spread": g["spread"],
                             "tier": tier(g["hc"], g["ac"])})
        final, _ = fit_ratings(sg, lam, cap, prior)
        prior = {t: decay * r for t, r in final.items()}
    return bets


def report(title, groups):
    print(f"\n== {title} ==")
    print(f"{'slice':>14} | {'bets':>5} {'W':>5} {'L':>5} | {'ATS%':>6} | {'vs break-even':>13}")
    print("-" * 60)
    for name, recs in groups:
        w = sum(1 for r in recs if r["won"] == 1)
        l = sum(1 for r in recs if r["won"] == 0)
        if w + l == 0:
            print(f"{name:>14} | {'0':>5}"); continue
        ats = 100.0 * w / (w + l)
        mark = "  <--" if ats > BREAKEVEN and (w + l) >= 300 else ""
        print(f"{name:>14} | {w + l:5d} {w:5d} {l:5d} | {ats:6.2f} | {ats - BREAKEVEN:+6.2f} pts{mark}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2020)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--cap", type=int, default=28)
    ap.add_argument("--lam", type=float, default=5.0)
    ap.add_argument("--from-week", type=int, default=6)
    ap.add_argument("--decay", type=float, default=0.6)
    args = ap.parse_args(argv)

    games = load(args.db, args.start, args.end)
    if not games:
        print("No lined games -- run cfb_backfill.py + cfb_lines.py first.", file=sys.stderr)
        return 1
    bets = collect(games, args.lam, args.cap, args.from_week, args.decay)
    print(f"{len(bets)} graded bets, {args.start}-{args.end}. Break-even (-110) = {BREAKEVEN:.2f}%. "
          f"'<--' flags a slice over break-even on >=300 bets.")

    for label, subset in [("ALL BETS", bets), ("|edge| >= 2", [b for b in bets if abs(b["edge"]) >= 2])]:
        print(f"\n################  {label}  ################")
        report("by conference tier", [(t, [b for b in subset if b["tier"] == t]) for t in ("P5-P5", "mixed", "G5-G5")])
        report("by week", [(wb, [b for b in subset if wk_bucket(b["week"]) == wb]) for wb in ("early(6-8)", "mid(9-11)", "late(12+)")])
        report("by spread size", [(sb, [b for b in subset if sp_bucket(b["spread"]) == sb]) for sb in ("close(<7)", "mid(7-14)", "big(14+)")])
    return 0


if __name__ == "__main__":
    sys.exit(main())
