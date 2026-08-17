"""
Stage A -- player AVAILABILITY model.

The snap-share model (model.py) predicts E[snap_share | active]: it only sees
players who dressed. Every prop projection downstream is therefore conditioned on
the player being on the field. Stage A supplies the missing P(active), so that

    E[snap_share] = P(active) * E[snap_share | active]

feeds the touch-share / volume layer honestly.

MECHANISM (stated in advance, per the project discipline):
  Universe  a recently-relevant RB/WR/TE: appeared in snaps in one of the prior 3
            weeks (mirrors the `_seen3` oracle filter in features.py; excludes
            cut / season-ending-IR players who are not this week's question).
  Label     active = played offensive snaps (offense_snaps > 0) in week W.
  Features  week-W injury report (report_status, practice_status) + returning,
            strictly-prior role (snap-share EWMAs, prior-season share, depth rank,
            games_prior, absences in the prior 3 weeks) + static pedigree
            (draft round/pick, years of experience). All known Friday night.
  Eval      strict walk-forward by (season, week); test 2022-2024. Graded on
            log-loss / Brier / AUC vs (a) the base rate and (b) an injury-report-
            only lookup -- the model must beat the report to justify existing.

HONEST LIMIT: the historical injury feed is one final designation per week, not
the Wed/Thu/Fri practice trajectory (that feed must be captured live -- see the
practice-data open item). So this is availability from the FINAL report only; the
trajectory is the next lever.

    python analysis/stage_a_availability.py
"""
import sys
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss

HERE = Path(__file__).resolve().parent
D = HERE.parent / "data"
sys.path.insert(0, str(HERE))
from build_panel import load_snaps, crosswalk   # noqa: E402  (players who played + id map)
from features import injury_table               # noqa: E402  (week-W report/practice status)

TEST_SEASONS = (2022, 2023, 2024)
SKILL_GRP = ["RB", "WR", "TE"]
NUM_FEATS = ["ewm1", "ewm3", "prior_season_share", "games_prior", "absent3",
             "depth_rank", "returning", "on_report", "draft_round", "draft_pick",
             "years_of_experience", "week"]
CAT_FEATS = ["report_status", "practice_status", "pos_grp"]


# ------------------------------------------------------------------- panel build
def build_universe():
    snaps = load_snaps()
    snaps["pos_grp"] = snaps["position"].replace({"FB": "RB"})
    snaps = snaps[snaps.pos_grp.isin(SKILL_GRP)].copy()
    snaps = snaps.merge(crosswalk(), on="pfr_id", how="left")

    # roster universe: every (player, team, season) crossed with that season's weeks
    allp = snaps[["pfr_id", "gsis_id", "season", "team", "pos_grp"]].drop_duplicates()
    weeks = snaps[["season", "week"]].drop_duplicates()
    uni = allp.merge(weeks, on="season", how="left")

    # did the player play offensive snaps this week?
    played = snaps[["pfr_id", "season", "week", "team", "offense_snaps", "snap_share"]].copy()
    uni = uni.merge(played, on=["pfr_id", "season", "week", "team"], how="left")
    uni["active"] = (uni["offense_snaps"].fillna(0) > 0).astype(int)

    uni = uni.sort_values(["pfr_id", "season", "week"]).reset_index(drop=True)
    g = uni.groupby(["pfr_id", "season"], sort=False)

    # recent role (strictly prior weeks)
    uni["ewm1"] = g["snap_share"].shift(1)
    uni["ewm3"] = (g["snap_share"].shift(1).groupby([uni.pfr_id, uni.season], sort=False)
                   .transform(lambda s: s.ewm(halflife=3, min_periods=1).mean()))
    uni["games_prior"] = g["active"].transform(lambda s: s.shift(1).cumsum())
    # short-term relevance: appeared in one of the prior 3 weeks
    uni["seen3"] = g["active"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).max())
    uni["absent3"] = g["active"].transform(lambda s: (1 - s).shift(1).rolling(3, min_periods=1).sum())

    # prior-season mean share (offseason role carryover)
    ps = (uni.groupby(["pfr_id", "season"])["snap_share"].mean()
          .rename("prior_season_share").reset_index())
    ps["season"] = ps["season"] + 1
    uni = uni.merge(ps, on=["pfr_id", "season"], how="left")

    uni = uni[uni["seen3"] == 1].copy()   # the Stage A question is only for relevant players

    # ---- week-W injury report (deployable: published Friday, pre-game)
    inj = injury_table().drop(columns=["position"], errors="ignore")
    uni = uni.merge(inj, on=["season", "week", "team", "gsis_id"], how="left")
    uni["report_status"] = uni["report_status"].fillna("None")
    uni["practice_status"] = uni["practice_status"].fillna("None")
    uni["on_report"] = (uni["practice_status"] != "None").astype(int)

    prev = inj[inj.report_status.isin(["Out", "Doubtful"])][
        ["season", "week", "team", "gsis_id"]].copy()
    prev["week"] = prev["week"] + 1
    prev["returning"] = 1.0
    uni = uni.merge(prev, on=["season", "week", "team", "gsis_id"], how="left")
    uni["returning"] = uni["returning"].fillna(0.0)

    # depth rank within team / position group / week, by recent role
    uni["_role"] = uni["ewm3"].fillna(uni["prior_season_share"]).fillna(0.0)
    uni["depth_rank"] = (uni.groupby(["season", "week", "team", "pos_grp"])["_role"]
                         .rank(ascending=False, method="min"))

    # static pedigree
    ped = pd.read_csv(D / "players.csv", low_memory=False)[
        ["gsis_id", "draft_round", "draft_pick", "years_of_experience"]].drop_duplicates("gsis_id")
    uni = uni.merge(ped, on="gsis_id", how="left")

    return uni.reset_index(drop=True)


