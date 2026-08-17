"""
Stage C -- assemble the player pipeline into PROP NUMBERS.

    prop = VOLUME (Stage B touch model) x EFFICIENCY (fixed prior-season baseline)

    proj_rush_yards = E[carries] x YPC_pos           (prior seasons only)
    proj_receptions = E[targets] x catch_rate_pos
    proj_rec_yards  = proj_receptions x YPR_pos

Volume comes from the Stage B walk-forward model (stage_b_touch); efficiency is a
pooled position baseline from STRICTLY prior seasons -- never the player's own
recent efficiency (it doesn't persist: YPC 0.058, catch 0.094, YPR 0.117).

Question: does routing volume through the snap-share touch model beat the direct
regression projection (props_projection.py) on the FINAL prop numbers -- and does
it beat the naive persistence / season-average baselines? Graded MAE on actual
rushing yards / receiving yards / receptions, strict walk-forward, test 2022-2024,
only on players with a real volume floor and >= 4 games of current-season history.

    python analysis/stage_c_props.py
"""
import numpy as np
import pandas as pd
from pathlib import Path
import stage_b_touch as sb

HERE = Path(__file__).resolve().parent
D = HERE.parent / "data"
PANEL = HERE.parent / "panel_feat.csv"
TEST = (2022, 2023, 2024)
MIN_PRIOR = 4  # current-season games before a week is graded (matches props_projection)


def load_yards():
    frames = []
    for y in range(2016, 2025):
        d = None
        for ext in (".csv.gz", ".csv"):
            p = D / f"stats_{y}{ext}"
            if p.exists() and p.stat().st_size > 1000:
                d = pd.read_csv(p, low_memory=False)
                break
        if d is None:
            continue
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        keep = ["player_id", "season", "week", "team",
                "rushing_yards", "receiving_yards", "receptions"]
        d = d[[c for c in keep if c in d.columns]]
        frames.append(d)
    y = pd.concat(frames, ignore_index=True).rename(columns={"player_id": "gsis_id"})
    for c in ("rushing_yards", "receiving_yards", "receptions"):
        if c not in y.columns:
            y[c] = 0.0
    return (y.groupby(["gsis_id", "season", "week", "team"], as_index=False)
            [["rushing_yards", "receiving_yards", "receptions"]].sum())


def efficiency_lut(df):
    """Per-season prior-only pooled efficiency by position group."""
    rows = []
    for S in sorted(df.season.unique()):
        t = df[df.season < S]
        if not len(t):
            continue
        for pos, g in t.groupby("pos_grp"):
            rows.append({
                "season": S, "pos_grp": pos,
                "ypc": g.rushing_yards.sum() / max(g.carries.sum(), 1),
                "catch": g.receptions.sum() / max(g.targets.sum(), 1),
                "ypr": g.receiving_yards.sum() / max(g.receptions.sum(), 1),
            })
    return pd.DataFrame(rows)


def lag(df, col):
    g = df.groupby(["pfr_id", "season"], sort=False)[col]
    df[f"{col}_last"] = g.shift(1)
    df[f"{col}_savg"] = (g.shift(1).groupby([df.pfr_id, df.season], sort=False)
                         .transform(lambda s: s.expanding(min_periods=1).mean()))
    return df


def mae(a, b):
    m = np.isfinite(a) & np.isfinite(b)
    return float(np.abs(a[m] - b[m]).mean()) if m.any() else float("nan")


def main():
    df = pd.read_csv(PANEL, low_memory=False)
    df["pos_grp"] = df["pos_grp"].fillna("NA")
    df = df[df.pos_grp.isin(["RB", "WR", "TE"])].copy()
    for c in ("carries", "targets"):
        df[c] = df[c].fillna(0.0)
    for c in sb.CATS:
        df[c] = df[c].fillna("None").astype(str)

    df = df.merge(load_yards(), on=["gsis_id", "season", "week", "team"], how="left")
    for c in ("rushing_yards", "receiving_yards", "receptions"):
        df[c] = df[c].fillna(0.0)

    # Stage B volume projections (walk-forward) + the regression-blend baseline
    for col in ("carries", "targets"):
        df = sb.add_vol_history(df, col)
    for col in ("carries", "targets"):
        df = sb.walk_forward(df, col)

    # efficiency baselines (prior seasons only), + naive yard baselines
    df = df.merge(efficiency_lut(df), on=["season", "pos_grp"], how="left")
    for c in ("rushing_yards", "receiving_yards", "receptions"):
        df = lag(df, c)

    # assemble projections
    df["pj_rush"] = df.carries_model * df.ypc
    df["bl_rush"] = df.carries_blend * df.ypc
    df["pj_recpt"] = df.targets_model * df["catch"]
    df["bl_recpt"] = df.targets_blend * df["catch"]
    df["pj_recyd"] = df.pj_recpt * df.ypr
    df["bl_recyd"] = df.bl_recpt * df.ypr

    # grade: test seasons, model produced a projection, real volume floor + >=4 games
    df["nprior"] = df.groupby(["pfr_id", "season"]).cumcount()
    d = df[df.season.isin(TEST) & df.carries_model.notna() & (df.nprior >= MIN_PRIOR)].copy()

    print(f"Stage C prop projections  --  test {TEST}   graded rows: {len(d):,}\n")
    specs = [
        ("rushing yards", "rushing_yards", "bl_rush", "pj_rush", d.pos_grp == "RB"),
        ("receiving yards", "receiving_yards", "bl_recyd", "pj_recyd", d.pos_grp.isin(["WR", "TE"])),
        ("receptions", "receptions", "bl_recpt", "pj_recpt", d.pos_grp.isin(["WR", "TE"])),
    ]
    for name, actual, blend, model, mask in specs:
        dd = d[mask]
        y = dd[actual].to_numpy()
        base = {
            "persistence": mae(y, dd[f"{actual}_last"].to_numpy()),
            "season avg": mae(y, dd[f"{actual}_savg"].to_numpy()),
            "regression blend x eff": mae(y, dd[blend].to_numpy()),
            "Stage C (touch model x eff)": mae(y, dd[model].to_numpy()),
        }
        print(f"===== {name}  (n={len(dd):,}) =====")
        for k, v in base.items():
            print(f"   {k:<30} MAE {v:6.3f}")
        b, m = base["regression blend x eff"], base["Stage C (touch model x eff)"]
        print(f"   -> Stage C vs regression blend: {(b - m) / b * 100:+.1f}%\n")


if __name__ == "__main__":
    main()
