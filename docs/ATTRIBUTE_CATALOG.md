# Team Attribute Catalog

Every team-level attribute worth considering, with test status. Tested against
the **closing line** on 6,967 regular-season games (1999–2025), because the line
already contains everything the market has thought of.

Bar: break-even at -110 is **52.38%**, and the confidence interval must clear it.
31 tests run → Bonferroni threshold p < 0.0016.

**Headline: zero of 31 attributes cleared the bar.** One came within 0.18
percentage points. Details below.

---

## Your five, tested

### 1. Fighting for playoff position

| Test | n | ATS | 95% CI |
|---|---|---|---|
| Late season (wk 14+), win% ≥ .600 | 1,164 | 49.6% | [46.7, 52.4] |
| Late season, win% ≤ .350 | 870 | 49.3% | [46.0, 52.6] |
| Contender (≥.600) vs also-ran (≤.350), late | 305 | 51.8% | [46.2, 57.4] |

**Fully priced.** Motivation differential from playoff stakes shows no residual
signal. The market knows which teams are playing for something.

### 2. Good home or away team

| Test | n | ATS |
|---|---|---|
| Home teams | 6,778 | 49.0% |
| Road teams | 6,778 | 51.0% |
| Home underdogs | 2,391 | 50.1% |
| Road favorites | 2,391 | 49.9% |

**Decisive kill on the concept:** lag-1 correlation of a team's home cover rate
season to season = **−0.020** (n=826 team-seasons). A "good home team" has zero
predictive carryover.

Home field advantage itself has declined, and the market tracked it:

| Era | Home margin | Market spread | Home ATS |
|---|---|---|---|
| 1999–04 | +2.70 | +2.39 | 47.9% |
| 2005–10 | +2.34 | +2.58 | 47.1% |
| 2011–16 | +2.57 | +2.32 | 47.7% |
| 2017–21 | **+1.27** | +1.76 | 47.1% |
| 2022–25 | +2.15 | +1.58 | 48.7% |

Real effect, real decline, already in the number.

### 3. Motivation / preseason expectations

Not directly testable without preseason win-total data. But note the mechanism
problem: teams that outperform expectations do so partly through luck (turnover
margin, fumble recoveries, opponent FG%), which reverts. "Motivated overachiever"
and "regression candidate" are frequently the same team.

The contract-year version was examined separately: mostly regression to the mean,
since players get paid after outlier seasons.

### 4. New head coach not gelling

| Test | n | ATS |
|---|---|---|
| New head coach, all season | 3,418 | 49.9% |
| New head coach, weeks 1–4 | 758 | 49.9% |
| New head coach, weeks 13+ | 1,159 | 49.9% |
| Facing a new head coach | 3,418 | 50.1% |

**Flat to three decimal places across every split.** The "not gelling yet"
hypothesis has no signal at all, and no early-season-vs-late pattern either.

### 5. "Where do the sportsbooks benefit?"

This one needs reframing more than testing, because the premise doesn't match how
modern books operate.

**What's not true:** that books set lines to engineer a profitable outcome and
that you can exploit this by deducing what they "want." Books don't primarily
balance action anymore — they price to be accurate and take positions. Their
exposure on a given game is unknowable to you and changes continuously. "Vegas"
isn't a monolith either: lines originate at a handful of sharp market-makers and
retail books largely copy them.

**How books actually make money:** vig on volume, plus recreational bettors'
predictable preferences — favorites, overs, popular teams, and especially parlays,
where hold runs far above straight-bet hold.

**The legitimate version — public bias — I tested:**

| Test | n | ATS | 95% CI |
|---|---|---|---|
| Primetime favorites | 1,259 | 50.9% | [48.2, 53.7] |
| Primetime underdogs | 1,259 | 49.1% | [46.3, 51.8] |
| Primetime overs | 1,275 | 48.6% | [45.9, 51.4] |
| Favorites 0.5–3.5 | 3,050 | 49.3% | [47.5, 51.1] |
| Favorites 4–7 | 2,093 | 49.2% | [47.1, 51.4] |
| Favorites 7.5–13 | 1,343 | 48.1% | [45.4, 50.8] |
| Favorites 13.5+ | 262 | **45.0%** | [39.1, 51.1] |

There *is* a consistent pattern — favorites cover under 50% and it worsens with
spread size, with big dogs (13.5+) covering 55.0%. That's the shape you'd expect
if the public overbets favorites. But n=262 and the interval doesn't reach the
vig. Suggestive, not actionable.

