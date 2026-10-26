# Empirical Reference

Every number measured during design work, with sample sizes. These are the
reusable asset — decisions change, measurements don't.

Sources: nflverse snap counts, injury reports, weekly player stats (2016–2025);
nfldata game results with closing spreads (1999–2025).

---

## 1. Snap-share model — build 1

Universe: 60,858 skill-position player-weeks. RB/WR/TE modelled. Walk-forward,
test seasons 2022–2024 (17,404 predictions).

| Predictor | MAE (snap share) |
|---|---|
| Season / prior-season mean | 0.1738 |
| EWMA(3) | 0.1141 |
| Persistence (last week) | 0.1112 |
| **Model** | **0.1047** |

**+5.9% over persistence.** On a 65-play offense: off by 6.8 snaps/game vs 7.2.

### Edge concentration (gate uses only pre-game info)

| | n | Persistence | Model | Gain |
|---|---|---|---|---|
| No change signal | 8,059 | 0.0983 | 0.0958 | +2.6% |
| **Change signal fired** | 9,345 | 0.1223 | 0.1123 | **+8.2%** |

### Interval calibration (split-conformal)

| Interval | Empirical coverage | Mean width |
|---|---|---|
| 50% | 0.511 | 0.166 |
| 80% | 0.814 | 0.329 |
| 90% | 0.913 | 0.437 |

Raw quantile regression was miscalibrated (80% covered only 76.2%). Conformal
calibration fixed it. Don't skip that step.

### Proportional error by role (props-relevant view)

| Prior-share bucket | n | Persistence | Model | Gain |
|---|---|---|---|---|
| <15% (deep reserve) | 3,461 | 70.7% | 69.9% | +1.1% |
| 15–35% (rotational) | 3,942 | 44.6% | 42.1% | +5.4% |
| **35–60% (co-starter)** | 4,109 | 28.2% | 25.9% | **+8.0%** |
| >60% (starter) | 5,500 | 15.0% | 14.8% | +1.5% |

**The modellable zone is the middle of the depth chart, not the back.** Deep
reserve share is ~70% proportional error — close to noise.

---

## 2. Attribute persistence (44,880 player-weeks)

Lag-1 within-player, within-season correlation.

### CUR_K re-swept with real in-season data — unchanged (2026-10-15)

`CUR_K` (how hard this season's games-so-far pull against the prior season) and
the 2.5-game recency half-life were originally chosen when 2026 was empty. Re-run
with weeks 1–5 complete, train 2021–24 / held-out 2025–26:

| | train MAE | pick |
|---|---|---|
| half-life 2.5, **CUR_K 1.0** | **2.9085** | best on train — what already ships |
| half-life 2.0, CUR_K 1.0 | 2.9109 | |
| half-life 2.5, CUR_K 1.5 | 2.9147 | |

Held-out 21,269 / 6,776 player-games: the shipped pair beats the old simple-mean
baseline by **+1.56%**, RB +2.07%, QB +2.05%, WR +1.01%, TE +0.04%, and on roles
that stepped up **+3.79% with bias −1.78 → −0.90**.

**Per-n re-confirmed too** (`curk_by_n.py`). At 4–5 games played — where week 6
sits — K=1.0 is the best cell. A per-n schedule chosen on train is still WORSE
held-out: −0.11% overall, **−1.76% on WR/TE early**. Same verdict as the first
sweep, now with a real current season behind it. **Do not re-run this.**

**What prompted it, and the answer.** The week-6 board sat +7.8 yards above the
market on `pass_yds` (67% over). Decomposed, the whole offset is VOLUME, not
efficiency — implied YPA across the 27 rows is a tight 6.63–7.24, and
+1.3 attempts × ~7.0 YPA ≈ +9 yards. The inputs check out against the raw stat
files (Stafford 35.1 → 43.2 attempts/game, Bryce Young 29.9 → 40.5, Winston
22.0 → 33.0), so the blend is reading real increases at the correct weight.

Note the gap that looks alarming and is not: league-wide passing is up only
**+0.38 attempts/team-game (+1.2%)** in weeks 1–5 2026 vs 2025, against +1.3 on
our board. That is SELECTION — the board is this week's posted starters, several
of whom (Winston, Young, Brissett) carried depressed prior-season averages as
backups. Comparing a board of starters to a league average including everyone is
not a like-for-like comparison, and the discrepancy is not evidence of a bug.

### Volume / role — highly persistent

| Attribute | Persistence |
|---|---|
| Carries | **0.678** |
| WOPR | 0.626 |
| Target share | 0.623 |
| Targets | 0.586 |
| Air yards share | 0.551 |
| Receptions | 0.511 |

### Role character

| Attribute | Persistence |
|---|---|
| aDOT (avg depth of target) | 0.303 |

The one usable member of the efficiency family — it's a *role* characteristic,
not a skill outcome. Use it to project yards per reception instead of using past
yards per reception.

### Efficiency — essentially noise

| Attribute | Persistence |
|---|---|
| YAC per reception | 0.118 |
| Yards per reception | 0.117 |
| Catch rate | 0.094 |
| **Yards per carry** | **0.058** |
| RACR | 0.052 |
| Yards per target | 0.049 |
| Rec EPA per target | 0.043 |
| Rush EPA per carry | 0.028 |

### The props themselves

| Prop | Persistence |
|---|---|
| Rushing yards | 0.516 |
| Receiving yards | 0.423 |
| Rushing TDs | 0.182 |
| **Receiving TDs** | **0.093** |

Note the props persist *less* than their volume components — multiplying a
predictable term by a noise term destroys signal.

### Variance decomposition

| Prop | Volume share | Efficiency share | Covariance |
|---|---|---|---|
| Rushing yards | 44.0% | 43.1% | 12.9% |
| Receiving yards | 30.9% | **63.2%** | 5.9% |

Receiving yards is the worst major prop to model — ~63% of variance comes from a
component with 0.049 persistence. Implied predictability ceiling ≈ 21% of
variance.

**Consequence: never model yards directly.** Project volume, multiply by a
*regressed* efficiency baseline — role expectation, not recent hot streak.

---

## 3. Game margins (6,967 games, 1999–2025)

### Key numbers

| Margin | Frequency | Cumulative |
|---|---|---|
| **3** | **15.01%** | 15.0% |
| **7** | **9.10%** | 24.1% |
| 6 | 5.96% | 30.1% |
| 10 | 5.60% | 35.7% |
| 4 | 4.89% | 40.6% |
| 14 | 4.79% | 45.4% |

Margins of 3 or 7 = **24.1% of all games**.

### Market efficiency

Error distribution (margin − spread): **mean +0.069, SD 13.19**, n=6,967. About as
clean a confirmation of efficiency as exists.

### Empirical P(favorite wins outright)

| Spread | Empirical | n | Normal model (σ=13.2) |
|---|---|---|---|
| 1.5 | 53.4% | 1,394 | 54.5% |
| 2.5 | 58.3% | 2,626 | 57.5% |
| 3.0 | 59.6% | 2,756 | 59.0% |
| 3.5 | 60.2% | 2,850 | 60.5% |
| 4.5 | 65.3% | 1,669 | 63.3% |
| 7.0 | 73.0% | 1,496 | 70.2% |
| 7.5 | 74.6% | 1,252 | 71.5% |
| 10.5 | 81.6% | 603 | 78.7% |

The normal model is low at nearly every spread. **Use the empirical curve.**

### Push risk and half-point value (conditional on spread)

| Spread | n | P(push) | Half point worth |
|---|---|---|---|
| 1.5 | 890 | 0.0% | 1.8–2.7% |
| 2.5 | 1,776 | 0.0% | 2.9–8.8% |
| **3.0** | 2,272 | **9.0%** | **9.0%** |
| 3.5 | 2,092 | 0.0% | 2.8–9.6% |
| 4.5 | 738 | 0.0% | 1.8–3.3% |
| 7.0 | 1,069 | 6.2% | 6.2% |
| 7.5 | 833 | 0.0% | 1.7–6.1% |
| 10.5 | 407 | 0.0% | 1.2–5.2% |

Buying **+3 → +4 = +6.0 points** of win probability (n=2,272).
Buying **+4.5 → +5.5 = +1.8 points** (n=738). Same point, 3.3x the value.

### Line-blind totals model — fails the bar (`totals_model.py`)

Tested a totals prediction (regress the two teams' prior-season game-total tendency
toward the league total). Walk-forward 2015–2025, n=2,847, best k=0.50:

| | MAE (total points) |
|---|---|
| Naive (league-average total) | 10.97 |
| Model total | **10.90** |
| Market total (`total_line`) | 10.39 |

Model beats a flat league-average guess by **0.07 pts** (essentially zero) and runs
**0.5 behind the market**. Calibrated (bias −0.07) but near-signal-less — prior-
season scoring tendency doesn't predict this year's game totals. **Not shipped:**
model team totals would print ~league average for every game, worse than the market
and misleading. The margin model (point differential) has real signal and stands;
the totals half does not. Contrast the margin model: MAE 10.15 vs market 9.89 — a
genuine if losing prediction; the totals model barely moves off a constant.

#### 🚨 It shipped anyway, with a SIDE attached — and the record found it (2026-10-15)

The paragraph above says "not shipped". It was: `gen_model_totals.py` has been
feeding `/model` and the homepage, and the board's bottom line turned it into an
over/under call whenever our number sat **one point** from the market's — against
a model whose own error on a total is 10.4 points. Graded over 2026 weeks 1–5 it
went **29-50, losing in all five weeks**, which is what prompted the rebuild.

**The level was never the problem.** Over those 79 games:

| | mean | bias vs actual | MAE | sd |
|---|---|---|---|---|
| ours | 46.06 | **−0.57** | 11.73 | 1.62 |
| market | 44.92 | −1.72 | 10.69 | 4.05 |
| actual | 46.63 | — | — | 14.60 |

We are **three times closer than the market on the level**. What cannot carry a
side is the SHAPE: a correctly-shrunk total varies 1.6 points between games
against the market's 4.1, so "ours vs theirs" is mostly the market's own line
read backwards — and the market's line is the better per-game signal (corr 0.48
with the result against our 0.25). Hence corr(ours−market, actual−market) =
**−0.222**: a contrarian machine built out of a constant.

**Reading the current season helps the number and not the record**
(`analysis/totals_inseason.py`). The margin model was given an in-season blend
months ago; the totals model never was, so a team scoring 31 a game was still
priced off last year. Walking the season forward, chosen on TRAIN 2018–22 and
confirmed once on HELD-OUT 2023–25:

| setting | train MAE | held-out MAE | train O/U | held-out O/U |
|---|---|---|---|---|
| CUR_W 0, K 0.50 (shipped) | 11.119 | 10.501 | 50.2% | 49.8% |
| **CUR_W 1.5, K 0.75** | **10.980** | **10.402** | 49.0% | 51.0% |
| CUR_W 3.0, K 0.75 | 11.016 | 10.493 | 47.3% | 50.2% |

About **+1% against what games actually score**, in both splits, with the optimum
in the interior of the grid rather than on an edge. Shipped on that basis.

**🚨 NOTHING BEATS THE CLOSING TOTAL, AT ANY SETTING.** Across 2,111 games the
over/under record runs **47.3%–51.4%** over the whole sweep, including the
settings that let the column swing hardest. The 29-50 is that coin flip landing
badly at n=79 (2.4 SE below chance), not a defect with a fix in it — and the
rebuilt model, replayed on the same five weeks, still goes 31-48. **Do not tune
this against the market again; the measurement above is the answer.**

**The shrink is correct, not timidity.** K below 1 pulls each game toward the
league rate, which is what a less-informed forecaster's estimate should do — it
is why our MAE is near the market's at all. The cost is a column that varies less
than the market's line, and that is an argument against printing a side from it,
not an argument for unshrinking it. The board now shows both numbers and calls
no side; the spread side stays, because the margin model does beat a
no-information baseline.

### Model win-probability calibration — v1 overconfident, fixed in v2 (`grade_predictions.py --backtest`)

Walk-forward 2021–2025, n=1,355, calibrating the model's favored-team win prob
against actual results.

**v1 (`game-v1-powerdiff`) — overconfident:** overall predicted **65.1%** vs.
actual **58.3%**; Brier **0.245**. Every band overshot (76.5%→59.2%, 83.3%→69.6%).
Mechanism: `winprob` mapped the model's predicted margin through the empirical
*market-spread* → win curve, but model margins are noisier than market spreads, so
the same number implied more certainty than it earns.

**v2 (`game-v2-powercal`) — calibrated:** rebuilt the curve from the model's OWN
out-of-sample margins (`model_win_curve`, self-calibrating on prior seasons).

| Predicted | Actual | n |
|---|---|---|
| 52.9% | 51.4% | 442 |
| 57.2% | 56.9% | 297 |
| 62.2% | 62.1% | 372 |
| 67.1% | 63.2% | 152 |
| 72.3% | 72.9% | 70 |

Overall predicted **59.2%** vs. actual **58.3%** (0.9pt), Brier **0.239**. Say 62%,
the favorite wins 62.1%. The recalibration touched only the margin→probability map,
**not which side the model favors** — every off-consensus call is preserved; the
model just stopped overstating its confidence. Brier stays near 0.24 because
line-blind game outcomes are genuinely uncertain — v2 is now honest about that.

### Total-points key numbers (6,967 games, `total_key_numbers.py`)

Do totals have key numbers like spreads? Yes, but **much weaker** — half-point
value = P(total lands exactly on N):

| Total | ½-pt value |
|---|---|
| 41 | 3.79% |
| 44 | 3.79% |
| 51 | 3.76% |
| 37 | 3.69% |
| 43 | 3.52% |

Everything else is <3.3%. The top total key (~3.8%) is under **half** the value of
a spread on 3 (9.0%), and no single total dominates the way 3 does for margins
(top 6 totals = 21.8% combined, vs. margin on 3 alone = 15.0%). **App flags total
sweet spots only on {37, 41, 43, 44, 51}, always with the honest value shown** so a
4% total key isn't confused with a 9% spread key. Note 49 is *not* a key total
(~2.2%).

---

## 4. Base rates — nothing beats the vig

Break-even at -110 is **52.38%**. 15 tests run; ~0.8 false positives expected at
p<0.05 by chance.

| Test | Rate | 95% CI |
|---|---|---|
| Favorites ATS, spread 0–3.5 | 49.4% | [47.6, 51.1] |
| Favorites ATS, spread 4–7 | 49.2% | [47.1, 51.4] |
| Favorites ATS, spread 7.5–13 | 48.1% | [45.4, 50.8] |
| Favorites ATS, spread 13.5+ | 45.0% | [39.1, 51.1] |
| Overs, all games | 49.5% | [48.3, 50.7] |
| Overs, total ≤40 | 50.5% | [48.1, 52.8] |
| Overs, total 50.5+ | 49.8% | [45.8, 53.9] |
| Home underdogs ATS | 50.1% | [48.1, 52.1] |
| Week 1 favorites ATS | 47.6% | [42.9, 52.4] |
| Week 1 overs | 45.3% | [40.6, 50.0] |

**Not one confidence interval clears 52.38%.**

### Week 1 specifics

| Measure | Week 1 | Weeks 2+ | p |
|---|---|---|---|
| Mean total points | 42.94 (n=428) | 44.24 (n=6,539) | 0.064 |
| Mean \|margin − spread\| | 10.06 | 10.28 | 0.617 |

**Week 1 is not more unpredictable than any other week** — the market prices it
just as accurately despite having no current-season data. This kills the "Week 1
is chaos so there's edge in the uncertainty" narrative.

Week 1 unders at 54.7% is the most tempting pattern found (n=424, 27 seasons, with
a plausible mechanism in rusty offenses). CI bottoms at exactly 50.0% and the
scoring difference is p=0.064. **Suggestive, not actionable** — and found after 15
tests.

---

## 5. Week 1 2026 board audit

Schedule verified: season opens Wed Sep 9, Patriots at Seahawks (Super Bowl LX
rematch); SF vs LAR in Australia Thu Sep 10; Broncos at Chiefs Mon Sep 14.

**The board is internally coherent.** Mean ML overround 4.06%. Spread and moneyline
agree within ~2 points of the empirical curve on 14 of 16 games. Largest gap
(TB@CIN, +4.2 pts) is ~2 standard errors — noise.

### Games on a key number

| Game | Line | Push risk |
|---|---|---|
| ATL@PIT | PIT -3 | 9.0% |
| NYJ@TEN | TEN -3 | 9.0% |
| DEN@KC | KC -3 | 9.0% |
| NO@DET | DET -7 | 6.2% |

