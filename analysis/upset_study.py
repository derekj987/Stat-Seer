"""
upset_study.py -- what actually drives an UPSET (the market underdog winning outright),
for both NFL and NCAAF, tested the honest way.

The betting spread already encodes an upset probability: a +3 dog wins far more often
than a +21 dog. So the only interesting question is NOT "which dogs win" (the spread
answers that) but "does any variable move the upset rate BEYOND what the spread already
prices?" A variable that doesn't is priced -- true, but Context, not an edge. A variable
that does, and clears the moneyline vig, is a real (rare) edge.

Method:
  * upset = the market underdog wins the game straight up (moneyline upset).
  * Baseline logistic: upset ~ 1 + |spread|. This IS the market's own curve.
  * For each candidate variable: upset ~ 1 + |spread| + X, and report X's coefficient,
    its z-stat, and the upset-rate shift it implies. Significant |z|>~2 => X carries
    information the spread alone doesn't.
  * NFL only: we also have the closing moneyline, so we can check whether that residual
    signal actually beats the DOG's price (de-vigged) -- the real edge bar. NCAAF has no
    historical ML in the store, so there we can only say "predicts beyond the spread" and
    flag that the price test is blocked (same wall as the rest of the CFB prop work).

    python analysis/upset_study.py            # both sports
    python analysis/upset_study.py --sport nfl

Stdlib + numpy. NFL from data/games.csv (nflverse), NCAAF from data/cfb.db.
"""
import argparse
import csv
import math
import sqlite3
import sys

import numpy as np


# ---- tiny logistic regression (Newton-IRLS), so there's no sklearn/statsmodels dep ----
def logit_fit(X, y, iters=50, ridge=1e-6):
    """Fit P(y=1)=sigmoid(X beta). X includes an intercept column. Returns (beta, se)."""
    n, k = X.shape
    beta = np.zeros(k)
    for _ in range(iters):
        eta = X @ beta
        p = 1.0 / (1.0 + np.exp(-np.clip(eta, -30, 30)))
        W = p * (1 - p)
        WX = X * W[:, None]
        H = X.T @ WX + ridge * np.eye(k)
        g = X.T @ (y - p) - ridge * beta
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-8:
            break
    # standard errors from the inverse Hessian at the solution
    eta = X @ beta
    p = 1.0 / (1.0 + np.exp(-np.clip(eta, -30, 30)))
    W = p * (1 - p)
    cov = np.linalg.inv(X.T @ (X * W[:, None]) + ridge * np.eye(k))
    se = np.sqrt(np.diag(cov))
    return beta, se


def z_and_p(beta, se):
    z = beta / se
    # two-sided normal p via erfc
    pv = math.erfc(abs(z) / math.sqrt(2))
    return z, pv


def std(v):
    v = np.asarray(v, float)
    s = v.std()
    return (v - v.mean()) / s if s > 0 else v - v.mean()


