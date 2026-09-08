---
name: visual-audit
description: Audit StatSeer's boards for the bugs Derek keeps catching by eye — both LAYOUT (unequal card heights, overflow, dead space, invisible text, clipped or intercepted controls, duplicated headers, stranded collapse controls, the side rails) and the NUMBERS those boards publish (a projection that contradicts its own line, a board where every row leans the same way, stale week data, a scraped roster silently dropping players). Use for a maintenance-day pass, before a deploy, whenever asked to check the app or website for bugs, and whenever a number or arrow on a board looks wrong. Also carries the rules that stop self-inflicted breakage — never hand-edit an AUTO-GENERATED file, and why a passing local build is not evidence. Runs an automated DOM probe at desktop + mobile, light + dark, then reports ranked candidates for Derek to approve.
---

# StatSeer visual audit

## Why this exists
Derek used to find visual bugs by eye and screenshot them one at a time. ~80% of those fall into a
handful of mechanically-detectable classes. This skill drives the dev preview across a page checklist
and runs an in-page probe that flags those classes, so the job becomes *review a ranked list and
approve fixes* instead of *spot and screenshot*. Subjective calls (tone, "looks clunky", whether a CTA
says the right thing) still belong to Derek — the audit only surfaces candidates.

## Bug classes it detects
`page-overflow-x` (body scrolls sideways) · `unequal-row-height` (cards in a row differ in height) ·
`zero-size` (a button/img/badge that's visible but 0×0 — the "green ring not showing" family) ·
`clipped-text` · `low-contrast-text` (the filled-bar-blank / invisible-text family) ·
`click-intercepted` (a control covered by an overlay — the "move button doesn't work" family) ·
`broken-image` · `bubble-overflow` (text spilling past a pill/badge/chip's rounded edge — the mobile
"text bleeding over bubbles" bug: a small rounded, filled element whose content extent exceeds its box) ·
`split-group` (a day/group header repeats within one board — the signature of a capped list rendered as
two sub-tables/`<details>`, which duplicates the header and strands the collapse control mid-list) ·
`off-center-content` (a fixed sidebar reserved via padding centres content in the REMAINING space, so
the page reads as "shifted right") · `grid-dead-space` (`repeat(auto-fill, …)` keeps empty tracks when
items < columns, leaving a block of dead space — `auto-fit` collapses them) ·
`chart-truncated-with-space` (a cell ellipsizes its text while its row still has unused width) ·
`repeated-row-label` (consecutive rows repeat the same first-cell text — the "double names" bug) ·
`nav-alignment-mismatch` (one header/nav row doesn't share the alignment of its siblings) ·
`full-bleed-short` (a hero/banner with negative margins stops short of the viewport edge — a container
gutter it doesn't cancel) · `table-overflows-container` (a chart needs a horizontal scrollbar on a wide
screen — usually the per-column widths don't cover every column) · `rail-asymmetry` /
`rail-uneven-rows` / `rail-overflows` / `rail-overlaps-content` (the side rails — see below) ·
`stranded-disclosure` (an open "show more" whose Collapse control has content above AND below it) ·
`chart-header-order` (a chart header's dashboard button isn't hard right, or the scroll tooltip
drifted past it) · `uncapped-long-list` (a long item list with no "show more" control) ·
`orphaned-continuation` (a grouped list whose first row has a blank leading label) ·
`all-cards-collapsed` (every per-game card on a board is closed, so nothing reads without a click) ·
`repeated-column-header` (the column row reappears mid-board, chopping one chart into several) ·
`content-escapes-card` (a row's border box is narrower than the content it wraps — the last columns
draw *outside* the card instead of scrolling; `overflow-x` on the flex column itself) ·
`chart-split-scrollers` (one chart rendered as two tables, so each half scrolls sideways
independently and the second half has no header) ·
`panel-half-empty` (a panel's content stops well short of its width, so the card reads as broken —
usually a `max-width` in `ch` on the copy with nothing else using the space) ·
`chart-header-misaligned` (a chart's column header does not sit over the data it labels — compares
the header cells' LEFT EDGES against the first data row's, so it catches a wrong `display`, a
column-count mismatch and a stray colspan alike).
Console errors + network 4xx/5xx are collected separately (see step 4).

### 🚨 Never hand-edit an AUTO-GENERATED file
Several `web/lib/*.ts` files are written by scripts and rewritten by scheduled jobs. Anything added to
one by hand is silently wiped on the next refresh. **Before editing any file under `web/lib/`, check
its first line:**

```bash
head -1 web/lib/<file>.ts | grep -i "AUTO-GENERATED"
grep -rl "AUTO-GENERATED" web/lib/          # the current list
```

Known generated files: `playerProjections.ts`, `ncaafPlayerProjections.ts`, `ncaafDepth.ts`.

This took production down. Four helpers (`projLean`, `leanCentres`, `hasProjSample`,
`MIN_PROJ_GAMES`) were added to `playerProjections.ts`, whose first line reads *"AUTO-GENERATED by
analysis/player_proj_export.py — do not edit by hand"*. The nightly `chore: refresh projections` job
regenerated it, wiped all four, and every build failed with `Module has no exported member
'projLean'` — two Vercel deploys and two CI runs.

**Put hand-written code in its own module** and import only the generated *data and types* from the
generated one (`lib/projLean.ts` does exactly this). If a helper feels like it belongs beside the
data, that is precisely the instinct to resist.

### ⚠️ A passing local build is not evidence the commit is safe
The failure above was invisible locally for hours: the working copy still had the hand-added exports,
so `tsc` and `next build` both passed, while CI checked out the regenerated file and failed. **A
generated file can drift out from under your working copy.**

When a change touches anything generated, verify the way CI does — from a clean state, not a warm one:

```bash
rm -rf .next/types && npx next typegen && npx tsc --noEmit -p tsconfig.json
```

Same reason a clean checkout fails with `Cannot find name 'PageProps'`: Next 16 writes those globals
into `.next/types`, and a warm local tree already has them.

### ⚠️ Verifying against a Next page: two traps that give WRONG answers
Both of these produced confidently wrong conclusions in one session. When a measurement contradicts
what you can see, suspect the measurement.

1. **`curl` on a Next page returns an RSC flight payload, not DOM order.** Class names appear in the
   serialised stream in a different order than the rendered page, so substring-position checks
   "prove" the wrong element order. Reading a chart's *content* from curl is fine; reading its
   *layout or ordering* is not — use the browser DOM for that.
2. **The DOM can hold a second, hidden copy of a subtree.** React streaming SSR leaves a Suspense
   placeholder (`<div hidden id="S:0">` with `$RS`/`$RT` scripts) alongside the live tree, and the dev
   preview sometimes keeps a stale duplicate too. `querySelector` may hand you the hidden copy, which
   measures `display:none` and 0×0. Tell-tale: query something common (`.leftrail__icimg`) and see
   two matches, one 0×0. **Filter by `checkVisibility()` or a non-zero rect, and when a probe reports
   something impossible, screenshot it before believing it.**

### ⚠️ Numbers on a board are auditable too
This skill started on layout, but the highest-value findings have come from reading the numbers a
board publishes. **A board whose every row leans the same way is a bug, not a signal.** Derek spotted
"every RB is going over" by eye; measuring it found a systematic error across two sports.

When a board shows a projection beside a market number, check the lean split before trusting it:

```python
over = sum(1 for r in rows if r['proj'] > r['book'])   # ~50% expected on a fair board
```

- NCAAF player props leaned OVER on **90% of rushing rows and 100% of receptions**.
- 46% of rows leaned OVER on players whose **own history cleared that same number less than half
  the time** (Daniel Hill: line 57.5, projection 75.1, cleared it in 1 of 17 games).

**Root cause — mean vs median.** The projection was a recency-weighted MEAN; a book sets its line
near the MEDIAN; yardage and reception distributions are right-skewed, so one big game drags the mean
above the middle and `proj > line` fires almost always. The fix is `projLean()` in
`lib/playerProjections.ts`: read the lean from the player's empirical exceedance rate at that line,
shrunk toward 50% so a short sample shows no arrow at all.

**The control that proves it is distributional**: anytime TD was unaffected (36% over in both
sports) because there `proj` and `book` are both probabilities — like-for-like. When you find a
one-sided board, look for the market that ISN'T biased; it usually names the mechanism.

The NCAAF game model does NOT have this bug — it already centres on the median of the residual vs
market (`debias = statistics.median(_resid)`, `total_debias` likewise in `cfb_export.py`), added for
exactly this reason. Game margins and totals are near-symmetric anyway, so mean ≈ median there.

**A one-sided board is a SYMPTOM, and it has two possible causes. Measure which before you fix it.**
The MLB game model board came up **13 of 15 over the market, median +0.7 runs** — the exact
signature above. The obvious diagnosis was ours: the league anchor was a full-season mean of 8.96
while the market priced that night at 8.20, so the level looked stale. A trailing-window league mean
was written to fix it.

**The sweep said no.** Model MAE by window on the train split: 150 → 3.5328, 300 → 3.5506,
450 → 3.5489, 600 → 3.5468, 900 → 3.5446, expanding → 3.5444. A 0.3% spread across a 9× range, and
**not monotonic** — which is what noise looks like, and the tell that a knob is not a lever. Against
actual runs the mean signed error was **+0.01**: unbiased. The lean was entirely against the
*market*, not against reality.

So the two causes are:
- **Our level is wrong** — the projection disagrees with what happens. Shows up as a non-zero mean
  residual vs OUTCOMES. This is a bug and must be fixed before publishing.
- **The market disagrees with us** — the projection matches outcomes and the market is elsewhere.
  This is not a bug, and "fixing" it by pulling toward the market destroys the line-blindness that
  makes the board worth anything.

```python
resid = statistics.mean(r["proj"] - r["actual"] for r in held_out)   # ~0 => not our bug
over  = sum(1 for r in board if r["proj"] > r["market"]) / len(board) # lean vs MARKET
```
**Never diagnose a lean from the market column alone** — that column cannot tell the two apart. And
when it turns out to be the second case, say so ON the board: a reader who notices that almost every
row points one way will assume the first case unless you show them the residual.

**Two leaks found while chasing this, both worth grepping for elsewhere.** `State.lg` was
`mean(g["total"] for g in games)/2` over the WHOLE list, held-out games included, so every
projection's league anchor had seen the future; and `validate()` scored the baseline as `2 * st.lg`
*after* the walk-forward loop, giving the baseline a final-state number the model never had. The
second is the more dangerous shape because it flatters **the thing the model must beat**, so it
understates the model and you will not go looking. Capture a baseline at prediction time, inside the
loop, next to the prediction.

### 🚨 A column whose value is the SAME on every row is telling you nothing
Derek: *"I'm seeing too many favorites and too many overs."* The favourites half was not the model
at all — it was a column that could only ever print one number.

The MLB board carried a "run line" column fed by football's `spread.consensus`. **Baseball's run
line is a fixed ±1.5 on every single game**, so the column printed `-1.5` down almost every row,
`+1.5` occasionally, and once `0` — which is not a real baseball line, and was the tell: it is the
median of `[-1.5, +1.5]` from books that disagreed about which side was favoured. A board of `-1.5`s
reads as "we make everyone a big favourite" when it actually says nothing at all.

**Check every board column for degenerate variance before trusting what it appears to claim:**
```js
const vals = rows.map(r => r[colIndex]);
new Set(vals).size   // 1-2 distinct values across 15 rows = the column carries no information
```

**The general rule: a football concept does not transfer to another sport just because the code
compiles.** `lib/mlbBoard.ts` already documented that football KEY NUMBERS don't carry to MLB; the
spread's POINT was the same problem one field over and got shipped anyway. When reusing a board
engine across sports, list what each column MEANS in the new sport, not just whether it renders.

In baseball the size of a favourite lives in the moneyline, so `marketMargin()` de-vigs the two
prices to a fair home win probability and converts it to runs through the measured margin spread:
`margin ≈ SD × probit(p)`, SD = 4.63 measured over 1,859 games. That makes the market column
directly comparable to our own expected margin — probability-to-runs on one side, runs on the
other, same units, same sign convention.

**And measure the complaint before believing its diagnosis.** "Too many favourites" sounds like an
overconfident model, so the obvious move is to shrink the margins. Measured, the opposite was true:

| | ours | actual |
|---|---|---|
| mean abs margin | **0.61** | **3.60** |
| sd | 0.80 | 4.63 |

A shrink sweep chosen on the train split picked **1.0 — no shrinking at all**, and the direction was
right (we say home by >1 ⇒ actual averages +1.19; away by >1 ⇒ −1.10). The model was far too
*timid*, not too bold, which is the 0.0% team-quality finding seen from the other side. Shrinking
on the strength of the screenshot would have made a correct model worse to fix a broken column.

### 🚨 A Brier score is NOT a calibration check
The MLB hits board read **78.7% over the book's de-vigged probability, mean +4.9pp** on 630 rows.
The model's published score said it was fine — Brier 0.2364 against 0.2406 for the batter's own
rate, +1.8%. Both statements were true at once, because **a Brier score can improve while every
number on the board sits above the truth.** Only the calibration says so:

| market | predicted | realized | bias |
|---|---|---|---|
| hit | 0.627 | 0.606 | **+2.1pp** |
| home run | 0.119 | 0.110 | +1.0pp |
| stolen base | 0.070 | 0.065 | +0.5pp |

Every market high, in every probability bucket. So `validate()` now prints mean-predicted against
mean-realized, plus a bucket table, next to every Brier it reports. **Any board publishing a
probability owes this table** — the whole trust premise is calibration anyone can check, and a
Brier number alone does not let them check it.

**The mechanism was Jensen's inequality, and it is worth knowing by name because it recurs.**
`P(≥1) = 1 - (1-q)^PA` is CONCAVE in PA, so `E[1-(1-q)^PA] < 1-(1-q)^E[PA]`: feeding it the *mean*
plate appearances for a batting slot overstates the answer versus averaging over the real spread.
A leadoff hitter does not take 4.49 plate appearances; he takes 3, 4 or 5, and sometimes 1 because
he was lifted — and the short games cost more than the long ones give back.

**Whenever a mean is fed into a non-linear function, the result is biased**, and the sign is
predictable: concave ⇒ overstated, convex ⇒ understated. Average the function over the
distribution instead. Fixing it moved hits from +2.1pp to +1.4pp and improved Brier as well
(0.23639 → 0.23612), which is the shape of a real fix — a correction that only moved the
calibration would be suspect.

**Do not close the rest by scaling.** The residual +1.4pp is within-game correlation: four trips
against one starting pitcher on one night are not independent trials, and an independence model
cannot express that. Multiplying the output until the gap vanishes fits the answer, not the
mechanism, and the board would then be lying twice — once about the number, once about why.
The remaining gap is published on the page instead.

**Related check — a UI must never ASSERT calibration.** The board's copy read "the probability is
well calibrated." Nobody had measured it; when someone did, it was 2.1pp out. Same failure family
as the hardcoded `is-online` class: the page stated a fact it never checked. It now prints the two
numbers and the gap.

### A week-scoped board must be able to say WHICH week its data is for
`/ncaaf/model/players` rendered week 1's games on every week of the season. The generated data set
carried `season` and `prior` but **no week**, so the view gated on `projections.length > 0` — true
for every week — instead of on a week match. The NFL side gated correctly on `week === PROJ_WEEK`;
only NCAAF had no week to compare against.

**The rule: if a generator emits a slate for one week, it must stamp that week, and the view must
gate on it.** A truthy-length check is not a week check. Whenever you add a week wheel to a board,
verify the data actually changes with the week — a nav that changes only the badge is worse than no
nav, because it looks authoritative.

Verify by diffing two weeks rather than trusting the badge:

```bash
curl -s "$BASE/ncaaf/model/players?cat=rushing"        | grep -c 'pmrow--data'   # 234
curl -s "$BASE/ncaaf/model/players?cat=rushing&week=5" | grep -c 'pmrow--data'   # 0
```

Identical counts across two different weeks means the board is ignoring the week. An empty board off
the projection week is the CORRECT answer — better than confidently showing stale games.

Watch for the sibling shape too: a data fetch that takes no week at all (`cfbWeekProps()` has no week
argument) can only ever return "current", so it silently pairs whatever it holds with any week you
select.

### An indicator must sit with the number it describes
A ▲/▼ rendered inside the "OUR PROJ" cell is read as a claim about that projection — always, no
matter what it is actually computed from. After the lean moved to an exceedance rate, the board
showed `193.2 ▼` against a 180.5 line and `194.5 ▲` against a 232.5 line: both arrows pointing the
opposite way to the two numbers beside them. The statistics were right and the placement made them
look broken.

**Put the indicator on the column it is derived from**, and make the arrow, the colour and the figure
one statement — the lean now lives on the % over cell and inherits that cell's red/green. Watch for
the sibling bug: a colour threshold that disagrees with the indicator (a flat 50% cut while the arrow
compares to a 22% baseline) reproduces the same contradiction one column over.

### Projection sanity: the projection ÷ line ratio
For a player who clears his line about half the time, **the line IS his median**, so a projection
should sit near it — a little above, since a mean exceeds a median on a right-skewed stat, but not
multiples above. That makes a one-line calibration test:

```python
rows = [r for r in proj if r['book'] and r['cat'] != 'td' and r['cG'] >= 8]
mid  = [r for r in rows if 0.40 <= r['cOver']/r['cG'] <= 0.60]   # line ≈ his median
statistics.median(r['proj']/r['book'] for r in mid)              # want ≈ 1.0
```

Measured: **NFL 1.01** (healthy) vs **NCAAF 1.52, worst 3.44×**. Elija Lofton cleared a 16.5 line in
10 of 19 games — his median is 16.5 — while we projected 56.7. A number multiples above a player's
own median is a defect, not skew. Run this test per sport after any change to the projection pipeline.

**The mechanism — a one-way ratchet.** `rolevol()` in `cfb_player_proj.py` returned
`max(role_baseline, own_recent)`, so it could only push volume UP. A player whose depth slot is
generous was handed the ROLE's workload however far below it his own history sat: Lofton's projected
4.9 receptions is *exactly* Miami's WR1 baseline × `TE_VOL_FACTOR`, not anything he had done. That
volume then multiplies through his own efficiency into the yardage number.

Whenever a projection looks inflated, check whether it equals a **role baseline** rather than
anything the player produced — that equality is the tell. `ROLE_VOL_CAP` (1.6) now bounds the lift
against demonstrated volume, which moved the NCAAF board from median 1.31 / 21% of rows ≥2× the line
to **1.06 / 3%**. It is a blunt clamp on the symptom; the open question is why CFB own-volume reads
so low against the role baseline in the first place.

A cap fixes a tail, not a level: the small well-sampled subset still ran 1.45 afterwards against the
NFL's 1.01. **Re-measure both the tail and the median — a headline number can improve while the bias
you were chasing is still there.**

### 🚨 A projection must not contradict the history printed beside it
The cheapest number check in this file, because the board does the work for you: **every row shows
its own evidence, so read the row.**

Derek asked whether Jawhar Jordan really had a 31.9% chance to score against a 7.7% market. The same
line answered it — `CAREER TD RATE 0% · 0/4 gm`. Adam Prentice was worse: **0 touchdowns in 41
games, published at 10.5%**. A reader does not need any of our methodology to see that is wrong.

```python
# anytime TD: never scored, yet projected above the book
[r for r in rows if r["cat"]=="td" and r["cOver"]==0 and r["cG"] >= 10 and r["proj"] > r["book"]]
# yardage: projected far from what he has actually done
[r for r in rows if r["cG"] >= 8 and not 0.5 <= r["proj"]/max(r["book"],1e-9) <= 2.0]
```

Both had the same root cause, and it is one worth stating on its own: **the projection deliberately
ignored the player's own history.** TD projection was volume × league TD-per-touch, justified by
"scoring doesn't persist" (receiving TD r=0.093 — true!). The finding was right and the conclusion
went one step too far. Measured on 33,861 player-games:

| | Brier |
|---|---|
| volume only (what shipped) | 0.14028 |
| blended with own rate, k=40 | **0.13895** |
| own rate only | 0.15160 |

Own rate alone IS worse — the original finding holds. It is still not worth *zero*. When a finding
says "X barely persists", the correct weight is small, not none, and the difference between those
is visible on the board.

### 🚨 Projecting last season's role
The other half of the same bug, and the bigger one. Jordan played 4 games in 2025 at **10.8 carries**
and is **RB3** now; 10.8 carries × league TD-per-carry is exactly 31.9%. The arithmetic was right and
the role was a year out of date. A typical RB3 gets **2.7** carries.

Measured per-game volume by current depth rank (2025):

| rank | RB car/g | WR tgt/g | TE tgt/g |
|---|---|---|---|
| 1 | 15.0 | 7.5 | 5.0 |
| 2 | 6.2 | 5.4 | 1.9 |
| 3 | **2.7** | 3.8 | 1.8 |

Blending a player's prior volume toward his CURRENT rank beats both extremes — predicting actual
per-game volume, n=700 player-seasons: prior-only **1.609**, blended k=12 **1.158**, role-median-only
**1.302**. That the blend beats *both* is the tell that each carries something the other lacks.

**It fixed both tails, not just the reported one**: Josh Allen 28.2% → 43.8% (market 43.5%) and
David Montgomery 28.7% → 45.0% (market 50.7%) had been badly UNDER. A role-blind projection is
wrong in both directions; only the inflated half gets reported, because only that half looks silly.

**Do NOT tune until the number matches the book.** Jordan sits at 16.4% against 7.7% and is left
there: 0-for-4 is genuinely weak evidence and a line-blind model is allowed to disagree. Closing
that gap on purpose would mean reading the number we are supposed to be blind to. Fix the mechanism,
then publish whatever it says.

### 🚨 A parser that matches nothing reports success
`current_ranks()` returned **zero entries** and disabled the entire role correction, while the run
printed its normal output and exited 0. The cause: nflverse names those columns `pos_abb` and
`player_name`; the code looked for `position` and `full_name`. Neither raises — the filter just
matches no rows.

This is the THIRD form of the same failure in this file, so treat the shape as the lesson rather
than the instance: a truncated page looks complete, a regex written for double-quoted JSON reports a
clean zero against a single-quoted TS literal, and now a column rename silently switches a feature
off. **An empty result is a claim, and it needs the same proof as a non-empty one.**

```python
if not out:
    print("WARNING: parsed ZERO entries — column names may have changed", file=sys.stderr)
```

Assert non-empty at every parse boundary, print the count on success (`1857 on the depth chart`),
and treat a silent zero as a failure rather than as "nothing to do".

### A scraped roster must never GATE who appears
`cfb_player_proj.build_slate` walked the depth chart only, so a player absent from the scraped chart
was invisible however the books priced him. Malachi Toney was the market's **second shortest price**
in his game (−250 to score) and had no row at all, while our chart's "WR1" sat at +350.

Not a stale scrape and not a name-matching artifact: a live `--probe` returned the same six Miami
receivers with no Toney, and "Toney" appeared nowhere in `cfb_depth.json`. Ourlads lags the transfer
portal and lists only a handful per position. **Measured: 195 of 813 players with posted props — 24%
— were missing from the chart entirely**, and every one was being dropped.

A posted prop is the market saying a player matters, so he now gets projected whether or not he is on
the chart. Once added, Toney projected 72.3 against a 73.5 line and 7.0 receptions against 6.5 — the
board had been silently omitting one of its best-calibrated rows.

**This does not break line-blindness**: it uses the EXISTENCE of a prop to decide who appears
(coverage, already prop-driven), never its VALUE. Keep that line sharp — using the book's number to
set a projection would.

Generalise: whenever a scraped reference list decides *who gets shown*, measure how many entities the
authoritative source has that the list lacks. A roster, a schedule, a team list — any of them can
silently truncate a board.

### 🚨 A paged read that stops at the cap looks EXACTLY like a complete one
The single highest-yield check in this file. **PostgREST caps every response at 1000 rows and does
not tell you.** `&limit=5000` does not raise the ceiling — it returns 1000 and looks finished. A
truncated read is not an error, is not logged, and produces a board that is merely *smaller* than it
should be, which reads as "the data isn't there yet."

Measured on the 2026-09-05 NCAAF slate: `cfb_player_proj.sb_get` was one un-ranged request. The
latest snapshot held **4,167 rows; it returned exactly 1,000**, and since the query was unordered,
*which* 1,000 was arbitrary. Downstream, `fetch_props()` saw **7 of 35 games and 145 of 716 priced
players** — 28 games with no prop coverage at all, and starters with posted lines (Keelon Russell,
244.5 passing yards) had no row on the board. After paging: 247 → 1,109 player-markets, 7 → 35 games.

Two tells that a read is truncated:
```python
len(rows) == 1000          # or == whatever PAGE size — never a coincidence at a round number
len({r["event_id"] for r in rows}) < len(expected_events)
```

**The rule: every Supabase/PostgREST read pages until a SHORT page comes back.** Never trust
`limit=`. `pg()` in `analysis/player_proj_export.py` is the correct pattern; `sb_get` in
`cfb_player_proj.py`, `sb_get` in `cfb_tailgate_reddit.py` and `_get` in `grade_predictions.py` were
all fixed to match. When you find one, **grep the siblings** — the same helper is copy-pasted per
script:
```bash
grep -rn "rest/v1" --include=*.py . | grep -v Range     # reads with no Range header
grep -rn "limit=[0-9]\{4,\}" --include=*.py .           # limits above 1000 = false confidence
```
`grade_predictions._get` is the one that would have hurt most: it read the set of already-graded
prediction ids to dedupe. Past 1000 graded rows the dedupe silently fails and the **published track
record** accumulates duplicate grades. It was caught while the table still had 0 rows — latent, not
yet firing. A truncation bug is usually found *before* it does damage only if you go looking.

### 🚨 A player's team comes from the CURRENT roster, never from his game log
This bug has now appeared in **both** sports from **different** code, which is why it gets its own
entry: the NFL version keyed off last season's stats team, the NCAAF version off the CFBD game log.
Same mistake, same two symptoms.

Derek caught it as *"Tayven Jackson (QB1, **Indiana**)"* — he is North Texas's QB1. The rank was
right and the team was wrong, because `team_logs` takes a player's team from wherever he last
played and builds the map with `setdefault` over an **alphabetically sorted** team list. For a
transfer that means his team is whichever school sorts first: "Indiana" beat "North Texas".

**The visible symptom is the small half.** `build_slate` drops any player whose logged team is not
in the game, so a transfer vanishes entirely unless he happens to be facing his old school — which
is exactly why the only three visibly-mislabelled players were all playing their former team. The
survivors are the ones you can see; the rest are silently gone.

Measured on the 2026-09-05 NCAAF slate, before the fix:
| | |
|---|---|
| rows disagreeing with the depth chart | 3 (all facing their old school) |
| priced players on the board | **292 of 716 (41%)** |
| priced players WITH a depth-chart entry and no row | **345** — 35 QB1s, 30 RB1s, 36 WR1s, 35 TE1s |

After re-tagging from the scraped depth chart: **441 players re-tagged, rows 464 → 726, coverage
41% → 62%, mismatches 3 → 0.**

**The rule: the roster source is the authority on which team a player is on NOW; the game log is
only the authority on what he DID.** Re-tag before anything reads `team` — role baselines and every
in-game guard key off it. NFL uses `roster_<season>.csv` joined on `gsis_id`; NCAAF uses
`current_team_map(depth)` from the scraped chart.

**Two follow-on rules that came out of finishing this fix:**

**Fetch history beyond the entities on screen.** `team_logs` pulled logs only for teams *playing
this week*, so a transfer whose old school wasn't on the slate had no log anywhere and was dropped
even after the team re-tag — 274 priced players. Pulling all 138 FBS teams took coverage to 68%,
and it is nearly free because completed seasons are immutable and cached per team-season. **Where a
player's history lives is not the same question as which teams are on the board.**

**Key player records on a STABLE ID, never on a name.** Once logs cover 138 teams instead of 86,
name collisions stop being exotic: **191 normalised names matched more than one athlete.** A
name-keyed dict silently merges two different players' game logs into one projection, and nothing
about the output looks wrong. CFBD returns an athlete `id` on every stat line — key on that, then
collapse to names at the very end, resolving collisions deliberately (prefer the athlete whose
schools include the team the depth chart says that name is on now; fall back to most games).

Note the distinction the collapse has to preserve: **a transfer is one athlete id with two schools
and both his log sets are wanted; a collision is two athlete ids sharing a name and only one is
wanted.** Treating them the same way corrupts one or the other.

Standing check, both sports — this is cheap and catches it instantly:
```python
mismatches = [r for r in rows if depth.get(nkey(r["player"]), {}).get("team") not in (None, r["team"])]
# must be 0
```
Watch the parser: `ncaafDepth.ts` is double-quoted JSON, `depthChart.ts` is single-quoted TS object
literal. A regex written for one silently matches **nothing** in the other and reports a clean zero
— which is a false pass, not a pass. Assert the entry count before trusting the result.

### 🚨 Never join a player to LAST season's team
`player_proj_export` took each player's team from his most recent game log — i.e. the team he played
for **last** season — and then dropped any player whose team was not in the game the book priced him
in ("bad source row"). That guard silently deleted **every player who changed teams in the
offseason**, which is exactly the set the books price most heavily.

Measured on the 2026 Week 1 board, all with posted lines and no row: A.J. Brown (PHI→NE), Mike Evans
(TB→SF), DJ Moore (CHI→BUF), Geno Smith (LV→NYJ), Kyler Murray (ARI→MIN), Tua Tagovailoa (MIA→ATL),
Travis Etienne (JAX→NO), David Montgomery (DET→HOU), Michael Pittman (IND→PIT), Rico Dowdle
(CAR→PIT), Stefon Diggs (NE→WAS), Jauan Jennings (SF→MIN). Teammates who *stayed* — DeVonta Smith,
Saquon Barkley — came through fine, which is the signature to look for.

**The book had them on the right team the whole time; we were holding last year's roster.** Fixed by
re-tagging from `roster_<season>.csv` (nflverse) joined on `gsis_id`, never on name. Usage still
comes from last season — that is the projection — only the team LABEL is refreshed. Off-team drops
went ~120 → 14, rows 593 → 701.

Generalise: **when our data and the market disagree about a fact the market cannot be wrong about**
— who is on which roster, who is playing in which game — the market is right and our reference is
stale. Never resolve that disagreement by dropping the row silently. Count the drops and print them;
this bug was invisible because `offteam` was appended to a list nobody read.

### 🚨 A BEM modifier declared BEFORE its base rule silently loses
`.docknotif--rail{position:fixed}` and `.docknotif{position:absolute;right:62px;bottom:0}` are both
single-class selectors — **equal specificity (0,1,0)** — and the modifier sat ~80 lines earlier in
globals.css. So the base won on source order, the notifications popup stayed `absolute` inside the
rail's overflow-clipped box, and the button looked dead. This shipped **twice**, because the fix
read correctly and was never opened in a browser.

`element.className` looking right tells you nothing. Check the COMPUTED value:
```js
getComputedStyle(el).position     // the only answer that counts
```
**The rule: a `--modifier` block goes AFTER its base block, and gets doubled up
(`.block.block--mod`, 0,2,0) when it overrides positioning or layout.** Then neither source order
nor a later insertion can revive it. Also check narrow-screen rules — a `@media` override on the
base (`.docknotif{right:0;bottom:62px}`) drags the modifier back too unless it is answered.

Grep for the shape after any CSS fix that "didn't take":
```bash
grep -n "^\.block" web/app/globals.css   # is the --modifier line number BELOW the base's?
```

### When a guard blocks YOUR fix, check whether the fix was worth making
A repair for the 14,007 mis-stamped `prop_snapshots` rows was refused by the database:

```
ERROR: P0001: append-only table: UPDATE on prop_snapshots is not permitted
CONTEXT: PL/pgSQL function block_mutation() line 3 at RAISE
```

The instinct is to look for a way around it — disable the trigger, grant UPDATE, re-enable. Resist
it. **A guarantee is worth exactly as much as the number of times it has been bypassed**, and "we
were sure this time" is how one dies. The append-only tables (`prediction_ledger`,
`practice_reports`, `pressers`, `odds_snapshots`, `prop_snapshots`) exist so captured market data
and published predictions cannot be edited after the fact — which is the entire trust premise.

Then the second half, which is the actual lesson: **the block bought a second look, and the second
look said the repair was pointless.**

| 2026 prop rows | rows | keys | keys with >1 observation |
|---|---|---|---|
| legacy (`snapshot_at` = kickoff) | 14,007 | 13,295 | **5%** |
| healthy (post-fix) | 19,743 | 10,431 | **89%** |

CLV needs a *series*. The legacy rows have one observation per key because the dedupe collapsed
them; relabelling their timestamps would have given accurate times to data with no movement in it.
I had told Derek those rows would "become usable for CLV" — they would not, and I only checked
because the trigger made me.

**The rule: when an integrity guard refuses a change, treat it as a review, not an obstacle.**
Re-derive what the change buys before deciding how to get past it. Twice now the answer has been
"less than I claimed".

Read-side resolution here, costing nothing: `collected_at` held the true capture time on every row
all along, so anything needing a real capture time reads that. `snapshot_at` stays the shared sweep
key that `the_board.py` groups on.

### A fallback that becomes an identity is a bug, not a default
`handle_new_user()` names a new profile from the signup metadata and falls back to
`'member_' || substr(id::text,1,8)`. The email form collects a username, so it never fires. **Google
OAuth carries no username field**, so every Google member silently became `member_f315ce11` — and
that string is then their name in the forum, on their wall and in DMs, permanently.

Nothing errors, nothing looks broken, and the member has no way to fix it (the column grant
excludes `username` by design). It only surfaces when someone reads a members list and asks why
half the names are hex.

**The rule: when a signup path can't supply a field the product treats as identity, ask for it —
don't generate one.** `/welcome` + `claim_username()` (ingest/oauth_username.sql) does that; it
accepts *only* a `member_[0-9a-f]{8}` placeholder and deliberately leaves `username_changed_at`
null, so the first real choice doesn't consume the one-time rename that email signups keep.

Generalise past usernames: any `coalesce(<from the user>, <generated>)` in a trigger is worth a
look. Ask which signup paths actually populate the first argument — if a whole provider can't, the
fallback is not a fallback, it is that provider's default state.

```sql
select count(*) from profiles where username ~ '^member_[0-9a-f]{8}$';  -- should trend to 0
```

### Verifying UI that only renders for a signed-in member
The rails and chat return `null` unless a member is signed in, which is why several fixes here were
shipped unverified. Do not sign in as Derek. Instead drop a **temporary probe route** that renders
the same markup with no auth, measure it, then delete it:

1. `web/app/cssprobe/page.tsx` with the component's markup and the panel forced open.
   **Not** a `_`-prefixed folder — the App Router treats a leading underscore as a private folder
   and never routes it (that 404 cost a round trip).
2. `preview_start {name:"web"}`, then `javascript_tool` to `location.href = "/cssprobe"`.
3. `document.documentElement.setAttribute("data-rail","1")` — the rail CSS is gated on that
   attribute, which only LeftRail sets for a signed-in member.
4. **`resize_window` to an explicit size first.** A hidden Browser pane reports `innerWidth 0`, so
   every `getBoundingClientRect()` is zero and *everything* looks invisible. And never `await`
   `requestAnimationFrame` in a hidden pane — rAF is paused, so the call just times out.
5. Assert the things that actually matter, not just that the element exists:
   ```js
   getComputedStyle(pop).position
   pop.getBoundingClientRect().width > 0                 // really laid out
   pr.left >= railRect.right                             // escaped the rail
   rail.scrollWidth > rail.clientWidth                   // no sideways scrollbar
   document.elementFromPoint(pr.left+20, pr.top+20)      // nothing covering it
   ```
6. **Delete the probe route** before committing.

### When the dev page won't render, measure the CSS against a REPLICA
Some days the preview never gets past `Loading…` and every element you query measures 0×0 inside
`<div hidden id="S:0">` — React's streaming placeholder. That is not the layout bug you were
chasing; it means the page's data never arrived, so the Suspense boundary never resolved. Two
causes seen so far:

- **TLS**: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` in `preview_logs` — Node can't verify Supabase's chain.
  Fix in `.claude/launch.json`: `"env": {"NODE_OPTIONS": "--use-system-ca"}`.
- **401s from the anon lockdown**: the signed-out QA preview hits tables `anon` can no longer read,
  a client component throws, and hydration never completes. Expected locally; not a product bug.

**The fix that makes a whole audit possible: splice `#S:0` into place yourself.** The server
finished — the complete, correct markup is sitting inside that hidden div; only the client-side swap
failed. Move it into the live tree and the page lays out normally, with the real stylesheet at the
real width. Run this right after `navigate`, before the probe, on every page:

```js
(()=>{const h=document.getElementById('S:0'), s=document.querySelector('.siteshift');
  if(h&&s&&h.children.length){const f=s.querySelector('main.wrap'); if(f) f.remove();
    h.removeAttribute('hidden'); h.style.display='contents'; s.appendChild(h);}})();
```

Caveat to state when reporting: the spliced tree is **not hydrated**, so geometry, contrast and
overflow are all trustworthy while anything depending on React event handlers is not. Every finding
in this file's last audit was geometric, so it cost nothing there.

If even that fails, a layout question is still answerable **without the page**, because the real
stylesheet is already loaded: inject a replica of the markup at the real container width, measure,
then flip the property back to the old value and measure again.

```js
const host = document.createElement('div');
host.style.cssText = 'width:301px;position:absolute;left:0;top:0;';   // the REAL container width
host.innerHTML = `<div class="imp-scroll" id="S"><div class="imptable" id="T">…one real row…</div></div>`;
document.body.appendChild(host);
const R = id => { const e = document.getElementById(id); return {w: Math.round(e.getBoundingClientRect().width), sw: e.scrollWidth}; };
const after = {scroll: R('S'), table: R('T')};
T.style.overflowX = 'auto'; T.style.minWidth = 'auto'; S.style.overflowX = 'visible';   // the OLD rule
const before = {scroll: R('S'), table: R('T')};
host.remove();
```

Two things make this trustworthy rather than a toy: take the container width from a real
measurement of the live page, and **check that `before` reproduces the numbers you measured on the
broken page**. When the replica's `before` matched the live `.impgame` exactly (301px box, 554px
content), the `after` was believable. If `before` doesn't reproduce, the replica is wrong — fix it
before trusting anything it says.

### A control that OPENS a panel in place must CLOSE it on the second click
Every rail item that opens a panel rather than navigating — Chat, Friends, AI Slip Assistant, Saved
Slips, Message Us — force-set the open state on every event:

```js
const onOpenChat = () => { setActive("friends"); ... };   // never closes
```

So a second click did nothing, and the panel could only be dismissed via its own small ✕. The
button is the only affordance a user aims at; if clicking it again does nothing, the control reads
as broken. Notifications was already correct (`setNotifOpen(v => !v)`), which is the shape to copy.

**Two rules, and the second is what makes this non-trivial:**
- A control that opens an in-place panel toggles: `setActive(cur => cur === t ? null : t)`.
- **A TARGETED open must never toggle shut.** "Message *this* member" from a profile carries
  `detail.userId`, and the notification menu's "Unread messages" passes `detail.force`. Both must
  land you in the panel; closing it because it happened to be open already is the same broken-button
  feeling in reverse. Toggle on the plain click, force on the targeted one.

Controls that NAVIGATE (Creator Dashboard, My Analytics, Bankroll) are plain `<a>` links and are
correctly exempt — the page change is the feedback.

Audit sweep: for each rail/dock item, click it twice and confirm the panel is gone. Then check any
deep-link into that panel still opens it while it is already open.

### 🚨 `overflow-y:auto` clips SIDEWAYS too
Setting one axis to `auto` computes the *other* to `auto` as well — there is no "scroll vertically,
overflow visibly sideways". `.leftrail{max-height:...;overflow-y:auto}` therefore did two things
nobody intended: it clipped the notifications popup that was deliberately positioned outside the
rail, and it counted that popup toward the rail's scroll width, giving the rail a **horizontal
scrollbar that pushed the icons out of frame**. One cause, two unrelated-looking symptoms — the
popup bug and the "rails should not scroll like that" bug were the same line of CSS.

**The rule: any element with a scrolling axis states the other axis explicitly.**
```css
max-height:calc(100vh - 124px);overflow-y:auto;overflow-x:hidden;
```
And anything that must escape such a box needs `position:fixed` (with JS-measured coordinates),
not `absolute` — `absolute` is still clipped by an ancestor's overflow. `fixed` escapes *unless* an
ancestor sets `transform`, `filter`, `perspective`, `will-change` or `contain`, any of which makes
that ancestor the containing block and re-traps it. Check for those before assuming `fixed` is safe.

Detection:
```js
el.scrollWidth > el.clientWidth        // sideways scroll nobody asked for
```

### 🚨 `overflow-x` belongs on a WRAPPER, never on the scrolling flex/grid column itself
A table built as `display:flex; flex-direction:column; align-items:stretch` sizes each row to the
**container's** width, not to the content's. Put `overflow-x:auto` on that same element and the
container *is* the phone — so every row's border box stops at the viewport while its grid tracks
carry on past it. The rows do not scroll; they **spill out of their own card**.

Derek reported it as *"the model predictions are not contained within the chart itself"* — on
`/model` the market spread/total sat inside a bordered card and MODEL SPREAD / MODEL TOTAL drew
outside its right edge.

Measured at 375px, `.imptable` before and after (same stylesheet, same container):

| | `.impgame` box | its content | reads as |
|---|---|---|---|
| `overflow-x` on the table | **301px** | 554px | border cuts off mid-row, model columns outside it |
| `overflow-x` on a wrapper + `min-width:min-content` | **568px** | 566px | border wraps all five columns, one scrollbar |

**The rule:**
```css
.thing-scroll{overflow-x:auto;max-width:100%}          /* the scroller */
.thing{display:flex;flex-direction:column;align-items:stretch;
       width:100%;min-width:min-content}               /* grows to the widest row */
```
`min-width:min-content` is the half that does the work — without it the table stays viewport-wide
and nothing changes. Keep scroll hints and "show more" controls **outside** the wrapper so they
stay put while the table scrolls.

Detection — a box narrower than the content it draws a border around:
```js
[...document.querySelectorAll('.impgame,.refrow,.aurow,.pmrow--data')]
  .filter(e => e.checkVisibility() && e.scrollWidth > e.clientWidth + 1)
```
Correct siblings to copy: `.auscroll`/`.autbl`, `.chartscroll`/`.charttbl`, `.pmscroll`/`.pmtable--data`.
When you find one, grep for the shape — it is copy-pasted per board:
```bash
grep -n "overflow-x:auto" app/globals.css   # then check each: wrapper, or the flex column itself?
```

### 🚨 One chart, one scrollbar — a "show more" must not render a SECOND table
The sibling of the split-group bug, and the one Derek described as *"a chart that split the chart
in half and I had to scroll 2 different sections to the right."*

`/considerations` rendered the referee crews as `REF_STATS.slice(0, 6)` in one `.reftable` and
`REF_STATS.slice(6)` in a **second** `.reftable` inside a `<details>`. Both carried `overflow-x`,
so one chart had two independent horizontal scrollbars — scrolling the top half left the bottom
half where it was — and the second table had **no header row at all**, so its columns were
unlabelled once you scrolled.

**The rule: cap by hiding rows INSIDE the one table, never by slicing it into two.** Use the
`hb-moretbl` checkbox pattern — the rest of the rows get `hb-row--more`, and
`.hb-moretbl__chk:not(:checked) ~ * .hb-row--more{display:none}` reveals them in place. `ImpTable`
already documents this for day groups; the referee table was the last holdout.

Detection:
```js
// same table class appearing more than once in one panel = a sliced chart
[...document.querySelectorAll('.ctxsec,.hb-panel')].filter(p =>
  ['.reftable','.imptable','.autbl','.charttbl'].some(c => p.querySelectorAll(c).length > 1))
// and: a scrolling table with no header row
[...document.querySelectorAll('.reftable,.imptable')]
  .filter(t => t.checkVisibility() && !t.querySelector('[class*="--head"]'))
```

**Check the responsive rule before "fixing" the columns.** `.refrow` looks broken at 375px — two
cells measure 0×0 — but that is deliberate: a media query near `.ctxsec__h--big` reflows it to four
columns and sets `display:none` on Avg Total and Read. The real defect there was only the split.
A zero-width cell is a *candidate*, not a finding, until you have checked for a media query that
hides it on purpose.

### 🚨 A fixed CONTAINER captures clicks even when everything it holds is `pointer-events:none`
The collapsed phone dock hides its icons correctly — `.dock__icons{opacity:0;pointer-events:none}`.
But `.dock` itself is a `position:fixed` flex column still *sized* to hold them, and it had no
`pointer-events` of its own. The result was an **invisible 52×294px strip down the right edge of
every phone screen that swallowed taps** while painting only the handle at the bottom.

`elementFromPoint` told the whole story — before, at 375px on `/props`:

| point | hit |
|---|---|
| (320, 450) — the "Receiving" tab | `DIV.dock` |
| (331, 500) — the week nav | `DIV.dock` |
| (331, 600) — the slip bar | `DIV.dock` |

Three separate controls unreachable, none of them near anything the user could see. Afterwards each
point hits its real control and (331, 700) still hits `BUTTON.dock__handle`.

**The rule: `pointer-events:none` goes on the fixed container, `auto` on its children.**
```css
.dock{position:fixed;…;pointer-events:none}
.dock > *{pointer-events:auto}
```
Order matters: the mobile rule that sets `.dock__icons{pointer-events:none}` must come *after*
`.dock > *`, or a collapsed dock starts eating clicks again.

Audit sweep — for every `position:fixed` overlay, check whether its box is bigger than what it
paints:
```js
[...document.querySelectorAll('*')].filter(e => getComputedStyle(e).position === 'fixed'
  && getComputedStyle(e).pointerEvents !== 'none'
  && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)')
```

### An `<a>` with no colour rule is a dark-theme bug waiting to happen
"Reset it by email" on `/settings` had no CSS at all, so it fell back to the browser default
`#0000ee`. That is ~8:1 on a light card and **1.35:1 on the dark one** — invisible, while the
sentence around it measured 11.4. It only ever showed in dark mode, which is why it survived.

```js
[...document.querySelectorAll('a')].filter(a => a.checkVisibility()
  && /rgb\(0, 0, 238\)|rgb\(85, 26, 139\)/.test(getComputedStyle(a).color)
  && [...a.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
```

**The `childNodes` filter is the whole trick.** Without it the sweep returns every card-sized link
on the homepage, because a link wrapping `<h3>` + `<p>` inherits the UA blue while its children set
their own colours — 6 false positives to 1 real hit. Only an `<a>` with its own direct text can
actually paint blue. Fix with the house convention: `color:var(--accent);font-weight:600`.

### Auditing the LIVE site: the two pages the QA preview can never reach
`/creator` and `/settings` are the blind spot in every local pass, for two different reasons, and
both were audited for the first time via **Claude in Chrome** driving Derek's own signed-in browser.
Do not sign in as Derek; ask him to connect the extension instead.

- **`/creator` is a server component** — `redirect("/login")`, then `notFound()` for anyone who
  isn't the founder. The QA mock in `lib/supabase/client.ts` is client-only, so nothing local
  renders it. No probe route helps either; it is the *data* that is gated.
- **`/settings` renders locally** but the username card does NOT, because the QA mock's `profiles`
  read 401s under the anon lockdown. **Its absence locally is an artifact, not a bug** — confirmed
  present and correct on production. Never report that card missing from a local pass.

The hosted-probe trick (`cp web/qa/visual-audit.js web/public/`) does not work here: the live origin
can't fetch it, and localhost is blocked by CORS + mixed content. Paste a trimmed probe inline via
`javascript_tool` instead — page-overflow, content-escapes-card, zero-size, contrast, intercepted
clicks, unstyled links, unequal rows is enough to be worth the trip.

Two findings from that first live pass:
- **`.ccard__more a` ("Open the full inbox →") was unstyled**, same class as `.setcard__hint a`.
  Note the honest measurement: UA blue on the light card is **8.81**, and the accent is **5.08** —
  the fix *lowers* light-mode contrast. It is still right, because the same blue measured **1.35**
  on the dark card and the app has one link convention. Don't sell a consistency fix as a rescue.
- **"Creator Dashboard" is the only rail label that truncates** — 133px of text in a 122px slot.
  The 11px it needs is exactly the item's right padding, so this is NOT dead space and the label
  genuinely has no room. Resist "fixing" it by trimming rail padding or the gap: rail width, gutter
  and breakpoint are one arithmetic chain (see the rails section). Shortening the label is the safe
  change, and it is Derek's call.

### 🚨 A check bound to a CLASS NAME only finds the boards you already thought of
Derek: *"I'm already noticing the MLB sections have no dropdowns. Would this be caught in our audit
skill?"* The answer was no, and the reason is the shape of the check, not the threshold.

`uncapped-long-list` selected `.propq__list, [class*='__list']`. Football's boards happen to use
that naming; the MLB panels are tables of `.pmrow--data`, so **210 and 53 uncapped rows sailed
through a probe reporting zero findings**. A check written against the markup you had is a check
that goes quiet exactly when you build something new.

**Rewritten structurally.** A "long list" is any container whose children are mostly one repeated
class — that is what a row list IS, whatever it is called:

```js
const counts = new Map();
for (const k of kids) { const c = k.getAttribute("class") || k.tagName;
  counts.set(c, (counts.get(c) || 0) + 1); }
const top = Math.max(...counts.values());
if (top / kids.length >= 0.7 && top > 8) longLists.add(el);   // header may differ
```

Two mistakes on the way there, both worth keeping:

1. **The signature must be the MODAL child class, not `kids[0]`.** The first child of a board is
   the HEADER row, whose class differs from every data row beneath it — so a 54-row table scored
   1/54 and passed. The fixed check still reported clean on a page with 53 uncapped rows on it.
2. **"Is it capped?" must walk ANCESTORS, not just `parentElement`.** The `hb-moretbl` checkbox
   usually sits a level or two above the table (checkbox wraps scroller wraps table), so a
   correctly-capped board was still flagged. Walk up ~4 levels rather than assuming one shape.

**Test any new check in both directions before believing a clean sweep** — cap the board, confirm
silence; strip the control with `document.querySelectorAll('.hb-moretbl__chk').forEach(c=>c.remove())`,
confirm it returns. Both of the above passed a one-way test.

### 🚨 A chart header must carry the class that makes it a GRID
Derek: *"the chart headers are misaligned on the data they are representing."* Every MLB board had
it, from one missing class. `.pmrow{display:flex}` is the base and **`.pmrow--data` is what adds
`display:grid`**, so a header written as `pmrow pmrow--head` stays FLEX and packs its labels to the
left while the numbers below sit on grid tracks. Measured on `/mlb/model`: header cells at
[316, 364, 494, 596, 674, 749], data at [316, 542, 718, 834, 938, 1050].

The house convention is in `PlayerModelView.tsx`: `className="pmrow pmrow--head pmrow--data"`. All
three MLB boards omitted the third class. `.pmrow--head.pmrow--data{border-bottom:0}` exists
precisely because the header is expected to carry both.

**Reading the CSS cannot find this, which is the part worth remembering.**
`getComputedStyle(head).gridTemplateColumns` cheerfully returns
`"minmax(210px, 1.7fr) 100px …"` on a flex container — the property is declared, it computes, it is
simply not in effect. Only the rendered geometry tells the truth. So `chart-header-misaligned`
compares **left edges**, header cell against data cell:

```js
const off = headCells.map((c, i) =>
  Math.round(c.getBoundingClientRect().left - dataCells[i].getBoundingClientRect().left));
if (Math.max(...off.map(Math.abs)) > 2) /* finding */;
```
Edge-comparison is deliberately agnostic about the cause, so it also catches a stray colspan or a
column budget that covers only some columns. Skip when the cell COUNTS differ — that is a different
bug and gets its own report. Two-way tested: 0 findings as shipped, 3 after
`document.querySelectorAll('.pmrow--head').forEach(e => e.classList.remove('pmrow--data'))`, 0 on
restore.

**The column budget is arithmetic — do it, don't guess it.** The same board then reported
`content-escapes-card` and 12 × `chart-truncated-with-space` at once, which sounds like two bugs and
was one: tracks 738 + gaps (5×14) + padding (2×16) = **840 against an 825px card**, while the
pitchers column sat at 160px needing 202px with 87px unused further right. Sum the tracks, the gaps
AND the padding, and compare against the real container width before choosing `min-width`.

**And a wrap fix must beat the mobile block on SPECIFICITY, not source order.** Letting the long
cell wrap fixed desktop and silently lost on a phone: the mobile rule
`.pmrow--data .pmcell--team{white-space:nowrap;text-overflow:ellipsis}` is (0,2,0) and sits later in
the file, so a two-class fix at equal specificity loses. Three classes
(`.pmtable--mlbg .pmrow--data .pmcell--team`) holds regardless of order. **Re-run at mobile after
any cell-level text fix** — this one reported clean at 1440 and 12 findings at 375.

### ⚠️ `checkVisibility()` makes an unrendered page look PERFECT
The most dangerous false pass in this file, because it reports zero and zero looks like success.
`/mlb/model` returned **0 findings at both desktop and mobile** while the page showed `Loading…`:
the real markup was sitting in React's hidden `<div hidden id="S:0">` streaming placeholder, every
element measured invisible, and the probe correctly skipped all of it. Splicing `#S:0` into the live
tree (the snippet in the section above) and re-running gave **22 findings on the same page**.

**A zero is only meaningful if the board was actually measured.** Assert the content is there before
believing a clean sweep — and note the splice is per-page, so doing it on three pages of a matrix
and forgetting the fourth produces one page that reports clean for the wrong reason:
```js
document.querySelectorAll('.pmrow--data, .hb-form tbody tr').length   // > 0 before trusting a 0
```

### ⚠️ `querySelector` looks DOWN — an ancestor never matches itself
`uncapped-long-list` walks up four ancestors asking whether a cap control is present, using
`a.querySelector(".hb-showmore, .hb-more, .hb-moretbl__chk")`. But the most common capped shape in
this app is `<details class="hb-showmore">` **wrapping** the table — so the ancestor IS the control,
and `querySelector` (descendants only) never saw it. Three correctly-capped boards were reported as
uncapped (`/props`, `/audit`, and both tables on `/ncaaf/model`) while the check stayed silent on
anything genuinely broken.

```js
if (a.matches?.(CAPSEL) || a.querySelector(CAPSEL)) capped = true;   // self OR descendants
```
Whenever a check walks ancestors looking for a marker, ask whether the marker can BE the ancestor.
This is the second false-positive cluster from this one check; both times the symptom was the same —
a finding repeating across pages that all looked fine.

### ⚠️ A probe that cries wolf buries the real bug
One audit produced **17 findings across 5 pages; 16 were false positives** — and the one real bug
(the dock above) was sitting in the middle of them. Tuning the checks was most of the work, and it
is worth doing the moment a finding repeats on every page: *a finding that appears everywhere is
almost always a probe bug, not a site-wide bug.*

The five that were fixed, each with the general lesson:

| symptom | cause | rule |
|---|---|---|
| `click-intercepted` on week nav 14-18, every page | items scrolled out of a horizontal scroller still report a rect at their unscrolled position, so hit-testing finds whatever is painted there | before hit-testing, skip anything a scrolling ancestor has clipped out of view |
| `repeated-column-header` 3× on `/ncaaf/model` | three *separate* panels each correctly drew one header; no single descendant owned all the tables, so the whole page counted as one board | a container holding several `.hb-panel`s is not one chart — `if (board.querySelector('.hb-panel')) continue` |
| `grid-dead-space` on `.pageweekrow`/`.subnavrow` | `1fr auto 1fr` is a CENTERING grid whose outer tracks are deliberate spacers | skip grids whose children are explicitly placed (`gridColumnStart !== 'auto'`); auto-fill dead space is the case where children just flow |
| `low-contrast-text` 1.07 on the hero tagline | the imagery-overlap bail-out only ran for `fixed`/`sticky` ancestors; a hero lockup is an ordinary in-flow child over a sibling `<img>` | test the element's own rect against imagery **whatever its position** |
| `full-bleed-short`, right gap 15px | measured against `window.innerWidth`, which counts the scrollbar | measure against `document.documentElement.clientWidth` — the same correction the rail check already makes |
| `uncapped-long-list` on the 18-week nav | a horizontally-scrolling picker is meant to be swiped | skip lists inside a `<nav>` or with `overflow-x:auto` |

**Verify a triage before acting on it, in both directions.** Each of those was settled by one
measurement — a rect comparison, a computed style, an ancestor query — not by reading the CSS. The
same discipline found the real dock bug, which *looked* like the same false positive as the other
`click-intercepted` hits until `overlapsDock` came back true with the element fully in view.

### A panel that stops halfway across reads as broken, not as generous margin
The mirror image of `content-escapes-card`. The homepage "Let's talk numbers" body was one
left-aligned column with `max-width:54ch` on the copy — a correct measure for line length, and
inside a ~1100px card it left **the entire right half empty**. Measured: content used **61% of the
width, 335px sitting blank** at 1440px.

**The fix is never "widen the paragraph."** 1100px of text is ~140ch and genuinely unreadable —
that trades a layout bug for a typography one. Fill the width with LAYOUT and keep the measure:

```css
.thing__body{display:grid;grid-template-columns:1fr;column-gap:32px}
@media(min-width:860px){
  .thing__body{grid-template-columns:1fr 1fr}
  .thing__body > .heading, .thing__body > .cta{grid-column:1 / -1}   /* span both */
}
```
Two columns of copy, heading and button row spanning. Single column below the breakpoint, where
one column of 54ch already fills the card.

**Measure the INK, not the boxes — this is the part that matters.** The obvious check is "how wide
are the children", and it is wrong: a block-level `<h2>` and a flex CTA row are full-width *by
definition* even when their text ends a third of the way across. That check reported **100% used**
on the very panel that looks half empty, and passed its own regression test. Walk the text nodes
and take the rightmost client rect instead:

```js
const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
let right = -Infinity;
for (let n = walk.nextNode(); n; n = walk.nextNode()) {
  if (!n.textContent.trim()) continue;
  const rng = document.createRange(); rng.selectNodeContents(n);
  for (const q of rng.getClientRects()) if (q.width > 0) right = Math.max(right, q.right);
}
// then also max in any img/svg/input rects, and compare (right - contentLeft) / innerWidth
```

Only flag single-column stacks — a grid or flex ROW is already using its width on purpose.

**Prove a new check fires before trusting a clean sweep.** Toggle the fix off in the page, re-run,
confirm it reports, toggle back:
```js
el.style.display = 'block';        // the broken layout
/* run probe -> expect a finding */
el.style.display = '';             // the fix
/* run probe -> expect none */
```
That two-way test is what caught the box-vs-ink mistake. A check added and never seen to fire is
indistinguishable from a check that cannot fire.

### Many tables ≠ one split chart: the signature is the MISSING header
`chart-split-scrollers` reported `/audit` as "one chart rendered as 16 separate tables". It is not:
the Pick Auditor draws one `.autbl` **per game card**, and each carries its own header. Sixteen
charts, correctly.

**A genuinely split chart leaves its continuation headerless** — that is what made the referee
table's bottom half unreadable, and it is the discriminator. Only report when at least one table
lacks a header row; a duplicated header across a split is `repeated-column-header`'s job instead.

This is the second false positive from the same instinct — counting how many of a thing exist
inside a container and calling that a split. The first was three separate panels on `/ncaaf/model`.
Before flagging "one chart in N pieces", ask what makes the pieces *wrong* rather than merely
plural.

### 🚨 A status indicator must READ the status, not assert it
The chat widget's friend bubbles rendered `<span className="cw__bubav is-online">` — the online
class **hardcoded on every friend**. So the widget told every member that their entire roster was
online, permanently. Measured against `profiles.last_seen` at the moment it was reported: **1 of 16
members was actually online, and it was Derek himself.** Two of the five bubbles on screen belonged
to members who had *never* had a session (`last_seen` null); another had last been seen 8.7 days
earlier.

Worse, the truth was already in the database and already being used elsewhere: `Presence.tsx`
heartbeats `last_seen` every ~60s and the profile page renders `f.online` from it. The widget had
simply never been wired to it.

This is the same failure as a projection that contradicts its own line — **the UI states a fact it
never checked** — and it is the most damaging kind on a product whose pitch is verifiable trust.

Audit sweep for it: any presence dot, "live" pill, "verified" tick, freshness stamp or status badge
whose class is unconditional in JSX.
```bash
grep -rnE 'className="[^"]*(is-online|is-live|is-verified|is-fresh)' web/app web/components
```
Every hit must be a ternary on real data, or belong to the signed-in user themselves (the rail and
dock render `is-online` on *your own* avatar, which is trivially true and fine).

Two rules that came out of the fix:
- **Unknown renders as nothing, never as the good state.** `onlineIds` starts empty, so a friend
  shows no ring until presence is actually known.
- **A freshness-based indicator must refresh on a timer.** Presence was read once when the friend
  list loaded, so a ring would have persisted long after the member left. It now re-reads every 60s
  while the panel is open — inside the 3-minute window, and no queries while closed.
- The threshold lives in ONE place (`lib/presence.ts`, client-safe so it isn't duplicated into a
  server-only module). Two copies of "how stale is stale" drift.

### A prop board shows ONLY players the sportsbook lists
The reconciliation below runs in both directions, and the second one is a product rule, not just a
bug: **a name on the prop board that is not in the book's app is noise.** A bettor reads our board
next to a sportsbook; a row they cannot bet costs them time and makes the board look padded.

`cfb_player_proj.build_slate` walks the whole depth chart and emitted every rotation player, with
`book: None` rendered as a "—" line. On the 2026-09-05 slate that was **649 of 756 rows (86%)** with
no posted line. Now filtered at the write step in `main()` — see the comment there.

Keep the direction of the rule straight, because it is the same line the second pass draws:
- **EXISTENCE** of a posted prop decides who appears → coverage. Allowed, in both directions.
- **VALUE** of the posted line decides a projection or whether we publish one → line-blindness is
  broken. Never.

Consequence to state rather than hide: a game the books have not priced shows no players, and a
slate captured early looks thin. That reads correctly — the market has not priced it yet.

Audit check: `rows.filter(r => r.book === null).length` should be **0** on any prop board.

### The board must reconcile against the market — run this every audit
Both bugs above presented identically: a board that looked fine, just missing people. Neither shows
up in a screenshot. The only way to catch them is to diff **who the book prices** against **who we
publish**, and require a reason for every gap:

```python
priced  = {norm(r["player"]) for r in prop_snapshots_for_the_slate}   # PAGED
shown   = {norm(r["player"]) for r in projections_file}
missing = priced - shown
```
Then bucket `missing` by cause and be suspicious of any bucket that isn't tiny:
`no prior-season stats` (rookies — legitimate), `team mismatch` (stale roster — a BUG),
`no game log` (true freshmen — legitimate in NCAAF), `absent from the fetch` (truncation — a BUG).
A star name anywhere in that list means it is a join bug, not a data gap.

### ⚠️ A measurement taken on broken data justifies a broken fix
`MIN_PROJ_GAMES = 5` blanked any projection built on under 5 of a player's own games. Its stated
evidence was median(proj ÷ line) of **1.74 at 0-2 games and 1.87 at 3-4, against 1.10 from 5 up**.
That measurement was real — and taken on a board where the 1000-row truncation left only **7 of 35
games visible**. Re-measured after the fix:

| own games | n | median | verdict |
|---|---|---|---|
| 0-2 | 5 | **0.88** | the BEST bucket |
| 3-4 | 6 | 1.83 | |
| 5-9 | 42 | **1.31** | published, and worse than what we hid |
| 10+ | 120 | 1.09 | |

The gate was hiding Keelon Russell at 1.00 and Quaid Carr at 0.95 while passing 42 rows at 1.31.

**The rule: when you fix a data-collection bug, re-run every measurement that was taken before the
fix — especially the ones you used to justify a behaviour.** A derived constant carries the bias of
the data it was derived from, and it does not announce that it is stale. Grep for tuned constants
after any pipeline fix and check what each was measured on.

Second rule from the same fix: **gate CLAIMS, not MEASUREMENTS.** A projection is our number and the
row already shows the sample size next to it ("0/2 gm") — the reader can discount it. A lean is an
assertion about what will happen, so it stays gated *and* shrinks toward the category baseline. The
board now publishes the number, marks it `.pmcell--thin`, and withholds only the arrow.

### Verify a "fix" did not just move the cost somewhere else
Paging `sb_get` was correct, and it took the slate from 7 games to 35 — which took `team_logs` from
14 teams to 86, i.e. **172 CFBD calls against the workflow's `timeout-minutes: 25`**. The nightly job
would have started failing that night, and the failure would have looked unrelated to the fix.

Two things to check on any fix that widens a data set:
```bash
grep -rn "timeout-minutes" .github/workflows/    # does the job still fit?
```
- **Runtime**: time the job locally before trusting the cron. 45+ min sequential here.
- **Upstream load**: 6x the API calls. Cache what cannot change — `HIST_SEASONS` is [2024, 2025]
  against a 2026 season, so those payloads are immutable; they are now cached per team-season and
  the workflow keeps the cache via `actions/cache`.

And when the work is pure network wait, make it concurrent rather than buying a faster machine:
`_fetch_all_logs` runs 8 in flight through a `ThreadPoolExecutor` (`cfbd_get` is stateless per call
and already retries 429/5xx). **Measured: 45+ minutes → 6m16s.** Parse SEQUENTIALLY afterwards —
the fetch order is nondeterministic and the parse feeds recency weighting.

### A cap fixes a tail; measure the OTHER tail too
`ROLE_VOL_CAP` clamped the inflated rows and regressed exactly the players it should have left alone.
The cap was multiplicative on a player's own volume, so on a near-zero own volume any multiple is
still near zero: a promoted QB1 with 3 games of mop-up duty went to 39.2 passing yards against a
155.5 line. One bad tail became the opposite bad tail:

```
median(proj/line)   <=4 games   >=10 games
before any cap         1.74        1.23
after a blunt cap      0.52        1.07     <- new damage, low side
after CAP_MIN_GAMES    1.74        1.10
```

**Always measure both tails after clamping anything** (`<0.5×` and `>=2×`, not just the one you were
chasing), and gate a multiplicative correction on having enough sample for the base to mean anything.

**Resolved by suppression, not by tuning.** Rows with a thin own-sample were the source of BOTH
numbers that looked broken — a receiver at 3.7x his line, and (under a blunt cap) a starting QB at a
quarter of his. Two games is not a projection, and no multiplier fixes that. The board now dashes
its own number below `MIN_PROJ_GAMES` (5) while still showing the player, his line and his real
hit-rates — the same honesty the game board uses when it cannot rate a side.

Pick such a threshold from the data, not by feel. The buckets made the break obvious:

```
 games   0-2    3-4    5-7    8-9   10-14  15+
 median  1.74   1.87   1.10   1.21   1.13  1.08
```

Published result: NCAAF median 1.10 (max 2.53, none under 0.5x) keeping 84% of rows, NFL 1.02
keeping 94% — NFL suppresses almost nothing because its players carry long histories. Suppress in
the VIEW rather than the generator, so the data keeps the value and the number returns by itself
once the sample fills in.

### Depth rank is an input, not a fact — cross-check it against the market
Depth slots (RB1/WR2) come from scraping Ourlads (`cfb_depth.py`) because CFBD has no depth order and
ESPN's college depth-chart page returns no player data. That rank then **feeds the projection**
(`proj = own_per_game × role_vol/own_vol`), so a contested rank actively scales the wrong player up.

Worked example: USC had Waymond Jordan RB1 / King Miller RB2 — faithful to Ourlads, and a live
re-probe confirmed our scrape was current, so the label was not a bug. But the **market disagreed**:
Miller's line 74.5 vs Jordan's 58.5. We had Jordan at 95.9 off a 6-game sample scaled to starter
workload, against a 58.5 line.

So when a projection looks wrong for a player, check in this order:
1. **Is our scrape stale?** Re-probe the live source (`python cfb_depth.py --probe <team>`) and
   compare — don't assume.
2. **Does the market's ordering within the position group match ours?** The book line is money on
   expected workload and is usually the better read. A conflict means one is wrong.
3. **How many games back the projection?** A thin sample amplified by role re-scaling is the
   dangerous combination.
4. **Is the sample even from this season?** Identical career and prior-season splits (Jordan 4/6 and
   4/6) mean we hold NO games from the current season for that player.

### One board = ONE column header
A board that renders a `<table>` per day group emits a `<thead>` per group, so the column row
("Game / Market Spread / Market O/U / Model Spread / Model O/U") reappears under every date — and
again wherever a day is split at the show-more cap. The reader sees one chart chopped into several.

Draw the column header on the **first day group only**, and make the show-more tail continue the
numbering so it never re-emits one:

```tsx
const dayTable = (grp, i) => (
  <table>{i === 0 && <ColumnHead />}<tbody>…</tbody></table>
);
head.map(dayTable)                       // i starts at 0 → header
rest.map((g, i) => dayTable(g, i + 1))   // never 0 → no header in the dropdown
```

Headerless continuation tables still line up because the per-column widths are declared on **`td` as
well as `th`** (`.hb-form--mkt th:nth-child(n), .hb-form--mkt td:nth-child(n)`). If you ever move
those widths onto `th` alone, every headerless table will collapse to content width — check both
selectors before changing them.

Day headers are the opposite case: those SHOULD repeat per day, except on the tail of a day split
across the cap (`grp.cont`), which already has one above the boundary.

### A cap only counts if the capped items are ON SCREEN
Capping a list at "the first 3" is worthless when the container holding it is collapsed. The prop
board capped each market at 3 players while every game card was a closed `<details>`, so the board
still read as 16 clickable rows with no prices on it — the cap changed nothing the reader could see.

So when asked to preview the first N of something, check **both** halves:
1. the list caps at N behind the standard dropdown, **and**
2. those N are visible without any interaction — the card/panel containing them defaults to open.

`all-cards-collapsed` catches half 2 by flagging a board whose per-item cards (`.propgame`,
`.augame`, `.pmgame`, anything `*game`) are ALL closed. It deliberately ignores a single shut card
among open ones — that's just a card the reader closed. **Verify with the probe on a fresh load, not
after the expand-collapsibles step**, which opens everything and hides exactly this bug.

Boards that show every item with nothing collapsed (`/lines`, `/ncaaf/lines`) need the opposite fix —
add the cap, since there is nothing to open.

### Capping a list: count the ENTITY, not the rows
Every long list caps behind the standard `.hb-showmore` dropdown (chevron · "Show N more X" ·
"Collapse"). Two rules that are easy to get wrong:

1. **Cap on the entity the reader counts, and split on its boundary.** Value Finder prop markets show
   the first **3 players**, not the first 3 rows — a player usually occupies two rows (his Over and
   his Under), so a row cap slices a pair in half and the dropdown opens mid-player. Same idea as
   `capDayGroups` capping on whole days rather than raw games.
2. **Recompute the grouping flag per segment.** A grouped list blanks a repeated leading label
   (`cont = i > 0 && rows[i-1].player === rows[i].player`). If you slice that list across the
   boundary, the first hidden row keeps its blank and the dropdown opens on a **nameless row**. Build
   each segment's rows with `cont` computed against *that segment*, never by slicing an
   already-rendered list. `orphaned-continuation` catches the symptom.

This is the same family as the duplicate-day-header bug: splitting a list is safe only when the thing
that identifies a row is recomputed for the segment it lands in.

### Chart headers are arranged in CSS, not per panel
Every `.hb-bar` chart header must read the same way, app-wide:

```
[ TITLE (+count)  scroll ] ......... free space ......... [ Add to dashboard ] [ chevron ]
```

Panels write those children in **different source orders** — some put the `Tip` before the pin, some
after — so the arrangement is enforced by flex `order` on `.hb-bar` rather than by editing each
panel. A new panel therefore inherits it for free, and you should **not** fix a misplaced header by
reordering one panel's JSX.

The failure mode to watch for: **two `margin-left:auto` in the same header**. Flex splits the free
space between them, which parks "Add to dashboard" in the middle of the bar instead of at the right
edge — exactly the reported bug. Only the pin carries the auto margin; the chevron gets a fixed
`margin-left`, and panels with no pin hand the auto margin to the chevron via
`:not(:has(.pinbtn-wrap))`. Beware sibling selectors here too: `order` changes the visual position
but NOT DOM order, so `.pinbtn-wrap + .hb-bar__chev` silently stops matching once a Tip sits between
them in the source.

### ⚠️ A check that is never RUN catches nothing
`split-group` was in this skill and still shipped three reported bugs on `/ncaaf/model` — duplicate
"Sep 5" sections, a stranded Collapse, and a completed Aug 29 day among the upcoming ones. The check
was correct; **it had simply never been run against that page**. Adding a check is half the job.
After adding one, run it over the page matrix — at minimum over the boards that share the shape it
detects — rather than waiting for the next audit. And when a bug is reported that an existing check
covers, the first question is "was this page ever probed?", not "is the check wrong?".

### Capped lists: group ONCE, cap on whole groups
The single root cause behind that whole cluster. A board that caps a long list must group by day
**once over the full list** and then split on whole group boundaries (`capDayGroups` in
`lib/gameDays.ts`). Slicing the games first and grouping each half separately re-derives day headers
per half, which:
- **duplicates** any day straddling the cut ("two Sep 5 sections"),
- **strands** the collapse control between the two halves, and
- **re-sorts each half independently**, so a completed day can surface among upcoming ones.

Three symptoms, one bug — so when any one of them is reported, check for the other two. This shape
existed on BOTH `/ncaaf/model` and `/model`; when you find it, grep for the sibling
(`slice(` immediately around a grouping call) rather than fixing only the page that was reported.

Separately, an open `<details>` keeps its `<summary>` in source position, so the control must be
pushed below what it revealed with the flex-order trick (`.hb-more`, `.hb-showmore[open]`:
`display:flex; flex-direction:column`, content `order:1`, summary `order:2`).

### The side rails (Member Rail + Bettor's Rail)
Two fixed sidebars share one `.leftrail` class — Member Rail on the left, Bettor's Rail on the right —
so they are mirror images by construction and any difference is a bug. The rail width, the reserved
gutter, and the width at which the rails split are **one arithmetic chain**; changing any one without
the others is the failure mode to watch for:

```
rail width + 16px offset + clearance = gutter   (254 + 16 + 14 = 284)
BOTH gutters are always reserved (symmetric) so content stays CENTRED; .wrap's 1120px is a max, so
below 1688px the column simply narrows (872px at 1440). The rails SPLIT at 1280px — do not derive
that threshold from 1120 + 2×gutter: gating it there hid the right rail on every 1440px laptop.
```

So when you resize a rail or its icons, re-check **all** of: `.leftrail{width}`, `.siteshift`
`padding-left`/`padding-right`, the `.lp-hero` full-bleed cancellations (both sides), the
`@media(min-width:…)` / `@media(max-width:…)` pair, **and** the two complementary
`@media` blocks that swap `.leftrail--right` for `.leftrail__merged`. That swap is CSS-only on
purpose: it was once a JS `matchMedia` decision, and a resize that outran the re-render hid the right
rail while its items had not yet folded back, leaving all five betting tools unreachable. Never move
that choice back into JS.

Check at desktop, in both the split (≥1280px) and merged (1100–1279px) layouts:
- **Mirrored**: equal width, equal top, equal gap to their own viewport edge.
- **Evenly spaced**: one row height and one gap for every row — rows size from a shared icon +
  padding pair, so a per-item override is the usual culprit. A merged rail's divider is the one
  legitimate bigger gap.
- **Nothing hidden**: `scrollHeight > clientHeight` means items are behind a scroll. The merged rail
  holds ~twice the items, so it is the one that overflows first — check it at a short viewport
  (900px tall and less).
- **No overlap** with the content column, and no rail item unreachable at any width: below the split
  threshold every item must still be present in the merged rail.

### Column-width budget (tables)
When a table declares per-column widths (`th:nth-child(n)`), **the rules must cover EVERY column and
sum to 100%**. `.hb-form--psnap` declared four widths for a five-column table, so the fifth fell
outside the budget: the table overflowed its wrapper, a scrollbar appeared, and the Player column
scrolled out of view. After adding or removing a column, always re-check the width rules — count the
`<th>`s and count the `nth-child` rules, and make sure they match.

### Full-bleed elements and gutters
A hero/banner escapes its container with negative margins plus an over-100% width
(`margin-left:-Xpx; width:calc(100% + Xpx)`). If a gutter is later added on the **other** side, the
element has to cancel that too — otherwise it stops short and leaves a strip of page background.
Whenever you change a container's padding, re-check every full-bleed child inside it.

### Why a change "over here" surfaces a bug "over there"
Two distinct causes — tell them apart before assuming you broke something:

1. **Shared global CSS.** Everything lives in one `globals.css` with generic class names (`.grid`,
   `.propstack`, `.catnav`, `.hb-bar__count`). Editing one rule hits *every* page using it. Before
   changing a shared class, `grep -c` the class across `app/` to see the blast radius, and re-check
   the other consumers — not just the page you were asked about.
2. **A latent bug that was camouflaged.** Fixing alignment/spacing often *reveals* a neighbour that
   was always wrong. The category pills looked fine while the whole page was shifted right; once the
   page was centred, the one left-aligned row stood out. **Check git before apologising**:
   `git log -S'.theRule{' --oneline -- web/app/globals.css` and `git show HEAD~N:web/app/globals.css |
   grep '^.theRule{'` — if the rule is byte-identical to before your change, you exposed it, you
   didn't cause it. Say which it was.

### Column ORDER, PAIRING and COLOUR are part of whether a chart is readable
Three standing rules, all from the same review of the MLB board, all cheap to check on any chart
that puts our number next to the market's:

- **Pair the market columns, then pair ours.** `market spread · market total · our spread · our
  total`, never interleaved and never separated by something else. Each pair is one comparison and
  should read as one block. This is the football boards' order (`Game / Market Spread / Market O/U /
  Model Spread / Model O/U`) — a sport reading differently for no reason is the inconsistency to
  avoid.
- **Give the compared columns EQUAL width.** Two numbers a reader is meant to weigh against each
  other should not be drawn at different sizes; `repeat(4, 77px)` rather than four hand-picked
  widths.
- **Colour by WHOSE claim it is, app-wide**: `--model` blue for anything we computed
  (`.pmcell--proj`), `--mkt` maroon for the market (`.pmcell--mkt`), green for a book price. Verify
  the computed value, not the class name:
  ```js
  getComputedStyle(document.querySelector('.pmcell--proj')).color   // want rgb(30, 91, 196)
  ```
  Colouring the words "market" and "ours" in the blurb with the same two colours (`.lgnd--mkt` /
  `.lgnd--model`) teaches the key once, in prose, without a separate legend.

**Drop a column rather than explain it.** The board also carried "our runs" (`3.9 @ 4.2`) — the two
halves of a total the very next column already showed. Derek: *"I do not know what the 'our runs'
row is. I do not think we need that one."* A column that needs a sentence to justify it is usually a
column that should not be there; the spread and the total between them already say everything the
split did.

**Identify people by the club beside the name.** Pitcher names alone are unreadable to anyone but a
diehard — `Tanner Bibee (CLE) / Brandon Young (BAL)`, abbreviations from the source's own
`abbreviation` field, never hand-mapped.

**Cap a chart at what fits without scrolling** — 4 games per day here, not 8. The right number is
"how many rows sit above the fold on the card", not a round number.

### ⚠️ Chart changes ALWAYS get an alignment pass
Standing rule from Derek: **any time a chart/table/board is changed, re-check alignment before
shipping** — don't wait for the periodic audit. Check, at desktop AND mobile:
- **Even spacing** between rows and between columns (no one column hogging or starving).
- **No dead space**: does the content actually fill the card? Watch for `auto-fill` grids (phantom
  tracks) and `object-fit: contain` media that shrinks inside an over-wide box.
- **No truncation while space is available** — an ellipsized name next to an empty gap is the tell.
- **Column order/pairing still reads correctly** (e.g. market pair then model pair).
- **Double names / repeated row labels.** Consecutive rows repeating the same leading label (a player
  name on both his Over and Under rows) read as duplicated data. The fix is to GROUP — blank the label
  on the continuation row (`cont = i > 0 && rows[i-1].player === row.player`), the way the Model chart
  stacks a player's markets. Give the stacked rows a column that says what distinguishes them (a
  `Prop`/side column); without one the reader has to infer it from the units.
- Repeated-looking rows are often legitimate pairs (Over/Under on the same player). Before "fixing a
  duplicate", confirm whether the rows differ by side/line/book — widening the column usually reveals
  they were never duplicates, just unreadable. Delete a row only if it is byte-identical to its
  neighbour; otherwise group, don't remove (each side is a separately bettable price).

### Check the reported tab/filter, not just the default view
Boards are often category- or week-scoped by URL (`/props?cat=passing`, `?week=N`, sport tabs). A bug
reported on one tab will NOT reproduce on the default one — `/props` defaults to Touchdowns (one row
per player, no pairs), so the double-name bug was invisible there and only appeared under
`?cat=passing`. Always reproduce on the exact URL/tab the report came from, then spot-check the
sibling tabs before calling it fixed.

### Mobile-specific checks
Several bugs only appear on a phone. At 375px (and 320px), verify:
- Banner/hero images **fill their box** — a fixed `aspect-ratio` far from the art's own ratio makes
  `contain` shrink it to a stamp in blurred filler. Match the box to the most common asset ratio.
- Header pills/among-title chips don't squeeze titles onto cramped lines (hide the pill, let the
  title span).
- The floating dock/bubble menu is short enough to thumb — every extra icon costs.

### Data-dependent bubble bugs (stress pass)
`bubble-overflow` only fires when the *current* data is long enough to overflow. Many pill/badge
bugs only bite with a long team name ("Massachusetts Minutemen"), long player name, or a big number
that isn't on this week's board. To catch these latent bugs, run a **stress pass**: for each visible
leaf bubble (rounded + filled, `children.length === 0`, `overflow: visible`), save its text, set it to
a long string, force reflow, measure `scrollWidth/Height − clientWidth/Height`, then restore the text.
Any that overflow are fragile — they *will* bleed with real long data (fix with `white-space`,
`max-width`, `overflow`, or letting the bubble size to content). Ignore count-only badges (`.slipbar__count`)
that never hold long text. Do this at 320–375px width; overflow appears at the narrowest widths first.

## Prerequisites (already in the repo)
- **QA preview mode** is automatic on the local dev server: `web/proxy.ts` opens the gate when
  `NODE_ENV==="development"`, and `web/lib/supabase/client.ts` mocks `auth.getUser/getSession` so
  gated client components (LeftRail, dashboards) hydrate with a mock member. Production is untouched.
  Requires `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env.local` (public
  values; already added). Set `NEXT_PUBLIC_QA_PREVIEW=0` to force a real signed-out dev session.
- **The probe** lives at `web/qa/visual-audit.js` — a self-contained, pasteable IIFE that returns JSON.

## Procedure
1. **Start the preview**: `preview_start { name: "web" }`. (Restart if `proxy.ts`/`.env.local` changed.)
2. **Host the probe for the run** so it can be re-fetched per page without re-pasting:
   `cp web/qa/visual-audit.js web/public/__ss_audit.js` — **delete this file before committing.**
3. **For each page × viewport × theme** in the matrix below:
   - **Expand collapsibles first** (some bugs — `split-group`, mid-list collapse controls, hidden
     overflow rows — only show when expanded): before the probe, run
     `document.querySelectorAll('details:not([open])').forEach(d=>{try{d.open=true}catch{}}); document.querySelectorAll('.hb-moretbl__chk').forEach(c=>{c.checked=true});`
   - **Splice `#S:0` on EVERY page, not just the ones that look broken** (snippet above). A page
     still showing `Loading…` reports **zero findings** because every element measures invisible —
     `/mlb/model` returned a clean sweep at both viewports and had 22 findings once spliced.
   - `navigate` to the URL, then in `javascript_tool`:
     `await new Promise(r=>setTimeout(r,1500)); JSON.parse(eval(await (await fetch('/__ss_audit.js?v='+Date.now())).text()))`
   - **Sanity-check the count before trusting a 0**: `document.querySelectorAll('.pmrow--data, .hb-form tbody tr').length`
     must be non-zero on any board page. A zero-finding sweep of an empty DOM is not a pass.
   - Sizes: `resize_window {width:1440,height:900}` (desktop, exercises the rail gutter),
     `resize_window {preset:"mobile"}` (overflow hides here). Themes: add `colorScheme:"dark"` /
     `"light"`. Reset with `resize_window {preset:"desktop"}` when done.
   - Collect the `findings[]`. One `low-contrast-text` or `unequal-row-height` at desktop-light is
     often enough to file; overflow is mobile-specific; contrast bugs often only show in one theme.
4. **Pull page errors** that the probe can't see: `read_console_messages {onlyErrors:true}` and
   `read_network_requests` (look for 4xx/5xx).
5. **Triage before reporting** — confirm each finding is real, not a probe limitation (below). For a
   suspicious contrast/overlap hit, inspect the element's computed `color` / `backgroundColor` and
   `elementFromPoint(center)` to confirm. Report a ranked list grouped by severity; recommend fixes;
   let Derek approve. Do not mass-fix without review.

## Page matrix (adjust per task)
Public/content (render fully in QA mode): `/`, `/model?week=1`, `/best?week=1`, `/props?week=1`,
`/considerations?week=1`, `/ncaaf/model`, `/ncaaf/best`, `/bankroll`, `/dashboard`, `/creator`.
Always include: `/` and `/model` at **mobile** (overflow) and one page in **dark** (contrast).

## Known limitations (state these, don't fight them)
- **Server-auth-gated pages redirect** in QA mode (the mock is client-only): `/u/[username]` (profile)
  and possibly `/settings` bounce to home. Audit those on the **live** site while logged in.
- **Founder-only UI is hidden**: the mock profile read is empty, so `role` falls back to "member"
  (no Creator Dashboard rail item). Navigate to `/creator` directly to see that page.
- **Text over background images** can't be contrast-checked (the probe skips it) — a nav/card over a
  photo won't be assessed either way. `effectiveBg` handles the overlay case (a `position:fixed` bar
  painted over a hero that is its SIBLING, not its ancestor) by testing rect overlap against imagery,
  deliberately not `elementsFromPoint` — the hero scrim sets `pointer-events:none`, so hit-testing
  walks straight past it.
- **Known false positive**: `low-contrast-text` on the homepage nav ("Logged in as <name>", contrast
  1.08). The cream text is correct — it renders over the dark hero image, confirmed by screenshot. It
  fires only because the dev preview sometimes keeps a **stale duplicate DOM tree** in which the hero
  reports `visible:false` with a 0×0 rect, so the overlap check finds no imagery and falls back to the
  bar's own colour. Tell-tale: query an element like `.leftrail__icimg` and see two copies, one 0×0.
  When the probe reports something impossible, check for the duplicate tree before believing it.
- **Dev CSS-ordering quirks**: a contrast/background finding that only appears in dev may not
  reproduce in production — confirm ambiguous ones against the live site before asserting a prod bug.
- Tune thresholds via `window.__SS_AUDIT_CFG = { rowHeightTol, contrastMin, maxPerType }` before eval.

## Cleanup
Remove `web/public/__ss_audit.js`, `resize_window {preset:"desktop"}`, and (if you set it) clear the
`colorScheme` emulation before finishing. The probe (`web/qa/visual-audit.js`) and QA mode stay.
