# Product Idea Tracker

Running log of every idea, its status, and the reasoning.
Last updated: Aug 14, 2026.

---

## Core vision

An AI/ML-led sports betting **advice** app — not a sportsbook. NFL first, then MLB,
NHL, soccer.

**Primary differentiator: being the most trustworthy source in the category.**

Trust interpreted as *verifiable* trust — published probabilities, published track
record including the bad stretches, calibration users can check.

Target experience: click a game, see what the model thinks and **why**, with each
clause traceable to a model input the user can check.

---

# App architecture — three sections

This is now the main organizing principle. The separation exists because each
section is true in a different way, and collapsing them into one composite
confidence score destroys all three.

## 1. Value Finder — line-aware

**Question it answers: where is the price wrong?**

| Feature | Status |
|---|---|
| Best number across books (line shopping) | Highest trust-per-effort. Not a model. |
| Key-number flags | Built. Half point at 3 is worth ~9% vs ~3% at 4.5. |
| Alternate-line fair pricing | Built (`alt_lines_v2.py`) |
| Market coherence check | Built (`odds_audit_v2.py`) |
| Parlay correlation detection | Designed, not built |
| Line movement display | Available from the board; **cannot be modelled** (see dependencies) |

This is where the actionable value is, and almost none of it requires prediction.
On the three Week 1 games sitting on -3, shopping for -2.5 is worth ~9 points of
win probability — larger than any model edge honestly claimable.

## 2. The Model — line-blind

**Question it answers: what does the data say on its own?**

Derek's framing was "non-biased, not influenced by sportsbooks." One correction:
the market is not a source of bias, it is the most accurate available forecast.
Measured directly — line-blind model MAE 10.15 vs market 9.89, market's advantage
significant at p=0.034. A line-blind model is not *unbiased*; it is *less
informed*.

Its real job is to be the **honest measurement instrument**. A model that never
sees the line cannot unconsciously anchor to it, so its published track record is
a genuine test of skill. That is the trust engine.

**Non-negotiables:**
- Predictions published and locked before kickoff (calibration ledger)
- Calibration tracked publicly
- Stated plainly as less accurate than the market
- Large disagreements flagged as *investigate the model*, not *bet it*

**Risk to avoid:** presenting it as purer advice. If users read "unbiased" and
follow it over Value Finder, they do measurably worse.

## 3. Context — neither

**Question it answers: what should I understand about this game?**

