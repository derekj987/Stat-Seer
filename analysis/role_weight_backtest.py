"""How much should the DEPTH-CHART ROLE pull a player's volume, once the season has games in it?

`apply_role` blends a player's own per-game volume toward his depth slot's league-wide median:

    volume = (own * n + role_median * ROLE_K) / (n + ROLE_K)        ROLE_K = 12

and `n` is whatever `blend_current` left in `games` -- which is PRIOR-season games plus this
season's. That count is the problem. It is meant to say "how much do I know about this player's
current role", and instead it mostly counts games in the role he no longer has:

    MarShawn Lloyd   no prior row, games=2   -> 2/(2+12)  = 14% his own 9.5 carries, 86% RB1 median
    Kaleb Johnson    12 prior + 2, games=12  -> 12/(12+12) = 50% own, and that "own" is itself
                                                mostly last season's 2.8 carries as a reserve

So the back with 19 carries in two games gets overwritten by a league median, and the back the
market now has as the lead gets anchored to his old role. Both from the same line of code.

This sweeps ROLE_K and what `n` should count, against what players actually did the following
week. Depth charts come from nflverse: 2021-24 publish a chart PER WEEK (the `depth_team` schema),
2025+ publish dated snapshots (`pos_rank`), so the season split falls naturally --

    train   2021-2024   choose ROLE_K and the weight
    hold    2025-2026   report only

Line-blind: own history, our own depth chart, and a median over our own numbers. No prices.

    python analysis/role_weight_backtest.py
"""
from __future__ import annotations

import io
import os
import sys
import urllib.request

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import odds_client as oc  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
VOL = {"RB": "carries", "FB": "carries", "WR": "targets", "TE": "targets", "QB": "attempts"}
HALF_LIFE, CUR_K = 2.5, 1.0        # chosen in volume_sweep.py
DEPTH_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
             "depth_charts/depth_charts_{}.csv")
CACHE = "data/_depth_cache"


