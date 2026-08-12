"""
Feature construction for the snap-share model.

Every feature is either:
  (a) derived from weeks strictly < W, or
  (b) from the week-W official injury report (published Friday -> pre-game).

Two versions of the availability feature are built:
  vacated_out    -> from the week-W injury report ('Out'/'Doubtful'). DEPLOYABLE.
  vacated_oracle -> from who actually did not play. DIAGNOSTIC ONLY.
The gap between them measures how much of the edge depends on a
separate Stage-A availability model.
"""
import pandas as pd
import numpy as np
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"
SEASONS = range(2016, 2025)
HALF_LIVES = {"ewm1": 1, "ewm3": 3, "ewm8": 8}


# ---------------------------------------------------------------- injury table
def injury_table():
    frames = []
    for y in SEASONS:
        for ext in (".csv.gz", ".csv"):
            p = D / f"inj_{y}{ext}"
            if p.exists() and p.stat().st_size > 1000:
                frames.append(pd.read_csv(p, low_memory=False))
                break
    i = pd.concat(frames, ignore_index=True)
    i = i[i.game_type == "REG"]
    i = i.drop_duplicates(subset=["season", "week", "team", "gsis_id"], keep="last")
    return i[["season", "week", "team", "gsis_id", "position",
              "report_status", "practice_status"]]


# ------------------------------------------------------------- lagged features
def add_lagged(df):
    """Within-season, strictly-lagged EWMAs of snap share + prior-season level."""
    df = df.sort_values(["pfr_id", "season", "week"]).reset_index(drop=True)
    g = df.groupby(["pfr_id", "season"], sort=False)["snap_share"]

    for name, hl in HALF_LIVES.items():
        df[name] = (g.shift(1)
                    .groupby([df.pfr_id, df.season], sort=False)
                    .transform(lambda s: s.ewm(halflife=hl, min_periods=1).mean()))

    df["games_prior"] = g.cumcount()
    df["stdm_prior"] = (g.shift(1).groupby([df.pfr_id, df.season], sort=False)
                        .transform(lambda s: s.expanding(min_periods=2).std()))

    # prior-season mean share (role continuity across offseason)
    ps = (df.groupby(["pfr_id", "season"])["snap_share"].mean()
          .rename("prior_season_share").reset_index())
    ps["season"] = ps["season"] + 1
    df = df.merge(ps, on=["pfr_id", "season"], how="left")

    # did the player appear last week?
    df["played_last_wk"] = (df.groupby(["pfr_id", "season"], sort=False)["week"]
                            .shift(1).rsub(df["week"]).eq(1).astype(float))
    return df


# ------------------------------------------------------- team / group features
def add_group(df, inj):
    """Depth rank, teammate competition, and vacated share within position group."""
    base = df["ewm3"].fillna(df["prior_season_share"]).fillna(0.0)
    df["_prior"] = base

    key = ["season", "week", "team", "pos_grp"]
    grp = df.groupby(key, sort=False)["_prior"]
    df["grp_prior_sum"] = grp.transform("sum")
    df["grp_n_active"] = grp.transform("size")
    df["depth_rank"] = grp.rank(ascending=False, method="min")
    df["prior_share_of_grp"] = df["_prior"] / df["grp_prior_sum"].replace(0, np.nan)

    # --- player-level prior lookup table, for absent teammates
    lut = df[["pfr_id", "season", "week", "_prior"]].copy()

    # map gsis -> pfr so injury rows can inherit a prior share
    xw = pd.read_csv(D / "players.csv", low_memory=False)[["gsis_id", "pfr_id"]].dropna()
    xw = xw.drop_duplicates("gsis_id")
    inj = inj.merge(xw, on="gsis_id", how="left")
    inj["pos_grp"] = inj["position"].replace({"FB": "RB"})
    inj = inj[inj.pos_grp.isin(["RB", "WR", "TE", "QB"])]

    # ---- DEPLOYABLE: injury-report-declared absences
    out = inj[inj.report_status.isin(["Out", "Doubtful"])]
    out = out.merge(lut, on=["pfr_id", "season", "week"], how="left")
    # a declared-Out player has no row in the panel that week -> fall back to
    # his most recent prior share
    hist = (df.sort_values(["pfr_id", "season", "week"])
            .groupby(["pfr_id", "season"])
            .apply(lambda d: d.set_index("week")["_prior"], include_groups=False))
    out["_prior"] = out.apply(
        lambda r: _last_prior(hist, r.pfr_id, r.season, r.week)
        if pd.isna(r._prior) else r._prior, axis=1)
    vac = (out.groupby(["season", "week", "team", "pos_grp"])["_prior"]
           .sum().rename("vacated_out").reset_index())
    df = df.merge(vac, on=key, how="left")
    df["vacated_out"] = df["vacated_out"].fillna(0.0)

    # ---- ORACLE: anyone with a meaningful prior share who did not appear
    appear = df.set_index(["pfr_id", "season", "week"]).index
    allp = df[["pfr_id", "season", "team", "pos_grp"]].drop_duplicates()
    weeks = df[["season", "week"]].drop_duplicates()
    roster = allp.merge(weeks, on="season")
    roster = roster.merge(lut, on=["pfr_id", "season", "week"], how="left")
    roster["_absent"] = ~roster.set_index(["pfr_id", "season", "week"]).index.isin(appear)
    # prior share for absent weeks: last observed
    roster = roster.sort_values(["pfr_id", "season", "week"])
    roster["_prior_f"] = roster.groupby(["pfr_id", "season"])["_prior"].ffill()
    # only count SHORT-TERM absence: player appeared in one of the prior 3 weeks.
    # without this, cut/traded players are scored as "absent" forever.
    roster["_seen"] = (~roster["_prior"].isna()).astype(float)
    roster["_seen3"] = (roster.groupby(["pfr_id", "season"])["_seen"]
                        .transform(lambda s: s.shift(1).rolling(3, min_periods=1).max()))
    orc = (roster[roster._absent & roster._prior_f.gt(0.05) & roster._seen3.eq(1)]
           .groupby(["season", "week", "team", "pos_grp"])["_prior_f"]
           .sum().rename("vacated_oracle").reset_index())
    df = df.merge(orc, on=key, how="left")
    df["vacated_oracle"] = df["vacated_oracle"].fillna(0.0)

    return df.drop(columns=["_prior"])