# --------------------------- data loaders -----------------------------------------------
def load_nfl(path="data/games.csv"):
    """nflverse schedule. Keep completed games with a spread. spread_line sign is
    auto-detected against the realized home margin so we never assume the convention."""
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                hs, as_ = r.get("home_score"), r.get("away_score")
                if hs in (None, "", "NA") or as_ in (None, "", "NA"):
                    continue
                sl = r.get("spread_line")
                if sl in (None, "", "NA"):
                    continue
                g = {
                    "season": int(r["season"]), "week": int(r["week"]),
                    "home_margin": int(hs) - int(as_),
                    "spread_line": float(sl),
                    "total_line": _f(r.get("total_line")),
                    "home_ml": _f(r.get("home_moneyline")), "away_ml": _f(r.get("away_moneyline")),
                    "home_rest": _f(r.get("home_rest")), "away_rest": _f(r.get("away_rest")),
                    "div": 1.0 if r.get("div_game") in ("1", "1.0", "True") else 0.0,
                    "neutral": 1.0 if (r.get("location") or "").lower() == "neutral" else 0.0,
                    "weekday": (r.get("weekday") or ""),
                }
                rows.append(g)
            except (ValueError, KeyError):
                continue
    # detect sign: positive corr(spread_line, home_margin) => spread_line>0 means home favored
    sl = np.array([g["spread_line"] for g in rows]); hm = np.array([g["home_margin"] for g in rows])
    sign = 1.0 if np.corrcoef(sl, hm)[0, 1] >= 0 else -1.0
    out = []
    for g in rows:
        home_fav_pts = sign * g["spread_line"]          # >0 => home favored by this many
        line = abs(home_fav_pts)
        if line < 1.0:
            continue                                    # pick'em: no underdog to upset
        home_is_dog = home_fav_pts < 0
        dog_won = (g["home_margin"] < 0) if not home_is_dog else (g["home_margin"] > 0)
        dog_ml = g["home_ml"] if home_is_dog else g["away_ml"]
        fav_ml = g["away_ml"] if home_is_dog else g["home_ml"]
        dog_rest = g["home_rest"] if home_is_dog else g["away_rest"]
        fav_rest = g["away_rest"] if home_is_dog else g["home_rest"]
        out.append({
            "season": g["season"], "week": g["week"], "line": line,
            "upset": 1.0 if dog_won else 0.0,
            "home_dog": 1.0 if home_is_dog else 0.0,
            "div": g["div"], "neutral": g["neutral"],
            "total": g["total_line"] or np.nan,
            "dog_rest_edge": (dog_rest - fav_rest) if (dog_rest and fav_rest) else np.nan,
            "dog_short_week": 1.0 if (dog_rest is not None and dog_rest <= 4) else 0.0,
            "dog_ml": dog_ml, "fav_ml": fav_ml,
            "late": 1.0 if g["week"] >= 10 else 0.0,
        })
    return out


def load_ncaaf(db="data/cfb.db"):
    """FBS-vs-FBS games with a consensus (else avg) spread + pregame Elo + conferences."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT g.season, g.week, g.home_team, g.away_team, g.home_points, g.away_points,
                  g.neutral_site, g.home_pregame_elo, g.away_pregame_elo,
                  g.home_conf, g.away_conf,
                  (SELECT spread FROM lines l WHERE l.game_id=g.id
                     AND l.provider='consensus' AND l.spread IS NOT NULL) AS cons,
                  (SELECT AVG(spread) FROM lines l WHERE l.game_id=g.id
                     AND l.spread IS NOT NULL) AS avgs
             FROM games g
            WHERE g.home_class='fbs' AND g.away_class='fbs'
              AND g.home_points IS NOT NULL AND g.away_points IS NOT NULL""").fetchall()
    conn.close()
    POWER = {"SEC", "Big Ten", "Big 12", "ACC", "Pac-12"}
    out = []
    for s, w, h, a, hp, ap, neu, he, ae, hc, ac, cons, avgs in rows:
        spread = cons if cons is not None else avgs
        if spread is None:
            continue
        spread = float(spread)                          # HOME number, neg => home favored
        line = abs(spread)
        if line < 1.0:
            continue
        home_is_dog = spread > 0
        margin = hp - ap
        dog_won = (margin < 0) if not home_is_dog else (margin > 0)
        elo_gap = None
        if he is not None and ae is not None:
            # elo-implied home edge; compare its sign/size to the spread
            elo_gap = (he - ae)
        out.append({
            "season": s, "week": w or 0, "line": line, "upset": 1.0 if dog_won else 0.0,
            "home_dog": 1.0 if home_is_dog else 0.0,
            "neutral": 1.0 if neu else 0.0,
            "cross_conf": 0.0 if (hc and ac and hc == ac) else 1.0,
            "dog_power": 1.0 if ((ac if home_is_dog else hc) in POWER) else 0.0,
            "fav_power": 1.0 if ((hc if home_is_dog else ac) in POWER) else 0.0,
            "elo_gap": elo_gap if elo_gap is not None else np.nan,
            "late": 1.0 if (w or 0) >= 10 else 0.0,
        })
    return out


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# --------------------------- analysis ---------------------------------------------------
def devig_dog_prob(dog_ml, fav_ml):
    """De-vigged fair upset prob implied by the two moneylines."""
    def imp(ml):
        if ml is None:
            return None
        return 100.0 / (ml + 100.0) if ml > 0 else (-ml) / (-ml + 100.0)
    d, fv = imp(dog_ml), imp(fav_ml)
    if d is None or fv is None or (d + fv) == 0:
        return None
    return d / (d + fv)


