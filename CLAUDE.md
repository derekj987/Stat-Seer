# Project context

Read this first. It orients you on a project already several months of thinking
deep, then points you at the right reference file.

---

## What this is

An **NFL betting advice app** — not a sportsbook. Analyzes spreads, totals, and
player props and produces statistical analysis with reasoning attached.

**The differentiator is verifiable trust**: published probabilities, published
track record including bad stretches, calibration anyone can check. Not
confident-sounding picks.

Owner: Derek, an IT auditor by trade — comfortable with data and systems, has not
shipped a consumer app before.

---

## Current state, in one paragraph

The analytical groundwork is done and mostly came back negative, which is itself
the finding. Roughly 50 hypotheses have been tested against the closing line
across team attributes, referees, weather, injuries, motivation, trends, and
streaks. **Essentially none beat the vig.** The one measured signal that survived
a real benchmark is a player-level snap-share model (+8.2% over persistence on
weeks where a change signal fires). A game-line power rating was built, appeared
to beat the market on Week 1, and was then shown to be noise when the sample
expanded. Infrastructure for data collection is written but not deployed.

---

## The architecture — three sections

This is the main organizing principle. Each section is true in a different way,
and collapsing them into one composite confidence score destroys all three.

| Section | Question | Contains |
|---|---|---|
| **The Board** | Where is the price wrong? | Line shopping, key numbers, alternate-line fair value, market coherence. Mostly arithmetic. **This is where the money is.** |
| **The Model** | What does the data say on its own? | Line-blind predictions, published and locked pre-kickoff, calibration tracked. **This is the trust engine.** |
| **Context** | What should I understand? | Weather, referees, injuries, trends, implied totals. All true, none an edge. **Explicitly not a pick driver.** |

**The design rule: panels inform, they do not vote.** Combining zero-edge signals
produces zero edge while the appearance of rigor rises sharply. That is the exact
machine the competition runs.

---

## Where to look for what

| File | Contents |
|---|---|
| `IDEA_TRACKER.md` | **Start here.** Every idea, its status, and why. Includes the architecture, language decisions, stack, and error log. |
| `EMPIRICAL_REFERENCE.md` | Every number measured, with sample sizes. Reusable — decisions change, measurements don't. |
| `ATTRIBUTE_CATALOG.md` | 31 team attributes tested against the closing line, plus ~25 untested ones with data requirements and P1/P2/P3 priority. |
| `CONFIDENCE_DESIGN.md` | Tier design and the Week 1 2026 board audit. |
| `TODO.md` / `TODO_SPLIT.md` | Build plan. The split version separates what needs accounts and money from what's just writing. |
| `ingest/` | Postgres schema, scrapers, name resolver, cron config. Written, not deployed. |
| `*.py` | Analysis scripts. All reproduce from public nflverse data on GitHub. |

---

## The handful of findings that shape everything

- **Volume persists, efficiency doesn't.** Carries 0.678, target share 0.623 vs
  yards-per-carry 0.058, receiving TDs 0.093. So never model yards directly —
  project volume, multiply by a regressed efficiency baseline.
- **The modellable zone is the middle of the depth chart** (35–60% snap share),
  not the back. Deep reserves are ~70% proportional error.
- **Margins land on exactly 3 in 15.0% of games**, 7 in 9.1%. A half point at 3 is
  worth ~9% of win probability — larger than any model edge realistically
  claimable on a game line. Never use a Gaussian where key numbers matter.
- **Point differential completely subsumes win-loss record** (coefficient −0.010
  vs +0.450). Never feed W-L into a rating.
- **The one live lead is wind.** Markets over-set totals by ~1.3 points at 15+ mph
  (56.1% unders, n=640). But it fails the vig bar by 0.18 points and uses
  *realized* wind — the real edge is forecasting better than the market prices.
- **Props are the only place edge plausibly remains**, because books price hundreds
  of markets semi-independently. Game lines at a single sharp book are internally
  coherent to within measurement error.

---

## What's next, in order

1. **Deploy data collection.** Practice trajectory cannot be backfilled — the
   Wed/Thu/Fri sequence exists only if captured on the day. Hard deadline of the
   season opener.
2. **Acquire timestamped multi-book odds history.** One purchase unblocks prop
   validation, line-movement modelling, reverse line movement, and CLV
   measurement. Nothing measurable happens without it.
3. **Build the Stage A availability model.** The whole player pipeline is currently
   conditioned on a player being active.
4. **Build the touch-share layer**, converting snap share into prop numbers.
5. **Build The Board**, which needs no model at all.

---

## How to work on this

**Respect the standing discipline.** A candidate enters the model only if it is
(1) observable and recorded historically, (2) has a mechanism stated in advance,
and (3) improves results **against the closing line**, out of sample. Fails any
one → it can be Context, not a model feature.

**Test before asserting.** Over the course of this project, seven separate
assertions were contradicted by the data — including four of mine that were caught
by automated checks rather than review. The error log in `IDEA_TRACKER.md` lists
them. The associated skill (`model-validation`) encodes the rules that came out
of it.

**Expect negative results and treat them as output.** "This is priced" is a
finding, and it saves building something useless. The project's value so far is
mostly in knowing what *doesn't* work.

**Two open items belong to Derek, not to analysis.** Whether media criticism
predicts beyond recent stats is his domain intuition against my expectation —
worth running rather than assuming. And the business model fork (subscription vs
affiliate) determines what the app is allowed to say, so it needs deciding before
confidence tiers ship.