Line shopping is worth ~9 points of win probability on the -3 games — larger than
any realistic model edge on a game line.

### Line movement (12 of 16 games moved off their open)

| Game | Move |
|---|---|
| ARI@LAC | -11.5 → **-10.5** (toward dog) |
| WAS@PHI | -5.5 → **-4.5** (toward dog) |
| SF@LAR | -2.5 → -3.5 (toward favorite) |
| DEN@KC | -2.5 → **-3** (through key number) |
| MIA@LV | -3 → -3.5 (through key number) |
| CLE@JAX | -7 → -7.5 |
| CHI@CAR | total 44.5 → 46.5 |
| NYJ@TEN | total 39.5 → 38.5 |

### Implied team totals (total/2 − spread/2)

| Highest | | Lowest | |
|---|---|---|---|
| LAC | 28.50 | CLE | 16.50 |
| DET | 28.25 | NYJ | 17.75 |
| CIN | 27.50 | ARI | 18.00 |
| LAR / BAL / PHI | 26.00 | MIA | 18.50 |
| DAL | 25.50 | DEN / ATL | 19.75 |

12-point range. Best single market-derived prop input, and it's pure arithmetic.

---

## 6. Alternate line ladders

Sanity rule: base line must price near 50% or the comparison window is biased.

### Underdog +4.5 (n=738, base 49.7% ✓)

| Line | P(win) | Fair price | Break-even price |
|---|---|---|---|
| +4.5 | 49.7% | +101 | (base) |
| +5.5 | 51.5% | -106 | -119 |
| +6.5 | 55.4% | -124 | -140 |
| +7.5 | 61.5% | -160 | -184 |

### Over, base total 48.5 (n=6,967, base 49.5% ✓)

| Line | P(win) | Fair price | Break-even price |
|---|---|---|---|
| over 48.5 | 49.5% | +102 | (base) |
| over 47.5 | 52.5% | -110 | -125 |
| over 46.5 | 55.7% | -126 | -144 |
| over 45.5 | 58.9% | -143 | -165 |

---

## 7. Parlay mathematics

**parlay EV = Π(1 + EV_i) − 1**

| Per-leg EV | 2 | 4 | 6 | 10 legs |
|---|---|---|---|---|
| -110, no edge (-5.26%) | -10.2% | -19.4% | -27.7% | **-41.7%** |
| exactly fair | 0.0% | 0.0% | 0.0% | 0.0% |
| +2% edge | +4.0% | +8.2% | +12.6% | +21.9% |
| +3% edge | +6.1% | +12.6% | +19.4% | **+34.4%** |

### Bought-points parlay (61.5% legs)

| Book price | Leg EV | 4-leg |
|---|---|---|
| -160 (fair) | -0.06% | -0.2% |
| -184 | -5.08% | -18.8% |
| -240 | -12.87% | -42.4% |

### Payout vs fair (61.5% legs at -184)

| Legs | True prob | Fair | Book pays | Shortfall |
|---|---|---|---|---|
| 2 | 37.82% | +164 | +138 | -9.9% |
| 3 | 23.26% | +330 | +268 | -14.5% |
| 4 | 14.31% | +599 | +468 | -18.8% |
| 5 | 8.80% | +1037 | +776 | -22.9% |
| 6 | 5.41% | +1748 | +1252 | -26.8% |

### Correlation mispricing (two 55% legs)

| Correlation | True joint P | Book implied | Edge |
|---|---|---|---|
| 0.00 | 30.3% | 30.3% | 0% |
| 0.15 | 33.9% | 30.3% | +12% |
| 0.30 | 37.5% | 30.3% | **+24%** |
| 0.45 | 41.5% | 30.3% | +37% |
| 0.60 | 45.1% | 30.3% | +49% |

---

## 8. Offseason roster change — QB continuity (tested → Context, not a model factor)

Question: does an offseason roster-improvement signal sharpen the line-blind
**preseason** rating beyond last-year point differential alone? Target = a team's
mean point differential per game (the model's rating). OOS = leave-one-season-out
over the 2017–2025 transitions. Scripts: `analysis/roster_backtest.py`,
`analysis/qb_direction.py`.

### 8a. Returning production — snap-weighted retention (n=286)

RP = share of a team's year-(Y-1) offense+defense snaps taken by players still on
the team in year Y. Mean 0.68, SD 0.10, range 0.43–0.97.

| Model (OOS) | MAE | RMSE | vs. baseline |
|---|---|---|---|
| Prev point diff only | 4.643 | 5.591 | — |
| + returning production | 4.624 | 5.567 | −0.019 |
| + RP + prev×RP (interaction) | 4.636 | 5.594 | −0.007 |

partial corr(RP, result \| prev) = **+0.11**. **No usable signal** — 0.02 pts,
mostly confounded with last year's record (good teams both win and retain).

### 8b. QB change — binary (n=286)

Same primary starter as last year (62% of teams keep theirs).
partial corr = **+0.15**; OOS MAE 4.643 → **4.550 (−0.093)**. Looks helpful — but
8c shows what's actually inside it.

### 8c. QB change — direction / upgrade vs. downgrade (n=235 measurable)

Incoming QB's prior EPA/att minus outgoing QB's (0 if unchanged). Of 113 QB
changes, **48 (42%) go to a rookie / never-started QB — direction unmeasurable in
advance.** Of the 65 measurable changes: 34 upgrades, 31 downgrades (a coin flip).

| Model (OOS, 235 rows) | MAE | vs. baseline |
|---|---|---|
| Prev point diff only | 4.572 | — |
| + QB changed (binary) | 4.589 | +0.017 (worse) |
| + QB **direction** | 4.586 | +0.013 (worse) |
| + both | 4.600 | +0.027 (worse) |

partial corr(direction, result \| prev) = **+0.05** overall, **+0.02** among changed
teams only.

**Direction is a null.** And note the binary flag *helped* in 8b (−0.093) but
*hurts* here (+0.017) — because 8c excludes the rookie-takeover cases. So the 8b
signal was the *rookie-takeover* cases: the flag marks **uncertainty (unproven new
starter), not direction.** We can see the ground shift under a team; we can't
forecast which way, and it's unmeasurable for ~40% of changes. The market prices
every proven-QB swap.

**Disposition:** not a model input (fails the OOS bar — makes it worse). Becomes a
**Context flag** — "New Week-1 starter (unproven)" — that informs, does not move the
number. Caveat: n=65 measurable changes is underpowered, so this is "no *detected*
signal," but the rookie-blindness is structural, not just sample size.

---

## 9. Props projection — volume × efficiency vs. baselines (`props_projection.py`)

Stages 1–4 of the props model, built on the project's core principle: project
volume (persists), multiply by a *regressed* league efficiency baseline (player
efficiency is noise), never model yards directly. Walk-forward, test 2021–2025,
graded on 16,936 skill player-weeks with ≥4 games of current-season history.

Model = projected volume × position efficiency. Baselines use recent *yards*
directly. MAE against actual box-score yards:

| Prop (n) | persistence (last wk) | season-avg | model | model-EWMA |
|---|---|---|---|---|
| Rushing yds — RB/FB, proj carries ≥8 (2,399) | 34.51 | 27.52 | 27.54 | 27.31 |
| Receiving yds — WR/TE, proj tgt ≥3 (7,018) | 32.63 | 25.60 | 25.49 | 25.70 |
| Receptions — WR/TE (7,018) | 2.19 | 1.73 | 1.73 | 1.74 |

**Two findings:**

1. **The volume × efficiency projection ties a season-average of yards** (27.5 vs
   27.5 rushing; 25.5 vs 25.6 receiving) and **beats last-week persistence by
   ~25%.** The decomposition doesn't add point-accuracy edge because, for
   established players, their own averaged efficiency ≈ the league baseline and
   their averaged volume is already in the season-average.

2. **Recency-weighting (EWMA volume) helps rushing on change weeks (+1.1%, n=503)
   but hurts receiving (−2.4%, n=1,843).** Carry-role changes stick; target spikes
   mean-revert, so chasing recent targets adds error. Matches the snap-share
   result — the volume signal that persists is *carries/role*, not target bursts.

**Consequence:** a better point projection is not where the props edge is — a
projection that ties the season-average will not beat a market that also knows the
season-average. The edge, if it exists, has to come from (a) **calibrated
over/under _probabilities_** (the distribution, not the point — that's what prices
a prop), (b) the validated **snap-share change signal** as the volume input
(§1: +8.2% on change weeks), and (c) beating the **closing prop line** (needs the
line history now being captured). Point MAE is a table-stakes sanity check, not the
bar.

### Distribution layer — P(over/under a line) (`props_distribution.py`)

Turns a projection into a probability. Model the ratio r = actual / projection
(far more stable than raw yards), bucket by projected volume (tertiles), keep an
empirical ratio-CDF per bucket, fit on **strictly prior seasons**, apply
walk-forward. Then P(over L) = 1 − F_b(L / projection). Empirical, not Gaussian.

Out-of-sample calibration (test 2021–2025):

| Prop | 50% cov | 80% cov | 90% cov | ECE |
|---|---|---|---|---|
| Rushing yards (n=1,427 pw) | 50.5% | 81.2% | 91.5% | 0.7 pts |
| Receiving yards (n=5,602 pw) | 49.8% | 83.0% | 92.5% | 0.4 pts |
| Receptions (n=5,602 pw) | 50.1% | 83.4% | 93.2% | 0.4 pts |

**The probabilities mean what they say** — a predicted 65% over hits ~65%, across
every decile, with expected calibration error <1 point. The 80/90% intervals run
slightly *wide* (conservative), the safe direction — we never overstate confidence.
This is the machinery that honestly prices a prop.

**Still not an edge by itself.** A calibrated 55%-over is +EV only if the book
prices it below 55%. Reliability here was checked against projection-relative
synthetic lines, which proves the *distribution* is calibrated — not that we beat a
book. The pick = our calibrated P vs. the book's implied P, which needs the prop-
line history now accruing (`prop_snapshots`). Also validated only on rostered
players above a volume floor with ≥4 games; low-volume/early-season is out of scope.

---

## 9b. Projection vs. the closing line — out of sample (`proj_edge_backtest.py`)

The test §9 left open: now that the backfilled prop history exists, does our
line-blind projection actually **beat the closing line**? Walk-forward projections
(strictly prior data) vs. the **consensus closing line** (backfilled
`prop_snapshots`) vs. the **actual result**. Our lean = OVER if proj > line. Season
2024, **6,457 graded props** with a result.

| Market | n | Our lean win% | vs. vig (52.4%) |
|---|---|---|---|
| Rushing yds | 944 | 48.4% | −4.0 |
| Receiving yds | 2,853 | 50.0% | −2.4 |
| Receptions | 2,660 | 51.0% | −1.4 |
| **All** | **6,457** | **50.2%** | **−2.2** |

**We do not beat the line.** ~50% overall — a coin flip, below the 52.4% break-even.
And the conviction gradient runs the **wrong way**: the bigger our disagreement with
the line, the *worse* we do — 0–2 yds 50.9%, 2–5 51.8%, **5–10 48.5%, 10+ 48.4%**.
The recency-weighted volume variant is the same story (all 50.7%, 10+ bucket 47.5%).

**Reading.** §9 showed the projection is *accurate* (beats persistence/season-avg on
MAE) and §9a that it's *calibrated*. But the closing line is a far stronger baseline
than persistence — and it already prices everything our volume×efficiency model
knows, plus what it can't see (game script, matchup, late news). When we deviate far
from the line we are usually the one who's wrong. **This is priced.** It confirms the
architecture: the Player Model is a trust/context engine (published, graded, honest),
**not** a bet signal — the edge lives in Value Finder (price), not in the projection
beating the market. Grades rush/rec/receptions only; passing yds + game lines untested
here (the game-line rating was already shown to be noise, §5).

---

## 9c. Upsets — the spread already prices them, both sports (`upset_study.py`)

Prompted by the CFB card flagging only 1 "upset" of 52 after the SP+ seed made our
projection agree with the market. Question, tested the honest way: an upset = the market
**underdog wins outright** (moneyline upset); does any variable predict upsets **beyond
what the spread already prices**? NFL from `data/games.csv` (nflverse, 7,245 games with a
real dog, 2016–2025); NCAAF from `data/cfb.db` (3,625 FBS-vs-FBS with a consensus spread).

**The spread is a near-perfect upset predictor, and it's priced.** NFL upset rate by
spread bucket tracks the de-vigged moneyline-implied rate almost exactly:

| \|spread\| | n | upset% | ML-implied% |
|---|---|---|---|
| 1–3 | 1,450 | 47.0 | 45.8 |
| 3–7 | 3,593 | 36.0 | 35.5 |
| 7–10 | 1,299 | 23.9 | 24.4 |
| 10–14 | 688 | 17.0 | 17.7 |
| 14–21 | 211 | 9.0 | 11.5 |

NCAAF is the same clean monotonic curve (48.4% at 1–3 → 5.5% at 21+); no historical ML in
the store, so its price test is blocked (same wall as §9/CFB props).

**No auxiliary variable beats the spread — in either sport.** Logistic `upset ~ |spread| +
X` (X standardized), every candidate |z| below the 2.0 bar:

| Variable | NFL z | NCAAF z |
|---|---|---|
| home dog (dog at home) | −1.0 | +0.8 |
| divisional / cross-conference | −0.0 | +0.6 |
| dog rest edge / short week | +0.5 / −1.8 | — |
| game total | −1.3 | — |
| Elo gap (home basis) | — | −0.9 |
| dog is Power-conf / neutral / late | — | 0.0 / +1.1 / −0.1 |

The famous **home-dog** angle is a spread confound: raw home-dog upset rate looks higher
(NFL 35.4% vs road-dog 32.4%; NCAAF 30.6% vs 25.0%) **only because home dogs carry smaller
spreads** (home field is already in the number). Match on spread size (games inside 7 pts)
and it vanishes — NFL home-dogs upset *less* (38.5% vs 39.6%). The lone NFL variable within
sight of significance, dog-on-short-week (z=−1.8, p=.08, one of 14 tests), points the
*wrong* way vs folklore (short-week dogs upset slightly less) and dies under multiple
comparisons.

**Reading.** Same result as §4/§5/§9b, now for upsets: the market spread already contains
everything our public variables know about who wins outright. This is *why* a
well-calibrated model flags few upsets — genuine off-market upset signal is ~nonexistent;
flagging more would mean manufacturing it. Upset context (home dog, division, rest,
letdown/lookahead) is true and worth showing, but it is **not** a pick driver.

---

## 9d. CFB game line & totals — does the rating beat the closing number? (`cfb_ats.py`, `cfb_totals.py`, `cfb_ats_slices.py`)

The CFB power rating's only bar, refreshed after pulling **2025 lines** (they had been
capped at 2024, leaving the published ATS a season stale). Walk-forward: fit weeks < w,
predict week w, seed each season from the prior (λ=5, cap 28, decay 0.6, from week 6),
2020–2025, consensus closing number. Break-even at −110 = 52.38%.

**Spread ATS (`cfb_ats.py --end 2025`), n=2,822 bets:** 49.79% at all bets (−2.59 pts),
49.26% at edge ≥2 (−3.12), 51.89% at edge ≥6 (−0.49, n=779). **Does not beat the spread at
any threshold** — the added 2025 season confirmed the loss, it didn't reveal an edge.
(Straight-up the rating still ~ties Elo; margin RMSE a hair worse. Competent, not an edge.)

**Totals O/U (`cfb_totals.py`), first-ever backtest — n=2,852; projection MAE 13.0 / RMSE 16.4:**
50.81% at all leans (−1.57), **52.22% at the shipped ≥2-pt lean (−0.17, dead on break-even =
no edge)**, a non-monotonic blip to 53.14% at ≥4 (n=991, +0.76) that falls back to 50.33% at
≥6. **The totals lean does not reliably beat the O/U — it is context, not a pick.**

**ATS by slice (`cfb_ats_slices.py`) — is any subset beatable? No.** By tier: P5-vs-P5 50.28%,
G5-vs-G5 **48.55%** (the "softer G5 lines" prior is *contradicted* — G5 is the worst),
P5-vs-G5 mixed 56.78% but only **n=118** (noise, below the 300-bet bar). Every week bucket
(early/mid/late) and spread-size bucket (close/mid/big) sits below break-even. No durable
beatable slice exists.

