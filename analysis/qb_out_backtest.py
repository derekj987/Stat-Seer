"""Does knowing the QB1 is out IMPROVE a receiving-yards projection out of sample? NO.

Measuring that receivers lose ~8% of their yards (qb_out_receivers.py) is not the same claim as
"applying an 8% haircut makes the board better". The standing rule needs the third test, and this
is it — the one the correction failed.

    baseline   the player's own recency-weighted receiving yards (EWMA, HALF_LIFE 2.5, the same
               half-life player_proj_export uses), which is what the board effectively projects
    treatment  baseline x (1 - h) on the weeks his depth-chart QB1 is out
    train      2021-2024, chooses h        hold  2025-2026, reported only

RESULT (2026-09-27) — DOES NOT SHIP.

Train picked h = 0.20, the EDGE of the sweep, in both populations, while held-out turned earlier
(best around 0.08-0.15 and worse at 0.20). Train preferring the boundary is the tell: it is not
finding an optimum, it is discovering that shrinking a high baseline lowers MAE.

    priced-like (base >= 20 yds/g), held out    no haircut 25.2215   h=0.20  25.2157   +0.02%
    on the 114 QB1-out rows alone                          23.1018           23.0230   +0.34%

THE PLACEBO IS WHAT SETTLES IT. Apply the identical haircut to a RANDOM set of weeks of the same
size, 200 draws:

                            real QB1-out rows   random rows (mean)   draws beating the real one
    ALL                            +0.083%             +0.264%                 83.5%
    priced-like                    +0.023%             +0.380%                 91.0%

A haircut on random weeks does BETTER than one on the actual quarterback-out weeks. So the tiny
gain is not about the quarterback at all — it is that shrinking a high baseline reduces MAE, and
doing it at random happens to work better. 91% of random draws beat the real signal.

WHY THE WITHIN-PLAYER MEASUREMENT SAID -8% AND THIS SAYS NOTHING. Three reasons, and they are the
general lesson:
  * The EWMA baseline already absorbs it. A quarterback who has been out for weeks is already in
    the receiver's recent yards, so there is nothing left to correct.
  * -8% of a 40-yard projection is 3.2 yards, against a weekly MAE of 25. It is inside the noise.
  * A within-player average across players seen in both states is a descriptive comparison, not a
    predictive one, and the two can disagree completely.

So it fails the third test and stays OUT of the projection. Per the standing rule it can be
Context — a flag on the card saying this receiver's QB1 is out — which is true, is worth knowing,
and is not a number we have shown improves anything.

    python analysis/qb_out_backtest.py
"""
import os, sys
import numpy as np
import pandas as pd

ROOT = r"C:\Users\joann\nfl-advice-app"
sys.path[:0] = [os.path.join(ROOT, "analysis"), ROOT]
os.chdir(ROOT)
sys.stdout.reconfigure(encoding="utf-8")
from role_weight_backtest import ranks_by_week
import injury_adj as IA

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
OUT_LIKE = {"out", "doubtful"}
HALF_LIFE = 2.5
MIN_PRIOR = 3
HS = [0.0, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.20]


def ewma(vals):
    n = len(vals)
    d = 0.5 ** (1.0 / HALF_LIFE)
    w = np.array([d ** (n - 1 - i) for i in range(n)], dtype=float)
    return float(np.dot(w, vals) / w.sum())


rows = []
for season in SEASONS:
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        continue
    st = pd.read_csv(path, low_memory=False)
    st = st[st.season_type == "REG"].copy()
    st["receiving_yards"] = pd.to_numeric(st.get("receiving_yards"), errors="coerce").fillna(0.0)
    st["week"] = pd.to_numeric(st.week, errors="coerce")
    charts = ranks_by_week(season)
    inj = IA._inj_for(season)
    if not charts or inj is None or not len(inj):
        continue
    outs = {}
    for _, r in inj.iterrows():
        if str(r.get("report_status") or "").strip().lower() not in OUT_LIKE:
            continue
        try:
            outs.setdefault((int(r.week), str(r.team)), set()).add(str(r.gsis_id))
        except Exception:
            continue
    wr = st[st.position.isin(["WR", "TE"])].sort_values(["player_id", "week"])
    for pid, grp in wr.groupby("player_id"):
        g = grp.dropna(subset=["week"]).sort_values("week")
        yds = g.receiving_yards.tolist()
        wks = g.week.astype(int).tolist()
        teams = g.team.astype(str).tolist() if "team" in g.columns else g.recent_team.astype(str).tolist()
        for i in range(MIN_PRIOR, len(yds)):
            wk, team = wks[i], teams[i]
            chart = charts.get(wk) or charts.get(max((k for k in charts if k < wk), default=-1)) or {}
            qb1 = [q for q, (pos, rank) in chart.items() if pos == "QB" and rank == 1]
            if not qb1:
                continue
            sick = outs.get((wk, team), set())
            rows.append({"season": season, "base": ewma(yds[:i]), "y": float(yds[i]),
                         "qb_out": 1 if any(q in sick for q in qb1) else 0})

