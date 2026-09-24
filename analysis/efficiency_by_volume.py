"""Does a flat positional efficiency baseline run LOW on high-volume players?

Two measurements set this up. Grading weeks 1-2 against the closing line showed our yardage
projections on STARTERS sitting well under what those players actually did -- receiving yards with
a 40+ line came in 7.76 yards below actual, against the market's 3.82. Then the volume backtest
showed the volume itself is fine at the top of the distribution: in the top decile we project
slightly OVER (+0.78 carries/targets), not under. So the shortfall is not in the volume term.

That leaves the other factor. We project

    yards = projected_volume  x  a REGRESSED efficiency baseline

and the baseline is a flat per-position constant (YPC, catch rate, yards per reception), by
design: "volume persists, efficiency doesn't" -- yards per carry correlates 0.058 year to year, so
trusting a player's own efficiency would be worse than using the league's.

The rule is right and the application may be too blunt. Individual efficiency not PERSISTING is a
different claim from efficiency being unrelated to usage. Usage SELECTS: a back gets 20 carries a
game because his team thinks he is good, so the high-volume bucket is not a random sample of the
league and should not be handed the league's average yards per carry.

This measures the relationship and then tests whether conditioning the baseline on projected
volume actually improves YARDS out of sample. Train 2021-24, held-out 2025-26. If the held-out
gain does not hold, the flat baseline stays -- the point is to find out, not to justify a change.

    python analysis/efficiency_by_volume.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE, CUR_K = 2.5, 1.0

# What defines "volume" and what it converts into, per position.
SPECS = {
    "RB": ("carries", "rushing_yards", "rush"),
    "WR": ("targets", "receiving_yards", "rec"),
    "TE": ("targets", "receiving_yards", "rec"),
    "QB": ("attempts", "passing_yards", "pass"),
}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(SPECS)].copy()
    for c in ("carries", "targets", "attempts", "receptions",
              "rushing_yards", "receiving_yards", "passing_yards"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d


def ewma(vals, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)])
    return float(np.dot(w, vals) / w.sum())


def build():
    data = {s: load(s) for s in SEASONS}
    rows = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        p = data.get(s - 1)
        prior = {}
        if p is not None:
            for pos, (volc, _, _) in SPECS.items():
                q = p[p.position == pos]
                g = q.groupby("player_id").agg(v=(volc, "sum"), n=("week", "nunique"))
                for k, r in g.iterrows():
                    if r.n:
                        prior[str(k)] = float(r.v / r.n)
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid, pos = str(r.player_id), str(r.position)
                volc, ydc, kind = SPECS[pos]
                past = hist.get(pid, [])
                if not past:
                    continue
                own = ewma(past)
                pm = prior.get(pid)
                if pm is not None:
                    own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                rows.append({"season": s, "week": wk, "pos": pos, "kind": kind,
                             "proj_vol": own, "act_vol": float(r[volc]),
                             "act_yds": float(r[ydc]), "act_rec": float(r.receptions)})
            for _, r in cur.iterrows():
                volc = SPECS[str(r.position)][0]
                hist.setdefault(str(r.player_id), []).append(float(r[volc]))
    return pd.DataFrame(rows)


def main():
    df = build()
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"train {len(tr):,} player-games   held-out {len(ho):,}\n")

    print("YARDS PER UNIT OF VOLUME, by projected-volume bucket (train 2021-24)")
    print("  the flat baseline we ship is the ALL row; if the buckets slope, it is too blunt\n")
    for pos in ("RB", "WR", "TE", "QB"):
        sub = tr[(tr.pos == pos) & (tr.act_vol > 0)]
        if len(sub) < 500:
            continue
        flat = sub.act_yds.sum() / sub.act_vol.sum()
        print(f"  {pos}   flat baseline {flat:.3f} yds per {SPECS[pos][0][:-1]}")
        qs = sub.proj_vol.quantile([0, .2, .4, .6, .8, 1.0]).values
        for i in range(5):
            lo, hi = qs[i], qs[i + 1]
            b = sub[(sub.proj_vol >= lo) & (sub.proj_vol <= hi)]
            if b.empty:
                continue
            eff = b.act_yds.sum() / max(b.act_vol.sum(), 1)
            print(f"      proj vol {lo:5.1f}-{hi:5.1f}  n={len(b):6,d}  {eff:6.3f}"
                  f"  ({(eff / flat - 1) * 100:+5.1f}% vs flat)")
        print()

    # Fit the slope on TRAIN, apply to HELD-OUT, and see whether projected yards improve.
    print("DOES CONDITIONING THE BASELINE ON VOLUME IMPROVE YARDS?  (held-out 2025-26)")
    print(f"  {'pos':4s} {'n':>6s} {'flat MAE':>9s} {'tiered MAE':>11s} {'gain':>7s}"
          f" {'flat bias':>10s} {'tiered bias':>12s}")
    for pos in ("RB", "WR", "TE", "QB"):
        t = tr[(tr.pos == pos) & (tr.act_vol > 0)]
        h = ho[ho.pos == pos]
        if len(t) < 500 or len(h) < 200:
            continue
        flat = t.act_yds.sum() / t.act_vol.sum()
        # Tier edges from TRAIN only; each tier's efficiency also from TRAIN only.
        edges = t.proj_vol.quantile([0, .2, .4, .6, .8, 1.0]).values
        effs = []
        for i in range(5):
            b = t[(t.proj_vol >= edges[i]) & (t.proj_vol <= edges[i + 1])]
            effs.append(b.act_yds.sum() / max(b.act_vol.sum(), 1) if len(b) else flat)

        def tier_eff(v):
            i = int(np.searchsorted(edges[1:-1], v, side="right"))
            return effs[min(i, 4)]

        pf = h.proj_vol.values * flat
        pt = h.proj_vol.values * np.array([tier_eff(v) for v in h.proj_vol.values])
        a = h.act_yds.values
        mf, mt = np.abs(pf - a).mean(), np.abs(pt - a).mean()
        print(f"  {pos:4s} {len(h):6,d} {mf:9.3f} {mt:11.3f} {(mf - mt) / mf * 100:+6.2f}%"
              f" {(pf - a).mean():+10.3f} {(pt - a).mean():+12.3f}")

    print("\n  TOP tier only (the starters the board leads with)")
    for pos in ("RB", "WR", "TE", "QB"):
        t = tr[(tr.pos == pos) & (tr.act_vol > 0)]
        h = ho[ho.pos == pos]
        if len(t) < 500 or len(h) < 200:
            continue
        flat = t.act_yds.sum() / t.act_vol.sum()
        edges = t.proj_vol.quantile([0, .2, .4, .6, .8, 1.0]).values
        effs = [t[(t.proj_vol >= edges[i]) & (t.proj_vol <= edges[i + 1])].act_yds.sum()
                / max(t[(t.proj_vol >= edges[i]) & (t.proj_vol <= edges[i + 1])].act_vol.sum(), 1)
                for i in range(5)]
        hh = h[h.proj_vol >= edges[4]]
        if len(hh) < 50:
            continue
        pf, pt, a = hh.proj_vol.values * flat, hh.proj_vol.values * effs[4], hh.act_yds.values
        print(f"  {pos:4s} n={len(hh):5,d}  flat bias {(pf - a).mean():+7.2f} yds"
              f" -> tiered {(pt - a).mean():+7.2f}   MAE {np.abs(pf - a).mean():6.2f}"
              f" -> {np.abs(pt - a).mean():6.2f}")

    df.to_csv("data/_eff_by_volume.csv", index=False)
    print(f"\nwrote data/_eff_by_volume.csv ({len(df):,} rows)")


if __name__ == "__main__":
    main()