def fetch_depth(season: int) -> pd.DataFrame | None:
    os.makedirs(CACHE, exist_ok=True)
    path = f"{CACHE}/{season}.csv"
    if not os.path.exists(path):
        try:
            oc.ensure_ssl_certs()
            req = urllib.request.Request(DEPTH_URL.format(season),
                                         headers={"User-Agent": "statseer-roleBT/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                open(path, "wb").write(r.read())
        except Exception as e:  # noqa: BLE001
            print(f"  depth {season} unavailable: {e}", file=sys.stderr)
            return None
    return pd.read_csv(path, low_memory=False)


def ranks_by_week(season: int) -> dict[int, dict[str, tuple[str, int]]]:
    """{week: {gsis_id: (pos, rank)}} -- the chart as it stood going into that week.

    Two schemas. 2021-24: one row per player per week, rank in `depth_team`, position in
    `position`. 2025+: dated snapshots, rank in `pos_rank`, position in `pos_abb`; for each week we
    take the latest snapshot strictly before that week's games. Getting a column name wrong here
    does not raise -- it returns an empty map and the role correction silently turns itself off --
    so both branches assert they produced something.
    """
    d = fetch_depth(season)
    if d is None or d.empty:
        return {}
    out: dict[int, dict[str, tuple[str, int]]] = {}
    cols = set(d.columns)
    if "depth_team" in cols:                                   # 2021-2024
        d = d[d.position.isin(VOL)].copy()
        d["rank"] = pd.to_numeric(d.depth_team, errors="coerce")
        d["wk"] = pd.to_numeric(d.week, errors="coerce")
        d = d[d["rank"].notna() & d.wk.notna() & d.gsis_id.notna()]
        for wk, g in d.groupby("wk"):
            m: dict[str, tuple[str, int]] = {}
            for _, r in g.iterrows():
                gid, rk = str(r.gsis_id), int(r["rank"])
                if gid not in m or rk < m[gid][1]:
                    m[gid] = (str(r.position), rk)
            out[int(wk)] = m
    elif "pos_rank" in cols:                                   # 2025+
        d = d[d.pos_abb.isin(VOL)].copy()
        d["rank"] = pd.to_numeric(d.pos_rank, errors="coerce")
        d["ts"] = pd.to_datetime(d.dt, errors="coerce", utc=True)
        d = d[d["rank"].notna() & d.ts.notna() & d.gsis_id.notna()]
        d = d.sort_values("ts")
        # A season's weeks run roughly one per 7 days from the opener; bucket snapshots by the
        # week column when it exists, else fall back to ordering by date.
        if "week" in cols and pd.to_numeric(d.get("week"), errors="coerce").notna().any():
            d["wk"] = pd.to_numeric(d.week, errors="coerce")
        else:
            first = d.ts.min()
            d["wk"] = ((d.ts - first).dt.days // 7 + 1).astype(int)
        for wk, g in d.groupby("wk"):
            g = g.sort_values("ts").groupby(["gsis_id"], as_index=False).last()
            m = {str(r.gsis_id): (str(r.pos_abb), int(r["rank"])) for _, r in g.iterrows()}
            out[int(wk)] = m
    if not out:
        print(f"  WARNING: depth {season} parsed to ZERO -- schema changed?", file=sys.stderr)
    return out


def load_stats(season: int):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(VOL)].copy()
    for c in ("carries", "targets", "attempts"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["vol"] = [r[VOL[p]] for r, p in zip(d.to_dict("records"), d.position)]
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d[["player_id", "position", "team", "week", "vol"]]


def ewma(vals, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)])
    return float(np.dot(w, vals) / w.sum())


def build() -> pd.DataFrame:
    stats = {s: load_stats(s) for s in SEASONS}
    rows = []
    for s in SEASONS:
        d = stats.get(s)
        if d is None or d.empty:
            continue
        charts = ranks_by_week(s)
        if not charts:
            continue
        p = stats.get(s - 1)
        prior = {}
        if p is not None:
            g = p.groupby("player_id").agg(v=("vol", "sum"), n=("week", "nunique"))
            prior = {str(k): (float(r.v / r.n), int(r.n)) for k, r in g.iterrows() if r.n}
        hist: dict[str, list[float]] = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            chart = charts.get(wk) or charts.get(max((k for k in charts if k < wk), default=-1)) or {}
            cur = d[d.week == wk]
            batch = []
            for _, r in cur.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                if not past:
                    continue
                pm, pn = prior.get(pid, (None, 0))
                own = ewma(past)
                if pm is not None:
                    own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                slot = chart.get(pid)
                if slot is None:
                    continue
                batch.append({"season": s, "week": wk, "pos": slot[0], "rank": slot[1],
                              "own": own, "cur_n": len(past), "prior_n": pn,
                              "actual": float(r.vol)})
            # The role yardstick comes from the same pool we are predicting with, this week only --
            # no future information, and it moves with the league like the production one does.
            b = pd.DataFrame(batch)
            if not b.empty:
                med = b.groupby(["pos", "rank"])["own"].agg(["median", "size"])
                med = {k: float(v["median"]) for k, v in med.iterrows() if v["size"] >= 5}
                for row in batch:
                    row["role_med"] = med.get((row["pos"], row["rank"]))
                rows += [r for r in batch if r.get("role_med") is not None]
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
    return pd.DataFrame(rows)


def blended(df: pd.DataFrame, role_k: float, weight: str) -> np.ndarray:
    if role_k <= 0:
        return df.own.values
    n = {"total": df.cur_n.values + df.prior_n.values,     # what ships today
         "cur": df.cur_n.values,                           # only this season's evidence
         "cur_capped": np.minimum(df.cur_n.values + df.prior_n.values, 6)}[weight]
    return (df.own.values * n + df.role_med.values * role_k) / (n + role_k)


def main():
    df = build()
    if df.empty:
        print("no rows -- depth charts unavailable"); return
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"train {len(tr):,} player-games   held-out {len(ho):,}\n")

    def mae(sub, rk, w):
        return float(np.abs(blended(sub, rk, w) - sub.actual.values).mean())

    print("TRAIN -- MAE by ROLE_K x weight")
    ks = [0, 2, 4, 6, 8, 12, 20]
    ws = ["total", "cur", "cur_capped"]
    print(f"  {'ROLE_K':>7s} " + " ".join(f"{w:>12s}" for w in ws))
    best = None
    for k in ks:
        cells = []
        for w in ws:
            m = mae(tr, k, w)
            cells.append(m)
            if best is None or m < best[0]:
                best = (m, k, w)
        print(f"  {k:7d} " + " ".join(f"{c:12.4f}" for c in cells))
    print(f"\n  best on train: ROLE_K={best[1]} weight={best[2]}  (MAE {best[0]:.4f})")

    ship = (12, "total")
    print("\nHELD-OUT 2025-2026 -- confirmation only")
    base = mae(ho, *ship)
    for lab, cfg in (("ships today", ship), ("chosen", (best[1], best[2])),
                     ("no role blend", (0, "total")), ("K=6 cur", (6, "cur"))):
        m = mae(ho, *cfg)
        print(f"  {lab:16s} ROLE_K={cfg[0]:<3} {cfg[1]:11s} MAE {m:.4f}  {(base - m) / base * 100:+5.2f}%")

    print("\nHELD-OUT by position")
    for pos in ("RB", "WR", "TE", "QB"):
        sub = ho[ho.pos == pos]
        if len(sub) < 150:
            continue
        b, c = mae(sub, *ship), mae(sub, best[1], best[2])
        print(f"  {pos:3s} n={len(sub):6,d}  ships {b:7.4f} -> chosen {c:7.4f}  {(b - c) / b * 100:+5.2f}%")

    print("\nHELD-OUT, players with FEW current-season games (cur_n <= 3) -- where the role prior bites")
    sub = ho[ho.cur_n <= 3]
    b, c = mae(sub, *ship), mae(sub, best[1], best[2])
    pb = blended(sub, *ship) - sub.actual.values
    pc = blended(sub, best[1], best[2]) - sub.actual.values
    print(f"  n={len(sub):,}  MAE {b:.3f} -> {c:.3f}  {(b - c) / b * 100:+5.2f}%"
          f"   bias {pb.mean():+.3f} -> {pc.mean():+.3f}")

    df.to_csv("data/_role_backtest.csv", index=False)
    print(f"\nwrote data/_role_backtest.csv  ({len(df):,} rows)")


if __name__ == "__main__":
    main()
