"""Should this season's sample be weighted by GAMES PLAYED or by SNAPS PLAYED?

Derek: "Sam Darnold is coming back from injury today and it looks like his numbers are off."
We had him at 130 passing yards against a 221.5 line. His entire 2026 was one week: two attempts,
13 yards, five snaps — 10% of a game, because he was hurt in the first quarter. blend_current
weighted that as a full game against a full prior season (CUR_K = 1.0, so n/(n+K) = 50%) and
halved his projection.

TWO CANDIDATE FIXES, and only one of them survives.

  A. DROP the low-snap weeks.  Failed. Floor 0.00 beat every floor on train AND held-out
     (all positions: 2.8249 no filter vs 2.8935 at a 10% floor; QBs 8.2327 vs 8.2387), because
     for most players a light week is genuine role variation and carries information. Deleting it
     throws away signal to fix one case.

  B. WEIGHT this season by snaps rather than games — keep every week, change the sample size.
     Darnold's one appearance becomes 0.1 of a game instead of 1.0, so the prior carries him.

This tests B the way the project tests everything: choose on train, report held-out.

    blend       pred = (n * cur_pg + CUR_K * prior_pg) / (n + CUR_K)
    games       n = number of weeks he appears in          (what shipped)
    snaps       n = sum of his offensive snap shares       (what B proposes)

    train 2021-2024    hold 2025-2026
    python analysis/snap_weight_backtest.py
"""
from __future__ import annotations

import os
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from player_proj_export import CUR_K, norm  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2022, 2023, 2024}, {2025, 2026}
FIELD = {"WR": "targets", "TE": "targets", "RB": "carries", "QB": "attempts"}


def snap_path(season):
    for c in (f"data/snaps_{season}.csv", f"data/snaps_{season}.csv.gz"):
        if os.path.exists(c):
            return c
    return None


def season_frames(season):
    sp, pp = f"data/stats_{season}.csv", snap_path(season)
    if not (os.path.exists(sp) and pp):
        return None, None
    st = pd.read_csv(sp, low_memory=False)
    st = st[st.season_type == "REG"].copy()
    for c in ("targets", "carries", "attempts"):
        st[c] = pd.to_numeric(st.get(c), errors="coerce").fillna(0.0)
    st["week"] = pd.to_numeric(st.week, errors="coerce")
    sn = pd.read_csv(pp, low_memory=False)
    if "game_type" in sn.columns:
        sn = sn[sn.game_type == "REG"]
    sn["offense_pct"] = pd.to_numeric(sn.get("offense_pct"), errors="coerce").fillna(0.0)
    sn["week"] = pd.to_numeric(sn.week, errors="coerce")
    return st, sn


def main():
    rows = []
    for season in SEASONS:
        st, sn = season_frames(season)
        prior, _ = season_frames(season - 1)
        if st is None or prior is None:
            continue
        # Last season's per-game volume, the shrinkage target.
        pri = {}
        for pid, g in prior.groupby("player_id"):
            pos = str(g.iloc[-1].position)
            f = FIELD.get(pos)
            if f:
                pri[str(pid)] = g[f].sum() / max(g.week.nunique(), 1)
        share = {(norm(str(r.player)), str(r.team), int(r.week)): float(r.offense_pct)
                 for r in sn.itertuples() if pd.notna(r.week)}
        for pid, g in st.groupby("player_id"):
            g = g.dropna(subset=["week"]).sort_values("week")
            pos = str(g.iloc[-1].position)
            f = FIELD.get(pos)
            p0 = pri.get(str(pid))
            if not f or p0 is None or len(g) < 2:
                continue
            nm = norm(str(g.iloc[-1].player_display_name))
            wks = g.week.astype(int).tolist()
            vals = g[f].tolist()
            teams = g.team.astype(str).tolist()
            sh = [share.get((nm, teams[i], wks[i]), 1.0) for i in range(len(wks))]
            # Predict each week from everything BEFORE it — the causal walk the export does.
            for i in range(1, len(vals)):
                cur_pg = sum(vals[:i]) / i
                rows.append({"season": season, "pos": pos, "y": float(vals[i]),
                             "cur": cur_pg, "prior": float(p0),
                             "n_games": float(i), "n_snaps": float(sum(sh[:i]))})
    d = pd.DataFrame(rows)
    print(f"{len(d):,} player-weeks with a prior-season rate and snap data")

    def mae(sub, col):
        pred = (sub[col] * sub.cur + CUR_K * sub.prior) / (sub[col] + CUR_K)
        return float((pred - sub.y).abs().mean())

    for label, sub in (("ALL", d), ("QB only", d[d.pos == "QB"]),
                       ("first 3 weeks of a season", d[d.n_games <= 3])):
        tr, ho = sub[sub.season.isin(TRAIN)], sub[sub.season.isin(HOLD)]
        if len(tr) < 300 or len(ho) < 100:
            print(f"\n{label}: too few ({len(tr)}/{len(ho)})")
            continue
        tg, ts = mae(tr, "n_games"), mae(tr, "n_snaps")
        hg, hs = mae(ho, "n_games"), mae(ho, "n_snaps")
        pick = "snaps" if ts < tg else "games"
        print(f"\n{label}:  train {len(tr):,}  held-out {len(ho):,}")
        print(f"  train   games {tg:.4f}   snaps {ts:.4f}   -> train picks {pick}")
        print(f"  HELD OUT games {hg:.4f}   snaps {hs:.4f}   "
              f"{(hg - hs) / hg * 100:+.2f}% for snaps")
    # C. THE NARROW GUARD. Neither global rule survived, but the case that prompted this is not a
    # global one: a player whose ENTIRE season so far is a fraction of one game, who also has a
    # full prior season. Does ignoring the current sample beat blending it, on those rows only?
    print("\n=== C. degenerate current-season samples only (total snaps < THRESH games) ===")
    for thresh in (0.3, 0.5, 0.8, 1.0):
        sub = d[d.n_snaps < thresh]
        tr, ho = sub[sub.season.isin(TRAIN)], sub[sub.season.isin(HOLD)]
        if len(tr) < 40 or len(ho) < 20:
            print(f"  thresh {thresh:.1f}: too few ({len(tr)}/{len(ho)})")
            continue
        blend_tr, blend_ho = mae(tr, "n_games"), mae(ho, "n_games")
        prior_tr = float((tr.prior - tr.y).abs().mean())
        prior_ho = float((ho.prior - ho.y).abs().mean())
        pick = "prior-only" if prior_tr < blend_tr else "blend"
        print(f"  thresh {thresh:.1f}  n tr/ho {len(tr):4d}/{len(ho):4d}   "
              f"train blend {blend_tr:.3f} prior {prior_tr:.3f} -> {pick:10s} "
              f"| HELD blend {blend_ho:.3f} prior {prior_ho:.3f} "
              f"{(blend_ho - prior_ho) / blend_ho * 100:+.1f}%")
    qb_no_start_test()
    return 0