**Reading.** Same result as §4/§5/§9b/§9c, now nailed for the CFB game line *and* totals: the
closing number already contains the rating's information. The CFB model is honest Context and
a calibration exhibit — **not** an ATS pick driver. CFB value, if anywhere, is line-shopping
(Value Finder), not the projection.

---

## 9e. Injury / availability — NFL yes, NCAAF no (`analysis/injury_adj.py`)

Two sports, opposite answers, and the difference is data availability rather than football.

### NFL — a real correction, shipped as `game-v4-injury`

Feature = the SHARE of a team's volume that is ruled Out/Doubtful, per position group
(QB→attempts, RB→carries, WR/TE→targets). Share, not headcount: a first pass using a binary
"is a starter out" found nothing outside QB, because it treats a WR1 on a 28% target share the
same as a WR2 on 15%.

| spec | QB | RB | WR | TE |
|---|---|---|---|---|
| binary starter-out | −3.59 (t −2.90) | −1.16 (t −0.99) | −1.09 (t −1.38) | +0.34 (t 0.31) |
| **share of volume** | **−4.35 (t −2.94)** | −2.25 (t −1.31) | **−4.96 (t −2.24)** | −1.45 (t −0.91) |

Points per 100% of the group's volume missing, fitted 2017–2022 (n=1567). QB and WR significant;
RB and TE right-signed but not established. Held out on 2023–2025:

| subset | n | MAE before | MAE after |
|---|---|---|---|
| a QB1 is out | 70 | 13.175 | **12.311** |
| any real absence | 398 | 11.436 | 11.312 |
| **nobody out** | 289 | 9.088 | **9.088 (+0.0000)** |

Season split is honest about the size: 2024 −0.228, 2023 +0.008, 2025 +0.029 — most of the
aggregate gain is one season. What survives is the shape: worth ~0.9 pts where a QB is out, inert
otherwise. Measured against the MODEL's own error, not the closing line — this is a correction,
not an edge claim.

### NCAAF — cannot be built, and probably not worth buying

**There is no pre-kickoff availability source.** The NFL mandates injury reports; the NCAA does
not. Verified, not assumed: CFBD `/player/injuries` and `/injuries` both 404, and ESPN's injuries
endpoints 403 for college *and* pro alike (an access block, not a college gap).

So the only definition available is post-hoc — a contributor who did not appear in the box score —
which is knowable only after kickoff and therefore useless for a locked pre-kickoff prediction.
Measured anyway, to price what an availability feed would be worth. Missing share vs the **closing
line**, fitted on 2024 (n=699), tested on 2025 (n=725):

| group | coef | t | verdict |
|---|---|---|---|
| QB | +1.43 | 0.80 | priced |
| RB | −2.51 | −0.69 | priced |
| receiving | +3.61 | 0.99 | priced |

Held-out MAE against the closing line **12.145 → 12.189 — worse**. WR and TE cannot be separated
(box scores carry no position), so they are one receiving group; stated rather than faked with two
identical columns.

**Reading: college availability is already in the number.** Even a perfect pre-kickoff CFB injury
feed looks unlikely to beat the line on this evidence, so paying for one is hard to justify. Caveats
worth keeping: 2 seasons only, one train/test split, and "did not appear" also catches benchings,
ejections and blowout rest, which is noisier than a real report.

## 10. Errors caught during this work

Recorded because these are the failure modes that produce confident, wrong betting
products — and every one happened while explicitly trying to avoid them.

| # | Error | How it surfaced | Cost |
|---|---|---|---|
| 1 | Claimed the snap-share edge was at the *back* of the depth chart | Proportional error by bucket showed it's the middle (35–60%) | Wrong product targeting |
| 2 | Stratified by \|actual − last week\|, i.e. by persistence's own error | Clean signal/no-signal split contradicted it | Two wasted model variants |
| 3 | Normal-margin model flagged **15 of 16** games as incoherent | Empirical curve showed the model was low at every spread | Would have declared the whole board mispriced |
| 4 | Entered moneylines backwards for all 5 road favorites | Coherence checker flagged impossible values | Caught pre-publication |
| 5 | Asserted lower totals → favorites win more | Data showed 60.0% vs 61.1%, slightly opposite, n.s. | Deleted a whole check |
| 6 | Alternate-line window ±1.5 gave base line at 53.9% | Sanity check — efficient lines must price ~50% | Would have shown free money at the base bet |
| 7 | Over-engineered odds ingestion (dedicated worker, partitioning) | Volume math: 2x/day is 480x smaller | Unnecessary infrastructure |

Four of seven were caught by automated checks rather than review. **Build the
checks into the pipeline, not the review process.**

---

## §12. MLB game model — what the run projection is worth (2026)

All figures walk-forward, constants swept on the first 70% of dates, scored on the rest.
Reproduce with `python mlb_game_model.py --validate`. **Current-season data only** — nothing is
blended from 2025 (see the prior-season test below).

### 12a. Totals

| model | MAE (runs) | vs baseline |
|---|---|---|
| league mean total, causal (8.96) | 3.5634 | — |
| team offence × defence, shrunk | 3.5611 | **−0.0%** |
| + starting pitcher | 3.5317 | **+0.9%** |

**Team quality on its own is worth nothing.** The shrinkage sweep chose k=150 against ~140 games
per team — the optimiser's way of saying "ignore the teams". Only the starting pitcher moves the
number. That is the sport, not the model: mean total 8.96, single-game **SD 4.52**, so variance
swamps every team-quality difference there is.

Mean signed error against actual totals is **+0.01 runs** (unbiased), though it is *too low* in four
of the season's six months. Home-field advantage measured **+0.06 runs** over 2,165 games —
indistinguishable from zero, and excluded.

### 12b. Margins — the model is far too TIMID, not too bold

| | ours | actual |
|---|---|---|
| mean abs margin | **0.61** | **3.60** |
| sd | 0.80 | 4.63 |

Direction is right (we say home by >1 ⇒ actual averages +1.19; away by >1 ⇒ −1.10), and a shrink
sweep chosen on train picked **1.0 — no shrinking**. Reported because the board *looked* like it
made too many favourites; it did not, and the cause was a display column (below).

### 12c. Prior-season team prior — real but small (SHIPPED 2026-09-08)

Question: does shrinking each team toward its own **2025** rate, instead of toward the league mean,
make the model less timid? Twelve configurations (regress ∈ {0.35, 0.5, 0.65} × K ∈ {150, 300, 600,
1200}), **chosen on train, reported on test**:

| | test margin MAE | margin gain vs zero | test total MAE |
|---|---|---|---|
| baseline (league prior, K=150) | 3.3178 | +2.29% | 3.5569 |
| prior regress=0.65, K=150 | **3.3064** | **+2.62%** | 3.5577 |

**+0.34% on margin MAE, totals unchanged**, mean abs margin 0.72 → 0.80. All twelve configurations
beat the baseline on test margin, and train agreed — so the sign is trustworthy even though the size
is small. Passes the standing bar (observable, mechanism stated in advance, improves out of sample)
**against actual results**; it has NOT been tested against a closing line, which MLB cannot do until
enough price history accumulates (capture began 2026-09-07).

Discipline note: selecting on the test split instead would have picked regress=0.5/K=1200 and
reported **+2.90%** — nearly double. The gap between those two numbers is the cost of choosing on
the data you report.

**Now wired in** at `PRIOR_REGRESS = 0.65`, `K_TEAM = 150`. Reproducible from the shipped script,
which reports margins alongside totals; run it with `PRIOR_REGRESS = 1.0` to collapse the prior back
to the league mean and recover the old model exactly:

| | total MAE | total gain | margin MAE | margin gain | mean abs margin |
|---|---|---|---|---|---|
| league prior only | 3.5317 | +0.9% | 3.3490 | +2.35% | 0.71 |
| **+ 2025 team prior** | 3.5355 | +0.8% | **3.3377** | **+2.68%** | **0.79** |

The trade is explicit: a tenth of a point of total accuracy for a third of a point of margin, and a
model that is less timid. Board effect — our mean absolute spread is 1.07 against the market's 1.01,
and we still call fewer home favourites than the market does (13 of 19 vs 16).

### 12d. The run line is not a spread

MLB's run line is a fixed ±1.5 on every game (confirmed against the raw capture: the only two
values present). A "consensus spread" column therefore prints −1.5 on nearly every row and, where
books disagree on the favourite, a median of **0** — not a real line. The market's side is read from
the **moneyline** instead: de-vig the pair, then `margin ≈ SD × probit(p)` with SD = 4.63.

### 12e. Batter vs pitcher (BvP) — measured, and deliberately not modelled

Career batter-vs-pitcher history, measured on a full 15-game slate (171 distinct pairs,
StatsAPI `vsPlayerTotal`):

| career AB vs tonight's starter | pairs |
|---|---|
| **0 — never faced** | **51.5%** |
| 1–4 | 20.5% |
| 5–9 | 17.0% |
| 10–19 | 9.9% |
| 20+ | 1.2% |

**Median 0.** 16% of all pairs read `.000` or `≥.500` on six at-bats or fewer — figures that look
authoritative and are noise. It is published as CONTEXT with the sample printed beside it, and is
not an input to any probability. It also could not fix a board-level lean even if it were: a
per-matchup adjustment averages to nothing across a slate.

### 12f. The board's "book %" column, and why our number sits above it

Measured on `batter_hits`, 1,122 (player, book) quotes in one snapshot:

| | mean |
|---|---|
| our probability | 61.9% |
| raw implied Over | 60.5% |
| de-vigged book (the column) | 56.7% |
| **realized 1+ hit rate (held out)** | **60.6%** |
| mean hold on the market | **6.77%** |

Our number sits on the rate batters actually achieve; the book column sits ~4 points below it
because the hold has been removed. **On a 6.8%-hold market a board comparing "our fair" against
"book fair" will always look like it leans over.** That is arithmetic, not a signal, and it is why
the lean cannot be read as a model error without the realized base rate beside it.

Defect found and fixed in the same pass: `propBookProb` fell back to the **raw** implied
probability when a book posted only one side (270 of 1,122 quotes), then took a median across books
— mixing ~56.7% de-vigged values with ~60.5% raw ones in a single column. Two-sided quotes now win
outright; a one-sided price is brought onto the same footing with the hold measured from that
snapshot.

### 12g. The board was comparing P(2+ hits) against P(1+ hit)

`batter_hits` carries **two lines**: 0.5 ("will he record a hit") and 1.5 ("will he get two") —
399 of 5,845 captured rows at 1.5. `propBookProb` keyed on `(player, book, side)` only, so the most
recently posted line won per book. Yandy Díaz's newest quotes were the 1.5 line
(`Over +160 / Under −220`), de-vigging to **36%** — his chance of a *second* hit, shown in a column
labelled as the chance of a hit, beside our 70%.

Caught by eye: his team-mates read 64% and 65% and he read 36%, which is the complement pattern a
mismatched line or side produces. A second, quieter failure came from the same key: an `Over 1.5`
could be paired with an `Under 0.5` from the same book and "de-vigged" into a meaningless number.

Fixed by keying on the line and filtering to the one the board asks about. Díaz now reads
**book 73% vs our 70%**; board-wide mean gap **+5.4pp → +3.3pp**, over-rate 78.8% → 75.0%.

The function's own comment had asserted *"the LINE carries no information — it is 0.5 on every
row"*, which is why nobody checked. **A comment stating a data invariant is a claim, not a fact.**

## §13. NCAAF prop conversion — the 50/50 ratio is fitted and applied on DIFFERENT SCALES (2026-10-01)

`weekly_flags` flagged the NCAAF board at median(proj/line) **1.094** (n=149) with 8 rows projecting
≥2× a non-trivial line. The headline is misleading in both directions, so all of it is recorded.

**It is not a uniform over-lean.** The per-market leans are fine (rec 59%, rush 53%, pass 40%,
receptions 44%). The ratio falls monotonically with the level, in every market:

| market | Q1 (low lines) | Q2 | Q3 | Q4 (high) |
|---|---|---|---|---|
| rec_yds | **1.474** | 1.004 | 1.036 | 0.921 |
| rush_yds | 1.091 | 1.124 | 1.116 | 0.887 |
| receptions | **1.200** | 1.020 | 0.944 | 0.945 |
| pass_yds | 1.025 | 0.973 | 0.924 | 0.933 |

**It is not thin samples.** Pooled over all rows the ratio does fall with sample size (0–4 games
1.405, 21+ games 1.017), but every one of the 149 flagged rows already has g ≥ 8, and restricting to
g ≥ 13 leaves it at 1.091. `MIN_PROJ_GAMES = 5` is doing its job; this is a separate defect.

**The defect: `PUBLISH_RATIO` is FITTED on bands of the BOOK'S LINE and APPLIED on bands of our own
mean.** `cfb_median_fit.py` buckets its `(line, actual)` pairs by the line; `to_fifty_fifty` selects
its band with `mu`. Those are different scales, and the gap between them is precisely the error the
ratio exists to remove — so the lookup lands a band too high, where the shrink is weaker:

- **62% of `rec_yds` rows and 51% of `rush_yds` rows** get a ratio fitted for a different band.
- It is **self-reinforcing**: the more inflated `mu` is, the higher the band it selects and the less
  it is shrunk. TJ Thomas (line 27.5) has `mu` 57.3, lands in band 3 and takes a **4%** shrink where
  his line's band says **28%** — published 55.1, which is 2.00× and one of the 8 flagged rows.

**Re-running the fit makes the low end WORSE, and the instruction to paste it is now qualified.**
The 2026-10-01 refit (573 receiving pairs, up from 391) raises `rec_yds` 0–18 from 0.616 to **0.789**
— a weaker shrink on the band that is already 1.47. Measured on the current board:

| variant | rec_yds median r | %over | Q1 median r |
|---|---|---|---|
| current (band by `mu`, old ratios) | 1.047 | 56% | 1.349 |
| band by OUTPUT, old ratios | 0.901 | 40% | 1.158 |
| band by `mu`, refit | 1.060 | 58% | 1.484 |
| band by OUTPUT, refit | 1.032 | 54% | 1.484 |

**NOTHING WAS SHIPPED, because no variant is defensible.** Correcting only the scale over-shrinks the
board to 40% over; the refit alone worsens the low band. A 1.45 cannot be brought to 1.0 by any ratio
in the 0.6–0.9 range, which says the residual low-line error is **not in the conversion at all** —
`mu` itself is too high for players the book lines under ~25 yards.

**Why it cannot be settled yet, and the one thing that unblocks it.** `med/mean` inside a line band
is an aggregate property of that band, not of the player we are converting; it is only the right
estimator when our `mu` equals the band's mean actual, which is exactly what is false here. The
honest fit is "median(actual) as a function of OUR mean" — and it cannot be estimated, because **we
have never stored the historical `mu`**. Storing the pre-conversion mean alongside each published
NCAAF projection costs nothing and is the prerequisite for validating any version of this out of
sample. Until then the conversion is unfalsifiable, which is the real finding.

`receptions` stays deliberately uncorrected: the refit offers a flat 0.771, and the board's overall
receptions lean is already 44% over — applying it would repeat the overshoot to 35% measured before.


### §13a. ...and 38% of the board never reaches the conversion at all (2026-10-02)

Storing `mu` paid for itself the first time the board was regenerated. A row that was never
converted is exactly one where `mu == proj`, and that made a second defect visible immediately:

**`cfb_player_proj.py` builds rows on three paths and only two of them call `to_fifty_fifty`.** The
second pass — players the market priced but the depth chart never listed — appends `proj` raw. Those
rows go on the board as a recency-weighted MEAN beside a line the book set near a MEDIAN, which is
the precise defect the conversion exists to remove. Ja'Kyrian Turner carried both at once: his
`rush_yds` came through the depth-chart pass and converted, his `rec_yds` came through the second
pass and did not.

It hid for so long because both numbers look like yards from outside, and because the population is
the one with no depth-chart slot — the same rows measured at 1.141 in §13 and 37 of the 51 in the
1.474 bottom quartile. Week 5, 2026, 392 yardage rows with a posted line:

| population | n | median proj/line |
|---|---|---|
| converted (`to_fifty_fifty` ran) | 243 | **0.984** |
| unconverted (`mu == proj`) | 149 (38%) | **1.197** |

The converted half of the board is already right. Essentially all of the visible over-lean is the
unconverted half — which revises §13's reading that the residual error "is not in the conversion at
all": much of it is the conversion never running.

**Applying it uniformly was measured and NOT shipped, because it trades one bias for another:**

| market | n | now | if converted |
|---|---|---|---|
| rec_yds | 102 | 1.252 (80% over) | **0.981** (46%) |
| rush_yds | 44 | 1.059 (52% over) | **0.820** (27%) |

