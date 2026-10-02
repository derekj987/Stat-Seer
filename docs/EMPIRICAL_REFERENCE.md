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