def design_matrix(uni):
    dummies = pd.get_dummies(uni[CAT_FEATS].astype(str), prefix=CAT_FEATS)
    X = pd.concat([uni[NUM_FEATS].reset_index(drop=True),
                   dummies.reset_index(drop=True)], axis=1)
    return X


# ---------------------------------------------------------------- walk-forward
def walk_forward(uni):
    uni = uni.sort_values(["season", "week"]).reset_index(drop=True)
    X = design_matrix(uni)
    y = uni["active"].to_numpy()
    n = len(uni)
    p_model = np.full(n, np.nan)
    p_base = np.full(n, np.nan)     # base rate (train)
    p_rep = np.full(n, np.nan)      # P(active | report_status) lookup (train)

    idx = uni.index.to_numpy()
    test_keys = (uni.loc[uni.season.isin(TEST_SEASONS), ["season", "week"]]
                 .drop_duplicates().sort_values(["season", "week"]).to_numpy())

    for S, W in test_keys:
        tr = ((uni.season < S) | ((uni.season == S) & (uni.week < W))).to_numpy()
        te = ((uni.season == S) & (uni.week == W)).to_numpy()
        if te.sum() == 0 or tr.sum() < 1000:
            continue
        clf = HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
            min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        clf.fit(X[tr], y[tr])
        p_model[te] = clf.predict_proba(X[te])[:, 1]
        # benchmarks from train-so-far
        p_base[te] = y[tr].mean()
        rate = uni.loc[tr].groupby("report_status")["active"].mean()
        p_rep[te] = uni.loc[te, "report_status"].map(rate).fillna(y[tr].mean()).to_numpy()

    uni["p_model"], uni["p_base"], uni["p_report"] = p_model, p_base, p_rep
    return uni.loc[idx]


def grade(uni):
    d = uni[uni.p_model.notna()].copy()
    y = d["active"].to_numpy()
    rows = []
    for name, p in (("base rate", d.p_base), ("injury report only", d.p_report),
                    ("Stage A model", d.p_model)):
        p = np.clip(p.to_numpy(), 1e-6, 1 - 1e-6)
        rows.append((name, log_loss(y, p), brier_score_loss(y, p),
                     roc_auc_score(y, p) if len(np.unique(y)) > 1 else float("nan")))
    res = pd.DataFrame(rows, columns=["benchmark", "log_loss", "brier", "auc"])

    print(f"\nStage A availability  --  test {TEST_SEASONS}")
    print(f"universe rows (all): {len(uni):,}   graded (test): {len(d):,}"
          f"   base active rate: {y.mean():.3f}")
    print("\n" + res.to_string(index=False,
          float_format=lambda v: f"{v:.4f}"))

    base_ll = res.loc[res.benchmark == "injury report only", "log_loss"].iloc[0]
    mod_ll = res.loc[res.benchmark == "Stage A model", "log_loss"].iloc[0]
    print(f"\nlog-loss vs injury-report baseline: "
          f"{(base_ll - mod_ll) / base_ll * 100:+.1f}%  (positive = model better)")

    # does the edge survive on the HARD cases, or is it just obvious starters?
    print("\nby injury-report presence (log-loss, lower = better):")
    for lbl, mask in (("on injury report", d.on_report == 1),
                      ("not on report", d.on_report == 0)):
        dd = d[mask]
        if len(dd) < 50:
            continue
        yy = dd.active.to_numpy()
        pr = np.clip(dd.p_report.to_numpy(), 1e-6, 1 - 1e-6)
        pm = np.clip(dd.p_model.to_numpy(), 1e-6, 1 - 1e-6)
        print(f"  {lbl:<18} n={len(dd):>6}  active={yy.mean():.3f}  "
              f"report={log_loss(yy, pr):.4f}  model={log_loss(yy, pm):.4f}")

    # calibration deciles
    d["bkt"] = pd.qcut(d.p_model, 10, duplicates="drop")
    cal = d.groupby("bkt", observed=True).agg(
        n=("active", "size"), pred=("p_model", "mean"), actual=("active", "mean"))
    print("\ncalibration (model):")
    print(cal.to_string(float_format=lambda v: f"{v:.3f}"))
    return res


def main():
    uni = build_universe()
    uni = walk_forward(uni)
    grade(uni)


if __name__ == "__main__":
    main()
