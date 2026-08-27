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
