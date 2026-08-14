"""
Backtest: does an offseason "returning production" signal improve the preseason
rating beyond last-year point differential alone?

Discipline (CLAUDE.md): a factor enters The Model only if it is observable,
recorded historically, mechanism stated in advance, and improves results OUT OF
SAMPLE. This is line-blind (The Model), so the bar is forecast accuracy of a
team's this-year point differential — NOT beating the closing line.

Metric — Returning Production (RP) for team T entering season Y:
    share of T's year (Y-1) offense+defense snaps taken by players who are still
    on T in year Y. (Snap-weighted retention. College SP+ uses the same idea.)
    Caveat: uses year-Y snaps to decide "who stayed," a mild look-ahead; the
    clean preseason version would use week-1 rosters. Fine for signal detection.

Mechanism stated in advance: high RP -> last year's rating should carry MORE
(regress less); low RP -> regress more. So RP enters as an interaction with
prev-year point differential, plus a small main effect.

Models compared, all predicting y = team's mean point diff in year Y:
    A (baseline):  y ~ 1 + prev
    B (main):      y ~ 1 + prev + rp
    C (interact):  y ~ 1 + prev + rp + prev*rp      <- the proposed mechanism

Evaluation: leave-one-SEASON-out CV over target years 2017..2025. Report
out-of-sample MAE and RMSE. A factor is only "in" if C (or B) beats A here.

    python analysis/roster_backtest.py
"""
import numpy as np
import pandas as pd

FIRST_SNaps = 2016          # snap data availability
TARGETS = range(2017, 2026)  # transitions (Y-1 -> Y) we can score


def point_diff(games, season):
    """Mean point differential per team over a completed REG season (per game)."""
    s = games[(games.season == season) & (games.game_type == "REG") & games.home_score.notna()]
    diff, cnt = {}, {}
    for _, r in s.iterrows():
        m = r.home_score - r.away_score
        diff[r.home_team] = diff.get(r.home_team, 0) + m
        diff[r.away_team] = diff.get(r.away_team, 0) - m
        cnt[r.home_team] = cnt.get(r.home_team, 0) + 1
        cnt[r.away_team] = cnt.get(r.away_team, 0) + 1
    return {t: diff[t] / cnt[t] for t in diff}


def team_player_snaps(season):
    """team -> {pfr_player_id -> offense+defense snaps} for a REG season."""
    s = pd.read_csv(f"../data/snaps_{season}.csv.gz")
    s = s[s.game_type == "REG"].copy()
    s["od"] = s.offense_snaps.fillna(0) + s.defense_snaps.fillna(0)
    out = {}
    grp = s.groupby(["team", "pfr_player_id"])["od"].sum().reset_index()
    for _, r in grp.iterrows():
        out.setdefault(r.team, {})[r.pfr_player_id] = r.od
    return out


def returning_production(prev_snaps, cur_snaps):
    """RP[team] = share of prev-year O+D snaps by players still on the team this year."""
    rp = {}
    for team, players in prev_snaps.items():
        total = sum(players.values())
        if total <= 0:
            continue
        here_now = set(cur_snaps.get(team, {}).keys())
        kept = sum(sn for pid, sn in players.items() if pid in here_now)
        rp[team] = kept / total
    return rp


def build_rows(games):
    snaps = {y: team_player_snaps(y) for y in range(FIRST_SNaps, 2026)}
    rows = []
    for Y in TARGETS:
        prev = point_diff(games, Y - 1)
        cur = point_diff(games, Y)
        rp = returning_production(snaps[Y - 1], snaps[Y])
        for t in cur:
            if t in prev and t in rp:
                rows.append((Y, t, prev[t], rp[t], cur[t]))
    return pd.DataFrame(rows, columns=["year", "team", "prev", "rp", "y"])


def design(df, spec, rp_mean):
    prev = df.prev.to_numpy()
    rp = df.rp.to_numpy() - rp_mean          # center RP so main effect is at avg roster
    one = np.ones(len(df))
    if spec == "A":
        return np.column_stack([one, prev])
    if spec == "B":
        return np.column_stack([one, prev, rp])
    if spec == "C":
        return np.column_stack([one, prev, rp, prev * rp])
    raise ValueError(spec)


def loso_cv(df, spec):
    """Leave-one-season-out predictions; return array of errors aligned to df."""
    preds = np.full(len(df), np.nan)
    for Y in df.year.unique():
        tr = df[df.year != Y]
        te = df[df.year == Y]
        rp_mean = tr.rp.mean()                # fit centering on TRAIN only
        Xtr, ytr = design(tr, spec, rp_mean), tr.y.to_numpy()
        beta, *_ = np.linalg.lstsq(Xtr, ytr, rcond=None)
        Xte = design(te, spec, rp_mean)
        preds[te.index] = Xte @ beta
    err = preds - df.y.to_numpy()
    return err, preds