def _last_prior(hist, pid, season, week):
    try:
        s = hist.loc[(pid, season)]
        s = s[s.index < week]
        return float(s.iloc[-1]) if len(s) else np.nan
    except Exception:
        return np.nan


# ------------------------------------------------------------------ own status
def add_own_status(df, inj):
    inj2 = inj.rename(columns={"report_status": "own_report",
                               "practice_status": "own_practice"})
    df = df.merge(inj2[["season", "week", "team", "gsis_id", "own_report", "own_practice"]],
                  on=["season", "week", "team", "gsis_id"], how="left")
    df["own_report"] = df["own_report"].fillna("None")
    df["own_practice"] = df["own_practice"].fillna("None")
    df["on_injury_report"] = (df.own_practice != "None").astype(float)

    # was the player himself declared Out the previous week? (ramp-up)
    prev = inj2[inj2.own_report.isin(["Out", "Doubtful"])][
        ["season", "week", "team", "gsis_id"]].copy()
    prev["week"] = prev["week"] + 1
    prev["returning"] = 1.0
    df = df.merge(prev, on=["season", "week", "team", "gsis_id"], how="left")
    df["returning"] = df["returning"].fillna(0.0)
    return df


# ------------------------------------------------------------------ team pace
def add_pace(df):
    tm = (df.groupby(["season", "week", "team"])["team_off_snaps"].max()
          .rename("tos").reset_index().sort_values(["team", "season", "week"]))
    tm["team_pace_prior"] = (tm.groupby(["team", "season"])["tos"].shift(1)
                             .groupby([tm.team, tm.season])
                             .transform(lambda s: s.expanding(min_periods=1).mean()))
    return df.merge(tm[["season", "week", "team", "team_pace_prior"]],
                    on=["season", "week", "team"], how="left")


def build():
    df = pd.read_csv("../panel_raw.csv", low_memory=False)
    df = df.drop(columns=["report_status", "practice_status"], errors="ignore")
    inj = injury_table()

    df = add_lagged(df)
    df = add_group(df, inj)
    df = add_own_status(df, inj)
    df = add_pace(df)

    # touch shares (for the volume layer)
    for col, out in (("carries", "rush_share"), ("targets", "target_share")):
        tot = (df.groupby(["season", "week", "team"])[col].transform("sum"))
        df[out] = df[col] / tot.replace(0, np.nan)

    return df


if __name__ == "__main__":
    d = build()
    d.to_csv("../panel_feat.csv", index=False)
    print("rows", len(d), "cols", d.shape[1])
    chk = ["ewm1", "ewm3", "ewm8", "prior_season_share", "vacated_out",
           "vacated_oracle", "depth_rank", "grp_prior_sum", "returning",
           "on_injury_report", "team_pace_prior"]
    print(d[chk].describe().T.round(3).to_string())
    print("\nvacated_out > 0 :", (d.vacated_out > 0).mean().round(3))
    print("vacated_oracle>0:", (d.vacated_oracle > 0).mean().round(3))
    print("\ncorr(vacated_out, vacated_oracle):",
          round(d.vacated_out.corr(d.vacated_oracle), 3))
