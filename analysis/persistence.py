"""
Which prop attributes actually persist week to week?

Persistence (lag-1 within-player correlation, and split-half reliability) tells
you which attributes carry real signal and which are noise dressed as insight.
An attribute with near-zero persistence cannot help you predict next week no
matter how well it explains last week.

Decomposition being tested:
    rush_yards = carries x yards_per_carry
    rec_yards  = targets x catch_rate x yards_per_reception
Volume terms vs efficiency terms. The question is which half is predictable.
"""
import numpy as np
import pandas as pd
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"
SEASONS = range(2016, 2025)


def load():
    fr = []
    for y in SEASONS:
        d = pd.read_csv(D / f"stats_{y}.csv", low_memory=False)
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        fr.append(d)
    d = pd.concat(fr, ignore_index=True)
    d = d[d.position.isin(["RB", "WR", "TE"])].copy()

    # derived attributes
    d["ypc"] = d.rushing_yards / d.carries.replace(0, np.nan)
    d["catch_rate"] = d.receptions / d.targets.replace(0, np.nan)
    d["ypr"] = d.receiving_yards / d.receptions.replace(0, np.nan)
    d["yptarget"] = d.receiving_yards / d.targets.replace(0, np.nan)
    d["adot"] = d.receiving_air_yards / d.targets.replace(0, np.nan)
    d["yac_per_rec"] = d.receiving_yards_after_catch / d.receptions.replace(0, np.nan)
    d["rush_epa_per"] = d.rushing_epa / d.carries.replace(0, np.nan)
    d["rec_epa_per"] = d.receiving_epa / d.targets.replace(0, np.nan)
    return d.sort_values(["player_id", "season", "week"]).reset_index(drop=True)


def persistence(d, col, min_obs, pos=None, min_denom=None, denom=None):
    """Lag-1 within-player, within-season correlation."""
    s = d if pos is None else d[d.position.isin(pos)]
    s = s[["player_id", "season", "week", col] + ([denom] if denom else [])].copy()
    if denom and min_denom:
        s = s[s[denom] >= min_denom]
    s = s.dropna(subset=[col])
    s["lag"] = s.groupby(["player_id", "season"])[col].shift(1)
    s = s.dropna(subset=["lag"])
    # require players with enough observations to be meaningful
    cnt = s.groupby(["player_id", "season"])[col].transform("size")
    s = s[cnt >= min_obs]
    if len(s) < 200:
        return np.nan, len(s)
    return float(s[col].corr(s["lag"])), len(s)


def main():
    d = load()
    print("=" * 84)
    print(f"WEEK-TO-WEEK PERSISTENCE  ({d.season.min()}-{d.season.max()}, "
          f"{len(d):,} player-weeks)")
    print("=" * 84)
    print("Lag-1 within-player correlation. Higher = more predictable.\n")

    specs = [
        # (label, column, positions, denom filter)
        ("--- VOLUME / ROLE", None, None, None),
        ("target_share",        "target_share",   ["WR", "TE"], None),
        ("air_yards_share",     "air_yards_share", ["WR", "TE"], None),
        ("wopr (weighted opp)", "wopr",           ["WR", "TE"], None),
        ("targets",             "targets",        ["WR", "TE"], None),
        ("carries",             "carries",        ["RB"],       None),
        ("receptions",          "receptions",     ["WR", "TE"], None),
        ("--- ROLE CHARACTER", None, None, None),
        ("aDOT (depth of tgt)", "adot",           ["WR", "TE"], ("targets", 3)),
        ("--- EFFICIENCY", None, None, None),
        ("catch_rate",          "catch_rate",     ["WR", "TE"], ("targets", 3)),
        ("yards per reception", "ypr",            ["WR", "TE"], ("receptions", 3)),
        ("yards per target",    "yptarget",       ["WR", "TE"], ("targets", 3)),
        ("YAC per reception",   "yac_per_rec",    ["WR", "TE"], ("receptions", 3)),
        ("racr",                "racr",           ["WR", "TE"], ("targets", 3)),
        ("yards per carry",     "ypc",            ["RB"],       ("carries", 5)),
        ("rush EPA per carry",  "rush_epa_per",   ["RB"],       ("carries", 5)),
        ("rec EPA per target",  "rec_epa_per",    ["WR", "TE"], ("targets", 3)),
        ("--- THE PROP ITSELF", None, None, None),
        ("receiving_yards",     "receiving_yards", ["WR", "TE"], None),
        ("rushing_yards",       "rushing_yards",  ["RB"],       None),
        ("receiving_tds",       "receiving_tds",  ["WR", "TE"], None),
        ("rushing_tds",         "rushing_tds",    ["RB"],       None),
    ]

    for label, col, pos, dn in specs:
        if col is None:
            print(f"\n{label}")
            continue
        denom, mind = (dn if dn else (None, None))
        r, n = persistence(d, col, min_obs=4, pos=pos, denom=denom, min_denom=mind)
        bar = "#" * int(max(r, 0) * 40) if not np.isnan(r) else ""
        print(f"  {label:<22}{r:>7.3f}  n={n:>6,}  {bar}")

    # --------------------------------------------------- variance decomposition
    print("\n" + "=" * 84)
    print("WHERE DOES THE VARIANCE COME FROM?")
    print("=" * 84)
    print("log(yards) = log(volume) + log(efficiency).  Share of variance:\n")

    rb = d[(d.position == "RB") & (d.carries >= 5) & (d.rushing_yards > 0)].copy()
    rb["lv"] = np.log(rb.carries)
    rb["le"] = np.log(rb.ypc.clip(lower=0.5))
    rb["ly"] = np.log(rb.rushing_yards.clip(lower=1))
    vv, ve = rb["lv"].var(), rb["le"].var()
    cv = 2 * rb["lv"].cov(rb["le"])
    tot = vv + ve + cv
    print(f"  RUSHING YARDS (RB, >=5 carries, n={len(rb):,})")
    print(f"    volume (carries)     {100*vv/tot:>6.1f}%")
    print(f"    efficiency (ypc)     {100*ve/tot:>6.1f}%")
    print(f"    covariance           {100*cv/tot:>6.1f}%")

    wr = d[(d.position.isin(["WR", "TE"])) & (d.targets >= 3)
           & (d.receiving_yards > 0)].copy()
    wr["lv"] = np.log(wr.targets)
    wr["le"] = np.log(wr.yptarget.clip(lower=0.3))
    vv, ve = wr["lv"].var(), wr["le"].var()
    cv = 2 * wr["lv"].cov(wr["le"])
    tot = vv + ve + cv
    print(f"\n  RECEIVING YARDS (WR/TE, >=3 targets, n={len(wr):,})")
    print(f"    volume (targets)     {100*vv/tot:>6.1f}%")
    print(f"    efficiency (yds/tgt) {100*ve/tot:>6.1f}%")
    print(f"    covariance           {100*cv/tot:>6.1f}%")


if __name__ == "__main__":
    main()