def report(df):
    print(f"observations: {len(df)}  (teams x transitions {df.year.min()}-{df.year.max()})")
    print(f"RP: mean {df.rp.mean():.3f}  sd {df.rp.std():.3f}  "
          f"range {df.rp.min():.2f}-{df.rp.max():.2f}\n")

    # raw correlations for intuition
    print(f"corr(prev, y)      = {np.corrcoef(df.prev, df.y)[0,1]:+.3f}")
    print(f"corr(rp,   y)      = {np.corrcoef(df.rp, df.y)[0,1]:+.3f}")
    # partial: does RP correlate with y AFTER removing what prev explains?
    b, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(df)), df.prev]), df.y, rcond=None)
    resid = df.y.to_numpy() - np.column_stack([np.ones(len(df)), df.prev]) @ b
    print(f"partial corr(rp, y | prev) = {np.corrcoef(df.rp, resid)[0,1]:+.3f}\n")

    base_mae = None
    print(f"{'model':<28}{'OOS MAE':>10}{'OOS RMSE':>10}{'vs A':>9}")
    for spec, name in [("A", "A  prev only (baseline)"),
                       ("B", "B  prev + rp"),
                       ("C", "C  prev + rp + prev*rp")]:
        err, _ = loso_cv(df, spec)
        mae = np.mean(np.abs(err))
        rmse = np.sqrt(np.mean(err**2))
        if spec == "A":
            base_mae = mae
            delta = ""
        else:
            d = mae - base_mae
            delta = f"{d:+.3f}"
        print(f"{name:<28}{mae:>10.3f}{rmse:>10.3f}{delta:>9}")

    # full-sample coefficients of C, for interpretation
    rp_mean = df.rp.mean()
    Xc = design(df, "C", rp_mean)
    beta, *_ = np.linalg.lstsq(Xc, df.y.to_numpy(), rcond=None)
    print(f"\nModel C full-sample coefs: intercept {beta[0]:+.3f}, "
          f"prev {beta[1]:+.3f}, rp {beta[2]:+.3f}, prev*rp {beta[3]:+.3f}")
    print("(prev*rp > 0 would mean: more returning production -> last year carries more.)")


def primary_qb(season):
    """team -> pfr_player_id of the QB with the most offense snaps that REG season."""
    s = pd.read_csv(f"../data/snaps_{season}.csv.gz")
    s = s[(s.game_type == "REG") & (s.position == "QB")].copy()
    s["off"] = s.offense_snaps.fillna(0)
    g = s.groupby(["team", "pfr_player_id"])["off"].sum().reset_index()
    out = {}
    for team, sub in g.groupby("team"):
        top = sub.sort_values("off", ascending=False).iloc[0]
        out[team] = top.pfr_player_id
    return out


def qb_probe(games, df):
    """Does 'same starting QB as last year' add signal beyond prev point diff?"""
    qbs = {y: primary_qb(y) for y in range(FIRST_SNaps, 2026)}
    same = []
    for _, r in df.iterrows():
        prevqb = qbs[r.year - 1].get(r.team)
        curqb = qbs[r.year].get(r.team)
        same.append(1.0 if (prevqb is not None and prevqb == curqb) else 0.0)
    d = df.copy()
    d["qb_same"] = same
    frac = d.qb_same.mean()
    print(f"\n--- QB continuity probe ---")
    print(f"teams keeping their primary QB: {frac:.0%}")
    # partial corr of qb_same with y after removing prev
    b, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(d)), d.prev]), d.y, rcond=None)
    resid = d.y.to_numpy() - np.column_stack([np.ones(len(d)), d.prev]) @ b
    print(f"partial corr(qb_same, y | prev) = {np.corrcoef(d.qb_same, resid)[0,1]:+.3f}")
    # OOS: baseline prev  vs  prev + qb_same + prev*qb_same
    def loso(cols):
        preds = np.full(len(d), np.nan)
        for Y in d.year.unique():
            tr, te = d[d.year != Y], d[d.year == Y]
            Xtr = np.column_stack([np.ones(len(tr))] + [tr[c].to_numpy() for c in cols])
            beta, *_ = np.linalg.lstsq(Xtr, tr.y.to_numpy(), rcond=None)
            Xte = np.column_stack([np.ones(len(te))] + [te[c].to_numpy() for c in cols])
            preds[te.index] = Xte @ beta
        e = preds - d.y.to_numpy()
        return np.mean(np.abs(e)), np.sqrt(np.mean(e**2))
    d["prev_qb"] = d.prev * d.qb_same
    a = loso(["prev"])
    b2 = loso(["prev", "qb_same"])
    c = loso(["prev", "qb_same", "prev_qb"])
    print(f"{'A prev only':<26}{a[0]:>10.3f} MAE {a[1]:>7.3f} RMSE")
    print(f"{'+ qb_same':<26}{b2[0]:>10.3f} MAE {b2[1]:>7.3f} RMSE   ({b2[0]-a[0]:+.3f})")
    print(f"{'+ qb_same + prev*qb_same':<26}{c[0]:>10.3f} MAE {c[1]:>7.3f} RMSE   ({c[0]-a[0]:+.3f})")


if __name__ == "__main__":
    games = pd.read_csv("../data/games.csv", low_memory=False)
    df = build_rows(games)
    report(df)
    qb_probe(games, df)
