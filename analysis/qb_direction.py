"""
Follow-up to roster_backtest.py — Derek's actual question: does the DIRECTION of a
QB change (did they UPGRADE or DOWNGRADE) predict this-year point differential
beyond (a) last year's point diff and (b) simply knowing the QB changed?

QB quality = season passing EPA per attempt (REG), the standard single-number QB
metric. For each team entering year Y:
    outQB = primary QB (most attempts) in Y-1; his rating = his Y-1 EPA/att.
    inQB  = primary QB in Y; his PRIOR rating = his most recent qualifying season
            (>= MIN_ATT attempts) strictly before Y.
    qb_delta = inQB_prior - outQB_prior   (0 if the QB is unchanged)

A positive qb_delta = the new guy has historically played better = an upgrade.
inQB with no qualifying prior (rookie / never-a-starter) = direction UNMEASURABLE;
those rows are excluded from the direction test and counted separately, because
"we can't see it in advance" is itself part of the answer.

Test, on the common set where qb_delta is defined:
    A    y ~ 1 + prev
    same y ~ 1 + prev + qb_changed        (mere change, from the prior script)
    dir  y ~ 1 + prev + qb_delta          (direction)
Leave-one-season-out CV, 2017..2025.  Direction is only worth adding if `dir`
beats both `A` and `same` out of sample.

    python analysis/qb_direction.py
"""
import numpy as np
import pandas as pd

YEARS = range(2016, 2026)
TARGETS = range(2017, 2026)
MIN_ATT = 150          # attempts needed for a season EPA/att to count as a rating


def point_diff(games, season):
    s = games[(games.season == season) & (games.game_type == "REG") & games.home_score.notna()]
    diff, cnt = {}, {}
    for _, r in s.iterrows():
        m = r.home_score - r.away_score
        diff[r.home_team] = diff.get(r.home_team, 0) + m
        diff[r.away_team] = diff.get(r.away_team, 0) - m
        cnt[r.home_team] = cnt.get(r.home_team, 0) + 1
        cnt[r.away_team] = cnt.get(r.away_team, 0) + 1
    return {t: diff[t] / cnt[t] for t in diff}


def load_qb_stats():
    """Return two dicts:
       primary[(season, team)] -> player_id (most team attempts that season)
       rating[(season, player_id)] -> (epa_per_att, attempts)   [player total, any team]
    """
    frames = []
    for y in YEARS:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        s = s[(s.position == "QB")].copy()
        if "season_type" in s.columns:
            s = s[s.season_type == "REG"]
        s["season"] = y
        frames.append(s[["season", "player_id", "team", "attempts", "passing_epa"]])
    df = pd.concat(frames, ignore_index=True)
    df["attempts"] = df.attempts.fillna(0)
    df["passing_epa"] = df.passing_epa.fillna(0)

    # primary QB per team-season = most attempts for THAT team
    byteam = df.groupby(["season", "team", "player_id"], as_index=False).agg(
        att=("attempts", "sum"), epa=("passing_epa", "sum"))
    primary = {}
    for (season, team), sub in byteam.groupby(["season", "team"]):
        top = sub.sort_values("att", ascending=False).iloc[0]
        primary[(season, team)] = top.player_id

    # player rating per season = total EPA / total attempts (across all his teams)
    byplayer = df.groupby(["season", "player_id"], as_index=False).agg(
        att=("attempts", "sum"), epa=("passing_epa", "sum"))
    rating = {}
    for _, r in byplayer.iterrows():
        rating[(r.season, r.player_id)] = (r.epa / r.att if r.att > 0 else np.nan, r.att)
    return primary, rating


def prior_rating(rating, player_id, before_year):
    """Most recent season < before_year with >= MIN_ATT attempts; else None."""
    best = None
    for y in range(before_year - 1, YEARS.start - 1, -1):
        v = rating.get((y, player_id))
        if v and v[1] >= MIN_ATT and not np.isnan(v[0]):
            return v[0]
    return best