Accurate football analysis that helps people think, explicitly labeled as **not a
pick driver**. Trend analysis, weather, referee crews, injury burden, implied
totals, line movement, **new-starter / QB-change flag** (see #25).

Every number here is true, sourced, and useful. None of it is an edge. Showing it
*without* claiming predictive power is what builds credibility rather than
spending it.

**The design rule: panels inform, they do not vote.** Five analysis panels feeding
a composite score looks like the most sophisticated product in the category while
being, mathematically, a coin flip with a dashboard. Combining zero-edge signals
produces zero edge — but the appearance of rigor rises sharply. That is the exact
machine the competition runs.

---

# Ideas: accepted and in the build

| # | Idea | Section | Status |
|---|---|---|---|
| 1 | Weather shown under each game | Context | Ship early. Lead with **wind** (>15mph), not temperature. |
| 2 | Weather forecast *distribution* | Model | **The one live lead.** Market under-adjusts ~1.3 pts of total at 15+ mph. |
| 3 | Practice participation trajectory | Model | **Cannot be backfilled** — capture live this season. **Vendor path dead-ended (Aug 14):** Sportradar ~$10k/mo; SportsDataIO won't sell the single field narrowly (only full Feeds + annual minimum — declined by email); The Injury Expertz has it but is contact-for-quote. **Decision → free self-scrape of the NFL's own injury JSON API.** ESPN's free API gives only status (= nflverse weekly-final, no new value); the daily DNP/Limited/Full trajectory lives on the official NFL report, best taken from its internal JSON endpoint (undocumented — Derek to grab the URL from nfl.com/injuries via DevTools Network once reports go live ~Sept 3, then build a JSON client + zero-row alerting + Wed/Thu/Fri capture). Not urgent (feeds props layer-2 projections); just must be capturing before Week 1. |
| 4 | Coordinator/coach presser mining | Model | Strongest idea raised. Extract *statements* about usage, not sentiment. |
| 5 | Per-coach credibility scoring | Model | Novel asset. Compounds every season. |
| 6 | Contract data → opportunity model | Model | Reframed: contracts predict *opportunity*, not effort. |
| 7 | Snap/touch share model | Model | **Build 1 complete.** +5.9% over persistence; +8.2% on change weeks. |
| 8 | Live odds feeds | Value Finder | Blocking dependency. |
| 9 | Confidence tiers | Value Finder + Model | Must be edge **and** uncertainty. Honest output is mostly "no bet." |
| 10 | Best-number-across-books | Value Finder | Highest trust-per-effort. |
| 11 | Alternate-line fair pricing | Value Finder | Engine built. |
| 12 | Player prop module | Value Finder (shopping) + Model (projections) | Two layers: the **price-shopping view** (best line across books + parlay math) lives under **Value Finder** — it's the same "where's the price wrong" job — and is **built/live**. The **projection tiers** (snap/touch-share → fair prop number) are **Model**. **v1 built + backtested (`props_projection.py`, Empirical §9):** volume×efficiency projection *ties* a season-average and beats last-week persistence ~25%, but does NOT beat season-avg on point accuracy — so the edge must come from calibrated over/under *probabilities* (distribution, not point), the validated snap-share change signal as the volume input, and beating the closing prop line (needs line history). **Point projection ≠ the edge.** |
| 18 | Referee crew statistics | Context | Tested — display only. Penalty rates persistent (r=+0.267), outcomes are noise. |
| 19 | **Trend analysis** | Context | Tested — see below. Framework is correct about football, produces no edge. |
| 25 | **Offseason roster improvement (FA/draft)** (Derek, Aug 14) | Context | Tested → see below and Empirical §8. Returning production = no signal (0.02 pts OOS); QB upgrade/downgrade *direction* = null; QB *change* only marks **uncertainty** (unproven new starter), not direction, and is unmeasurable for ~40% of changes. **Not a model input** — becomes a "New Week-1 starter (unproven)" **Context flag**. |

# Ideas: modified

| # | Idea | Disposition |
|---|---|---|
| 13 | Media sentiment | Redirected. Criticism follows bad performance, already in the stats. Beat coverage *does* leak usage info — that is the extractable part. |
| 14 | "Motivation scale" from contracts | Reframed. The pattern is regression to the mean, not motivation. |
| 15 | "Move the line to +7.5" | Reframed to fair-price comparison. Buying points changes variance, not edge. |
| 16 | Parlay recommendations | Reframed to correlation detection. |
| 20 | "Unbiased, no-Vegas section" | Reframed to The Model — an honest measurement instrument, not purer advice. |

# Ideas: declined

| # | Idea | Reason |
|---|---|---|
| 17 | Legal/domestic issue flag | **Legal:** an anonymized severity score on a named player is a specific accusation with sourcing stripped out — worse exposure, not better. **Statistical:** 5–15 heterogeneous cases a season; "Severity: High" would be a fabricated number borrowing credibility from real output beside it. **Brand:** a trust-first app that monetizes a player's divorce doesn't survive the first screenshot. Replaced by **availability facts** — suspended, exempt list, expected to miss time. |

---

# Ideas: raised, parked

| # | Idea | Section (likely) | Notes |
|---|---|---|---|
| 21 | **Fan/community sentiment mining** — parse team subreddits, fan forums, message boards for how fans feel about their team and specific players (Derek, Aug 12) | Context by default; Model-candidate only if a factual signal is isolable | Derek's rationale: fans discuss depth chart, who's returning from injury, which rookie/draft pick may break out early — potential weekly betting insight. **Discipline caveat (parallels #13 media sentiment):** aggregate *sentiment* is almost certainly already priced and will read as noise. The extractable part, if any, is the same as pressers/beat writers — **factual usage/availability leakage** (depth-chart buzz, snap-count expectations, injury-return chatter), which can surface *before* markets post props for secondary players. Enters The Model only if a specific, observable, pre-stated signal beats the closing line out of sample; otherwise it stays Context. **Data/eng reality:** heavy NLP/LLM extraction, spam/brigade filtering, and selection bias (loud fans ≠ informed fans) — non-trivial. **Parked** until odds + practice + props pipelines are live. |
| 22 | **Player "beef" / called-out signal** — detect players with public feuds, or called out by another player or coach, as a possible *extra-motivation* driver for next-game performance (Derek, Aug 12) | Context by default; Model-candidate only if it beats the closing line OOS | Derek's rationale: a called-out or feuding player may be extra motivated to perform. **Discipline caveat — this is the motivation-narrative family, which has a poor track record here:** #14 "motivation from contracts" reframed as *regression to the mean, not motivation*; #13 media criticism redirected (criticism follows bad play, already in the stats); every "needs a win" streak angle failed the vig (e.g. losing-streak wk12+ = 48.9%). "Extra motivation" feels predictive and mostly hasn't been. **BUT** — like media criticism, it's Derek's domain intuition worth *running* rather than assuming; the honest test is: does a called-out event predict next-game performance beyond what recent stats already imply, against the closing line? **Measurement problem (cf. #17):** these events are rare, heterogeneous, and hard to score objectively — needs news/social extraction + a defensible "called out" definition, and a season yields few clean cases. **Parked** with #21 until the core pipeline is live; test as a batch study before any UI. |
| 23 | **Member-defined parlay builder** — natural-language requests build custom parlays, e.g. "4-leg parlay with the most value from Value Finder" or "4-leg, +2000, player-props only, based on the data" (Derek, Aug 13) | Value Finder / Board feature (composes existing outputs); props-dependent | A product/UX feature, not a new edge. Feasible and appealing, but **must carry honest EV framing or it becomes the confident-picks app we're avoiding:** a parlay compounds the vig (every leg adds hold), so a long-odds combo like +2000 is *not* "value" by virtue of its price — it's low win-probability by construction. Per #16 (parlays reframed to **correlation detection**), the only real parlay edge is (a) shopping the best price for each leg across books and (b) flagging **correlated legs** that books price independently (e.g. a QB passing over + his WR receiving over). So the builder should optimize best-priced legs + surface correlation + show the true combined win prob and EV — never imply a +2000 parlay is "likely." Ties to confidence tiers (#9) and the prop module (#12). **Depends on** the props pipeline, prop pricing, a parlay EV/correlation engine, and an NL query layer. **Extension — save picks + best-book placement (Derek, Aug 13):** a save/❤️ feature to bookmark picks, then a **book-placement optimizer** that tells the member where to actually place the slip. This part is honest arithmetic, no picks. Nuance to get right: for **straight bets**, each leg's best book can differ, so offer both a *per-leg-optimal* view (max value, more accounts) and a *one-book convenience* mode ("3/5 of your picks are best-priced on FanDuel → place there") that names the small value given up vs splitting; for a **parlay** (which must sit at a single book) compute the one book that maximizes the *combined* price. This is the most natural payoff of the whole line-shopping engine. **Requires** member accounts/persistence for saved picks. **Parked** until props are live. |
| 24 | **Betting-advice consensus tracker** — aggregate picks across X/Twitter, Facebook, and major bet-advice apps to surface consensus, e.g. "20/25 advice sources say Player X over yards" (Derek, Aug 13) | Context by default; Model-candidate only if consensus beats the closing line | Derek's rationale: knowing where the tout/public crowd is piling in. **Discipline caveat:** heavy public/tout consensus is usually *already in the line* or a **fade** signal (the popular side is often overbet), not a follow signal — so raw consensus rarely beats the price. The sharper, testable version is **reverse line movement** (line moves *against* where the public money is), which the timestamped odds we're now capturing makes measurable — ties to the RLM/line-movement plans in CLAUDE.md. Overlaps the "aggregate what others say" family (#13 media sentiment, #21 fan sentiment). **Data/eng/legal reality:** the X API is paid/restricted and FB scraping is locked down; aggregating other apps' picks raises ToS/IP questions; plus NLP to extract pick + side + market and a defensible definition of "consensus." Non-trivial and permission-sensitive. **Parked** until odds-history + props are live; first test as a batch RLM study, not a live scraper. |

---

# Language decisions

| Term | Decision |
|---|---|
| **"Safe"** | **Never use.** Over 45.5 instead of 48.5 isn't safe — it's 58.9% instead of 49.5% at a price that makes EV roughly identical. "Safe" implies risk reduction; what happens is variance reduction. Users size bets on that word. |
| "Best bet" | Only with a published probability beside it. |
| "Lock", "can't lose", "free money" | Never. |
| Stale line display | Always timestamp: "line as of 5:00 PM ET." |
| "Unbiased" (for The Model) | Avoid. It's line-blind, not unbiased — and measurably less accurate. |

---

# Trend analysis — tested

21 streak and momentum angles. **Zero clear the vig.**

| Angle | n | ATS | 95% CI | p |
|---|---|---|---|---|
| On 3-game losing streak — back them | 759 | 52.8% | [49.3, 56.4] | 0.127 |
| After losing by 21+ — back them | 1,129 | 51.8% | [48.9, 54.7] | 0.234 |
| **Losing streak, week 12+ ("needs a win")** | 1,431 | **48.9%** | [46.3, 51.5] | 0.428 |
| On 4+ game win streak — fade them | 996 | 50.8% | [47.7, 53.9] | 0.635 |
| Hot by 3-game EPA — back them | 800 | 51.1% | [47.7, 54.6] | 0.548 |

## The framework's two claims, both tested

| Trailing signal | r with next game | r with ATS margin |
|---|---|---|
| 1-game margin | +0.122 | +0.006 |
| 3-game margin | +0.197 | +0.014 |
| 5-game margin | +0.236 | +0.020 |
| 1-game net EPA | +0.133 | +0.001 |
| 3-game net EPA | +0.194 | −0.001 |
| **5-game net EPA** | **+0.254** | +0.024 |

**"Three to five games is more meaningful" — VALIDATED.** Longer windows predict
better, monotonically.

**"Usage trends beat results trends" — VALIDATED, modestly.** EPA edges margin at
the 5-game window (+0.254 vs +0.236).

**But the ATS column is ~zero for every row.** The framework is accurate football
analysis that produces no betting edge, because the closing line already contains
it. This is the sharpest single illustration of the Value Finder/Model/Context split, and
the reason trend analysis belongs in Context.

---

# The game-line model — validation record

| Sample | n | Market MAE | Model MAE | Model ATS |
|---|---|---|---|---|
| Week 1 only | 159 | 9.97 | **9.73** | **58.5%** |
| Weeks 1–2 | 319 | 9.36 | 9.47 | 56.7% |
| Weeks 1–4 | 635 | 9.84 | 10.04 | 55.4% |
| Weeks 1–6 | 925 | **9.85** | 10.07 | 54.8% |

**The advantage flips sign as the sample grows.** ATS decays monotonically
58.5 → 54.8, CI lower bound stuck near 51.6%, never clearing 52.38%.

Distinguishing 55% from break-even at 80% power needs ~2,842 games. Week 1 supplies
16/season — **177 seasons.** A Week-1-specific model cannot be validated, ever.

## Two recommended fixes, tested and rejected

Weeks 1–6, 2017–2025, n=833:

| Model | Market MAE | Model MAE | Diff | p |
|---|---|---|---|---|
| A. Margin | 9.89 | 10.15 | +0.26 | 0.034 |
| B. EPA-based | 9.89 | 10.16 | +0.27 | 0.032 |
| C. EPA + luck-adjusted | 9.89 | **10.23** | **+0.35** | **0.010** |

Both fixes made it *worse*, and the market's advantage more significant. Reason:
EPA-based luck-adjusted ratings are table stakes, not an edge — every sharp shop
runs them. Making the model more sophisticated moves it toward the market's number;
the remaining deviation is noise, not insight.

**Calibration note:** turnover margin persistence is r = **+0.214**, not zero. It
is partly skill, so stripping all of it over-corrects — which is why model C is
worst. Regress it partially.

---

# Offseason roster change — tested (idea #25)

Derek's hypothesis (Aug 14): can we predict whether a team **improved** its roster
through free agency and the draft, and use it as a preseason 8th factor that decays
once games start? Tested against team point differential, OOS, 2017–2025. Full
numbers in Empirical §8.

| Version tested | OOS effect vs. last-year-only | Verdict |
|---|---|---|
| Returning production (snap-weighted retention) | −0.02 MAE | No signal; confounded with last year's record |
| QB change — binary (new starter y/n) | −0.09 MAE | Small — but it's an **uncertainty** flag (rookie takeovers), not direction |
| QB change — **direction** (incoming QB's prior EPA/att) | +0.01 MAE (worse) | **Null.** Can't forecast which way a QB swap tips |

**Two structural reasons it fails as a model factor:**
1. **42% of QB changes hand the job to a rookie / never-started QB** — the biggest,
   highest-variance moves, whose direction is *unmeasurable in advance* from NFL
   history. The one thing we most want to price is the one thing we can't.
2. Prior-year QB EPA is itself noisy and mean-reverts, and **the market prices every
   proven-QB swap** — a new starting QB is the single biggest mover of a Vegas win
   total. No free direction signal is lying around.

The honest read: for prediction, *roster change ≈ QB change*, and QB change signals
**uncertainty, not direction**. That belongs in Context, not the rating.
**Disposition:** a "New Week-1 starter (unproven)" Context flag — informs the reader
the ground is shifting without pretending we know the outcome. Consistent with the
panels-inform-they-don't-vote rule. Clean negative result, treated as output.

---

# Alternate lines (buy points)

Principle: **the app computes fair price; it does not recommend moving the line.**

```
base line   WAS +4.5    -110        true 49.7%   fair +101
alternate   WAS +7.5    book -240   true 61.5%   fair -160   OVERPRICED by 80c
```

Buying +3 → +4 is worth **+6.0 points** of win probability. From +4.5 → +5.5 it's
**+1.8**. Same point, triple the value, because one crosses 3. Books often price
point-buying flat; an engine that knows key numbers finds real value.

---

# Parlays

**parlay EV = Π(1 + EV_i) − 1.** Parlays are **leverage** — they multiply per-leg
edge in whichever direction it points.

| Per-leg EV | 4 legs | 10 legs |
|---|---|---|
| -110, no edge | -19.4% | **-41.7%** |
| exactly fair | 0.0% | 0.0% |
| +3% edge | +12.6% | **+34.4%** |

Buying points does not rescue a parlay — the probability gain is already paid for.

**Where parlays genuinely become +EV: correlation mispricing.** Books often price
same-game legs as independent:

| Correlation | True joint P | Book implied | Edge |
|---|---|---|---|
| 0.30 | 37.5% | 30.3% | **+24%** |
| 0.60 | 45.1% | 30.3% | +49% |

Requirements: fair price per leg, correlation estimate, true parlay probability
shown next to payout, and **never present a longer parlay as higher confidence.**

**Deliberate decision required:** parlay hold runs far above straight-bet hold, and
parlay volume is disproportionately associated with problem gambling. A trust-first
brand needs a stated position, not a default.

---

# Technical stack

| Layer | Choice |
|---|---|
| Database | Supabase (Postgres) |
| API / hosting | Vercel |
| Mobile build/test | Expo |
| Mobile frontend | React Native |
| Web frontend | Next.js |

**Batch-precompute the models.** Python models don't run in Next.js. Compute on a
schedule, write to Supabase, serve from Postgres.

**The calibration ledger is the most important schema decision in the app.**
Write-once, append-only, timestamped before kickoff, UPDATE grants revoked at the
database level — not enforced in application code. If past predictions can be
edited, the track record is worth nothing, and it *is* the differentiator. Build
this table before the model that fills it.

**No dedicated worker needed** at the chosen cadence — Vercel Cron handles it.
**No table partitioning needed** under ~10M rows/season.

**Verify app-store policy early.** Gambling-adjacent apps face specific review
requirements around age gating and geo-restriction. Read current Apple/Google
guidelines before going deep on Expo builds.

---

# Odds ingestion schedule

| Window | Cadence | Purpose |
|---|---|---|
| Baseline, every day | 5:00 AM + 5:00 PM ET | display |
| ~20 min before each kickoff wave | one poll per wave | **closing line capture** |

5:00 PM catches the day's practice reports. **Event-anchored, not day-of-week** —
Week 1 2026 has no Saturday game; Weeks 16–18 do.

**Why the pre-kickoff poll matters:** NFL inactives drop 90 minutes before
kickoff. An 11:00 AM poll for a 1:00 PM slate misses it, and the next poll lands
after kickoff. Without it, "closing line" means a T-2h line, biasing the CLV metric
the trust proposition rests on.

Volume: ~1.5M rows/season, ~0.15 GB. (30-second polling would be 2.5B rows.)

---

# Blocking dependencies

**One acquisition unblocks three features.** Prop history, opening lines, and
betting splits are all the same purchase: **timestamped multi-book odds history.**

| # | Dependency | Unblocks |
|---|---|---|
| 1 | **Timestamped multi-book odds history** | Prop validation, line movement modelling, reverse line movement, CLV measurement, cross-book disagreement |
| 2 | Stage A availability model | The whole player pipeline (currently conditioned on being active) |
| 3 | Daily practice report scraping | Practice trajectory. **Start now or lose the season.** |
| 4 | Presser transcript corpus | Coordinator mining, per-coach credibility. Start in parallel. |
| 5 | Coordinator history (needs scraping) | The one coaching test not yet run |

---

# Open tests

| Test | Status |
|---|---|
| Does media criticism predict beyond recent stats? | Open. Derek's read against mine. |
| Offensive line continuity | P1, highest-value untested roster item |
| New offensive/defensive coordinator | P1. Head coaches showed exactly nothing (49.9% every split) |
| Fourth-down aggressiveness by coach | P1 |
| Pace of play differential | P1 |
| Travel distance and time zones | P1, computable today |
| Look-ahead / let-down spots | P1, computable today |
| Wind forecast vs realized | P1 — the live lead |
| How much lines move in the final 2 hours | Needs intraday odds |

Full prioritized list with data requirements in `ATTRIBUTE_CATALOG.md`.

---

# Standing discipline

A candidate enters **the model** only if it clears all three:

1. Observable and recorded historically
2. Plausible mechanism, stated in advance
3. Improves results **against the closing line**, out of sample

Fails any one → it can be **Context**, not a model feature.

Rules earned the hard way during this design work:

- **Never define an evaluation stratum using the outcome** or a competitor's error.
- **Any model whose base case shows free money has a bug.** Enforce a sanity check
  that efficient lines price near 50%.
- **Use empirical distributions, not Gaussians,** anywhere key numbers matter.
- **Count your tests.** 31 attribute tests produce ~1.5 false positives at p<0.05.
- **Hold out later weeks by default.** A p-value on the sample a hypothesis was
  born in is not validation. The Week 1 model looked like a 58.5% system until the
  sample grew.
- **Test the variance before ranking.** If crew-to-crew spread ≈ binomial
  expectation, the leaderboard is noise — and a leaderboard is exactly what a
  betting app is tempted to display.

**Business model note:** affiliate revenue pays you when users bet more, which is
structurally opposed to saying "sit this one out." Subscription revenue aligns with
honest advice but grows slower. Decide this before the confidence tiers ship.

---

# Error log

Seven cases where the data contradicted an assertion. Recorded because these are
the failure modes that produce confident, wrong betting products.

| # | Error | How it surfaced |
|---|---|---|
| 1 | Claimed snap-share edge was at the *back* of the depth chart | Proportional error showed it's the middle (35–60%) |
| 2 | Stratified by persistence's own error | Clean signal/no-signal split contradicted it — two wasted model variants |
| 3 | Normal-margin model flagged 15 of 16 games as incoherent | Empirical curve showed the model was low at every spread |
| 4 | Moneylines entered backwards for 5 road favorites | Coherence checker flagged impossible values |
| 5 | Asserted lower totals → favorites win more | 60.0% vs 61.1%, slightly opposite, n.s. |
| 6 | Alternate-line window ±1.5 showed free money at the base bet | Sanity check that efficient lines price ~50% |
| 7 | Called turnover margin "mostly luck" | r = +0.214, partly skill — over-corrected model C |

**Four of seven were caught by automated checks rather than review. Build the
checks into the pipeline, not the review process.**
