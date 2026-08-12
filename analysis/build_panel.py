"""
Assemble a point-in-time player-week panel for snap-share modelling.

Sources (nflverse-data):
  snap_counts  -> offense_pct  (player offensive snaps / team offensive snaps)
  injuries     -> final pre-game report + practice designation
  stats_player -> carries / targets (touch layer)
  players      -> pfr_id <-> gsis_id crosswalk

POINT-IN-TIME RULE
  Features for week W may use:
     - snap/touch outcomes through week W-1 only
     - the week-W injury report (published Friday, pre-game -> legitimate)
  Nothing else from week W.
"""
import pandas as pd
import numpy as np
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"
SEASONS = range(2016, 2025)
SKILL = {"RB", "WR", "TE", "QB", "FB"}


def _read(pattern, year):
    for ext in (".csv.gz", ".csv"):
        p = D / f"{pattern}_{year}{ext}"
        if p.exists() and p.stat().st_size > 1000:
            return pd.read_csv(p, low_memory=False)
    raise FileNotFoundError(f"{pattern}_{year}")


def load_snaps():
    frames = []
    for y in SEASONS:
        s = _read("snaps", y)
        s = s[s.game_type == "REG"]
        frames.append(s)
    s = pd.concat(frames, ignore_index=True)
    s = s[s.position.isin(SKILL)].copy()
    s["snap_share"] = s["offense_pct"].astype(float)
    # PFR reports pct as 0-1 in some seasons, 0-100 in others: normalise
    hi = s["snap_share"] > 1.5
    s.loc[hi, "snap_share"] = s.loc[hi, "snap_share"] / 100.0
    s["snap_share"] = s["snap_share"].clip(0, 1)
    keep = ["season", "week", "team", "opponent", "player", "pfr_player_id",
            "position", "offense_snaps", "snap_share"]
    return s[keep].rename(columns={"pfr_player_id": "pfr_id"})


def load_injuries():
    frames = []
    for y in SEASONS:
        i = _read("inj", y)
        i = i[i.game_type == "REG"]
        frames.append(i)
    i = pd.concat(frames, ignore_index=True)
    i = i[["season", "week", "team", "gsis_id", "report_status", "practice_status"]]
    # one row per player-week (last modified wins if duplicated)
    i = i.drop_duplicates(subset=["season", "week", "team", "gsis_id"], keep="last")
    return i


def load_touches():
    frames = []
    for y in SEASONS:
        d = _read("stats", y)
        cols = ["player_id", "season", "week", "team", "carries", "targets"]
        cols = [c for c in cols if c in d.columns]
        d = d[cols]
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        frames.append(d)
    t = pd.concat(frames, ignore_index=True)
    for c in ("carries", "targets"):
        if c not in t.columns:
            t[c] = np.nan
    t = t.rename(columns={"player_id": "gsis_id"})
    agg = {"carries": "sum", "targets": "sum"}
    return t.groupby(["gsis_id", "season", "week", "team"], as_index=False).agg(agg)


def crosswalk():
    p = pd.read_csv(D / "players.csv", low_memory=False)
    p = p[["gsis_id", "pfr_id"]].dropna()
    return p.drop_duplicates(subset=["pfr_id"])


def build():
    snaps = load_snaps()
    xw = crosswalk()
    snaps = snaps.merge(xw, on="pfr_id", how="left")

    inj = load_injuries()
    snaps = snaps.merge(inj, on=["season", "week", "team", "gsis_id"], how="left")

    tou = load_touches()
    snaps = snaps.merge(tou, on=["gsis_id", "season", "week", "team"], how="left")

    # team offensive snaps for the week (max across players ~ team total)
    team_snaps = (snaps.groupby(["season", "week", "team"])["offense_snaps"]
                  .max().rename("team_off_snaps").reset_index())
    snaps = snaps.merge(team_snaps, on=["season", "week", "team"], how="left")

    # position group (collapse FB into RB, QB kept separate)
    snaps["pos_grp"] = snaps["position"].replace({"FB": "RB"})

    snaps = snaps.sort_values(["pfr_id", "season", "week"]).reset_index(drop=True)
    return snaps


if __name__ == "__main__":
    df = build()
    df.to_csv("../panel_raw.csv", index=False)
    print("rows", len(df))
    print(df.groupby("pos_grp").size())
    print("\nid match rate:", df.gsis_id.notna().mean().round(4))
    print("injury report coverage:", df.report_status.notna().mean().round(4))
    print("touch coverage:", df.targets.notna().mean().round(4))
    print("\nsnap_share describe:")
    print(df.snap_share.describe())
    print("\nseasons:", sorted(df.season.unique()))