**The genuinely untested version:** *reverse line movement* — when the line moves
**against** the public betting percentage, indicating sharp money on the other
side. This is the real form of "follow the smart money," and I can't test it
because it requires public betting split data. **This is your best remaining lead
in the market-behavior category.**

---

## Everything else tested

| Attribute | n | Result | Verdict |
|---|---|---|---|
| **Wind 15+ mph, unders** | 640 | **56.1%**, p=0.002, CI [52.2, 59.9] | **closest miss** |
| Wind 8–14 mph, unders | 1,918 | 52.9%, p=0.013 | under vig |
| Wind 0–7 mph, overs | 2,342 | 52.3%, p=0.027 | under vig |
| Division games, underdogs | 2,611 | 52.0%, p=0.038 | under vig |
| Division game unders | 2,652 | 51.8% | no |
| Off a bye (rest ≥13) | 858 | 50.5% | no |
| Short week (rest ≤4) | 567 | 49.9% | no |
| Rest advantage ≥7 days | 633 | 50.6% | no |
| New starting QB vs last week | 1,270 | 48.7% | no |
| Dome, overs | 1,713 | 51.2% | no |
| Temp ≤32°F, overs | 300 | 53.3% | no |
| Turf surface, overs | 3,049 | 50.6% | no |
| Neutral site, favorites | — | insufficient n | — |

### Referees — full crew analysis

Two questions: do a crew's games go over or under, and do they favor the team
getting points or laying them? Both tested across 37 crew chiefs with 60+ games.

**Career rates look exploitable:**

| Crew chief | n | Over% | 95% CI | Fav ATS% | 95% CI |
|---|---|---|---|---|---|
| Mike Carey | 216 | 42.1% | [36, 49] | 45.4% | [39, 52] |
| Shawn Hochuli | 121 | 42.1% | [34, 51] | 44.2% | [36, 53] |
| Bill Vinovich | 253 | 44.3% | [38, 50] | 44.0% | [38, 50] |
| Tony Corrente | 333 | 45.0% | [40, 50] | 48.6% | [43, 54] |
| John Parry | 173 | 55.5% | [48, 63] | 51.2% | [44, 59] |
| Jerome Boger | 250 | 55.6% | [49, 62] | 52.2% | [46, 58] |
| Gerry Austin | 122 | 59.8% | [51, 68] | 42.5% | [34, 51] |
| Scott Green | 132 | 59.8% | [51, 68] | 53.8% | [45, 62] |

Over% ranges 42.1% → 59.8%. Favorite ATS% ranges 40.0% → 57.1%. An 18-point
spread on totals looks like a system.

**It is entirely sampling noise. Three independent tests agree:**

| Test | Over/under | Favorite ATS |
|---|---|---|
| Observed SD across crews | 3.87 pts | 3.51 pts |
| **Expected SD if pure noise** | **3.79 pts** | **3.81 pts** |
| Chi-square homogeneity | p = 0.351 | p = 0.691 |
| Split-half reliability (200 reps) | r = **−0.020** | r = **−0.071** |
| Year-over-year persistence | r = −0.050 | r = +0.044 |

The observed crew-to-crew spread almost exactly matches what binomial noise
predicts. For favorite ATS the observed spread is actually *smaller* than chance
would produce. Split-half reliability — random half of a crew's games against the
other half, which removes the crew-turnover confound — is negative for both.

**But crew *behavior* is real and persistent.** Penalties per game, 2016–2024,
22 crews with 40+ games:

| Crew chief | Penalties/game | n |
|---|---|---|
| Bill Vinovich | 10.53 | 139 |
| Scott Novak | 11.52 | 94 |
| John Hussey | 11.63 | 140 |
| Ron Torbert | 11.87 | 109 |
| Peter Morelli | 12.87 | 45 |
| Shawn Hochuli | 12.91 | 108 |
| John Parry | 13.24 | 42 |
| Walt Anderson | 14.65 | 62 |

Range: **10.53 to 14.65** penalties/game, a 4.11 spread.
ANOVA across crews: **F=3.10, p=2.8×10⁻⁶ — real variation.**
Year-over-year persistence: **r = +0.267** — genuinely predictive.

**So why doesn't it convert?**

| Penalty volume | Over rate | n |
|---|---|---|
| Low (≤9) | 50.0% | 638 |
| High (≥15) | 46.4% | 668 |

High-penalty games do lean under (53.6%), but the crew effect — about 4
penalties/game of spread — is small next to game-to-game variance. Crew identity
can't move a total enough to matter.

