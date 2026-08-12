# Snap-Share Model — Build 1 Findings

Real data, real walk-forward validation. 2016–2024 nflverse snap counts, official
injury reports, weekly stats. 60,858 skill-position player-weeks; RB/WR/TE
modelling universe; test seasons 2022–2024 (17,404 predictions).

---

## Headline result

| Predictor | MAE (snap share) |
|---|---|
| Season-to-date / prior-season mean | 0.1738 |
| EWMA(3) of recent weeks | 0.1141 |
| **Persistence (last week's share)** | **0.1112** |
| **Model (gradient boosting, logit target)** | **0.1047** |

**+5.9% over persistence**, walk-forward, no leakage. In volume terms: on a
65-play offense, persistence is off by ~7.2 snaps/game, the model by ~6.8.

That is a modest but real edge, and it is roughly the size you should expect
from a first honest build. Anything dramatically larger at this stage would be
evidence of a bug, not of skill.

## Where the edge concentrates

Splitting on whether a **pre-game change signal** is present (teammate declared
Out/Doubtful, player on the injury report, returning from Out, position group
depleted, or first 3 games of a player's season):

| | n | Persistence | Model | Gain |
|---|---|---|---|---|
| No signal | 8,059 | 0.0983 | 0.0958 | +2.6% |
| **Signal fired** | 9,345 | 0.1223 | 0.1123 | **+8.2%** |

The edge is ~3x larger when something has actually changed. This is the clean,
deployable version of the finding — the gate uses only information available
Friday night.

## Predictive intervals are calibrated

Split-conformal, calibrated on recent held-out weeks:

| Interval | Empirical coverage | Mean width |
|---|---|---|
| 50% | 0.511 | 0.166 |
| 80% | 0.814 | 0.329 |
| 90% | 0.913 | 0.437 |

This matters more than the point estimate. Props are tail questions
(P(volume > line)), so you need the distribution. These are honest intervals —
when the model says 80%, it means 80%.

Note: raw quantile-regression intervals were *miscalibrated* (q10 fired at 13.6%,
80% interval covered only 76.2%). Conformal calibration fixed it. Don't skip
that step.

## Where the model is predictable vs. hopeless

Proportional error (MAE ÷ mean share in bucket) — the props-relevant view, since
a 0.05 miss on a 20%-share player is a 25% volume error but only 6% on a starter:

| Prior-share bucket | n | Persistence | Model | Gain |
|---|---|---|---|---|
| <15% (deep reserve) | 3,461 | 70.7% | 69.9% | +1.1% |
| 15–35% (rotational) | 3,942 | 44.6% | 42.1% | +5.4% |
| 35–60% (co-starter) | 4,109 | 28.2% | 25.9% | **+8.0%** |
| >60% (starter) | 5,500 | 15.0% | 14.8% | +1.5% |

**This corrects something I told you earlier.** I said the edge would live at the
back of the depth chart. It doesn't. Deep-reserve snap share is ~70%
proportional error — close to noise, and the model barely improves it. The
modellable zone is the **middle of the depth chart** (35–60% share), where roles
are genuinely contested and genuinely predictable.

Practical consequence: target props for co-starters and rotational players, not
for WR5s.

## Feature importance (permutation, 2024 holdout)

| Feature | Importance |
|---|---|
| ewm1 (last week's share) | 0.0400 |
| position group | 0.0395 |
| grp_prior_sum (group strength) | 0.0245 |
| depth_rank | 0.0075 |
| prior_share_of_grp | 0.0068 |
| ewm8 | 0.0061 |
| prior_season_share | 0.0053 |
| vacated_out | 0.0013 |

`vacated_out` looks weak only because it fires on 15% of rows — and because
`grp_prior_sum` already absorbs most of it (when teammates are out, group
strength drops mechanically). The information is in the model; it's just
routed through a different column.

---

## An evaluation error I made, and what it teaches

My first pass stratified by `|actual − last_week|` and reported that the model
was **18% worse than persistence on "stable" weeks**. I then built two
successive fixes (a residual-target model, then a signal gate) to repair that.

Both failed, because the finding was an artifact. The "stable" stratum is
*defined by persistence's own error being small*. Conditioning on it guarantees
persistence looks good — it's conditioning on the outcome. The real, clean
comparison is the signal/no-signal split above, where the model wins in both
regimes.

Cost: two wasted model variants. Worth recording, because it is exactly the
failure mode that produces confident, wrong betting models — and it happened
in a build that was explicitly trying to avoid it. Any stratum used to judge a
model must be defined **without reference to the outcome or to a competitor's
error**.

---

## Known limitations

1. **`E[share | active]` only.** Snap counts contain only players who played, so
   the panel is conditioned on activity. This is the right target for props
   (books void inactive players) but it means a separate **Stage A availability
   model** is still needed. The injury report captures declared absence for only
   ~15% of player-weeks vs ~40% actual short-term absence (r = 0.58) — the gap is
   healthy scratches and game-day inactives.
2. **No practice trajectory.** nflverse carries a single final practice
   designation, not Wed/Thu/Fri. The trajectory feature we discussed requires
   scraping daily reports going forward — it cannot be backfilled from here.
3. **No contract or draft data yet.** The guaranteed-money and draft-pedigree
   features are not in this build.
4. **No coordinator-presser features.** Requires the transcript corpus.
5. **Touch shares computed but not modelled.** `rush_share` and `target_share`
   are in the panel; the volume layer is the next build.

## Next build, in order

1. **Stage A availability model** — the biggest single gap. Everything downstream
   is conditioned on it.
2. **Touch-share layer** — carries and targets conditional on snap share. This is
   what actually converts to a prop line.
3. **Team-plays projection** — completes `volume = plays × snap share × touch rate`.
4. **Coherence detector** — needs only the volume projection plus live prop
   lines. This is the fastest path to something shippable.

---

## Files

| File | Purpose |
|---|---|
| `build_panel.py` | Downloads nflverse data, assembles player-week panel |
| `features.py` | Point-in-time features, vacated-share mechanics |
| `model.py` | Walk-forward eval, baselines, quantile calibration |
| `model_v2.py` | Residual variant, conformal intervals, importances |
| `model_v3.py` | Signal-gated blend (negative result, kept for the record) |

Run order: `build_panel.py` → `features.py` → `model.py` → `model_v2.py`.

**Package note:** this uses only pandas/numpy/scikit-learn/scipy. Per Lilly
policy, if you extend it (LightGBM, statsmodels, pyarrow), pull from JFrog
Artifactory rather than PyPI.