`rec_yds` is fixed outright; `rush_yds` is currently near-fair and would be pushed to 27% over. The
whole yardage board moves 1.056 → 0.968. Fixing only the market that improves would be fitting to one
week's board at n=44, which is the overfitting this project forbids. And the ≥2× rows barely move
(7 → 6), so this is not the cause of the extreme rows either.

The reason it cannot be settled today is still §13: the band ratios themselves are fitted on one
scale and applied on another, so converting *more* rows with them propagates that error to a bigger
population. Both fixes want the same prerequisite — enough stored `mu` to fit median(actual) against
our own mean. **`ncaaf_guardrail.check_one_scale` now reports the split as a WARN** (not a FAIL: it
is true of 38% of rows today, and a check that is red every morning is one nobody reads). It turns
green the day the second pass is fixed, and red again only on a regression.


### §13b. The second pass converts — SHIPPED 2026-10-02 (Derek's call)

Shipped against my own hesitation, and the board is better than the subset measurement predicted.
That measurement was the error: §13a measured the 44 previously-unconverted `rush_yds` rows in
isolation (0.820) and read it as a market-level regression. The MARKET includes the rows that were
already converting, and it lands at 0.945.

| market | n | before | after |
|---|---|---|---|
| rec_yds | 222 | 1.112 | **0.985** (47% over) |
| rush_yds | 110 | 1.105 | **0.945** (44% over) |
| pass_yds | 59 | 0.995 | 0.958 (34% over) |
| receptions | 145 | 1.160 | 1.044 (57% over) — still uncorrected by design |

The two flags that started this are resolved:

- **proj/line on mid-range players 1.094 → 1.049**, inside the 0.93–1.07 band.
- **rec_yds tilt 19pts → 5pts.** The tilt was the structural signature of the whole defect — the
  bottom of each game leaning over while the top did not — and it is now flat.
- `ncaaf_guardrail.check_one_scale` reports all 391 yardage rows on one scale and was promoted from
  WARN to **FAIL** the same day: with the backlog cleared, a red means a regression.

**Still open, and not caused by this change.** Rows ≥2× a non-trivial line went 8 → 6 (Evan Dickens
39.5 → 102.9). Those are rows where `mu` itself is wrong, not rows the conversion mis-scaled, and
they are the §13 problem. `pass_yds` moved 40% → 34% over, but its ratio is 1.006 — effectively the
identity — and only 3 pass rows were ever unconverted, so that is line drift and the market, not
this edit.

**The lesson worth keeping: a subset measurement is not a market measurement.** I came within one
sentence of refusing a change that was correct, because I measured the population I was changing
instead of the population the user sees.


### §13c. Why Evan Dickens projects 102.9 — a transfer's old school becomes his new team's role

Traced end to end. Not a data bug, not a name collision (one athlete id, 5076122, across both
seasons), and not the conversion. The arithmetic is exactly right and every input is wrong in the
same direction.

    18.81 projected carries  x  5.457 recency-weighted ypc  =  102.7      (then x1.002 -> 102.9)

**His 2025 was genuinely enormous — at another school.** 1,539 yards on 273 carries over 11 games
(217, 127, 106, 228, 267 in the back half) for a Conference USA team. At Boston College in 2026 he
is 214 yards on 45 carries across 4 games: **11.2 car/g, 53.5 yds/g, 4.76 ypc**. The book line is
39.5.

**The role prior is himself.** `build()` re-tags a transfer's whole log entry to his current team
(`_e["team"] = _t`) and `rank_baselines` immediately groups by that field and reads
`recent = PRIOR_SEASON games`. So Dickens's 11 games elsewhere are attributed to Boston College,
rank him BC's RB1, and *become* BC's RB1 carries baseline:

    BC RB1 baseline = 20.73 car/g        Dickens' 2025 = 20.7 car/g

`rank_baselines`' docstring promises "the workload a role implies, independent of who filled it".
For a transfer it is one player's production at a different program, so the blend
`v = (own*n + base*k)/(n+k)` has no independent anchor — it is his own prior season on both sides.
Each game already carries its own `g["team"]`, so the information needed to fix it is present.

**Meanwhile BC's actual 2026 lead back is Mason McKenzie**, 18.5 car/g for 90.8 yds/g. Dickens is the
complement. The model has the depth chart inverted because the ranking counts games played elsewhere.

**Scope, measured on the week-5 board:** 1,462 players have prior-season games for a different team
than their current one, and **61 of them define their new team's rank-1 baseline**. It is heaviest at
QB, where the transfer portal moves starters every year — Iowa State's QB1 attempt baseline is
Arkansas State's offense (38.46/g), Miami's is Duke's, LSU's is Arizona State's.

**It is NOT a board-wide inflation, which is why it survived.** Across the 483 rows with both a prior
and a current season, the shipped projection is a median **0.917x** of a current-season-only one — the
prior season usually damps correctly. Only 45 rows (9%) are inflated more than 25%, and Dickens is
4th worst. This is a tail that the averages hide.

**Two separate contaminations, and the architecture already says which way to split them.** The
project's standing finding is *volume persists, efficiency doesn't* — but volume persists as a
property of a ROLE on a TEAM. A transfer's workload (20.7 carries) is not portable; his efficiency
(5.64 ypc) plausibly is. So the candidate fix is: attribute each game to `g["team"]` when building
role baselines, and exclude prior-school games from the VOLUME estimate while keeping them for
efficiency. NOT SHIPPED — it is a model change and belongs behind `analysis/cfb_role_backtest.py`
out of sample, the way ROLE_BLEND_K and QB_BLEND_K were settled.

Note the conversion is innocent here but not harmless: `mu` of 102.7 lands in the 80+ band whose
ratio is 1.002, so it escaped correction entirely, where its line's own band (28-45) carries 0.722.
That is §13's scale mismatch producing its worst case — the more wrong the mean, the less it is
corrected.


### §13d. The transfer fix — TESTED AND REJECTED, the hypothesis was backwards (2026-10-02)

§13c found that a transfer's prior-school production is attributed to his new team, so Evan Dickens'
20.7 car/g at a CUSA school became Boston College's RB1 baseline and he was blended toward himself.
The reasoning was that workload is a property of a ROLE on a TEAM and should not travel, while
efficiency should. Both halves were implemented behind `CFB_TRANSFER` and scored on played weeks
against what players actually did — choose on week 2, confirm on week 3:

| transfer rule | wk2 MAE | wk3 MAE | wk2 bias | wk3 bias | rushing MAE wk2 / wk3 |
|---|---|---|---|---|---|
| **off** (ships) | **21.2** | **22.8** | +0.3 | −5.0 | **30.1 / 34.3** |
| team | 21.6 | 22.8 | +1.5 | −3.6 | 30.8 / 34.5 |
| vol | 21.5 | 23.1 | +1.9 | −3.2 | 31.4 / 35.1 |
| both | 22.4 | 23.2 | +3.4 | −1.7 | 34.5 / 35.8 |

`off` is best-or-tied on MAE in both weeks, and **rushing — the category the fix was written for —
degrades monotonically with how much of the prior school is removed.** Removing the information made
the prediction worse, which means the information is real: **a transfer's prior-school workload does
predict his new workload, better than his new team's role baseline does.** The conceptual complaint
in §13c stands — the baseline really is contaminated — but correcting it costs more than it saves,
so the contamination is apparently carrying signal rather than noise.

**The bias column is a trap, and it is the one I would have fallen into.** The rule shifts
projections reliably UP, so it reads as a fix in week 3 (−5.0 → −1.7) and as damage in week 2
(+0.3 → +3.4). Bias swings sign between weeks at a FIXED setting, exactly as the QB_BLEND_K table
shows, so it is week-to-week variance in how teams played, not evidence about the knob. MAE is the
criterion. Had I run only week 3 and looked at bias, I would have shipped a change that makes the
board less accurate.

Dickens moved 122.1 → 99.3 at week 2 under `both` and the board still got worse. So he is a genuine
outlier, not the visible end of a systematic error — which is also why §13c's measurement found the
median affected row at 0.917× and only 9% inflated past 25%. The knob stays, defaulted `off`.

Tooling note: `cfb_role_backtest` ran the child with `encoding="utf-8"` and no error handler, and a
cp1252 byte in a team name ("San José State") raised UnicodeDecodeError in the pipe reader thread.
The child still ran so the results were fine — but a REAL projector failure could be swallowed the
same way and scored as a variant. Now `errors="replace"`.


### §13e. The NCAAF card inflates HOME FAVOURITES by ~4 points, and only them (2026-10-02)

Measured on the week-5 board, FBS-vs-FBS only, as |our margin| − |market margin|:

| the market favours | n | median \|model\| − \|market\| | we side with the favourite |
|---|---|---|---|
| HOME | 31 | **+4.10** | 65% |
| AWAY | 23 | −0.20 | 48% |

Across all 106 priced games we take the home side against the market in **61%** of them, median
edge −2.35 points.

**It is not CARD_SCALE.** A symmetric de-compression (1.33) would enlarge away favourites by the
same proportion, and they sit flat at −0.20. Whatever is adding the points is conditioned on the
home side, so the suspects are HFA (3.2) entering the scaled margin, or the spread-aware market
anchor behaving asymmetrically — not the scale on its own.

**Pre-existing, not from the FCS change.** The same measurement on the 59-game board from before
that commit gives +4.10 / −0.10 — identical. Adding 49 FCS games moved the pooled number to +2.60
only by mixing in a different population.

Consistent with the published record rather than contradicting it: card ATS is **49.3%** against a
52.38% breakeven, and the standing finding is that the CFB rating ties Elo without beating the
spread. A systematic 4-point inflation on one side of the board is a plausible contributor, and it
is the first mechanism found that is specific enough to test.

NOT FIXED — it is a model change and belongs behind a backtest, the same bar the transfer rule was
held to in §13d. The cheap first experiment is to re-measure with HFA excluded from the scaled term
(scale the rating difference, add HFA after) and score it on played weeks.


### §13f. HFA belongs OUTSIDE the card scale — SHIPPED 2026-10-02

§13e's suspect was right. `anchored_margin` computed

    m = CARD_SCALE * (rh - ra + hfa)

so the de-compression meant to widen a compressed rating gap also widened a measured field
advantage: the board played **1.33 × 3.2 = 4.26** points of home edge it never intended.

**The published card number had never been backtested.** `cfb_ats.py` scores the RAW rating
(`ratings[home] − ratings[away] + hfa`); the card publishes that run through CARD_SCALE, a market
anchor and two de-bias passes. `analysis/cfb_card_backtest.py` now mirrors build_card step for step
— anchor and both de-bias passes included — because a validator that predicts differently from
production measures a model nobody ships, which this repo has been bitten by twice.

Walk-forward 2021–2025, HFA inside vs outside the scale:

| season | MAE in | MAE out | bias in | bias out | home-fav infl in / out |
|---|---|---|---|---|---|
| 2021 | 13.21 | **13.16** | +2.33 | **+1.59** | −0.36 / −0.81 |
| 2022 | 12.57 | **12.43** | +3.38 | **+2.35** | +0.39 / −0.34 |
| 2023 | 13.31 | **13.25** | +1.64 | **+0.77** | +0.43 / +0.00 |
| 2024 | 12.59 | **12.50** | +1.70 | **+0.72** | +0.83 / +0.00 |
| 2025 | 12.65 | **12.48** | +2.48 | **+1.26** | +1.16 / +0.19 |

**Lower MAE in 5 of 5 seasons and lower bias in 5 of 5** — a stronger result than the transfer rule
cleared (§13d), where `off` was merely best-or-tied. Split choose-2021/23 / confirm-2024/25 agrees:
MAE 12.84→12.78 and 12.55→12.47.

On the live week-5 board the asymmetry narrows as predicted: we take the home side against the
market in **59% → 52%** of games, and the home/away inflation gap closes from 4.30 points
(+4.10 / −0.20) to 2.30 (+3.10 / +0.80). Both sides positive is CARD_SCALE doing its intended,
symmetric job — our ratings really are compressed by the ridge.

`rate_non_fbs`'s division-offset fit was changed in the same commit: it is fitted against the
published formula, so leaving it on the old one would let the FCS offset quietly absorb the
difference and mis-place every FCS team.

**NOT a cure.** A residual positive bias of ~+0.7 to +2.4 remains — we still over-predict the home
margin. ATS is unchanged in substance (49.3% published, below the 52.38% breakeven), so this is a
calibration correction and not an edge claim.

~~The next candidate is the fitted HFA itself: college home advantage has compressed over this
period and 3.2 may simply be high for 2026.~~ **Measured and WRONG in both halves — see §13g.**
Home advantage has RISEN (1.53 → 3.50 since 2020) and 3.2 is slightly LOW, not high. That sentence
was speculation written into the record as if it were a lead; it should not have been.


### §13g. The fitted HFA is right — and home advantage is RISING, not compressing (2026-10-02)

§13f named the fitted HFA as the next suspect for the residual home bias, on the reasoning that
college home advantage has compressed. Both halves of that are wrong.

**The naive benchmarks mislead, so they are shown and then discarded.** `mean(actual home margin)`
is 5.23 in 2025 and `mean(-spread)` is 4.54, both far above our fitted 3.18 — which looks damning
until you notice neither controls for schedule. P5 teams host weak non-conference opponents, so both
numbers are home advantage PLUS a scheduling imbalance. The ridge is the only one of the three that
separates them.

**Fitting the SAME ridge to the market's own spreads makes it apples-to-apples** — team dummies plus
a home flag, response `-spread` instead of `margin`:

| season | HFA from RESULTS | HFA the MARKET prices | gap |
|---|---|---|---|
| 2020 | 1.53 | 2.42 | −0.89 |
| 2021 | 2.21 | 3.10 | −0.89 |
| 2022 | 2.53 | 3.47 | −0.94 |
| 2023 | 2.79 | 3.26 | −0.47 |
| 2024 | 3.36 | 3.29 | +0.07 |
| 2025 | **3.50** | **3.33** | +0.16 |

Two findings, neither of them the one expected:

1. **Home advantage has risen steadily since the 2020 trough** (1.53 → 3.50), consistent with crowds
   returning. The "HFA is compressing" intuition is a real trend in some sports and is not what this
   data shows.
2. **The market over-priced home advantage from 2020-2022** by ~0.9 points a year and converged with
   results by 2024. We anchor and de-bias toward the market, so in those seasons we inherit its home
   lean — which is a plausible source of the residual bias §13f left open, and it is the market's,
   not ours.

Our card's 3.2 sits just below both 2025 benchmarks. **No change made:** it is correctly fitted and,
if anything, mildly conservative.

**CARD_SCALE swept at the same time and it is FLAT.** Walk-forward, HFA outside, choose 2021-23 /
confirm 2024-25:

| scale | 1.00 | 1.10 | 1.20 | 1.25 | **1.33** | 1.40 |
|---|---|---|---|---|---|---|
| choose MAE | 12.79 | 12.76 | 12.76 | 12.77 | **12.78** | 12.81 |
| confirm MAE | 12.52 | 12.48 | 12.46 | 12.46 | **12.47** | 12.47 |

A 0.02 spread across the whole range is noise; the nominal optimum (~1.20) is indistinguishable from
the shipped 1.33. Bias falls monotonically as the scale rises, which is the trap §13d already named
— do not pick a knob on bias when MAE is flat. **Nothing changed.**

So the residual home bias is not HFA and not the scale. The live suspect is the de-bias pass itself,
which centres on the MARKET rather than on results, and therefore imports whatever home lean the
market is carrying.


### §13h. The de-bias was centred on the wrong axis — SHIPPED 2026-10-02

The big-spread de-bias exists, by its own comment, so the board's divergences "straddle the market
(~50% cover), not a systematic dog-lean". It had never been measured against that promise. It was
delivering **18–24%**, every season, on games where favourites actually cover **44–53%**. The board
was calling the dog on four of every five big games.