**Conclusion:** referees are a legitimate **display attribute**, not a model
feature. "This crew averages 14.7 penalties/game, 4th-highest in the league" is
true, interesting, and persistent (r=+0.267). It just doesn't predict the outcome.
This is exactly the display-vs-model distinction in the standing discipline — and
it's worth showing precisely *because* it's honest about not being an edge.

Note also the crew-chief caveat: the referee field identifies the crew chief, but
NFL crew membership is reshuffled between seasons, so year-over-year tests partly
measure turnover rather than the chief's own tendency. The split-half test avoids
that and still comes back at zero.

---

## The one live lead: wind

| Wind | Actual total | Market total | Difference | n |
|---|---|---|---|---|
| 0–7 mph | 44.27 | 42.96 | **+1.31** | 2,386 |
| 8–14 mph | 42.92 | 42.69 | +0.23 | 1,945 |
| **15+ mph** | **40.44** | **41.72** | **−1.28** | 647 |

Unders in 15+ mph wind: **56.1%**, p=0.002, CI [52.2, 59.9]. The market appears to
**under-adjust** for high wind by about 1.3 points of total.

**Two serious caveats before anyone gets excited:**

1. **It fails the bar.** CI lower bound is 52.2% against a 52.38% break-even, and
   p=0.002 doesn't survive Bonferroni (p<0.0016). It is the best of 31 tests,
   which is exactly the position where false positives live.

2. **Hindsight problem.** This uses *recorded game-time* wind. At bet time you
   only have a **forecast**. Forecast error shrinks the realizable edge, possibly
   to nothing. The genuine version of this edge is not "high wind → under" — it's
   **being better than the market at predicting where the forecast lands.** Which
   is precisely the weather-distribution idea from earlier, now with an estimated
   payoff attached: roughly 1.3 points of total, available only to the extent you
   can forecast better than the market prices.

Worth pursuing. Not worth betting on yet.

## The "surprise team" question — tested

The idea: Week 1 produces upsets; a team projected poorly starts 4-1 or 3-2, then
regresses and finishes badly. Find those teams in advance.

### Is Week 1 more upset-prone?

| Measure | Week 1 | Weeks 2–17 | p |
|---|---|---|---|
| Underdog wins outright | 33.9% | 33.3% | 0.808 |
| Underdog of 7+ wins outright | 23.7% | 20.0% | 0.458 |
| Mean \|margin − spread\| | 10.06 | 10.29 | 0.589 |
| Games missing the line by 17+ | 18.5% | 19.3% | 0.662 |

Week 1 averages **5.4 outright underdog wins per season** — so the "2–3 crazy
upsets" observation is actually an undercount. But the *rate* is
indistinguishable from every other week. Upsets are a feature of all NFL weeks;
Week 1's are more memorable because expectations are freshest and attention is
highest, not because they're more frequent.

### How much do hot starts regress?

| First-5 record | n | Rest-of-season win% | Regression |
|---|---|---|---|
| 4-1 or better | 160 | 62.3% | **−24.5 pts** |
| 3-2 | 246 | 53.9% | −9.7 |
| 2-3 | 233 | 46.8% | +4.3 |
| 1-4 or worse | 222 | 39.8% | **+24.0 pts** |

Correlation of first-5 win% with rest-of-season win%: **r = +0.382, R² = 0.146**.
A hot start explains only 15% of what follows.

**The observation is completely validated.** A 4-1 team (80%) plays like a 62%
team afterward. Regression of ~24 points in both directions.

### But it's fully priced

| Strategy, weeks 6–12 | n | ATS | 95% CI |
|---|---|---|---|
| Hot starters (4-1+) | 950 | 49.5% | [46.3, 52.6] |
| **Betting against hot starters** | 950 | 50.5% | [47.4, 53.7] |
| Cold starters (1-4−) | 1,053 | 51.9% | [48.8, 54.9] |
| Betting against cold starters | 1,053 | 48.1% | [45.1, 51.2] |

Nothing. The market prices the regression correctly.

### The logical trap

**Persistence of luck itself: r = +0.020** (n=826 team-seasons).

This is the crux. If a team starts 4-1 and then regresses, the start *was* luck —
and luck has near-zero year-over-year persistence, by construction. "Find the team
that will get lucky" is asking to predict a random variable. It cannot be done,
and the r=+0.020 is the measurement proving it.

### The sophisticated version: Pythagorean luck

Does prior-season point differential identify teams whose record misrepresented
their quality?

| Relationship | r |
|---|---|
| Prior win% → next win% | +0.327 |
| **Prior Pythagorean% → next win%** | **+0.361** |