def bucket_table(games):
    edges = [(1, 3), (3, 7), (7, 10), (10, 14), (14, 21), (21, 100)]
    print(f"  {'|spread|':>10} {'n':>6} {'upset%':>7} {'ml-impl%':>9}")
    for lo, hi in edges:
        sub = [g for g in games if lo <= g["line"] < hi]
        if not sub:
            continue
        up = 100 * np.mean([g["upset"] for g in sub])
        impl = [devig_dog_prob(g.get("dog_ml"), g.get("fav_ml")) for g in sub]
        impl = [x for x in impl if x is not None]
        istr = f"{100*np.mean(impl):9.1f}" if impl else "      n/a"
        print(f"  {lo:>3}-{hi if hi<100 else '+':<5} {len(sub):6d} {up:7.1f} {istr}")


def test_variable(games, name, key, base_keys=("line",)):
    """Logistic upset ~ 1 + base + X(std). Return X's z and per-1SD odds shift."""
    sub = [g for g in games if not (isinstance(g.get(key), float) and math.isnan(g[key]))]
    if len(sub) < 200:
        return None
    y = np.array([g["upset"] for g in sub])
    cols = [np.ones(len(sub))]
    for b in base_keys:
        cols.append(std([g[b] for g in sub]))
    cols.append(std([g[key] for g in sub]))
    X = np.column_stack(cols)
    beta, se = logit_fit(X, y)
    z, pv = z_and_p(beta[-1], se[-1])
    return {"name": name, "n": len(sub), "beta": beta[-1], "z": z, "p": pv,
            "odds_per_sd": math.exp(beta[-1])}


def analyze(sport, games, candidates):
    print(f"\n{'='*74}\n{sport}: {len(games)} games with a real underdog (|spread|>=1)")
    base = 100 * np.mean([g["upset"] for g in games])
    print(f"overall moneyline-upset rate: {base:.1f}%  (dog wins outright)\n")
    print("upset rate by spread bucket (spread IS the market's upset curve):")
    bucket_table(games)
    print("\ndoes any variable predict upsets BEYOND the spread?  "
          "(logistic upset ~ |spread| + X, X standardized)")
    print(f"  {'variable':<22} {'n':>6} {'z':>6} {'p':>7} {'odds/1SD':>9}  reading")
    results = []
    for name, key in candidates:
        r = test_variable(games, name, key)
        if r:
            results.append(r)
    for r in sorted(results, key=lambda d: -abs(d["z"])):
        sig = "**BEYOND spread**" if abs(r["z"]) >= 2.5 else ("mild" if abs(r["z"]) >= 2 else "priced (no signal)")
        print(f"  {r['name']:<22} {r['n']:6d} {r['z']:6.1f} {r['p']:7.3f} {r['odds_per_sd']:9.2f}  {sig}")
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", choices=["nfl", "ncaaf", "both"], default="both")
    args = ap.parse_args(argv)

    if args.sport in ("nfl", "both"):
        nfl = load_nfl()
        analyze("NFL", nfl, [
            ("home dog (dog at home)", "home_dog"),
            ("divisional game", "div"),
            ("dog rest edge (days)", "dog_rest_edge"),
            ("dog on short week", "dog_short_week"),
            ("game total (pts)", "total"),
            ("late season (wk>=10)", "late"),
            ("neutral site", "neutral"),
        ])

    if args.sport in ("ncaaf", "both"):
        try:
            cfb = load_ncaaf()
        except sqlite3.OperationalError as e:
            print(f"NCAAF skipped: {e}", file=sys.stderr)
            cfb = []
        if cfb:
            analyze("NCAAF", cfb, [
                ("home dog (dog at home)", "home_dog"),
                ("Elo gap (home basis)", "elo_gap"),
                ("cross-conference", "cross_conf"),
                ("dog is Power-conf", "dog_power"),
                ("fav is Power-conf", "fav_power"),
                ("late season (wk>=10)", "late"),
                ("neutral site", "neutral"),
            ])
    return 0


if __name__ == "__main__":
    sys.exit(main())
