"""
Stage B -- the TOUCH layer: project carries and targets per player-week.

The volume decomposition the whole prop pipeline rests on:
    prop yards = VOLUME (project this) x EFFICIENCY (fixed prior-season baseline)
So the edge lives in volume. props_projection.py already projects volume by
regressing a player's OWN carry/target history toward his prior-season rate --
but that can only react to a role change a week AFTER it shows up in his box
score. Stage B routes volume through the snap-share ROLE features (depth rank,
vacated_out, returning, snap-share EWMAs) that see the change the SAME week.

HYPOTHESIS (stated in advance): a learned touch model beats the direct-regression
baseline mostly on CHANGE weeks (injury/role shifts), mirroring the snap-share
model's +8.2% on change weeks. On stable weeks it should roughly tie.

Target   carries, targets (two models), among ACTIVE player-weeks (panel is
         players who took a snap). E[touches | active]; multiply by Stage A
         P(active) for the unconditional expectation.
Features own prior volume (EWMAs, season-to-date, prior-season per-game) PLUS the
         snap-share role/change features. All pre-game.
Eval     strict walk-forward by (season, week), test 2022-2024. MAE vs
         persistence, season-average, and the regression blend (the real
         baseline). Reported overall AND split by change vs stable weeks.

    python analysis/stage_b_touch.py
"""
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import HistGradientBoostingRegressor

HERE = Path(__file__).resolve().parent
PANEL = HERE.parent / "panel_feat.csv"
TEST_SEASONS = (2022, 2023, 2024)
K = 4.0  # regression-blend strength (matches props_projection.py)

ROLE_FEATS = ["ewm1", "ewm3", "ewm8", "prior_season_share", "games_prior",
              "stdm_prior", "played_last_wk", "depth_rank", "grp_prior_sum",
              "grp_n_active", "prior_share_of_grp", "vacated_out", "returning",
              "on_injury_report", "team_pace_prior", "week"]
CATS = ["pos_grp", "own_report", "own_practice"]


def add_vol_history(df, col):
    """Lagged own-volume features for `col` (carries|targets): last week, EWMA3,
    season-to-date mean, and prior-season per-game -- all strictly < W."""
    g = df.groupby(["pfr_id", "season"], sort=False)[col]
    df[f"{col}_l1"] = g.shift(1)
    df[f"{col}_ew3"] = (g.shift(1).groupby([df.pfr_id, df.season], sort=False)
                        .transform(lambda s: s.ewm(halflife=3, min_periods=1).mean()))
    df[f"{col}_sd"] = (g.shift(1).groupby([df.pfr_id, df.season], sort=False)
                       .transform(lambda s: s.expanding(min_periods=1).mean()))
    pg = (df.groupby(["pfr_id", "season"])[col].mean().rename(f"{col}_ps").reset_index())
    pg["season"] = pg["season"] + 1
    df = df.merge(pg, on=["pfr_id", "season"], how="left")
    df["nprior"] = df.groupby(["pfr_id", "season"]).cumcount()
    # regression blend baseline: season-to-date -> prior-season per-game (K games)
    w = df["nprior"] / (df["nprior"] + K)
    blend = w * df[f"{col}_sd"] + (1 - w) * df[f"{col}_ps"]
    df[f"{col}_blend"] = blend.where(df[f"{col}_ps"].notna(), df[f"{col}_sd"])
    return df


def design(df, col):
    feats = ROLE_FEATS + [f"{col}_l1", f"{col}_ew3", f"{col}_sd", f"{col}_ps", "nprior"]
    dummies = pd.get_dummies(df[CATS].astype(str), prefix=CATS)
    X = pd.concat([df[feats].reset_index(drop=True), dummies.reset_index(drop=True)], axis=1)
    return X


def walk_forward(df, col):
    df = df.sort_values(["season", "week"]).reset_index(drop=True)
    X = design(df, col)
    y = df[col].to_numpy()
    pred = np.full(len(df), np.nan)
    keys = (df.loc[df.season.isin(TEST_SEASONS), ["season", "week"]]
            .drop_duplicates().sort_values(["season", "week"]).to_numpy())
    for S, W in keys:
        tr = ((df.season < S) | ((df.season == S) & (df.week < W))).to_numpy()
        te = ((df.season == S) & (df.week == W)).to_numpy()
        if te.sum() == 0 or tr.sum() < 2000:
            continue
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06,
            max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        m.fit(X[tr], y[tr])
        pred[te] = np.clip(m.predict(X[te]), 0, None)
    df[f"{col}_model"] = pred
    return df


def mae(a, b):
    m = np.isfinite(a) & np.isfinite(b)
    return float(np.abs(a[m] - b[m]).mean()) if m.any() else float("nan")


def grade(df, col):
    d = df[df[f"{col}_model"].notna()].copy()
    y = d[col].to_numpy()
    # pre-game change signal (same spirit as model_v3): role/injury shift known Fri
    chg = ((d.vacated_out > 0) | (d.returning == 1) | (d.on_injury_report == 1)
           | (d.games_prior <= 3)).to_numpy()

    def row(name, pred):
        p = d[pred].to_numpy() if isinstance(pred, str) else pred
        return (name, mae(y, p), mae(y[chg], p[chg]), mae(y[~chg], p[~chg]))

    cols = ["method", "MAE all", "MAE change", "MAE stable"]
    tbl = pd.DataFrame([
        row("persistence (last wk)", f"{col}_l1"),
        row("season average", f"{col}_sd"),
        row("regression blend", f"{col}_blend"),
        row("Stage B model", f"{col}_model"),
    ], columns=cols)

    base = tbl.loc[tbl.method == "regression blend"].iloc[0]
    mod = tbl.loc[tbl.method == "Stage B model"].iloc[0]
    print(f"\n===== {col.upper()}  (n={len(d):,}; change weeks={chg.mean():.0%}) =====")
    print(tbl.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"  model vs regression blend:  all {(base['MAE all']-mod['MAE all'])/base['MAE all']*100:+.1f}%"
          f"   change {(base['MAE change']-mod['MAE change'])/base['MAE change']*100:+.1f}%"
          f"   stable {(base['MAE stable']-mod['MAE stable'])/base['MAE stable']*100:+.1f}%")


def main():
    df = pd.read_csv(PANEL, low_memory=False)
    df["pos_grp"] = df["pos_grp"].fillna("NA")
    df = df[df.pos_grp.isin(["RB", "WR", "TE"])].copy()
    for c in ("carries", "targets"):
        df[c] = df[c].fillna(0.0)
    for c in CATS:
        df[c] = df[c].fillna("None").astype(str)

    for col in ("carries", "targets"):
        df = add_vol_history(df, col)
    for col in ("carries", "targets"):
        df = walk_forward(df, col)
        grade(df, col)


if __name__ == "__main__":
    main()