Regressing next-season win% on both:

```
next_wp = 0.280 − 0.010 × prior_win%  + 0.450 × prior_pythagorean%
```

**The prior-record coefficient is essentially zero.** Point differential
completely subsumes W-L record — record adds nothing once differential is known.

**This is a genuine modeling insight**: never use win-loss record as a model
input. Use point differential. It's the single cleanest illustration of the
strip-out-the-luck principle.

But as a betting edge:

| Group, weeks 1–6 | n | ATS | 95% CI |
|---|---|---|---|
| Prior year unlucky (record < differential) | 464 | 50.9% | [46.3, 55.4] |
| Prior year lucky (record > differential) | 496 | 51.0% | [46.6, 55.4] |
| Bad record (≤.450) but good differential | 144 | 51.4% | [43.3, 59.4] |
| Good record (≥.550) but bad differential | 140 | 50.7% | [42.5, 58.9] |

Fully priced. The market has known about Pythagorean luck for decades.

**Net:** every effect here is real, large, and already in the line. Identifying
them correctly is necessary to build a competent model — but "competent model" and
"beats the closing line" are different bars, and this is the gap between them.

---

## Injury burden — tested

Snap-weighted metric: for each player-week where a player is declared Out, add
that player's season-average snap share. 1.00 = one full-time starter
unavailable. This weights a 90%-snap starter far above a special-teamer, which
raw "players on IR" counts do not. League mean is 0.69 per team-week; p90 is 1.69.

### T1: prior-season burden → next-season bounce-back

| Relationship | r |
|---|---|
| Burden vs same-season win% | −0.070 |
| Burden vs next-season win% | −0.064 |

```
next_wp = 0.342 + 0.325 × this_wp − 0.00143 × this_burden
```

The burden coefficient is essentially zero. **No bounce-back effect.**

| Early-season ATS (wks 1–6) | n | ATS | 95% CI |
|---|---|---|---|
| High prior-year burden (≥7) | 1,141 | 50.5% | [47.6, 53.4] |
| Low prior-year burden (≤0) | 2,938 | 50.0% | [48.2, 51.8] |

"Healthier roster this year" produces nothing. Closes the loop on the
surprise-team mechanisms.

### T2: current-week burden → ATS

| Group | n | ATS | 95% CI | p |
|---|---|---|---|---|
| ≥1.0 starter-equivalent Out | 988 | 48.5% | [45.4, 51.6] | 0.356 |
| ≥1.5 starter-equivalents Out | 518 | 47.1% | [42.8, 51.4] | 0.203 |
| ≥2.0 starter-equivalents Out | 180 | **43.3%** | [36.3, 50.6] | 0.086 |
| **Fading teams at ≥2.0** | 180 | **56.7%** | [49.4, 63.7] | 0.086 |
| Fully healthy (burden = 0) | 9,957 | 49.9% | [49.0, 50.9] | 0.920 |
| Healthier than opponent by 1+ | 570 | 52.3% | [48.2, 56.4] | 0.295 |

**Monotonic dose-response** — 48.5% → 47.1% → 43.3% as burden rises — which is
what a real effect looks like. But n=180 at the extreme, CI bottoms at 49.4%, and
p=0.086 doesn't clear either the vig or a multiple-comparison threshold.

Effect size is small: burden differential vs ATS margin r = **−0.021**. Mean ATS
margin is +0.62 for the healthier team and −0.62 for the less healthy, so a 1.24
point swing for a full starter-equivalent differential — against a 13.2-point
margin SD.

**Verdict:** second-most-promising finding after wind, on the strength of the
monotonic pattern. Not actionable. Worth re-testing as n accumulates.

---

## Untested attributes worth trying

With data requirement and priority. **P1** = testable with data you have or can
get cheaply; **P2** = needs acquisition; **P3** = speculative.

### Roster and personnel

| Attribute | Data needed | Priority |
|---|---|---|
| ~~Prior-season injury burden~~ | — | **TESTED — nothing.** See injury burden section. |
| **Offensive line continuity** | Snap counts by position (already have) — games with same 5 starters | **P1 — now the highest-value untested roster item.** Widely believed, rarely tested. |
| Cumulative in-season injury burden | Injury reports + Stage A availability model | P2 |
| Overlooked free agent signings | Roster transactions + contract data (OverTheCap) | P2 — hard to define "overlooked" without circularity |
| Draft needs addressed | Draft data + prior-season positional weakness | P3 — hard to operationalize |
| Rookie QB progression curve | QB starts by experience (have QB names) | P2 |

