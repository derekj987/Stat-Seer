"""A starter back from injury: project him off his ROLE, not off the game he got hurt in.

Derek: "Sam Darnold is coming back from injury today and it looks like his numbers are off. We are
projecting his passing yards way under." 130 against a 221.5 line.

His whole 2026 is one week: two attempts, 13 yards, five snaps — 10% of a game, because he was
hurt in the first quarter. blend_current weights that as a FULL GAME against a full prior season
(CUR_K = 1.0, so n/(n+K) = 50%) and halves him. The role layer cannot rescue it: apply_role weighs
the role median by CAREER games, so his 2.0 of role_k lands against n = 18 and moves him 10%.

FOUR GENERAL FIXES WERE TRIED FIRST AND ALL FAILED (analysis/snap_weight_backtest.py): dropping
low-snap weeks, snap-weighting the sample, ignoring degenerate samples, and a QB-specific
no-start rule. They fail for one reason — the population is dominated by genuine reserves and
backups, for whom a tiny current sample is INFORMATIVE ("he is not playing much") while the prior
season overstates them. Darnold is the rare inverse.

So the rule cannot key on volume or snaps. It has to key on the thing that actually separates him:
HE IS A LISTED STARTER WHO MISSED TIME AND IS BACK. That is the depth chart plus the injury
report, both knowable before kickoff, and neither is in his game log.

    returning starter at week W
      * depth-chart rank 1 at his position going into W          (role)
      * missed at least MIN_MISSED of the previous weeks         (absence)
      * has a usable prior-season rate                           (something to fall back on)

    candidates, all predicting his volume in week W
      blend      what ships: (n_cur * cur_pg + CUR_K * prior_pg) / (n_cur + CUR_K)
      prior      his prior-season per-game rate
      role       the median volume of that depth slot
      role+prior the average of the two

    train 2021-2024   choose        hold 2025-2026   report only

    python analysis/returning_starter_backtest.py
"""
from __future__ import annotations

import os
import statistics
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from role_weight_backtest import ranks_by_week  # noqa: E402
from player_proj_export import CUR_K  # noqa: E402
import injury_adj as IA  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
FIELD = {"WR": "targets", "TE": "targets", "RB": "carries", "QB": "attempts"}
OUT_LIKE = {"out", "doubtful"}
MIN_MISSED = 2          # weeks absent before "returning" means anything
STARTER_RANK = 2        # rank 1 or 2 at his position; WR2 is a starter in any real sense
MAX_CUR_GAMES = 3       # a thin current sample is the whole point; past this he has re-established
VOL_FLOOR = 0.35        # current volume below this share of his slot's median = not a real sample


def load(season):
    p = f"data/stats_{season}.csv"
    if not os.path.exists(p):
        return None
    s = pd.read_csv(p, low_memory=False)
    s = s[s.season_type == "REG"].copy()
    for c in ("targets", "carries", "attempts"):
        s[c] = pd.to_numeric(s.get(c), errors="coerce").fillna(0.0)
    s["week"] = pd.to_numeric(s.week, errors="coerce")
    return s.dropna(subset=["week"])


