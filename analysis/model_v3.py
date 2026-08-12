"""
v3: signal-gated blend.

Diagnosis so far:
  - persistence is near-optimal when nothing changed (MAE .043)
  - the model is materially better when something DID change (MAE .308 vs .380)
  - neither reframing (v2) nor the level model (v1) knows which regime it is in

Fix: gate on whether a CHANGE SIGNAL is actually present. All gate inputs are
known pre-game, so the gate is deployable.

  signal = teammate declared Out/Doubtful
        OR player himself on this week's injury report
        OR player returning from Out/Doubtful
        OR position group depleted vs its own recent baseline
        OR early season (roles still forming)

Where no signal fires -> defer to persistence.
Where signal fires    -> use the model.
"""
import numpy as np
import pandas as pd
from model import prep, mae, TEST_SEASONS
from model_v2 import fit_predict_resid

d = prep()
v1 = pd.read_csv("../walkforward_preds.csv")
v2 = pd.read_csv("../walkforward_v2.csv")

k = ["season", "week", "player", "team"]
r = v1.merge(v2[k + ["pred_v2"]], on=k, how="inner")

# re-attach the gate inputs from the feature panel
gate_cols = ["on_injury_report", "grp_prior_sum", "grp_n_active", "games_prior"]
r = r.merge(d[k + gate_cols].drop_duplicates(k), on=k, how="left")

# group depletion: this week's group strength vs the team-position rolling norm
norm = (d.groupby(["team", "season", "pos_grp"])["grp_prior_sum"]
        .transform(lambda s: s.expanding(min_periods=2).mean()))
d2 = d[k].copy()
d2["grp_norm"] = norm.values
r = r.merge(d2.drop_duplicates(k), on=k, how="left")
r["depleted"] = (r.grp_prior_sum < 0.90 * r.grp_norm).fillna(False)

r["signal"] = (
    (r.vacated_out > 0)
    | (r.returning == 1)
    | (r.on_injury_report == 1)
    | r.depleted
    | (r.games_prior <= 3)
).astype(int)

print("=" * 74)
print("SIGNAL-GATED BLEND")
print("=" * 74)
print(f"  signal fires on {r.signal.mean():.1%} of player-weeks\n")

for name, col in (("v1 level", "pred"), ("v2 residual", "pred_v2")):
    r[f"gated_{col}"] = np.where(r.signal == 1, r[col], r.ewm1)

r["delta"] = (r.y - r.ewm1).abs()
strata = [
    ("ALL", r),
    ("stable  |chg| < .10", r[r.delta < 0.10]),
    ("moderate  .10-.25", r[(r.delta >= 0.10) & (r.delta < 0.25)]),
    ("large  >= .25", r[r.delta >= 0.25]),
    ("signal fired", r[r.signal == 1]),
    ("no signal", r[r.signal == 0]),
]
print(f"  {'stratum':<26}{'persist':>9}{'v1':>9}{'v2':>9}{'gated1':>9}{'gated2':>9}")
for name, s in strata:
    if len(s) < 30:
        continue
    print(f"  {name:<26}"
          f"{mae(s.y, s.ewm1):>9.4f}{mae(s.y, s.pred):>9.4f}"
          f"{mae(s.y, s.pred_v2):>9.4f}"
          f"{mae(s.y, s.gated_pred):>9.4f}{mae(s.y, s.gated_pred_v2):>9.4f}")

best = min(["pred", "pred_v2", "gated_pred", "gated_pred_v2"],
           key=lambda c: mae(r.y, r[c]))
b, p = mae(r.y, r[best]), mae(r.y, r.ewm1)
print(f"\n  best overall: {best}   MAE={b:.4f}   vs persistence {p:.4f} "
       f"({100*(p-b)/p:+.1f}%)")

# ---- headline: where does this actually convert to prop-relevant accuracy?
print("\n" + "=" * 74)
print("VOLUME IMPLICATION  (snap share -> expected snaps, 65-play team baseline)")
print("=" * 74)
for name, s in [("all", r), ("signal fired", r[r.signal == 1])]:
    e_p = mae(s.y, s.ewm1) * 65
    e_m = mae(s.y, s[best]) * 65
    print(f"  {name:<16} persistence off by {e_p:.1f} snaps/game, "
          f"model off by {e_m:.1f}  ({100*(e_p-e_m)/e_p:+.1f}%)")

r.to_csv("../final_preds.csv", index=False)