def build(games):
    primary, rating = load_qb_stats()
    rows = []
    n_change = n_change_measurable = n_rookie = 0
    for Y in TARGETS:
        prev = point_diff(games, Y - 1)
        cur = point_diff(games, Y)
        for t in cur:
            if t not in prev:
                continue
            outq = primary.get((Y - 1, t))
            inq = primary.get((Y, t))
            if outq is None or inq is None:
                continue
            changed = inq != outq
            out_prior = prior_rating(rating, outq, Y)      # outgoing QB's Y-1 form
            in_prior = prior_rating(rating, inq, Y)         # incoming QB's pre-Y form
            if changed:
                n_change += 1
                if in_prior is None:
                    n_rookie += 1
                    continue                                # direction unmeasurable
                n_change_measurable += 1
            # delta defined: 0 if unchanged, else in-out (both need priors)
            if out_prior is None:
                continue
            delta = 0.0 if not changed else (in_prior - out_prior)
            rows.append((Y, t, prev[t], cur[t], 1.0 if changed else 0.0, delta))
    df = pd.DataFrame(rows, columns=["year", "team", "prev", "y", "qb_changed", "qb_delta"])
    print(f"QB changes total: {n_change}  | with measurable incoming prior: "
          f"{n_change_measurable}  | rookie/unmeasurable: {n_rookie} "
          f"({n_rookie/max(n_change,1):.0%} of changes)\n")
    return df


def loso(df, cols):
    preds = np.full(len(df), np.nan)
    idx = df.reset_index(drop=True)
    for Y in idx.year.unique():
        trm, tem = idx.year != Y, idx.year == Y
        tr, te = idx[trm], idx[tem]
        Xtr = np.column_stack([np.ones(len(tr))] + [tr[c].to_numpy() for c in cols])
        beta, *_ = np.linalg.lstsq(Xtr, tr.y.to_numpy(), rcond=None)
        Xte = np.column_stack([np.ones(len(te))] + [te[c].to_numpy() for c in cols])
        preds[np.where(tem)[0]] = Xte @ beta
    e = preds - idx.y.to_numpy()
    return np.mean(np.abs(e)), np.sqrt(np.mean(e**2))


def main():
    games = pd.read_csv("data/games.csv", low_memory=False)
    df = build(games)
    print(f"rows (direction defined): {len(df)}   "
          f"changed w/ measurable direction: {int(df.qb_changed.sum())}")
    chg = df[df.qb_changed == 1]
    print(f"of measurable changes: upgrades (delta>0) {int((chg.qb_delta>0).sum())}, "
          f"downgrades {int((chg.qb_delta<0).sum())}\n")

    # partial correlations after removing prev
    b, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(df)), df.prev]), df.y, rcond=None)
    resid = df.y.to_numpy() - np.column_stack([np.ones(len(df)), df.prev]) @ b
    print(f"partial corr(qb_changed, y | prev) = {np.corrcoef(df.qb_changed, resid)[0,1]:+.3f}")
    print(f"partial corr(qb_delta,   y | prev) = {np.corrcoef(df.qb_delta, resid)[0,1]:+.3f}")
    # among only the changed teams: does delta predict the change?
    rb, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(chg)), chg.prev]), chg.y, rcond=None)
    rresid = chg.y.to_numpy() - np.column_stack([np.ones(len(chg)), chg.prev]) @ rb
    print(f"partial corr(qb_delta, y | prev) AMONG CHANGES ONLY (n={len(chg)}) = "
          f"{np.corrcoef(chg.qb_delta, rresid)[0,1]:+.3f}\n")

    a = loso(df, ["prev"])
    s = loso(df, ["prev", "qb_changed"])
    d = loso(df, ["prev", "qb_delta"])
    b2 = loso(df, ["prev", "qb_changed", "qb_delta"])
    print(f"{'model (OOS, same rows)':<34}{'MAE':>8}{'RMSE':>8}{'vs A':>9}")
    print(f"{'A  prev only':<34}{a[0]:>8.3f}{a[1]:>8.3f}")
    print(f"{'    prev + qb_changed (binary)':<34}{s[0]:>8.3f}{s[1]:>8.3f}{s[0]-a[0]:>+9.3f}")
    print(f"{'    prev + qb_delta (direction)':<34}{d[0]:>8.3f}{d[1]:>8.3f}{d[0]-a[0]:>+9.3f}")
    print(f"{'    prev + both':<34}{b2[0]:>8.3f}{b2[1]:>8.3f}{b2[0]-a[0]:>+9.3f}")


if __name__ == "__main__":
    main()
