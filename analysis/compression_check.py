"""Are our player projections COMPRESSED — too low at the top, too high at the bottom?

Derek, on tonight's receiving board: "We also have most of the receivers as an under for tonight's
game. Is that correct or a data error?" The board he is looking at is ordered almost perfectly:

    Drake London   WR1  line 65.5  ours 48.8   under
    Tucker Kraft   TE1  line 46.5  ours 34.3   under
    Kyle Pitts     TE1  line 36.5  ours 27.3   under
    ...
    Jonnu Smith    TE2  line  7.5  ours 21.6   OVER
    Zaccheaus      WR3  line 10.5  ours 23.6   OVER
    MarShawn Lloyd RB1  line  5.5  ours  9.1   OVER

Starters under, back-ups over. That is not a lean, it is a SLOPE, and it is the signature of
shrinking everything toward the middle of the distribution.

I previously told Derek this effect was an artifact. That was wrong, and the way it was wrong is
worth stating: grading rows with a posted line >= 40 said we ran 7.76 yards low on starters, and
re-measuring by OUR OWN projected volume said the top decile ran 3.57 yards HIGH, so I concluded
the first number was a market-selected subset and dropped it. Both numbers are real and they are
not in conflict — they are two views of the same compression. Bucketing by our own estimate finds
the players WE think are big and we overshoot those; bucketing by the market's finds the players
the market thinks are big and we undershoot those. A compressed estimator does exactly that.

The test here uses no lines at all. Regress what actually happened on what we projected:

    actual = a + b * projected

    b = 1  calibrated
    b > 1  COMPRESSED — the truth varies more than our projection does, so we are low on the
           big ones and high on the small ones, which is precisely the board Derek is reading

    python analysis/compression_check.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE, CUR_K = 2.5, 1.0
SPECS = {"RB": ("carries", "rushing_yards"), "WR": ("targets", "receiving_yards"),
         "TE": ("targets", "receiving_yards"), "QB": ("attempts", "passing_yards")}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(SPECS)].copy()
    for c in ("carries", "targets", "attempts", "rushing_yards", "receiving_yards",
              "passing_yards", "receptions"):
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
            for pos, (volc, _) in SPECS.items():
                q = p[p.position == pos]
                gg = q.groupby("player_id").agg(v=(volc, "sum"), n=("week", "nunique"))
                for k, r in gg.iterrows():
                    if r.n:
                        prior[str(k)] = float(r.v / r.n)
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid, pos = str(r.player_id), str(r.position)
                volc, ydc = SPECS[pos]
                past = hist.get(pid, [])
                if not past:
                    continue
                own = ewma(past)
                pm = prior.get(pid)
                if pm is not None:
                    own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                rows.append({"season": s, "pos": pos, "proj_vol": own,
                             "act_vol": float(r[volc]), "act_yds": float(r[ydc])})
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r[SPECS[str(r.position)][0]]))
    return pd.DataFrame(rows)


def slope(x, y):
    """OLS slope and intercept of y on x."""
    b, a = np.polyfit(x, y, 1)
    return b, a


def main():
    df = build()
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    # Efficiency baselines from TRAIN only, exactly as the exporter does it.
    eff = {p: tr[(tr.pos == p) & (tr.act_vol > 0)].act_yds.sum()
              / tr[(tr.pos == p) & (tr.act_vol > 0)].act_vol.sum() for p in SPECS}

    print("Regression of ACTUAL on PROJECTED. b = 1 is calibrated; b > 1 means compressed.")
    print("No market line is used anywhere in this table.\n")
    print(f"  {'':4s} {'n':>7s} {'VOLUME b':>10s} {'YARDS b':>9s} {'yds intercept':>14s}")
    for pos in ("RB", "WR", "TE", "QB"):
        h = ho[ho.pos == pos]
        if len(h) < 200:
            continue
        bv, _ = slope(h.proj_vol.values, h.act_vol.values)
        by, ay = slope(h.proj_vol.values * eff[pos], h.act_yds.values)
        print(f"  {pos:4s} {len(h):7,d} {bv:10.3f} {by:9.3f} {ay:14.2f}")

    print("\nWhat that costs at the top and the bottom of the board (held-out, yards):")
    print(f"  {'':4s} {'decile':>8s} {'rows':>6s} {'our proj':>9s} {'actual':>8s} {'miss':>8s}")
    for pos in ("WR", "TE", "RB"):
        h = ho[ho.pos == pos].copy()
        if len(h) < 200:
            continue
        h["proj_yds"] = h.proj_vol * eff[pos]
        h["dec"] = pd.qcut(h.proj_yds, 10, labels=False, duplicates="drop")
        for d, lab in ((h.dec.max(), "top"), (h.dec.max() - 1, "9th"), (0, "bottom")):
            g = h[h.dec == d]
            if g.empty:
                continue
            print(f"  {pos:4s} {lab:>8s} {len(g):6,d} {g.proj_yds.mean():9.1f} "
                  f"{g.act_yds.mean():8.1f} {g.proj_yds.mean() - g.act_yds.mean():+8.1f}")

    print("\nThe correction a compressed estimator needs is a STRETCH about the mean:")
    print("    proj' = mean + (proj - mean) * b")
    print("  fitted on train, applied to held-out, yards MAE:\n")
    print(f"  {'':4s} {'n':>7s} {'b (train)':>10s} {'MAE now':>9s} {'MAE stretched':>14s} {'gain':>7s}")
    for pos in ("RB", "WR", "TE", "QB"):
        t, h = tr[tr.pos == pos], ho[ho.pos == pos]
        if len(t) < 500 or len(h) < 200:
            continue
        tp, hp = t.proj_vol.values * eff[pos], h.proj_vol.values * eff[pos]
        b, _ = slope(tp, t.act_yds.values)
        mu = tp.mean()
        base = np.abs(hp - h.act_yds.values).mean()
        new = np.abs((mu + (hp - mu) * b) - h.act_yds.values).mean()
        print(f"  {pos:4s} {len(h):7,d} {b:10.3f} {base:9.3f} {new:14.3f} "
              f"{(base - new) / base * 100:+6.2f}%")


if __name__ == "__main__":
    main()
