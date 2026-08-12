---
name: model-validation
description: Rigorous validation discipline for quantitative models and statistical claims — catching false positives, sample-size mirages, evaluation leakage, and multiple-comparison artifacts before they ship. Use this skill whenever the user is backtesting a model, checking whether a pattern is real, evaluating a trading or betting strategy, testing a hypothesis against historical data, comparing a model to a benchmark, or asking "is this signal significant?" Also use it proactively when a user reports a result that looks good — an apparent edge, a high hit rate, a leaderboard of ranked entities — because that is exactly when these errors hide. Applies to finance, sports analytics, audit analytics, A/B testing, and any domain where a wrong positive result is expensive.
---

# Model validation discipline

A checklist derived from seven real failures on a live project, where each error
initially looked like a discovery. Four of the seven were caught only by automated
assertions, not by review — which is the central lesson.

**Core principle: a result that looks good is a result that needs a harder check.**
Enthusiasm is the signal to slow down.

---

## The seven checks

Run these in order. Stop at the first one that fires.

### 1. Is the benchmark the right one?

The bar is almost never "better than nothing." It's "better than the best cheap
alternative."

- Time series → beat **persistence** (last observed value), not the mean.
- Betting/trading → beat the **closing price**, not a coin flip.
- Classification → beat the **majority class** and a **single-feature baseline**.

A model that beats a straw man tells you nothing. Compute the strong baseline
first, before building anything.

**Real failure:** a snap-share model showed +5.9% MAE improvement. Against the
right baseline (persistence) that was real but modest. Against the season mean it
would have looked like +40% and meant nothing.

### 2. Does the sample survive expansion?

**This is the check that catches the most damage.** A p-value computed on the same
sample that generated the hypothesis is not validation.

Expand the sample and watch the direction of travel:

| Sample | Model vs benchmark | Hit rate |
|---|---|---|
| n=159 | model better by 0.24 | 58.5% |
| n=319 | model worse | 56.7% |
| n=635 | model worse | 55.4% |
| n=925 | model worse, p=0.054 | 54.8% |

**The advantage flipped sign as n grew, and the hit rate decayed monotonically.**
At n=159 this looked like a shippable system. It was noise regressing toward its
true value.

Also compute the sample size you'd actually *need*. Distinguishing 55% from 52.4%
at 80% power takes ~2,842 observations. If the domain supplies 16 per year, the
hypothesis is **unvalidatable by construction** — say so and stop.

### 3. Is any stratum defined using the outcome?

Conditioning on the outcome — or on a competitor's error — guarantees the answer.

**Real failure:** stratifying player-weeks by `|actual − last_week|` and reporting
that the model lost to persistence on "stable" weeks. The stratum was *defined by
persistence's own error being small*, so persistence won by construction. Two
model variants were built to fix a finding that didn't exist.

**The fix:** define strata only from information available *before* the outcome.
If the split uses the target variable or any competitor's residual, it's invalid.

### 4. Does the base case show free money?

**Any model whose baseline case shows a profit or a >50% edge on an efficient
market has a bug.** Assert this in code, not in review.

**Real failure:** an alternate-line pricing engine used a ±1.5 comparison window
and reported the base bet at 53.9% on an efficient line. Tightening to ±0.5 gave
49.7%. The wide window leaked easier games into the comparison set.

**The fix:** a hard assertion. `assert abs(base_case_prob - 0.5) < 0.035, "window
bias"`. It caught the bug immediately once written.

### 5. Is the observed spread wider than chance?

Before ranking anything — teams, referees, salespeople, regions — test whether the
variation exceeds what random sampling produces.

**Real failure:** referee crews showed career over-rates from 42.1% to 59.8%, an
18-point spread across 37 crews. Looked exploitable.

| Test | Result |
|---|---|
| Observed SD across crews | 3.87 pts |
| **Expected SD if pure noise** | **3.79 pts** |
| Chi-square homogeneity | p = 0.351 |
| Split-half reliability | r = −0.020 |

Pure noise. The spread was exactly what binomial variation predicts.

**The fix:** chi-square homogeneity, plus **split-half reliability** — split each
entity's observations randomly in half and correlate the halves. A real tendency
gives r > 0. This also avoids the composition-change confound that contaminates
year-over-year tests.

**A leaderboard is exactly what a dashboard is tempted to display.** Test the
variance before you rank.

### 6. How many tests have you run?

31 tests produce ~1.5 false positives at p<0.05 by chance. Report the count and
apply a corrected threshold.

State the hypothesis before looking, or hold out a slice you never touch until the
end.

### 7. Is the distributional assumption doing hidden work?

**Real failure:** a Gaussian margin model flagged 15 of 16 games as mispriced.
The market was fine; the model was low by 2–4 points at every input, because NFL
margins have 15% of their mass on exactly 3 and 9% on exactly 7.

**The fix:** use the empirical distribution wherever discrete mass points exist.
Check the histogram before assuming smoothness.

---

## Things that masquerade as findings

| Pattern | What it usually is |
|---|---|
| Effect vanishes with controls | Confounded, not causal |
| Effect strongest in the smallest subgroup | Noise |
| Non-monotonic dose-response | Noise (monotonic is what real looks like) |
| Ranked leaderboard with wide spread | Sampling variation |
| Hit rate that decays as n grows | Regression toward the truth |
| Uses realized rather than forecast values | Hindsight — unavailable at decision time |
| Explains the past, never tested forward | Overfit |

**On that second-to-last row:** a wind/totals signal hit 56.1% using *recorded
game-time* wind. At decision time you only have a forecast. The realizable edge is
whatever forecast skill you have, which is smaller and possibly zero. Always ask:
**was this value knowable when the decision had to be made?**

---

## Reporting requirements

Every result gets:

- **n**, always
- A **confidence interval**, not just a point estimate
- The **decision threshold** the CI must clear (break-even, not zero)
- **Test count** and corrected threshold
- **Effect size** in units someone can act on

Never report a hit rate without its interval. "58.5%" and "58.5% [50.8, 66.1]"
support opposite decisions.

---

## Build the checks into the pipeline

Four of seven failures were caught by code that asserted something must be true —
not by careful review. Review is where errors hide, because the person reviewing
is the person who wants the result.

Minimum set to write once and keep:

```python
assert abs(base_case - 0.5) < 0.035, "efficient baseline shows free money"
assert n >= min_n_for_power, f"underpowered: need {min_n_for_power}"
assert not stratum_uses_outcome, "stratum defined by the target"
assert observed_sd > 1.5 * expected_sd_noise, "spread within noise"
assert test_count_logged, "multiple comparisons not tracked"
```

---

## When the answer is "no signal"

Say so plainly, and treat it as output rather than failure. "This is already priced
/ this is noise / this is unvalidatable at available sample sizes" saves building
something useless — which is usually worth more than a marginal positive.

Then be specific about what *would* change the answer: more data, a different
benchmark, a forecast rather than a realization, or a market with less attention on
it.
