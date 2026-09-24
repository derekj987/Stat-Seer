"""Does a RECEIVER's own yards-per-target persist enough to use instead of the league average?

Derek: "All of the main receivers are all unders and the bottom half players are all overs. That is
not correct." He is right, and it is neither skew nor the volume blend — both of those were
measured first and came back clean. It is the efficiency term.

`project()` computes rec_yds as volume x a LEAGUE baseline catch rate and yards per reception. The
player's own efficiency is discarded entirely, on the project's founding finding that efficiency
does not persist (yards per carry r=0.058). So:

    Tucker Kraft      own 11.11 yds/target   -> priced at the league's 7.72   under-rated
    Olamide Zaccheaus own  4.82 yds/target   -> priced at the league's 7.72   over-rated

Stars get marked down, back-ups get marked up, and the board splits top-half-under / bottom-half-
over exactly as Derek describes.

The founding finding is about RUSHING. `PASS_K = 300` already encodes the exception for
quarterbacks — "QB YPA persists (unlike RB/WR efficiency), so we regress the player's OWN YPA
toward the starter baseline rather than stripping it". Nobody has ever tested whether receivers
belong on the QB side of that line. Yards per target is partly a role — a deep threat and a
check-down slot are not drawing from the same distribution — and roles persist.

This measures persistence, then whether a REGRESSED own-efficiency beats the league baseline out of
sample. If it does not, the league baseline stays and the board's shape is simply correct.

    train 2021-2024    hold 2025-2026
    python analysis/rec_efficiency_persist.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
MIN_TGT = 25          # a season's worth of usage before "his own efficiency" means anything


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(["WR", "TE", "RB"])].copy()
    for c in ("targets", "receptions", "receiving_yards"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d


def season_eff(d):
    """{(player_id, pos): (targets, yards)} for one season."""
    if d is None or d.empty:
        return {}
    g = d.groupby(["player_id", "position"]).agg(t=("targets", "sum"), y=("receiving_yards", "sum"))
    return {(str(i[0]), str(i[1])): (float(r.t), float(r.y)) for i, r in g.iterrows()}


def main():
    data = {s: load(s) for s in SEASONS}
    effs = {s: season_eff(data.get(s)) for s in SEASONS}

    print("PERSISTENCE — a player's yards per target this season vs last, by position")
    print(f"  {'pos':4s} {'pairs':>7s} {'corr':>7s}   (for scale: rushing YPC is 0.058)")
    for pos in ("WR", "TE", "RB"):
        xs, ys = [], []
        for s in SEASONS[1:]:
            a, b = effs.get(s - 1, {}), effs.get(s, {})
            for k, (t1, y1) in a.items():
                if k[1] != pos or t1 < MIN_TGT:
                    continue
                if k in b and b[k][0] >= MIN_TGT:
                    xs.append(y1 / t1)
                    ys.append(b[k][1] / b[k][0])
        if len(xs) > 60:
            print(f"  {pos:4s} {len(xs):7,d} {np.corrcoef(xs, ys)[0, 1]:7.3f}")

    # Out-of-sample: predict each player-GAME's receiving yards from his target volume x either the
    # league baseline or his own prior-season efficiency regressed toward it by K targets.
    print("\nDOES IT PREDICT? per-game receiving yards, volume held identical in every variant")
    print("  (volume = his ACTUAL targets that game, so this isolates the efficiency term)\n")
    rows = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        prev = effs.get(s - 1, {})
        for _, r in d.iterrows():
            if r.targets <= 0:
                continue
            k = (str(r.player_id), str(r.position))
            pt, py = prev.get(k, (0.0, 0.0))
            rows.append({"season": s, "pos": str(r.position), "tgt": float(r.targets),
                         "yds": float(r.receiving_yards), "prev_t": pt, "prev_y": py})
    df = pd.DataFrame(rows)
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    lg = {p: tr[tr.pos == p].yds.sum() / tr[tr.pos == p].tgt.sum() for p in ("WR", "TE", "RB")}
    print(f"  league yards per target from TRAIN: " +
          ", ".join(f"{p} {v:.2f}" for p, v in lg.items()) + "\n")

    KS = [None, 500, 300, 200, 120, 80, 50, 25]
    print(f"  {'pos':4s} {'n':>7s} " + " ".join(f"{('K=' + str(k) if k else 'league'):>8s}" for k in KS))
    best = {}
    for pos in ("WR", "TE", "RB"):
        t = tr[tr.pos == pos]
        if len(t) < 2000:
            continue
        vals = []
        for K in KS:
            if K is None:
                eff = np.full(len(t), lg[pos])
            else:
                eff = (t.prev_y.values + lg[pos] * K) / (t.prev_t.values + K)
            vals.append(float(np.abs(t.tgt.values * eff - t.yds.values).mean()))
        best[pos] = KS[int(np.argmin(vals))]
        print(f"  {pos:4s} {len(t):7,d} " + " ".join(f"{v:8.3f}" for v in vals)
              + f"   best K={best[pos]}")

    print("\nHELD-OUT 2025-2026")
    for pos in ("WR", "TE", "RB"):
        h = ho[ho.pos == pos]
        if len(h) < 500 or pos not in best:
            continue
        base = float(np.abs(h.tgt.values * lg[pos] - h.yds.values).mean())
        K = best[pos]
        eff = (h.prev_y.values + lg[pos] * K) / (h.prev_t.values + K) if K else np.full(len(h), lg[pos])
        new = float(np.abs(h.tgt.values * eff - h.yds.values).mean())
        print(f"  {pos:4s} n={len(h):6,d}  league {base:7.3f} -> own regressed at K={K} {new:7.3f} "
              f"({(base - new) / base * 100:+5.2f}%)")

    print("\n  Where it matters — held-out, split by the player's own prior efficiency")
    for pos in ("WR", "TE"):
        h = ho[(ho.pos == pos) & (ho.prev_t >= MIN_TGT)].copy()
        if len(h) < 300 or pos not in best:
            continue
        K = best[pos] or 1e9
        h["own"] = h.prev_y / h.prev_t
        h["eff"] = (h.prev_y + lg[pos] * K) / (h.prev_t + K)
        for lab, sub in (("efficient (top third)", h[h.own >= h.own.quantile(2 / 3)]),
                         ("average", h[(h.own > h.own.quantile(1 / 3)) & (h.own < h.own.quantile(2 / 3))]),
                         ("inefficient (bottom)", h[h.own <= h.own.quantile(1 / 3)])):
            if len(sub) < 80:
                continue
            bb = (sub.tgt * lg[pos] - sub.yds).mean()
            nb = (sub.tgt * sub.eff - sub.yds).mean()
            print(f"    {pos} {lab:24s} n={len(sub):5,d}  bias league {bb:+7.2f} -> own {nb:+7.2f}")


if __name__ == "__main__":
    main()