**The axis was wrong, not the size.** The residual was taken as (our HOME margin − the market's) and
subtracted from the home margin — which shrinks a home favourite and *grows* an away one. One
constant pushes the two groups in opposite directions on "does the favourite cover", so no value of
it can centre both. Measured on 2024–25 anchored games:

| anchored | n | median \|ours\|−\|market\| | we said fav covers |
|---|---|---|---|
| home favourite | 104 | −0.30 | 30.8% |
| away favourite | 33 | **−4.43** | **6.1%** |

The home group was roughly centred all along; the away group was 4.4 points adrift and essentially
never called a favourite.

**Fix: centre in FAVOURITE space.** Residual is `|ours| − |market|`, and the correction is applied to
the favourite's margin with the picked side preserved, so it means the same thing whichever team is
favoured. Walk-forward 2021–2025:

| season | home-space (was) | favourite-space (now) | ACTUAL | MAE was / now |
|---|---|---|---|---|
| 2021 | 18.3% | **47.3%** | 52.7% | 13.16 / 13.17 |
| 2022 | 19.7% | **45.9%** | 50.8% | 12.43 / 12.50 |
| 2023 | 20.3% | **46.4%** | 49.3% | 13.25 / 13.21 |
| 2024 | 23.9% | **46.5%** | 43.7% | 12.50 / 12.46 |
| 2025 | 19.7% | **45.5%** | 48.5% | 12.48 / 12.49 |

Closer to the realised cover rate in **5 of 5 seasons**, and MAE is a tie (12.78/12.79 choose,
12.47/12.45 confirm) — the calibration is bought for nothing. Live week-5 board: 45.8% against the
~20–25% it was publishing this morning.

**Two variants tested and rejected.** Centring on past RESULTS instead of the market (`--debias
results`) reaches the cover rate too but costs MAE in the choose era (12.87 vs 12.78) and needs a
number that does not exist at publish time. Separate constants per side (`favside`) is marginally
better on MAE and marginally worse on the objective, for twice the parameters — the single median
wins on both simplicity and the thing being fixed.

**Still not an edge claim.** ATS is unchanged (~50%). This makes a published number mean what it says
it means; it does not make it beat the market.


### §13i. Receptions got its own bands — fitted, backtested, NOT shipped (2026-10-09)

§13a left receptions unconverted because the yardage bands (0/18/28/45/62/80) put its whole 0.5-8.5
range in band 0, so the fit could only return a flat ratio — "a uniform shrink, which does not
correct a tilt, it just moves the level". The week-6 board showed the tilt plainly: median proj/line
1.567 at a 0.5-2.5 line and 0.965 at 4.5-8.5, 88% over down to 36%. So receptions was given its own
bands and refit.

`cfb_median_fit.py` now takes per-market bands (`BANDS_BY_MARKET`) and emits them alongside the
ratios, because ratios fitted on one band structure and looked up against another is the silent
mis-application of §13. Receptions on [0, 2, 3, 4, 5, 7], 358 joined pairs:

| band | 0-2 | 2-3 | 3-4 | 4-5 | 5-7 | 7+ |
|---|---|---|---|---|---|---|
| ratio | 0.852 | 0.852 | 0.876 | 0.876 | 0.905 | 0.905 |

**THE DECISIVE MEASUREMENT IS THAT THE REAL TILT IS ZERO.** Scored against what players actually
caught, the over-rate does not vary with the line at all — 48.2% on the low half of lines against
48.6% on the high half (weeks 2-3), 58.6% against 56.9% (week 5). The book prices receptions fairly
across its whole range, so every point of our tilt is ours.

Our error against that benchmark, by line half:

| | low half | high half |
|---|---|---|
| **off** (ships) wk2-3 | +41.8 | +9.0 |
| **on** wk2-3 | +26.4 | **−24.3** |
| **off** (ships) wk5 | +29.3 | −19.0 |
| **on** wk5 | **+3.4** | **−36.2** |

The curve fixes the low end and breaks the high end. Pre-registered bar was: the tilt narrows in
BOTH eras, no overshoot, lean and MAE not degraded. The tilt **widened** on the choose weeks
(32.3 → 50.2pts) and the high half overshoots to −24.3 / −36.2. Lean and MAE are a wash
(52.8→57.8% and 1.74→1.68 choose; 60.6→59.1% and 1.45→1.47 confirm). **Not shipped.**

**Why the bands did not help, which is the finding worth keeping.** They were supposed to stop the
fit coming back flat — and it came back nearly flat anyway: 0.852 to 0.905 is a 5.3% spread against
an error running from +41.8 to +9.0. That is not a failure of the band structure; it says
**med/mean genuinely does not vary with receptions level**, so the mean→median conversion is not
where this error lives. A near-uniform shrink can only slide the curve down, which is exactly what
it did.

So the receptions error is in `mu` — our projected mean is too high for low-usage receivers and
about right for high-usage ones — and that is the same conclusion §13 reached for the yardage
markets. Conversion cannot repair a mean. The next candidate is the volume estimate at the bottom of
the depth chart, where the project's own standing finding already says we are weakest ("deep
reserves are ~70% proportional error").

The machinery is kept and inert: `PUBLISH_BANDS_BY_MARKET` is correct and needed the moment any
market's fit comes back non-flat, and `CFB_RECEPTIONS` defaults off so the published board is
byte-identical. Re-run rather than re-reason.


## §14. NHL — what the market looks like, measured before anything was built (2026-10-09)

Derek: "I want to get a NHL Hockey section in for the next sport." Everything below was measured
off the live feeds before a line of model code existed, because what is buildable is decided by
what the data supports.

### 14a. The goal-margin distribution, and hockey's key number

All 1,312 completed 2025-26 regular-season games (NHL public API, club-schedule-season across 32
clubs, deduped by game id):

| | |
|---|---|
| home margin | mean **+0.130**, SD **2.569** |
| home win rate | 52.2% |
| ties | **0** — hockey has none |

| \|margin\| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| share | **43.2%** | 17.5% | **23.1%** | 10.7% | 4.0% |

**One goal is hockey's key number and it dwarfs football's.** NFL margins land on exactly 3 in 15.0%
of games; NHL games land on exactly 1 in **43.2%**. Two things cause it and both are structural:
there are no ties, and 24.8% of games (OT 207 + SO 119) are decided past regulation where the
winning margin can ONLY be one. That floor is in the rules and will be there every season.

**Three goals is more common than two** (23.1% vs 17.5%), which is the empty net: a team protecting
a two-goal lead pulls its goalie, so late goals convert two into three rather than the reverse.

### 14b. The puck line is not a spread

On a live sweep (18 games × 19 books) the `spreads` market returned **1.5 on 284 of 284 rows**, no
exceptions. It is a second moneyline with a goal and a half attached, sitting directly on top of the
43.2% spike, so it is decided almost entirely by whether the game is a one-goal game. Comparing it
to a projected margin is the mistake the MLB board made with the run line (§12d). `nhl_capture.py`
prints a warning if a value other than ±1.5 ever appears.

Totals came in threes: **5.5, 6.0, 6.5**. Note the 6.0 — a whole number, so an NHL total CAN push
and grading needs W-L-Push. Moneylines ran −285 to +230, far tighter than football.

### 14c. What line shopping is worth — the Value Finder's honest pitch

Measured on one sweep, 144 legs, median 14 books quoting each:

| market | legs | median gain | p90 | max |
|---|---|---|---|---|
| moneyline | 36 | 0.92% | 1.53% | 2.14% |
| puck line | 38 | **1.32%** | 2.47% | 3.19% |
| total | 50 | 0.97% | 1.68% | 2.83% |

(implied-probability points saved by taking the best book instead of the median one)

Against a median two-way vig of **4.62%**, shopping recovers roughly **a quarter of the house edge**
on essentially every bet, with no model and no opinion about the game.

**And the contrast that sets the copy.** Quotes that BEAT the de-vigged consensus — a genuinely
mispriced number — turned up on **7 of 1,048 book quotes (1%)**, worth a median 0.30% and a maximum
0.66%, clustered in reduced-juice books (lowvig, betonlineag). So the NHL Value Finder's honest
pitch is **shopping, not mispricing**: the routine 1% is real and repeatable, the 0.30% outlier is
neither. The page says exactly that.

### 14d. The TOTAL is 68% odd — and a Poisson misprices the push by 5 points (2026-10-10)

`nhl_results.py` (NHL public API, free) + `nhl_totals_study.py`. **6,560 completed regular-season
games, 2021-22 through 2025-26** — five full 82-game seasons, so five times §14a's sample.

§14a measured the *margin* and found hockey's key number. This is the same structural force acting
on the **total**, which is what the 5.5/6.0/6.5 market actually prices.

| | |
|---|---|
| mean total | **6.242** goals |
| odd totals | **68.2%** (4,476) |
| even totals | **31.8%** (2,084) |
| ended OT / SO | 15.0% / 7.2% — **22.2%** past regulation |

**Mechanism, stated before measuring.** A tie at 60 minutes is not a regulation game, so every even
"tie" composition (2-2, 3-3, …) is removed from regulation and returns as OT/SO having added
**exactly one** goal — even plus one is odd. Even totals are therefore suppressed twice. The
measurement matches the mechanism: OT and SO are 100% odd by construction, and regulation alone is
already **59.1%** odd because the ties have been taken out of it.

**Stable in every season** — 67.8%, 69.0%, 68.3%, 65.2%, 70.8%. Not a sampling artefact.

⚠️ **The season got longer in 2026-27.** `nhl_results` holds 1,344 scheduled games for season 2026 against 1,312 for each of the five before it — still 32 teams, but **84 games each, not 82** (verified from the table: every club has 84). Nothing in the code assumes 1,312, but the "five full 82-game seasons" framing above describes 2021-25 only, and any future per-season rate or sample claim has to use 84. Two extra games a club is also two more chances at an OT/SO goal, so the odd/even split should be re-measured once 2026-27 is complete rather than assumed to carry over.

**What it costs to ignore.** A fitted Poisson (λ = 6.242) against the empirical distribution:

| total | actual | Poisson | error |
|---|---|---|---|
| 5 | **22.1%** | 15.4% | +6.7% |
| 6 | **11.0%** | 16.0% | **−5.0%** |
| 7 | **20.5%** | 14.3% | +6.3% |

So a smooth fair price **overstates the push on a 6.0 total by 5.0 points** (16.0% → 11.0% actual)
and understates 5.0 and 7.0 by ~6.5 each. §14b already flagged that 6.0 can push and needs
W-L-Push grading; this is the size of the error if that push is priced off a smooth curve.

**This is the NHL analogue of the NFL key-number rule in CLAUDE.md** ("never use a Gaussian where
key numbers matter"). It is a constraint on how we may compute a fair price, **not an edge**. Any
NHL fair price must come from the empirical distribution, or from a model that treats the OT/SO goal
separately from goals scored in play. `nhl_results.last_period_type` is kept on every row so both
views stay available.

**And the push is the CENTRAL case, not a corner case** — corrected 2026-10-12. This section first
claimed books post 5.5/6.5 more often than 6.0 "because they know". That was an assumption and it
is **wrong**. Measured on the backfilled 2024-25 season (§14e, n=1,240 games with a near-closing
total): **6.0 is the single most-posted line**, and whole numbers are 41.5% of the board.

| posted total | games |
|---|---|
| **6.0** | **510** |
| 5.5 | 407 |
| 6.5 | 318 |
| 7.0 / 5.0 | 3 / 2 |

So the pushable number is the modal number, and 2 games in 5 can push. Conditional on the market
setting a whole number, the realised push rate is **12.8%** (n=515) — a touch above the 11.0%
unconditional rate, as expected, since those are the games the market judged to land near 6. A
fitted Poisson would still say ~16%, so it overstates the push by **~3.2 points on the population
where it actually matters**. Getting this right is not an edge, but getting it wrong misprices the
most common NHL total there is.

### 14e. The NHL closing total is efficient — the bar, measured (2026-10-12)

`nhl_backfill_odds.py --season 2024 --write` then `nhl_totals_validation.py --season 2024`.
**1,240 games with a near-closing consensus total** — 94.5% of the 1,312 completed 2024-25 regular
season games. 780 snapshots, 76,758 rows, 23,400 Odds API credits. Discovery cost **zero** credits
(the schedule came from the NHL's own free feed, not the odds API).

This exists because Derek asked for an NHL totals model built on goaltending/GSAx, xG, pace and
special teams. Those are mechanisms, not measurements, and the standing rule is that nothing enters
The Model unless it beats the closing line out of sample. Before building anything, measure what it
would have to beat.

**Data integrity, reported rather than assumed:**

| | |
|---|---|
| priced games joined to a result | 93.8% (1,240 / 1,322) |
| season coverage | 94.5% (1,240 / 1,312) |
| snapshot lead before puck drop | median **9 min** (p90 19, max 24) |
| in-progress events rejected | 2,065 |

The lead time is why this is called **near-closing**, not the close: the archive's snapshot cadence
sets the floor, not our request. The 2,065 rejections are the filter earning its keep — the
historical endpoint returns games already under way, and an in-progress price recorded as a closing
line would have corrupted every number below. (2 of 780 snapshots lost their write to transient
connection resets; the writer is idempotent, so a re-run would recover them.)

**The bar:**

| | |
|---|---|
| mean two-way hold | **4.45%** (median 4.48%) |
| break-even win rate | **52.23%** of decided bets |

That **independently corroborates §14c's 4.62%**, which came from a single live sweep by a different
code path. Two measurements, two methods, same number — the bar is solid.

**The result — nothing to take.** (Single season only; **§14f extends this to four seasons and is
the number to quote** — the −0.69% below turns out to sit inside a 4.9-point band, and the winning
side flips between seasons.)

| | |
|---|---|
| over / under / push | 45.9% / 48.8% / 5.3% |
| of decided bets | over 48.5% / under 51.5% (n=1,174) |
| best side (under) vs break-even | **−0.69%** |

The under wins 51.5% and needs 52.23%. **It misses the vig bar**, exactly as the NFL work predicted
it would (§4: ~50 hypotheses, essentially none beat the vig; even the wind survivor failed by 0.18
points). Calibration says the same thing: the market implied 50.2% over and 48.5% came in, a −1.8%
tilt that is *smaller than the hold it would have to pay*.

**So: no systematic side on the NHL total at the close.** This is a negative result and it is the
useful kind — it says a goaltending/xG/pace model is not competing against a sloppy number, and it
sets 52.23% as the out-of-sample hurdle any such candidate must clear. The place left to look is
the one thing on Derek's list with a *timing* mechanism rather than a priced-variable mechanism —
goalie confirmation, which lands the morning of the game — and that is Value Finder arithmetic on a
stale price, not a model. Consistent with §14c: the NHL module's honest pitch is shopping.

### 14f. ...and it does not hold — the "best side" flips between seasons (2026-10-12)

Derek: "backfill 2021-2023 and see if it holds." It does not. Backfilled three more seasons
(2,310 snapshots, 379,994 rows, 69,300 credits, zero write failures) and re-ran §14e per season.
**5,061 games with a near-closing consensus total; 4,812 decided bets.**

| season | games | coverage | hold | break-even | under | best side | vs break-even |
|---|---|---|---|---|---|---|---|
| 2021-22 | 1,267 | 96.6% | 4.51% | 52.26% | 46.7% | **over 53.3%** | **+1.09%** |
| 2022-23 | 1,270 | 96.8% | 4.55% | 52.27% | 49.8% | over 50.2% | −2.02% |
| 2023-24 | 1,284 | 97.9% | 4.51% | 52.25% | 50.6% | under 50.6% | −1.64% |
| 2024-25 | 1,240 | 94.5% | 4.45% | 52.23% | 51.5% | under 51.5% | −0.69% |
| **POOLED** | **5,061** | | **4.50%** | **52.25%** | 49.6% | over 50.37% | **−1.88%** |

**The side that "won" flips from over to under halfway through the sample.** The under-rate swings
46.7% → 51.5%, a 4.9-point band, and §14e's −0.69% sits comfortably inside it. Pooled across 4,812
decided bets the best available side misses break-even by **1.88%** — close to the full hold, which
is what an efficient market looks like.

**And 2021-22 on its own would have looked like an edge: the over cleared break-even by +1.09%.**
Stopping there would have produced a publishable "NHL overs beat the market" claim that the very
next season contradicts. That is the Week 1 power-rating trap from CLAUDE.md repeating in a second
sport — the reason the standing rule demands out-of-sample confirmation before anything ships.

**What IS stable is the hold:** 4.45%–4.55% across four seasons, and §14c measured 4.62% by a
different code path on a live sweep. The bar is 52.25% and it is solid. Coverage held at 94.5%–97.9%
with no season degrading.

**Conclusion: the NHL closing total is efficient, confirmed out of sample.** No side, no season, no
direction. A goaltending/xG/pace model must clear 52.25% out of sample, and the measured room
between the closing total and the truth is 1.88% the wrong way. The remaining candidate on Derek's
list is the one with a *timing* mechanism rather than a priced-variable one — goalie confirmation,
which lands the morning of the game — and that is Value Finder arithmetic on a stale price, not a
model. §14c's verdict stands: the NHL module's honest pitch is shopping.

### 14g. Goalie confirmation — NO timing edge; the apparent one is price extremity (2026-10-12)

Derek: "build the goalie confirmation value finder." **The premise fails, so it was not built.**

§14f settled that the closing total is efficient, leaving one item on the NHL factor list whose
mechanism is *timing* rather than a priced variable: NHL starters are confirmed on the morning of
the game, so a book slow to reprice a backup start would be offering a stale number — Value Finder
arithmetic, not a model. Tested with `nhl_goalies.py` + `nhl_goalie_value.py`.

**Data.** 1,312 games (2024-25), starting goalies from the NHL's own boxscore `starter` flag (free).
Odds backfilled at **three** lead times — T−24h, T−4h, near-close — 192,772 book-level rows,
~31k credits. Four-book minimum for a consensus.

**The label has no hindsight, and the first attempt at it was wrong.** A binary "backup started"
at a <50%-of-starts threshold fired on **60.7%** of games, because NHL teams split starts ~60/40 and
a 1B starting 30% of the time is routine, not news (New Jersey's Jake Allen was flagged as a
surprise in every one of his starts). Replaced with a dose-response on the *more surprising* of the
two starters, using only that goalie's share of the team's starts **before** the game, requiring 10
prior team games first: 31.1% / 29.9% / 22.8% / 16.2% across #1-both / routine-1B / deep-backup /
rare-start. Rare-start examples are genuine (Commesso 0% of Chicago's prior starts, Wedgewood 4%).

**Result: flat, and tightest exactly where the hypothesis says it should be loosest.** Share of book
quotes beating the de-vigged consensus:

| band | totals | h2h |
|---|---|---|
| pre-confirm (~24h) | 0.3% | 0.9% |
| post-confirm (~4h) | **0.2%** | **0.5%** |
| close (<40m) | 0.5% | 0.8% |

The post-confirmation window is the *least* disperse of the three. Books reprice together. On
totals the dose-response down the surprise buckets is non-monotonic noise (0.1% / 0.3% / 0.1% /
0.2%).

**h2h did show a gradient — 0.4% → 0.9% from #1-both to rare-start — and it is a confound.** Two
independent reasons:

1. **It is strongest 24h out** (0.7% → 1.5%), *before the starter is known*. The information does
   not exist yet, so it cannot be causing the dispersion.
2. **Consensus-beating quotes track how lopsided the price is, not goalies:** 0.5% near an even
   price rising monotonically to **2.7%** at 25%+ from even — a 5× gradient. And rare-start games
   are more lopsided games (mean 11.4% from even vs 9.4% for #1-vs-#1). The goalie gradient is the
   extremity gradient wearing a costume.

**Conclusion: no goalie-confirmation timing edge. Do not build the panel.** Median edge never
exceeded ~0.55% in any window and typically sat at 0.2%, i.e. no better than §14c's 0.30% at the
close. Three NHL negatives now agree: the total is efficient (§14f), the market is calibrated
(§14e), and news timing does not strand value (here). §14c's verdict stands unchanged — the NHL
module's honest pitch is **shopping**, and it should stay Value-Finder-only with no model.

**⚠️ One lead, and a reason to distrust it.** The extremity gradient (0.5% → 2.7%) would be a real
shopping filter if it survives, but **proportional de-vig is known to be biased on lopsided
two-way markets** (favourite–longshot bias), which is the exact regime where the gradient appears.
So the 2.7% may be measuring our own de-vig error rather than a mispriced book. Testing it means
re-running with a Shin or power de-vig and seeing whether the gradient holds. Until then it is a
lead, **not a finding**, and nothing should be shipped on it.

### 14h. The extremity gradient was our own de-vig error (2026-10-12)

`nhl_devig_extremity.py --season 2024 --market h2h`. Same data, same join, same four-book
consensus and same both-sides edge test as §14g — **only the de-vig changes**.

§14g logged a lead: consensus-beating NHL moneyline quotes rose monotonically with how lopsided the
price was, 0.5% near even to 2.7% at 25%+ from even. At face value that is a free shopping filter.
It was flagged as suspect because proportional de-vig is biased in precisely that regime. It was.

| consensus from even | quotes | proportional | **Shin** | difference |
|---|---|---|---|---|
| 0-5% | 16,764 | 0.5% | 0.4% | −0.0% |
| 5-10% | 21,320 | 0.4% | 0.2% | −0.1% |
| 10-15% | 14,368 | 0.6% | 0.3% | −0.3% |
| 15-20% | 9,164 | 1.1% | 0.2% | −0.9% |
| 20-25% | 4,394 | 1.9% | 0.1% | −1.8% |
| 25%+ | 1,574 | **2.7%** | **0.1%** | **−2.6%** |

| | near-even | lopsided (20%+) | ratio |
|---|---|---|---|
| proportional | 0.47% | 2.13% | **4.5x** |
| Shin | 0.44% | 0.11% | **0.3x** |

**The gradient does not merely vanish, it reverses** — under a bias-aware de-vig a lopsided game
has *fewer* consensus-beating quotes, not more. And the size of the correction tracks lopsidedness
exactly (−0.0% → −2.6%), which is the signature of a method artifact rather than a market effect.
**There is no shopping filter here. Nothing ships.**

Shin (1993), inverse per Štrumbelj (2014): p_i = [√(z² + 4(1−z)·r_i²/S) − z] / (2(1−z)), with z
bisected so Σp = 1. `--selftest` checks it against known properties: balanced books come out 50/50,
fair probabilities sum to 1, the favourite sits above its proportional share, and the correction
grows with lopsidedness (+0.0000, +0.0053, +0.0131, +0.0158 at −110/−110 → −1000/+650).

**§14e and §14f are unaffected, verified not assumed.** Run on totals, the two methods agree to
rounding (0.3% vs 0.3%; 0.5% vs 0.5%) because NHL totals sit within 10% of an even price — 56,202
of 56,934 quotes are inside 5%. And §14f's headline never used a de-vig at all: the over/under
hit rate compares the realised total to the line, and the hold is raw overround.

**The app was already right; the analysis was not.** `web/lib/fairValue.ts` deVig() has used the
POWER method since the MLB hits board read above the book on 77% of rows, and its comment states
the rule: *the grader and the board must use the same method.* But `weekly_report.py` was still
de-vigging the **moneyline** proportionally — the lopsided regime — making the market's fair
favourite probability 1.3 points low at −400/+300 and 1.6 at −1000/+650. Fixed to the power method
and verified identical to `mlb_player_props._power_devig` across five markets.

**The lesson is the one CLAUDE.md's error log keeps recording.** A plausible mechanism (the
favourite–longshot bias is real, books do load vig onto longshots) plus a monotone 5x gradient
across 1,574–16,764 quotes still produced a signal that was entirely an artifact of our own
arithmetic. The gradient was *more* convincing than the thing it was measuring. It only fell
because the method was distrusted in the regime where it is known to be weak.
---

### §13k. Receptions and pass TDs: the mean→median conversion is the WRONG INSTRUMENT — NOT shipped (2026-10-12)

Derek, on the live board: *"a lot more unders than overs for receiving yards, passing yards, rushing
yards."* That turned out to be a separate regression (§13l), but it surfaced the two markets leaning
the other way and never corrected: **receptions 62.9% over, pass_tds 57.1% over**.

`to_fifty_fifty`'s docstring and `cfb_median_fit`'s both said the honest fit needs *median(actual) as
a function of OUR mean*, blocked on `mu` not being stored per row. `mu` is stored now, so
`analysis/cfb_mu_median_fit.py` does that fit: it bands on **mu** (the scale the lookup actually
uses, closing the §13 "fitted on one scale, applied on another" error), trains on early weeks and
scores on later ones it never saw.

**The harness is validated, because it re-derives a known-good answer.** On rec_yds — already
converted and shipped — it independently takes the held-out board from **69.8% over to 49.0%**. So
the method works where the market suits it.

**It does not suit these two.** The decisive table, 6 weeks of backtested `mu` joined to CFBD
actuals and the posted line:

| market | n | actual > line | our mu > line | med actual | med line | med mu |
|---|---|---|---|---|---|---|
| receptions | 301 | 53.5% | **70.1%** | 3.00 | 2.50 | 3.50 |
| pass_tds | 191 | 49.7% | 55.5% | 1.00 | 1.50 | 1.50 |
| rec_yds | 357 | 52.9% | 75.1% | 40.00 | 39.50 | 48.40 |
| rush_yds | 239 | 43.1% | 57.7% | 49.00 | 59.50 | 60.40 |

**The book is calibrated on both** — actual beats the line 53.5% and 49.7%, within noise of half
(SE ≈ 2.9 and 3.6 points). So there is no mispricing to harvest, only our own number to align.

Every correction tested overshoots, and by about as much as it was missing by:

| market | fit | held-out over | MAE |
|---|---|---|---|
| receptions | banded on mu | 64.7% → **34.1%** | 1.401 → 1.509 **worse** |
| receptions | flat 0.822 (train 1-4) | 64.7% → **36.5%** | 1.401 → 1.490 **worse** |
| receptions | flat 0.833 (train 1-3) | 67.5% → **35.0%** | 1.457 → 1.480 **worse** |
| pass_tds | flat 0.667 (train 1-4) | 52.1% → **20.8%** | 1.023 → 1.033 **worse** |
| pass_tds | flat 1.333 (train 1-3) | 61.8% → **89.9%** | 0.993 → 1.147 **worse** |

**pass_tds cannot even agree with itself on the DIRECTION**: train on weeks 1-4 and the fitted ratio
is 0.667, train on 1-3 and it is 1.333. A correction whose sign flips with the split is noise, and
n=191 over six weeks is why.

**WHY A MULTIPLICATIVE SHRINK IS THE WRONG INSTRUMENT HERE, which is the transferable part.** These
are small counts priced against half-point lines. Median mu (3.65) sits only ~1.15 above median line
(2.50), so a ratio that moves the median onto the line in aggregate pushes a large share of
individual rows clean past it — the shrink is proportional to mu, and the high-mu rows take the
biggest absolute cut. The medians line up and the row-by-row comparison does not. Yardage markets
are continuous with a wide range and do not have this problem, which is exactly why §13 works there
and dies here.

The raw per-band receptions ratios also refuse to be monotone — **0.556, 0.980, 0.882, 0.889,
0.741** — so the "skew can only shrink as the level rises" constraint that is sound for yardage
forced every band up to 0.98 and erased the correction entirely. That constraint is market-specific
and must not be applied by default.

**Verdict: ship nothing.** Both markets stay unconverted and are on an explicit WARN-only allowlist
in `analysis/ncaaf_guardrail.py` so they stay visible without turning the job red daily. What would
actually move this: a line-aware conversion that publishes P(X > line) from the player's own count
distribution rather than scaling a mean, and several times this sample. Re-run
`cfb_mu_median_fit.py` once the season is deep enough to make the ratio stable across splits.

---


### §15. NHL shots and saves — persistence measured, model built, expectations set (2026-10-13)

**§15a. The hockey version of "volume persists, efficiency doesn't", and it is the strongest this
project has measured.** Split-half within player-season, Spearman-Brown to full length, 239,197
skater games and 13,291 goalie starts:

| | split-half r | full-season r |
|---|---|---|
| skater time on ice | 0.989 | **0.995** |
| **skater shots on goal** | 0.902 | **0.949** |
| skater shots per 60 | 0.829 | 0.907 |
| skater points | 0.846 | 0.917 |
| skater goals | 0.743 | 0.853 |
| skater shooting % | 0.391 | **0.563** |
| **goalie shots against** | 0.675 | **0.806** |
| goalie saves | 0.627 | 0.770 |
| goalie save % | 0.181 | **0.307** |

NFL comparison: carries 0.678, target share 0.623, yards-per-carry 0.058. **Shots on goal at 0.949
is more persistent than any NFL volume metric.** Not an artefact of the games threshold — r runs
0.939 at 10 games to 0.956 at 60.

**§15b. And that is exactly why a shots model adds almost nothing.** Trained on 2021-22/22-23/23-24
/26-27, scored on 2024-25 and 2025-26, prior games only, walking forward:

| target | held-out n | season-mean MAE | model MAE | gain |
|---|---|---|---|---|
| skater shots on goal | 85,707 | 1.0400 | 1.0379 | **+0.20%** |
| goalie shots against | 4,413 | 5.6117 | 5.6140 | **−0.04%** |
| goalie saves (direct) | 4,413 | 5.6038 | 5.6600 | **−1.00%** |

**A player's own season-to-date mean is the projection.** The fitter picked a 35-game half-life —
nearly flat weighting — which is it saying the same thing: at r = 0.949 there is no recency
structure left to exploit. Beating persistence was the bar, and on shots nothing does.

**§15c. The decomposition DOES work for saves, and the optimal shrink is infinite.** Saves
projected as `projected shots against x save%`, varying how hard the save% is pulled to league:

| save% shrink (shots) | held-out MAE |
|---|---|
| 50 | 5.5970 |
| 400 | 5.5866 |
| 2,000 | 5.5768 |
| **league only** | **5.5708** |

Monotone: every step toward the league mean improves it, and the best model **ignores the goalie's
own save percentage entirely**. That beats the direct projection by +1.58% and the season-mean
baseline by +0.59%. It is the cleanest confirmation of the project's oldest rule yet — efficiency at
r = 0.307 is not worth conditioning on, so project the volume and multiply by the league baseline.

**🚨 WHAT THIS IS NOT. Every number above is MAE against the ACTUAL result, not against the book's
line.** Beating a naive baseline is not beating a market, and this project has already measured that
its NFL and NCAAF prop projections do NOT beat the closing line (~50% on 6,457 props). NHL shots
props have been captured since 2026-10-09 and saves since 2026-10-13, so the line comparison cannot
be run for months. Expect it to come back priced; publish this as a line-blind read, never as an
edge claim, until that test exists.

**§15d. Publish a PROBABILITY, not a mean beside a half-point line.** The first cut of the
/nhl/props model panel printed our projected shots next to the book's line. Measured across the
live board that made **58% of 262 players read as overs** (median gap +0.11 shots) — a one-way lean
with no edge behind it, because a mean and a half-point threshold are not the same statistic.

Converting the mean to a median is NOT the fix, and this is §13k confirmed on a far bigger sample.
Median/mean by band across 227,871 skater games: **1.255, 0.810, 1.156, 0.900, 1.106, 0.934, 0.811,
0.914** — a sawtooth, not a curve, because the median of a small count snaps to an integer.

What IS comparable to a price is the probability of going over, so that is what the panel publishes.
Non-parametric, bucketing player-seasons by per-game mean and counting how often a game cleared each
posted line. Monotone in the mean for every line, thousands of games per cell:

| player's mean | games | P(>1.5) | P(>2.5) | P(>3.5) |
|---|---|---|---|---|
| 0.00-1.25 | 78,490 | 0.249 | 0.080 | 0.022 |
| 1.75-2.25 | 41,487 | 0.578 | 0.320 | 0.149 |
| 2.75-3.25 | 13,310 | 0.786 | 0.568 | 0.348 |
| 3.75+ | 3,018 | 0.910 | 0.767 | 0.589 |

**Result on the live board:** our mean P(over) **47.3%** against the market's de-vigged **48.8%**,
and we read higher than the market on **46.2%** of rows — from a 58% one-way lean to balanced, with
a 6.6-point mean absolute gap left as the actual disagreement. This is the same reason the football
boards publish anytime TD as a percentage rather than as a number of touchdowns.

### §15e. The no-prior fallback overstated every rookie's P(over) by 8 points (2026-10-16)

Derek, on the PIT @ COL shots board: *"we have all shots going over for one team and all shots
going under for the other. Is this accurate?"* The team split turned out not to be a defect — but
chasing it found one.

**The split itself is the board working as designed.** The projection is line-blind with no
opponent, pace or home/away term (§15), so it cannot produce a team-level lean on its own. Measured
on that game, the book's lines sat **0.19 below** COL players' own season averages and **0.25
above** PIT's, while our projections sat +0.07 and +0.26 against the same averages. The lean is the
book pricing tonight's game and us deliberately not. Walk-forward over 45,393 player-games, our
mean residual against ACTUAL shots is **+0.034** — the level is right, which is the test that
separates "our bug" from "the market disagrees" and this is the second case.

**And it looks worse than it is, because of which column gets read.** By projection-vs-line the
board read 8 over / 1 under for COL and 2/4 for PIT; by the published CHANCE OVER it reads 6/3 and
1/5, mean 50.9% against 44.8%. Three rows point opposite ways between the two columns. The median
walk-forward residual is **+0.206** against a mean of +0.034 — the usual right-skew signature, and
exactly why the panel publishes a probability.

**THE REAL DEFECT, found while confirming the above.** Leave-one-season-out over **226,854
player-games**, with `pOver` reconstructed the way the board builds it:

| group | n | mean proj | mean actual | P(over 1.5) error |
|---|---|---|---|---|
| has prior / 2-9 games | 21,261 | 1.64 | 1.61 | −2.0pp |
| has prior / 10+ games | 141,864 | 1.72 | 1.69 | −1.6pp |
| **no prior / 2-9 games** | **11,517** | **1.60** | **1.39** | **−8.2pp** |
| no prior / 10+ games | 51,830 | 1.70 | 1.68 | −1.6pp |

A skater with no qualifying prior season was shrunk toward `league_rate`, the mean over EVERY
skater game. But a player with no prior season and a handful of games is, by selection, a rookie or
a call-up, and that population shoots **76-78%** of the league rate for shots and **62-70%** for
goals/assists/points in both recent seasons. The fallback was describing a different population
from the one it served — the same shape as the `member_f315ce11` username default and the
season-leading-passer definition: *a default that cannot fit the case it exists for.*

Fixed with a **frozen RATIO applied to the live league rate**. All three candidates were tried and
the first two fail: a live sample of this season's no-prior games is empty exactly when it matters
(in October it fell back to league on 4 of 4 markets), and a frozen RATE goes stale because the
league drifts (shots 1.74 → 1.55 over four seasons). The ratio is stable where the level is not.
Board-wide overstatement **2.0 → 1.0** points at the 1.5 line, 1.4 → 0.6 at 2.5, 0.7 → 0.2 at 3.5.
Clean A/B on identical data: 204 of 2,560 rows move, all downward, and zero of them have a prior
baseline.

**🚨 TWO WRONG DIAGNOSES FIRST, BOTH FROM NOT RECONSTRUCTING THE BOARD'S OWN ARITHMETIC.** This is
the validator rule in CLAUDE.md's skill file, earned twice more:

1. The open-ended top band (3.75+) measured **7.3 points** overstated and a fix was approved on
   that basis. It was my method: I compared a flat band rate to a flat realized rate, while
   `pOver` **interpolates between band means and clamps at the ends**. Splitting the band would
   have fixed nothing.
2. The table assigns a player to a band by his season mean and then counts overs on **those same
   games** — selection on the outcome. Real, but leave-one-game-out recovers only **0.2-0.3** of
   the 2.0 points, so it is not the cause either.

Only localising the error — monotone in SAMPLE DEPTH (−5.4pp at 2-5 games falling to −1.1pp at
40+), not in band — pointed at the fallback. **Localise before fixing; a plausible mechanism that
explains the right-shaped number can still be the wrong one.**

### §16. NHL game model — published, and worth about 2% (2026-10-14)

Derek asked for a game board covering spreads and over/unders "just like the other sections". Built,
backtested, shipped at `/nhl/model`. Team goals-for and goals-against rates, shrunk toward the league
mean, combined into an expected score with a fitted home ice of **+0.21 goals**.

**Held out on 2,504 games across two seasons the model never saw:**

| | model | no-information baseline | gain |
|---|---|---|---|
| margin MAE | 1.7405 | 1.7768 | **+2.04%** |
| total MAE | 1.8622 | 1.8635 | **+0.07%** |
| winner called right | 54.0% | — | |
| Brier | 0.2465 | 0.2500 | |

**The margin carries a little. THE TOTAL CARRIES NOTHING** — +0.07% over "always say the league
average" is not a signal, and it does not become one at any shrink setting tested (the sweep ran
−0.20% to +0.07%). It is published because a line-blind number graded in public is what the Model
section is for, not because it finds a price error. Nothing here has been scored against the
closing line, and the starting goalie — the input anyone would reach for first — is already
priced (§18d).

**§16a. Carrying last season forward HURTS, and a default-argument bug nearly hid it.** Fitted:

| prior-season weight | margin vs base | total vs base |
|---|---|---|
| **0** | **+2.04%** | **+0.07%** |
| 5 | +1.66% | −0.06% |
| 20 | +1.51% | −0.16% |
| 200 | +1.45% | −0.20% |

Monotone: every game of last season blended in makes both numbers worse. In a league this
high-variance last year's ratings are stale information.

🚨 The first sweep returned **byte-identical results at every prior weight**, which is what exposed
the bug: `def blend_prior(..., weight=PRIOR_W)` evaluates its default once, at definition time, so
reassigning the module global never reached it. A parameter that cannot move is indistinguishable
from a parameter that does not matter — if a sweep comes back flat, check that the knob is wired
before concluding the knob is useless.

**What the sweep does NOT test:** the backtest skips each season's first 60 games, so the
early-season case, where a team has three games and a prior would matter most, is untested. The
shrink toward the league mean (K=6) carries that load instead — at six games a rating is half its
own and half the league's.

**No puck-line call, ever.** It is ±1.5 on every game and 43.2% of games finish inside one goal, so
a margin against that number is not a comparison — the same trap the MLB run line set (§12d). The
margin converts to a win probability instead, and the market column shows the moneyline expressed
in goals.

**§16b. 🚨 RECONSTRUCTING A HOCKEY SCORE FROM GOALIES UNDERCOUNTS BY 0.44 GOALS A GAME.** The first
cut of this model derived each game's score by summing `goals_against` across a team's goalies. An
empty-net goal is charged to no goalie, and a shootout decider is not charged either, so both are
missing. Measured across 6,646 games:

    official mean total      6.241
    GA-reconstructed         5.804      gap +0.437
    shootout games           480 (7.2%) — so the bulk of it is empty netters

Against a market averaging **6.095**, a model carrying that 0.437 would have read UNDER on very
nearly every game — the one-way lean this project has already been bitten by twice. It was caught
only by checking our totals against the market's BEFORE shipping the column, which is now the
standing check for any new board.

Switching to the official boxscore score fixed the level AND improved the model: the league rate
moved 2.879 → **3.069** goals a game (a 6.14 total baseline, against the market's 6.095), and on the
same held-out 2,504 games the **winner called right rose 54.0% → 56.6%** with Brier 0.2465 → 0.2440.
Margin and total gains over baseline were unchanged at +2.03% and +0.08%, so the error had been
sitting almost entirely in the level rather than in the ranking.

**The board matches the football layout** — Game · Market Spread · Market O/U · Model Spread · Model
O/U — with one hockey-specific note printed under it: **Market Spread is the moneyline expressed in
goals**, because the puck line is ±1.5 on every game and a column of that would carry no
information. Same resolution the MLB board reached for the run line (§12d).

---

### §17. Scheduled captures were delivering a third of their runs (2026-10-14)

Noticed while checking why `player_total_saves` had landed in only one sweep: `capture-nhl-props`
declares every 3 hours and the sweeps were ~8 hours apart. Measured across the repo's scheduled
workflows, actual runs against declared:

| workflow | declared | expected/day | actual/day | delivered | median delay |
|---|---|---|---|---|---|
| capture-nhl-odds | `*/30` | 48 | 4.7 | **10%** | 26 min |
| capture-props (NFL) | `0 */2` | 12 | 4.1 | 34% | 58 min |
| capture-cfb-props | `0 */2` | 12 | 4.4 | 36% | 60 min |
| capture-nhl-props | `0 */3` | 8 | 3.5 | 43% | 61 min |
| capture-odds | `0 */3` | 8 | 6.0 | 75% | 84 min |

**Two separate causes, and neither is a bug in our code.**

**1. The top of the hour is GitHub's peak.** Scheduled workflows run on a best-effort queue that is
delayed during high load, and every hour's :00 is the heaviest moment on the platform — our
on-the-hour jobs arrived a median 58-84 minutes late. **2. High-frequency crons are dropped
hardest**: `*/30` delivered one run in ten, because `*/30` is `0,30` and both are peak minutes.

**And we were adding to it ourselves.** Three workflows fired at exactly 14:00 and two more at
15:00, so our own jobs queued behind each other on top of the platform's load.

**Fix: every schedule in the repo now sits on a distinct off-peak minute.** 29 cron lines changed,
minute field only — hours, months and weekdays untouched. `*/30` became `11,41` and `14,44`; `*/15`
became `7,22,37,52`; the rest moved to their own minute between :07 and :58. Frequency is unchanged
everywhere, so nothing is being given up — this only moves *when* within the hour.

🚨 **THIS IS A MITIGATION, NOT A GUARANTEE.** GitHub's scheduler is explicitly best-effort and will
still drop runs. Re-measure in a week with the same method before believing it worked; if delivery
is still poor on the perishable captures (props especially, which cannot be backfilled), the next
step is an external trigger — a scheduler calling the workflow-dispatch API — rather than more cron
tuning.

The one-line rule for anyone adding a workflow: **never schedule on minute :00**, and pick a minute
no other workflow in the repo is using.

### 17a. The re-measurement, 12 days on: the minute fix did not work, and the reason is a REPO-WIDE CAP

Measured 2026-10-26, same method, every scheduled workflow in the repo. §17 asked for exactly this
before believing the off-peak-minute change had worked. **It had not.**

| declared/day | workflows | delivered |
|---|---|---|
| 48 | capture-nhl-odds `14,44`, capture-cfb-odds `11,41` | **11–12%** |
| 12–17 | capture-props, capture-cfb-props, capture-odds | 36–40% |
| 6–8 | capture-nhl-props, capture-sleeper | 51–60% |
| 3–4 | weather, capture-mlb, refresh-cfb-ratings | 87–97% |
| 1–2 | the daily jobs | ~100% |

`capture-nhl-odds` went from 10% to 12% — inside the noise. Moving off minute :00 did not buy back
the dropped runs, so **peak-minute contention was not the binding constraint.**

**WHAT THE BINDING CONSTRAINT ACTUALLY IS.** Count every scheduled run the repo delivers per day:

    2026-10-15 … 2026-10-25:  65, 67, 74, 70, 59, 66, 64, 63, 66, 68, 68
    mean 66.4/day, min 59, max 74, across a steady 24 distinct workflows

The repo *declares* roughly 180 scheduled runs a day and *receives* about 66, and that ceiling holds
to within ±11% across eleven consecutive days while the declared total was unchanged. **Scheduled
runs are a fixed, scarce, shared budget — not a per-workflow setting.** The delivery column above is
not a throttle applied to each workflow independently; it is each workflow's share of one pool.

🚨 **THE PRACTICAL CONSEQUENCE: DECLARING MORE OFTEN DOES NOT GET YOU MORE RUNS.** `capture-odds`
declares 17/day and receives 6.9/day; `capture-nhl-odds` declares 48/day — nearly three times as
many — and receives 5.7/day. Above roughly 8 declared runs a day the return flattens, so a `*/30`
cron is not a cadence, it is a claim on a pool that cannot honour it. Anyone tempted to fix a stale
board by tightening a cron is spending the repo's budget for nothing.

**What this costs the product.** 5.7 delivered runs a day is an effective cadence of about 4.2 h, with
observed gaps of 5–6 h. A board built from the newest sweep can therefore sit up to ~6 h behind the
book on both prices and *which games exist at all*. Measured the same day: the NHL board held 3 games
at the 11:32Z sweep while the books had posted 14; the 17:39Z sweep picked up all 14. Nothing was
broken — 94 of 94 scheduled runs in the workflow's lifetime succeeded, with zero failures — the board
was simply between sweeps. §17b records how that nearly got misreported.

**So the next step is the one §17 already named, and cron tuning is now formally ruled out**: an
external scheduler calling the `workflow_dispatch` API, which is not drawn from this pool. The other
lever is consolidation — five per-sport odds captures each take a share of 66/day to do work one job
could do in one run.

### 17b. A board that is between sweeps looks exactly like a board that dropped games

`slate_audit.py --sport all` reported 11 NHL FAILURES at 15:53Z: every Tuesday-night game priced by
the books and absent from our board. The obvious readings were both wrong — it was not the capture
window (those games tip 1.52 days after the sweep, inside `--within-days 2`) and not a failing job
(every run was green). The books had posted Tuesday's lines after our last delivered sweep, and the
next sweep took the board to 14 of 14 with no change to anything.

The audit is not wrong to fail here: the board really was missing games a member could bet. But the
finding is **"the board is N hours behind the market"**, not "the capture dropped games", and only the
sweep-age line distinguishes them. That `[info]` line in `_snapshot_board` exists for precisely this,
and it is the first thing to read before acting on one of these failures.

**The check that settles it in one query**: list every sweep in the window with the games it held. A
capture that is losing games shows a count that falls and stays down; a board between sweeps shows a
count that rises again on the next sweep as the books post.

---

*Numbering note: §18 continues the NHL goalie work that was drafted as §14a-d in a
parallel session. It was renumbered on merge because §14d-§14h were already taken by the
totals and timing studies below, which were written first.*

### §18. NHL goalie starts — backfilled 1,399 games, and two findings (2026-10-12)

`nhl_goalies.py` backfills who started in goal and how they did, from the NHL public API:
**2025-26 complete (1,312 games) plus 2026-27 to date (87)** — 2,953 goalie rows, 2,624 + 174
starters, exactly **2.00 starters per game** and zero game-sides left ambiguous.

**§18a. THE OFFICIAL FEED HAS NO PROJECTED STARTER.** Checked endpoint by endpoint on a PRE-state
game: `schedule/now` carries no goalie field, and `gamecenter/{id}/landing.matchup` has
`goalieComparison` and `goalieSeasonStats`, both of which list EVERY goalie on both rosters with
season numbers and name no starter — the strings "start", "probable", "confirmed", "expected" and
"projected" appear **zero** times in that payload. The starter is only visible once the game
begins.

This splits the goalie problem in two, and the halves have different deadlines:

| | source | perishable? |
|---|---|---|
| who started, and how it went | NHL API, any time | **no** — backfillable forever |
| who is starting tonight, and when it was announced | not in the official feed | **yes** — needs a third party |

So the "capture it now or lose it" argument applies only to the second half. The historical record
can be rebuilt on demand, which is why this was done as a backfill rather than a daily capture.

**§18b. NEITHER OBVIOUS WAY TO IDENTIFY THE STARTER WORKS.** The boxscore has no `starter` flag.
Measured across all 2,798 game-sides: both goalies played in **155 (5.5%)**, and in those the
goalie with MORE ICE TIME is the wrong one **79 times — 51%, a coin flip**. Boxscore order was
3/6 on a first sample. The reliable answer is the play-by-play's first goalie-in-net for that team,
which is one extra request and only needed for that 5.5%.

This matters more than the small share suggests: an ambiguous side IS the pulled-starter case —
a goalie who was announced, started, and got yanked — which is exactly the population a rest or
workload model is about. A heuristic would have mislabelled 79 of them.

**§18c. BACK-TO-BACKS DO NOT SHOW A FATIGUE PENALTY — the opposite, if anything.**

| rest days | starts | mean save% |
|---|---|---|
| 0 (back-to-back) | 452 | **0.8933** |
| 1 | 1,673 | 0.8857 |
| 2 | 475 | 0.8854 |
| 3 | 99 | 0.8918 |
| 4 | 47 | 0.8700 |

No monotone pattern, and the back-to-back group is the *best* of the large buckets. **Do not put a
rest-fatigue term in an NHL model on intuition.** The obvious confound is selection — a club often
starts its BACKUP on the second night, so "back-to-back" is partly "a different goalie" rather than
"the same goalie, tired" — and the right test therefore conditions on the GOALIE, not on the date.
Noted here so the naive version is not shipped as a feature.

### §18d. The starting goalie is PRICED — it does not beat the NHL close (2026-10-13)

The obvious hockey input, tested at the project's standard bar. **3,241 games**, four backfilled
seasons of closing moneylines joined to who actually started.

**Mechanism stated in advance:** a goalie faces ~30 shots, so a one-point save-percentage gap
between the starters is worth ~0.3 goals against a ~2.6-goal margin SD. Starters are announced in
the morning, hours before the close. So either the market has already moved on it, or a cheap
observable beats the close.

**No look-ahead:** a starter's quality is his save% over games STRICTLY BEFORE this one, shrunk
toward the league mean by 500 shots, and a game is skipped unless both starters have 200+ prior
shots. Using season or career numbers leaks the outcome and is the easiest way to fake an edge here.

**TEST 1 — does the goalie gap explain the market's error?**

    slope  +0.0157 win-prob per save% point    SE 0.0087    t = +1.81

Not significant. A market that fully prices the starter gives zero, and this is within noise of it.

**TEST 2 — bet the better goalie, graded at the closing price.**

| split | n | win% | break-even | edge | ROI | SE | t |
|---|---|---|---|---|---|---|---|
| **all** | **3,241** | 56.6% | 57.1% | **−0.5** | **+0.15%** | 2.60 | **+0.06** |
| 2021-22 | 521 | 59.5% | 56.6% | +2.9 | +15.94% | 13.40 | +1.19 |
| 2022-23 | 782 | 55.9% | 57.3% | −1.4 | −3.66% | 3.25 | −1.13 |
| 2023-24 | 819 | 55.3% | 58.5% | −3.2 | −6.92% | 3.04 | −2.28 |
| 2024-25 | 1,105 | 56.9% | 56.2% | +0.7 | +0.87% | 2.79 | +0.31 |

**+0.15% ROI with a standard error of 2.60 is zero.** The per-season swing from +15.9% to −6.9%,
with every |t| under 2.3, is what noise looks like. Betting the better goalie wins 56.6% of the
time, which sounds like a lot until you notice the prices imply 57.1% — you are paying for the
goalie you are backing.

**🚨 ROI WITHOUT A STANDARD ERROR IS NOT A RESULT.** A unit moneyline bet has a payout SD near 1,
so even 3,000 bets leave an SE around 2.6 points — larger than almost any "edge" anyone quotes. The
first cut of this test printed +1.22% and no error bar, and that number is indistinguishable from
the +0.15% it became when a join bug was fixed.

**WHAT THIS DOES AND DOES NOT SAY.** It says the starter is in the CLOSING line, which is the bar
this project holds everything to. It does NOT test whether the line MOVES on the announcement —
that is a CLV question needing intraday odds, and the backfilled archive holds one snapshot per
event, taken near puck drop. So "can you beat the opener by knowing the goalie first" is still open
and is a different, harder data problem.

**Consequence:** goalie identity is Context for the NHL, not a model feature, and NHL stays
Value-Finder-only. The goalie table keeps its value for the places the closing line is not the
benchmark — shots and saves props, where a goalie's workload is the quantity being priced.

A JOIN BUG WORTH REMEMBERING, because it is the third time this class has bitten in one week: the
odds feed's commence_time is UTC and the NHL's gameDate is local, so a 10pm ET game is *tomorrow*
in UTC. Keying on the UTC date alone matched 1,261 of 3,987 events — it silently discarded most of
the Western conference. With neighbouring dates tried it matches 3,945 of 3,964.

---

### §19. The margin→win% normal was tested and kept (2026-10-14)

§14d established that NHL scoring does not take a smooth distribution — totals are 68% odd and a
Poisson misprices the push on a 6.0 by five points. The obvious corollary was that the game board's
**margin → win probability** conversion, a normal over the measured margin SD, had the same defect.
Tested on the training seasons, scored on 2,504 held-out games:

| conversion | held-out Brier | winner | vs shipped |
|---|---|---|---|
| **normal (shipped)** | **0.24400** | 56.6% | — |
| empirical 9-band win curve | 0.24449 | 55.0% | **−0.35%** |
| normal, width fitted on train (k=1.5) | 0.24396 | 56.6% | **+0.02%** |

**Neither replacement beats it, so neither shipped.** The corollary does not transfer: a normal over
*margins* survives where a Poisson over *totals* does not.

**But the diagnosis was real, and it is a known limitation rather than a clean bill of health.** The
empirical curve is measurably steeper than the normal at both edges:

| expected margin | observed P(home) | normal says |
|---|---|---|
| −0.49 | 0.383 | 0.424 |
| −0.06 | 0.464 | 0.491 |
| +0.32 | 0.581 | 0.550 |
| +0.85 | **0.687** | **0.630** |

At +0.85 that is ~3 SE on n=734 — the normal genuinely understates confidence in the tails. It is
not corrected because **a single width parameter that helps the tails hurts the middle**, where
nearly every NHL game sits, and the honest fit (chosen on train) nets +0.02%. The right fix is a
non-linear recalibration, which is the empirical table, which overfits at this sample size.

Revisit with more seasons. `nhl_game_model.py --backtest` now scores both conversions side by side
on every run, so the assumption is re-tested rather than inherited.

---

### §20. NHL puck line — books disagree on the favourite on 1 game in 5 (2026-10-16)

Measured on `nhl_odds_snapshots`, 4 snapshots / 21 events, all US books:

| | |
|---|---|
| distinct points one book posts for one side | **1 on 21 of 21 events** — no alternate puck lines in this feed |
| events where books disagree on **who is laying** the 1.5 | **4 of 21 (19%)** |
| events with no FanDuel spread | **0 of 21** |

Two consequences, and the second is why this is written down.

**1. The puck line is not a margin, it is a price.** It is ±1.5 on essentially every game (497 rows
at −1.5, 497 at +1.5 and 6 at ±2.5 on a 1,000-row sweep), so the line carries no information and
all of it is in the price beside it: on one night BOS laid 1.5 at **+210** and COL laid it at
**+116** — the same posted number describing very different favourites.

**2. `lineSide(rows,"max")` in `lib/board.ts` cannot build a hockey puck line.** It takes the
LARGEST point posted for each side independently. That is correct for football — books genuinely
post −2.5 and −3 on one game, and taking the most points IS the shopping convention — but hockey's
two sides share magnitude 1.5, so on the 19% where books disagree it returns **+1.5 for both
clubs**: one side's +1.5 from the majority, the other's from whichever book had the game the other
way round. Neither side then has a negative point and the favourite cannot be identified at all.

Observed: ANA/BOS came back as ANA +1.5 (eight books) and BOS +1.5 (betmgm alone), with FanDuel's
actual **BOS −1.5 +210** discarded entirely.

**The reader therefore goes to the raw rows, not to `game.spread`** (`nhlPuckLines()` in
`lib/nhlBoard.ts`). Because every event carries a FanDuel spread and nobody posts an alternate,
FanDuel's own pair is the whole answer: the negative-point row is the favourite, the other row is
the opposing price, and de-vigging the two gives that book's own fair cover chance. The fallback
for an unpriced event is the majority favourite at its best price; it fired on none of the 21.

**Do not "fix" this in `board.ts`.** The football behaviour is deliberate and shared by NFL, NCAAF
and MLB. The defect is hockey-shaped and belongs in the hockey reader.

**The rule this is the third instance of: A MARKET COLUMN SHOWS WHAT THE BOOK POSTS.** §12d caught
it on the MLB run line; it recurred on the NHL model cards, where the column printed the de-vigged
moneyline converted to goals and published rows like "NJD −0.4" that no sportsbook has offered; and
it is still live on `/nhl/lines`, which quotes two dog sides against each other on those same 19%.
The objection that keeps producing it — "a column of ±1.5 says nothing" — is true about the LINE and
false about the MARKET, because the price is the number that varies.

### §21. The NFL model's in-season weighting is already right — no knob is mis-set (2026-10-19)

Derek, six weeks in: *"We need to be better at the spreads, ML, and over/unders… Have we been using
in-season data? We need to adjust our model and get our numbers more accurate."* The honest answer
to the first question is **yes**, and to the second, **there is no adjustment available in the
parameters we have** — swept and reported here so nobody re-runs it.

**Yes, in-season data is used, and it refreshes.** The rating is
`(n·this_season + PRIOR_K·last_season)/(n + PRIOR_K)` with `PRIOR_K = 5`, so by week 6 it is **55%
this season**. Totals blend separately (`CUR_W 1.5`, `K 0.75`). `player-projections.yml` runs twice
daily and the generated files were last written the morning this was checked — the mechanism is
live, not a stale file.

**What the blend does to each club.** Mean pull away from a team's own 2026 margin: **2.40 points**,
with the extremes at LAC (+5.4 up from −10.2/g), LV (−5.1 down from 0.0/g), LA (+4.8), KC (−4.7).
Those look like the model refusing to believe what it has seen, which is what prompted the question.

**🚨 BELIEVING IT MORE MAKES IT WORSE, AND BY A LOT.** Walk-forward over 2026's 92 games, strictly
no look-ahead:

| PRIOR_K | 2026 MAE | vs shipped |
|---|---|---|
| **0** (this season only) | **11.393** | **+1.700** |
| 1 | 10.337 | +0.644 |
| 3 | 9.822 | +0.129 |
| **5 (shipped)** | **9.693** | — |
| 8 | 9.666 | −0.027 |
| 16 | 9.687 | −0.006 |

Discarding last season costs **1.7 points of margin per game**. 2026's own optimum is K≈8 — *more*
prior weight, not less — and the curve from 5 to 16 is flat inside 0.03.

**The optimum wanders between seasons, which is the tell.** Best K is 2 on 2024, 3 on 2025, 8 on
2026, and K=5 is within 0.08 of the best in every one. A parameter whose optimum moves that much on
a curve that flat is not a lever; picking any season's winner is fitting that season's noise.

**REGRESS and HFA are the same story.** Swept across 2023-2026:

| | best per season | shipped | four-season mean gap |
|---|---|---|---|
| REGRESS | 0.65 / 0.80 / 0.55 / 0.45 | 0.65 | 0.025 |
| HFA | 2.0 / 1.0 / 2.0 / 0.5-1.0 | 2.0 | 0.009 |

2026 prefers REGRESS 0.45 and HFA ~0.5 strongly *on 2026 alone* — because this season's home margin
is **+0.63** against +2.71 / +1.72 / +2.18 in the three before it. With n=87 and a margin SD near
13.5, the standard error on that mean is **±1.45**, so +0.63 is within one SE of +2.0. It is a
small sample, not a league shift, and tuning HFA down to chase it is the §4 mistake with a new
number on it.

**So where does the gap to the market actually live?** Our walk-forward margin MAE is **9.69**
against the market's ~**9.3** on the same games — about **0.4 points**, and it is not in K, REGRESS
or HFA. Closing it needs information the model does not have, not a better setting of the
information it does. The 2026 board's records (ATS 45-45 = 50.0%, below the 52.4% break-even;
totals 37-55) are that 0.4-point deficit expressed as win-loss, plus noise at n≈90.

**Carry forward:** when a model looks too slow to update, sweep the weight before trusting the
impression. Here the impression was right about the mechanism (the blend really does hold teams
back by 2.4 points on average) and exactly backwards about the remedy.

### §22. Wind at BET TIME — the one live lead survives its first real test (2026-10-19)

ATTRIBUTE_CATALOG's wind finding (market under-sets totals ~1.3 pts at 15+ mph, 56.1% unders,
n=647) carried its own disqualifier: it used the wind **recorded at game time**, which nobody can
bet. The catalog named the honest version — *"being better than the market at predicting where the
forecast lands"* — and left it there. This is that test.

**Data.** `analysis/wind_forecast_build.py`: **1,442 outdoor games, 2018-2025**, each with the
closing total, the actual total, and the wind that was **FORECAST** for kickoff. Forecast comes from
Open-Meteo's historical-forecast archive (what was predicted), realized from its ERA5 archive (what
happened) — free, no key. Join validated two ways: forecast↔realized r=+0.71 with a 2.05 mph MAE
(a real forecast, not a relabelled analysis), and nflverse's own recorded wind↔ERA5 r=+0.70 with
matching means, which independently confirms each game is matched to the right venue-hour.

**Q1 — does the market price the forecast? No.** Regressing (actual total − closing total) on wind,
threshold-free over every game:

| predictor | slope (pts/mph) | t |
|---|---|---|
| **FORECAST wind** | **−0.2764** | **−3.38** |
| realized wind | −0.2152 | −2.90 |

**The forecast slope is STRONGER than the realized one.** That is the opposite of a hindsight
artifact: if the edge lived in wind the market could not see, realized would dominate.

**Q2 — is it only the surprises? No, and this is the decisive split.**

| group | n | under % |
|---|---|---|
| forecast windy, and it was | 154 | 57.5% |
| **forecast windy, it was NOT** | **67** | **59.7%** |
| surprise wind (not forecast) | 63 | 57.1% |
| calm by both | 1,158 | 50.7% |

The games that were *forecast* windy go under whether or not the wind arrives. The edge is attached
to the forecast — the thing a bettor holds — not to the weather.

**It replicates out of sample.** Cutoff fitted on 2018-2021, tested on 2022-2025: slope −0.2674
(t=−2.35) on train, **−0.2895 (t=−2.46) held out**. Essentially the same number on seasons the
cutoff never saw.

**It is not a proxy for December.** Controlling for temperature and week leaves wind at −0.2836
(t=−3.31) while temp (t=+1.08) and week (t=+1.01) do nothing; corr(wind, temp) is only −0.106. The
cleanest cut is the 2×2 — the wind gap is the same size in cold and mild games:

| | forecast windy | calm |
|---|---|---|
| cold (<45°F) | **58.7%** under | 50.4% |
| mild | **57.0%** under | 50.2% |

**The bettable group:** forecast ≥ 11.5 mph went **128-92 to the under = 58.2%** (n=220, p=0.018),
mean total 2.26 points under the closing line. Break-even is 52.4%.

**🚨 NOT YET TRADEABLE, AND THE REASONS ARE SPECIFIC.**
1. **n=220.** The 95% interval on 58.2% runs roughly [51.6%, 64.4%] — the lower bound is *below*
   break-even. Significant is not the same as established.
2. **Lead time.** The archived forecast is a SHORT lead. The closing total is also set near kickoff,
   so the comparison is fair for a late bettor — but anyone pricing days out holds a worse forecast
   than this, and that version has not been measured.
3. **Provenance.** This began as the best of 31 tests (§4), which is exactly where false positives
   live. It is now a pre-specified test of a named mechanism that replicated held out, which is a
   much stronger position — but it is one mechanism, measured once more.

**Status change: from "worth pursuing, not worth betting on" to "the mechanism is confirmed at bet
time; the open question is lead time and sample."**

### §22b. Lead time is NOT the obstacle — sample size is (2026-10-19)

The follow-up §22 asked for: a forecast issued days out rather than near kickoff. Open-Meteo's
`wind_speed_10m_previous_dayN` gives the forecast for the SAME kickoff hour as it stood N days
earlier — verified to be a genuinely different forecast rather than a 24-hour lag of the series
(mean |difference| 2.56 mph, almost never identical).

**The archive only covers 2024-2025** — 348 of the 1,442 games. So every lead-time number below is
on that subset, and the honest comparison is against near-kickoff **on the same games**, not
against the full sample.

| forecast issued | slope (pts/mph) | t | windy group |
|---|---|---|---|
| near kickoff | −0.2520 | −1.54 | 49.1% |
| ~1 day earlier | −0.2686 | −1.65 | 54.5% |
| ~2 days earlier | −0.2939 | −1.80 | 43.4% |
| ~3 days earlier | −0.2203 | −1.39 | 46.2% |
| *(full sample, near kickoff)* | *−0.2764* | *−3.38* | *58.2%* |

**The slope does not degrade with lead** — −0.25 to −0.29 with no trend, and forecast skill barely
decays either (r 0.835 → 0.761, MAE 2.05 → 2.40 mph at three days). Synoptic wind is genuinely
predictable that far out.

**And the subset shows no edge at ANY lead, including near kickoff (49.1%).** That rules out the
tempting misreading: the weak lead-time numbers are not evidence that older forecasts fail, because
the *same games* fail with the newest forecast too. 2024-2025 is simply a weak window.

**It is a weak window, not a dying edge.** The windy group by season runs 61 / 65 / 46 / 66 / 65 /
68 / **41** / 56 percent — n≈25-35 a season, SE ≈ 9 points. Split in halves: **2018-2021 58.9%**
(n=112) against **2022-2025 57.4%** (n=108). Stable.

**So: the information is available when a bettor would need it, and the market still does not price
it.** What is NOT established is the size, and that has not moved — 220 windy games, an interval
whose lower bound sits below break-even, and a per-season bounce of 27 points. The remaining work
is sample, not mechanism and not timing.

**⚠️ A bug caught mid-analysis, recorded because it nearly shipped.** The lead-time loop was written
`for n in (1, 2, 3)`, shadowing the `n = len(rows)` used by the percentile cutoffs further down. The
top-15% threshold silently became the third-smallest value — 0.2 mph instead of 11.5 — which put
every game in the "windy" group and reported it at 52.2%. The tell was a cutoff printed in the
output that was obviously wrong; printing the threshold rather than just using it is what made it
visible.