d = pd.DataFrame(rows)
print(f"{len(d):,} projectable receiver-weeks   QB1 out on {int(d.qb_out.sum()):,}")
# The board only prices players with a real role; test on that population too, because a haircut
# applied to a WR6 projecting 4 yards is not what is being proposed.
for label, sub in (("ALL", d), ("priced-like (base >= 20 yds/g)", d[d.base >= 20])):
    tr, ho = sub[sub.season.isin(TRAIN)], sub[sub.season.isin(HOLD)]
    if len(tr) < 500 or len(ho) < 200:
        print(f"\n{label}: too few rows ({len(tr)}/{len(ho)})")
        continue
    print(f"\n{label}:  train {len(tr):,}  held-out {len(ho):,}  "
          f"(QB1 out: {int(tr.qb_out.sum()):,} / {int(ho.qb_out.sum()):,})")
    print(f"  {'h':>6s} {'train MAE':>10s} {'held MAE':>10s}")
    best = None
    for h in HS:
        f = lambda s: float(np.abs(s.base * (1 - h * s.qb_out) - s.y).mean())
        a, b = f(tr), f(ho)
        print(f"  {h:6.2f} {a:10.4f} {b:10.4f}")
        if best is None or a < best[1]:
            best = (h, a, b)
    h0 = HS[0]
    b0 = float(np.abs(d[d.season.isin(HOLD)].base - d[d.season.isin(HOLD)].y).mean()) if False else None
    base_ho = float(np.abs(ho.base - ho.y).mean())
    print(f"\n  train picks h = {best[0]:.2f}")
    print(f"  HELD OUT   no haircut {base_ho:.4f}   with haircut {best[2]:.4f}   "
          f"{(base_ho - best[2]) / base_ho * 100:+.2f}%")
    # And on the affected rows alone, which is where any effect has to show up.
    aff = ho[ho.qb_out == 1]
    if len(aff) > 50:
        n0 = float(np.abs(aff.base - aff.y).mean())
        n1 = float(np.abs(aff.base * (1 - best[0]) - aff.y).mean())
        print(f"  on the {len(aff):,} QB1-out rows only: {n0:.4f} -> {n1:.4f}   "
              f"{(n0 - n1) / n0 * 100:+.2f}%")

# ---- PLACEBO CONTROL -------------------------------------------------------------------------
# Train picked the EDGE of the sweep in both populations, which is what you see when shrinking
# helps for a reason unrelated to the variable. If the baseline simply projects high, ANY haircut
# on ANY subset lowers MAE. So apply the same haircut to a RANDOM set of weeks of the same size
# and see whether it "works" just as well.
print("\n=== PLACEBO: same haircut, random weeks instead of QB1-out weeks ===")
rng = np.random.default_rng(7)
for label, sub in (("ALL", d), ("priced-like (base >= 20 yds/g)", d[d.base >= 20])):
    ho = sub[sub.season.isin(HOLD)].copy()
    if len(ho) < 200:
        continue
    real = ho.qb_out.values.astype(bool)
    base_ho = float(np.abs(ho.base - ho.y).mean())
    gains = []
    for _ in range(200):
        fake = np.zeros(len(ho), dtype=bool)
        fake[rng.choice(len(ho), int(real.sum()), replace=False)] = True
        m = float(np.abs(ho.base * (1 - 0.20 * fake) - ho.y).mean())
        gains.append((base_ho - m) / base_ho * 100)
    r = float(np.abs(ho.base * (1 - 0.20 * real) - ho.y).mean())
    rg = (base_ho - r) / base_ho * 100
    pct = float((np.array(gains) >= rg).mean())
    print(f"\n{label}")
    print(f"  real QB1-out rows      {rg:+.3f}%")
    print(f"  random rows (200 runs) mean {np.mean(gains):+.3f}%  p95 {np.percentile(gains, 95):+.3f}%")
    print(f"  share of random draws at least as good as the real one: {pct:.1%}")
