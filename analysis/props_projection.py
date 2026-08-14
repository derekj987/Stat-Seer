"""
Props projection model — stages 1-4 (volume x regressed efficiency), backtested.

The whole project's core finding, applied to props:
  * VOLUME persists (carries 0.678, targets 0.586, target share 0.623) -> project it.
  * EFFICIENCY does NOT (YPC 0.058, catch rate 0.094, YPR 0.117) -> DON'T use the
    player's recent efficiency; multiply projected volume by a POSITION baseline.
  * Never model yards directly.

So the model projects, for each player-week:
    proj_carries      = regressed season-to-date carries  (toward prior-season)
    proj_targets      = regressed season-to-date targets
    proj_rush_yards   = proj_carries  * league YPC (position, prior seasons only)
    proj_receptions   = proj_targets  * league catch-rate
    proj_rec_yards    = proj_receptions * league YPR

Baselines it must beat (these use recent YARDS directly, inheriting efficiency noise):
    persistence   = last week's actual yards
    season-avg    = mean of this season's prior weeks' actual yards

Walk-forward, test seasons 2021-2025. Efficiency baselines use STRICTLY prior
seasons (no leakage). Evaluated only on prop-relevant roles (a real volume floor)
and once a player has >= 4 games of current-season history, so every method is
well-defined on the same rows.

    python analysis/props_projection.py
"""
import numpy as np
import pandas as pd

SEASONS = range(2016, 2026)
TEST = range(2021, 2026)
POS = {"RB", "FB", "WR", "TE"}
K = 4.0          # games of regression toward the prior-season per-game rate
MIN_PRIOR = 4    # current-season games required before we grade a week
VOL = ["carries", "targets", "receptions", "rushing_yards", "receiving_yards"]


def load():
    frames = []
    for y in SEASONS:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        s = s[(s.season_type == "REG") & s.position.isin(POS)]
        keep = ["player_id", "position", "season", "week",
                "carries", "rushing_yards", "targets", "receptions", "receiving_yards"]
        frames.append(s[[c for c in keep if c in s.columns]].copy())
    df = pd.concat(frames, ignore_index=True)
    for c in VOL:
        df[c] = df[c].fillna(0.0)
    return df.sort_values(["player_id", "season", "week"]).reset_index(drop=True)


def sd_prior(df, col):
    """Season-to-date mean over PRIOR weeks only (excludes current week)."""
    return df.groupby(["player_id", "season"])[col].transform(lambda x: x.shift().expanding().mean())


def ewma_prior(df, col, span=3):
    """Recency-weighted mean over PRIOR weeks only — responds to volume shifts."""
    return df.groupby(["player_id", "season"])[col].transform(
        lambda x: x.shift().ewm(span=span, min_periods=1).mean())


def recent2_prior(df, col):
    """Mean of the last 2 prior weeks — used only to DETECT a volume change pre-game."""
    return df.groupby(["player_id", "season"])[col].transform(
        lambda x: x.shift().rolling(2, min_periods=1).mean())


def eff_baselines(df, before):
    """Pooled position efficiency from strictly prior seasons."""
    t = df[df.season < before]
    out = {}
    for pos in POS:
        p = t[t.position == pos]
        out[pos] = {
            "ypc": p.rushing_yards.sum() / max(p.carries.sum(), 1.0),
            "cr": p.receptions.sum() / max(p.targets.sum(), 1.0),
            "ypr": p.receiving_yards.sum() / max(p.receptions.sum(), 1.0),
        }
    return out


def mae(a, b):
    return float(np.mean(np.abs(np.asarray(a) - np.asarray(b))))