def qb_no_start_test():
    """D. The one case the shipped code already has a concept for, and gets wrong.

    current_season_rates computes a QB's att_pg from his weeks with >= 15 attempts ("starts"),
    and when he has NONE it falls back to his non-start weeks. That fallback is how Darnold's
    5-snap, 2-attempt cameo became his rate. Is prior-season-only better for that exact case?"""
    rows = []
    for season in SEASONS:
        st, sn = season_frames(season)
        prior, _ = season_frames(season - 1)
        if st is None or prior is None:
            continue
        pri = {}
        for pid, g in prior.groupby("player_id"):
            if str(g.iloc[-1].position) == "QB":
                s = g[g.attempts >= 15]
                if s.week.nunique() >= 4:
                    pri[str(pid)] = s.attempts.sum() / s.week.nunique()
        for pid, g in st.groupby("player_id"):
            g = g.dropna(subset=["week"]).sort_values("week")
            if str(g.iloc[-1].position) != "QB":
                continue
            p0 = pri.get(str(pid))
            if p0 is None or len(g) < 2:
                continue
            vals, wk = g.attempts.tolist(), g.week.astype(int).tolist()
            for i in range(1, len(vals)):
                hist = vals[:i]
                starts = [v for v in hist if v >= 15]
                if starts:
                    continue                      # he HAS a real start; not the case in question
                rows.append({"season": season, "y": float(vals[i]),
                             "cur": sum(hist) / len(hist), "prior": float(p0),
                             "n": float(len(hist))})
    d2 = pd.DataFrame(rows)
    print(f"\n=== D. QB-weeks whose season so far holds NO start of 15+ attempts ===")
    print(f"{len(d2):,} such weeks (he has a real prior season)")
    if len(d2) < 60:
        print("  too few to choose on"); return
    tr, ho = d2[d2.season.isin(TRAIN)], d2[d2.season.isin(HOLD)]
    if len(tr) < 30 or len(ho) < 15:
        print(f"  too few per split ({len(tr)}/{len(ho)})"); return
    def blend(s):
        return ((s.n * s.cur + CUR_K * s.prior) / (s.n + CUR_K) - s.y).abs().mean()
    b_tr, p_tr = float(blend(tr)), float((tr.prior - tr.y).abs().mean())
    b_ho, p_ho = float(blend(ho)), float((ho.prior - ho.y).abs().mean())
    pick = "PRIOR-ONLY" if p_tr < b_tr else "blend"
    print(f"  train  n={len(tr):4d}  blend {b_tr:.3f}  prior-only {p_tr:.3f}  -> train picks {pick}")
    print(f"  HELD   n={len(ho):4d}  blend {b_ho:.3f}  prior-only {p_ho:.3f}  "
          f"{(b_ho - p_ho) / b_ho * 100:+.1f}% for prior-only")


if __name__ == "__main__":
    sys.exit(main())