def main():
    rows = []
    for season in SEASONS:
        st, prev = load(season), load(season - 1)
        charts = ranks_by_week(season)
        inj = IA._inj_for(season)
        if st is None or prev is None or not charts or inj is None or not len(inj):
            continue
        # Prior-season per-game rate, and the role median per (pos, rank) from LAST season, so the
        # baseline never sees the season it is predicting.
        pri, by_slot = {}, {}
        pchart = ranks_by_week(season - 1) or {}
        last_pweek = max(pchart) if pchart else None
        for pid, g in prev.groupby("player_id"):
            pos = str(g.iloc[-1].position)
            f = FIELD.get(pos)
            if not f:
                continue
            rate = g[f].sum() / max(g.week.nunique(), 1)
            pri[str(pid)] = (pos, rate)
            slot = (pchart.get(last_pweek) or {}).get(str(pid))
            if slot:
                by_slot.setdefault(slot, []).append(rate)
        rolevol = {k: statistics.median(v) for k, v in by_slot.items() if len(v) >= 4}

        outs = {}
        for _, r in inj.iterrows():
            if str(r.get("report_status") or "").strip().lower() not in OUT_LIKE:
                continue
            try:
                outs.setdefault(str(r.gsis_id), set()).add(int(r.week))
            except Exception:  # noqa: BLE001
                continue

        for pid, g in st.groupby("player_id"):
            g = g.sort_values("week")
            key = str(pid)
            if key not in pri:
                continue
            pos, prate = pri[key]
            f = FIELD.get(pos)
            if not f:
                continue
            wks = g.week.astype(int).tolist()
            vals = g[f].tolist()
            missed = outs.get(key, set())
            for i, wk in enumerate(wks):
                chart = charts.get(wk) or charts.get(max((k for k in charts if k < wk), default=-1)) or {}
                slot = chart.get(key)
                if not slot or slot[1] > STARTER_RANK:
                    continue                            # listed starters only
                if i > MAX_CUR_GAMES:
                    continue
                cur = vals[:i]
                n = float(len(cur))
                cur_pg = (sum(cur) / n) if n else 0.0
                role = rolevol.get(slot)
                if role is None:
                    continue
                # THE DEFINING SHAPE, and it is not "he missed N weeks". Counting absences found
                # 353 rows of which 348 were receivers and ONE was a quarterback -- and Darnold
                # himself would not have qualified, because he missed a single week.
                #
                # What actually describes him: a LISTED STARTER whose season so far is a small
                # fraction of what his slot normally does. That means one of two things -- he lost
                # the job, or he did not finish a game -- and the depth chart says he still has it.
                # Observable before kickoff, and it does not care why he was absent.
                if n == 0 or cur_pg > VOL_FLOOR * role:
                    continue
                rows.append({"season": season, "pos": pos, "y": float(vals[i]),
                             "blend": ((n * cur_pg + CUR_K * prate) / (n + CUR_K)) if n
                                      else prate,
                             "prior": prate, "role": role,
                             "roleprior": (role + prate) / 2.0})

    d = pd.DataFrame(rows)
    print(f"{len(d):,} weeks: listed starter (rank <= {STARTER_RANK}), <= {MAX_CUR_GAMES} games "
          f"played, current volume under {VOL_FLOOR:.0%} of his slot's median")
    if d.empty:
        return 0
    print(f"  by position: {d.pos.value_counts().to_dict()}")
    tr, ho = d[d.season.isin(TRAIN)], d[d.season.isin(HOLD)]
    print(f"  train {len(tr):,}   held-out {len(ho):,}")
    thin = len(tr) < 40 or len(ho) < 15
    if thin:
        print("  NOTE: held-out sample is small; the table below is direction, not a decision.")
    cands = ["blend", "prior", "role", "roleprior"]
    mae = lambda s, c: float((s[c] - s.y).abs().mean())
    print(f"\n  {'candidate':>10s} {'train MAE':>10s} {'held MAE':>10s}")
    for c in cands:
        print(f"  {c:>10s} {mae(tr, c):10.3f} {mae(ho, c):10.3f}")
    best = min(cands, key=lambda c: mae(tr, c))
    print(f"\n  train picks: {best}")
    print(f"  HELD OUT   shipping ('blend') {mae(ho, 'blend'):.3f}   "
          f"chosen ('{best}') {mae(ho, best):.3f}   "
          f"{(mae(ho, 'blend') - mae(ho, best)) / mae(ho, 'blend') * 100:+.1f}%")
    # QBs alone — the case that prompted this, and the one with the biggest volume scale.
    for pos in ("QB", "RB", "WR"):
        sub_t, sub_h = tr[tr.pos == pos], ho[ho.pos == pos]
        if len(sub_t) < 15 or len(sub_h) < 8:
            continue
        b = min(cands, key=lambda c: mae(sub_t, c))
        print(f"    {pos}: train picks {b:>9s}   held blend {mae(sub_h,'blend'):7.3f} "
              f"-> {b} {mae(sub_h,b):7.3f}  "
              f"{(mae(sub_h,'blend') - mae(sub_h,b)) / max(mae(sub_h,'blend'),1e-9) * 100:+.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