def build_projections():
    """Full walk-forward panel with volume projections, efficiency baselines, model
    projections, and naive baselines. Reused by the distribution layer."""
    df = load()

    # --- volume: season-to-date prior means + games so far ---
    for c in ["carries", "targets", "receptions", "rushing_yards", "receiving_yards"]:
        df[f"sd_{c}"] = sd_prior(df, c)
    df["ew_carries"] = ewma_prior(df, "carries")
    df["ew_targets"] = ewma_prior(df, "targets")
    df["r2_carries"] = recent2_prior(df, "carries")
    df["r2_targets"] = recent2_prior(df, "targets")
    df["nprior"] = df.groupby(["player_id", "season"]).cumcount()

    # --- prior-season per-game (join season Y to means from Y-1) ---
    pg = df.groupby(["player_id", "season"])[VOL].mean().reset_index()
    pg["season"] = pg["season"] + 1
    pg = pg.rename(columns={c: f"ps_{c}" for c in VOL})
    df = df.merge(pg, on=["player_id", "season"], how="left")

    # --- regressed projected volume: blend season-to-date with prior-season ---
    def proj_vol(vol_col, ps_col):
        vv = df[vol_col]; ps = df[ps_col]; n = df["nprior"]
        blend = (vv * n + ps * K) / (n + K)          # both present
        blend = blend.where(ps.notna(), vv)          # no prior season -> use the volume est
        blend = blend.where(n > 0, ps)               # no current games -> prior season
        return blend
    # season-to-date volume projection (lags shifts) and recency-weighted (catches them)
    df["proj_carries"] = proj_vol("sd_carries", "ps_carries")
    df["proj_targets"] = proj_vol("sd_targets", "ps_targets")
    df["proje_carries"] = proj_vol("ew_carries", "ps_carries")
    df["proje_targets"] = proj_vol("ew_targets", "ps_targets")

    # volume-change flag (pre-game only): last-2-game volume vs season-to-date
    df["chg_rush"] = (df.r2_carries - df.sd_carries).abs() / df.sd_carries.clip(lower=1)
    df["chg_rec"] = (df.r2_targets - df.sd_targets).abs() / df.sd_targets.clip(lower=1)

    # --- efficiency baselines per test season (prior seasons only) ---
    df["ypc"] = np.nan; df["cr"] = np.nan; df["ypr"] = np.nan
    for Y in TEST:
        b = eff_baselines(df, Y)
        for pos in POS:
            m = (df.season == Y) & (df.position == pos)
            df.loc[m, "ypc"] = b[pos]["ypc"]
            df.loc[m, "cr"] = b[pos]["cr"]
            df.loc[m, "ypr"] = b[pos]["ypr"]

    # --- model projections (volume x regressed efficiency) ---
    df["m_rush"] = df.proj_carries * df.ypc              # season-to-date volume
    df["m_recpt"] = df.proj_targets * df.cr
    df["m_recyd"] = df.m_recpt * df.ypr
    df["me_rush"] = df.proje_carries * df.ypc            # recency-weighted volume
    df["me_recpt"] = df.proje_targets * df.cr
    df["me_recyd"] = df.me_recpt * df.ypr

    # --- baselines: persistence (last week) & season-to-date mean of ACTUAL yards ---
    def persist(col):
        p = df.groupby(["player_id", "season"])[col].shift(1)
        return p.where(p.notna(), df[f"ps_{col}"])
    df["p_rush"] = persist("rushing_yards")
    df["p_recyd"] = persist("receiving_yards")
    df["p_recpt"] = persist("receptions")
    return df


def main():
    df = build_projections()

    test = df[df.season.isin(TEST) & (df.nprior >= MIN_PRIOR)].copy()
    CHG = 0.35   # >=35% swing in last-2 vs season-to-date volume = a "change" week

    def block(name, mask, actual, m_sd, m_ew, sd_base, persist_base, chg_col):
        s = test[mask].dropna(subset=[actual, m_sd, m_ew, sd_base, persist_base, chg_col])
        if not len(s):
            print(f"\n{name}: no rows"); return

        def line(tag, sub):
            mp = mae(sub[actual], sub[persist_base])
            ms = mae(sub[actual], sub[sd_base])
            m1 = mae(sub[actual], sub[m_sd])
            m2 = mae(sub[actual], sub[m_ew])
            g = (ms - m2) / ms * 100
            print(f"  {tag:<16} n={len(sub):>5,}  persist {mp:6.2f}  "
                  f"season-avg {ms:6.2f}  model {m1:6.2f}  model-EWMA {m2:6.2f}"
                  f"   (EWMA {g:+.1f}% vs season-avg)")

        print(f"\n{name}  (n={len(s):,})")
        line("ALL", s)
        line("change wk", s[s[chg_col] >= CHG])
        line("stable wk", s[s[chg_col] < CHG])

    print(f"loaded {len(df):,} skill player-weeks; grading {len(test):,} "
          f"(test {min(TEST)}-{max(TEST)}, >= {MIN_PRIOR} prior games)")
    print("model = season-to-date volume x eff; model-EWMA = recency-weighted volume x eff")

    block("RUSHING YARDS (RB/FB, proj carries >= 8)",
          (test.position.isin(["RB", "FB"])) & (test.proj_carries >= 8),
          "rushing_yards", "m_rush", "me_rush", "sd_rushing_yards", "p_rush", "chg_rush")

    block("RECEIVING YARDS (WR/TE, proj targets >= 3)",
          (test.position.isin(["WR", "TE"])) & (test.proj_targets >= 3),
          "receiving_yards", "m_recyd", "me_recyd", "sd_receiving_yards", "p_recyd", "chg_rec")

    block("RECEPTIONS (WR/TE, proj targets >= 3)",
          (test.position.isin(["WR", "TE"])) & (test.proj_targets >= 3),
          "receptions", "m_recpt", "me_recpt", "sd_receptions", "p_recpt", "chg_rec")


if __name__ == "__main__":
    main()