### Coaching and scheme

| Attribute | Data needed | Priority |
|---|---|---|
| **New offensive/defensive coordinator** | Coordinator history — NOT in nflverse, needs scraping | **P1.** Head coach change showed exactly nothing (49.9% across every split), but coordinators sit closer to scheme and playcalling. This is the specific version worth testing. |
| **Fourth-down aggressiveness by coach** | Play-by-play (nflverse pbp) | **P1.** Affects both margin and total, and is coach-persistent. |
| **Pace of play differential** | pbp — seconds per play, situation-neutral | **P1.** Drives total plays, which drives totals more than efficiency does. |
| Coach on hot seat / interim coach | Manual tagging or news | P3 |
| Coach vs former team | Coach history (have by team-season) | P2 — small n |
| Clock management quality | pbp | P2 |

### Schedule and travel

| Attribute | Data needed | Priority |
|---|---|---|
| **Travel distance and time zones** | Stadium coordinates (have stadium_id) | **P1.** West→east early kicks is the specific case. Computable today. |
| **Look-ahead / let-down spots** | Schedule + spread magnitudes (have both) | **P1.** Definable purely from schedule — game before or after a marquee matchup. |
| Consecutive road games | Schedule (have) | P1 |
| Three games in 11 days | Schedule (have) | P1 |
| Facing a team off a bye | Rest fields (have) | P1 |
| Post-international game | Schedule + location (have) | P2 — small n |

### Environment

| Attribute | Data needed | Priority |
|---|---|---|
| **Wind forecast vs realized** | Historical weather *forecasts*, not just outcomes | **P1 — the one live lead.** See wind section. |
| Dome team playing outdoors | roof + home venue (have) | P1 |
| Cold-weather team in early-season heat | temp + home venue (have) | P1 |
| Surface change (grass ↔ turf) | surface field (have) | P1 |
| Precipitation | Weather API history | P2 |
| Altitude (Denver) | Have stadium data | P2 — single venue, slow n |

### Market behavior

| Attribute | Data needed | Priority |
|---|---|---|
| **Reverse line movement** | Public betting % splits | **P1 — best market-behavior lead.** Line moving *against* public money. |
| **Cross-book line disagreement** | Multi-book odds feed | **P1** — falls out of the odds API you already need |
| Sharp-book vs retail divergence | Pinnacle/Circa vs retail | P1 |
| Opening vs closing differential | Have closing; need opening | P1 |
| Steam moves | Timestamped multi-book odds | P2 |

### Officiating

| Attribute | Data needed | Priority |
|---|---|---|
| Crew clock-stoppage rate → total plays | pbp + referee (have both) | P2 — the one referee thread with a mechanism, since penalty rate is persistent (r=+0.267) but doesn't move outcomes |

### Largely unmeasurable

Locker-room chemistry, "wanting it more," coaching relationships, media pressure
as a causal factor, player mindset. These fail criterion 1 of the standing
discipline (observable and recorded historically) and are where narrative-driven
products live.

### The team-quality work that actually matters

Not exotic attributes, but the unglamorous version — and the highest-return
modeling decision available:

- Opponent-adjusted EPA, split four ways (pass/rush × offense/defense)
- **Strip out non-persistent luck**: fumble recovery rate (near coin flip),
  turnover margin (weakly persistent), opponent FG% (near zero persistence), red
  zone TD rate (reverts hard)
- Regress the non-persistent component aggressively toward the mean
- Pythagorean expectation vs actual record

A team that went 11–6 on turnover luck is not an 11–6 team. This matters most in
September, when everyone else is overreacting to Week 1.

---

## What this sweep means

Team-level attributes are the most scrutinized data in sports betting. Thirty-one
tests across schedule, environment, coaching, motivation, personnel, and officials
produced zero results clearing the vig. That is not a failure of the search — it's
what an efficient market looks like from the inside, and it's the same conclusion
the Week 1 board audit reached independently.

Where undiscovered edges plausibly remain, in descending order of promise:

1. **Player-level and role-level granularity** — props, where books price hundreds
   of markets semi-independently
2. **Correlation structure** — same-game parlay legs priced as independent
3. **Speed on new information** — pressers, practice reports, inactives
4. **Forecast skill on things not yet known** — the wind result points here
5. **Line shopping and key numbers** — not an edge in prediction, but a real and
   verifiable edge in execution

Note that four of those five are about *process and pipeline*, not about finding a
hidden variable. That's the honest shape of the opportunity.

---

## Script

`team_attributes.py` — runs all 31 tests plus the persistence and era analyses.
