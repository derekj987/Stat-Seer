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
`chart-rows-uneven` (data rows in one chart differ in height because a cell wraps) ·
`chart-columns-lopsided` (one column sits on a pile of empty width while another is squeezed under
its own content — the `fr`-mixed-with-`px` grid) ·
`card-property-as-column` (a column constant within each card but varying between cards — game-level
data rendered once per row) ·
`content-escapes-card` (a row's border box is narrower than the content it wraps — the last columns
draw *outside* the card instead of scrolling; `overflow-x` on the flex column itself) ·
`chart-split-scrollers` (one chart rendered as two tables, so each half scrolls sideways
independently and the second half has no header) ·
`panel-half-empty` (a panel's content stops well short of its width, so the card reads as broken —
usually a `max-width` in `ch` on the copy with nothing else using the space) ·
`chart-header-misaligned` (a chart's column header does not sit over the data it labels — compares
the header cells' LEFT EDGES against the first data row's, so it catches a wrong `display`, a
column-count mismatch and a stray colspan alike) ·
`column-no-variance` (a numeric column holding one or two distinct values across 8+ rows — a column
that cannot be carrying the information it appears to) ·
`popover-unanchored` (a Tip/tooltip bubble with no positioned ancestor, or one that opens far from
the control that triggers it — the "the scroll doesn't work any more" family) ·
`prose-above-board` (paragraphs of copy stacked above a chart instead of being routed into a Tip
scroll — the "too wordy" family).
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

### 🚨 `position:absolute` with no positioned ancestor falls through to the PAGE
The scroll "?" (`Tip`) on `/model` silently stopped working. `.tip` was `position:static` on
purpose, so the bubble could anchor to a positioned ROW above it (`.tblhelp` / `.pmcat__legend`) and
span that row's width. That holds only while every Tip happens to sit inside such a row — and when
the Model page's Tip moved into `WeekBadge`'s aside, which is not positioned, `absolute` walked all
the way up to the **initial containing block**. Measured: the bubble rendered **1425px wide at
left:0**, 143px from the seal, somewhere down the page. Nothing threw. The control just did nothing
when clicked.

**The rule: a popover anchors to its own trigger's wrapper, never to whatever happens to be
above it.** `.tip{position:relative}` cannot be broken by where the Tip is placed. Then the bubble
needs its own width, because anchored to a 22px icon `left:0;right:0` would collapse it:
```css
.tip{position:relative}
.tip__bubble{position:absolute;left:50%;transform:translateX(-50%);top:calc(100% + 8px);
  width:max-content;max-width:min(460px,calc(100vw - 32px))}
```

**Centring cannot be clamped, so phones need a different anchor.** At 375px the same bubbles landed
at **left −123px** and past the right edge, because a seal near either edge throws a centred bubble
off-screen. Below 640px it becomes a viewport-anchored bottom sheet (`position:fixed;left:12px;
right:12px;bottom:12px`), which always fits. Watch the trap the rails section already documents:
`fixed` is re-captured by any ancestor with `transform`/`filter`/`perspective`/`contain`, so verify
with `getComputedStyle(bubble).position === "fixed"` rather than assuming.

**A CLOSED popover still occupies layout.** `visibility:hidden` does not remove a box, so the
off-screen hidden bubble was adding **5px of horizontal page overflow** — a `page-overflow-x`
finding whose cause was an invisible element. `position:fixed` contributes nothing to the document's
scroll width, which fixed that too.

Detection is `popover-unanchored`, and it measures the OPENED bubble rather than reading CSS —
force it visible, take both rects, restore:
```js
let anchored = false;
for (let a = bubble.parentElement; a; a = a.parentElement)
  if (getComputedStyle(a).position !== "static") { anchored = true; break; }
const dx = Math.abs(bubbleCentreX - triggerCentreX);   // > 500px = it is not beside its control
```
Two-way tested: 0 findings as shipped, 1 after re-applying the old rules via an injected
`<style>`, 0 on removal — and the finding reproduced the exact numbers ("1425px wide at left 0px,
143px from the control").

**Generalise past this component.** Any absolutely-positioned child that assumes a positioned
ancestor is one refactor away from this bug, and the failure is invisible until someone clicks. When
you move a component into a new container, re-check what positions it.

**Fixing one instance is not the job — sweep every instance, both viewports.** The bug was reported
on `/model`; it was latent everywhere, because the cause is CSS shared by every Tip. Enumerate the
consumers from source, then visit all of them:
```bash
grep -rln 'from "\(\.\.*/\)*Tip"\|<Tip ' web/app --include=*.tsx
```
Swept after the fix: **22 Tips across 13 pages at 1440 and 375, zero bad** — `/`, `/model`,
`/model/players`, `/props`, `/lines`, `/considerations`, `/context`, `/local-intelligence`,
`/ncaaf/model`, `/ncaaf/model/players`, `/ncaaf/lines`, `/ncaaf/considerations`,
`/ncaaf/local-intelligence`, `/mlb/model`. A per-page assertion worth reusing:
```js
tips.filter(t => !anchored(t) || !fitsViewport(t) || distanceFromTrigger(t) > 500)   // must be []
```

### 🚨 The `#S:0` splice DISTORTS geometry on a page that already rendered
The splice is for pages stuck on `Loading…`. Applied to a page whose live tree is fine, it moves
content out of its real container and the measurements go wrong — and they go wrong in the
direction that invents bugs.

Measured on `/context` at 375px: before the splice `documentElement.scrollWidth` was **375**
(clean); after, **452**, with the fixed phone dock shifted 77px and its icons reported 87px past the
viewport. That reads exactly like a phone horizontal-overflow bug, and it does not exist. Two other
checks fired downstream of it (`popover-unanchored`, because the bubble is sized from the inflated
viewport).

**Splice conditionally, never unconditionally:**
```js
const live = document.querySelector('.siteshift main.wrap');
if (!live || live.getBoundingClientRect().height <= 40) { /* only now splice #S:0 */ }
```
Report whether you spliced alongside every finding, and **re-verify any overflow or geometry
finding on a page you spliced** by re-measuring without it. The rule of thumb: a splice is evidence
the page did not render, so treat every measurement on that page as provisional.

### Long copy belongs in the scroll, not on the board
Derek: *"Most of the information on this page is too wordy."* The MLB game panel had **five
paragraphs of caveat above the chart**. Every sentence was true and measured, and stacked over a
board they are a wall nobody reads — which is worse for honesty than one line plus a click, because
unread caveats protect nobody.

The house pattern is one `.ctxsec__legend` line naming the columns, with a `<Tip>` scroll carrying
the detail. Keep the measured numbers *in* the Tip — condensing must not mean deleting the gain, the
calibration or the "no pick" statement.

**⚠️ Writing that rule down did not work.** The very next board built — `/mlb/model/players` —
shipped three stacked paragraphs plus a "Not modelled, and why" section, and Derek had to ask again.
A rule in this file only fires if someone re-reads this file; a probe check fires every audit. So it
is now `prose-above-board`: it sums the visible prose ABOVE the first board in each panel and flags
anything past ~420 characters, with the severity lowered when a Tip already exists (meaning the
pattern is understood and the split is just incomplete).

Three things that check had to get right, all found by running it:
- **Exclude the Tip's own bubble text.** It lives inside the legend `<p>`, so `textContent` includes
  every word correctly moved into the scroll — it reported **1,661 characters** on a panel whose
  visible copy is one line. Clone the node and strip `.tip, .tip__bubble` before counting.
- **Count characters, not paragraphs.** One long paragraph is the same wall as three short ones.
- **Require a board to be present.** The name is the specification: prose *above a chart*. A
  collapsible explainer whose entire content is prose — `/considerations`' "How we read weather &
  scoring" — has nothing to bury, and its `<summary>` already IS the click a scroll would add.
  Flagging it (655 characters) was the check overreaching, not a page defect. `if (!board) continue;`

**🚨 A `<p>` cannot nest inside a `<p>` — so Tip content uses `<br /><br />`, never `<p>`.** The
legend that carries a `<Tip>` IS a `<p>`. Writing the Tip's `text` as `<p>` elements makes the parser
close the outer paragraph, and the copy you "moved into the scroll" pops back out as siblings on the
page. It looked moved, it read as moved in the diff, and `prose-above-board` correctly reported the
same 577 characters afterwards as before. The tell in the DOM is the Tip's paragraphs reporting
`parentElement.className === "ctxsec"` instead of `tip__bubble`. Copy `PlayerModelView`'s Tips.

Note the near-miss this caused: the first diagnosis was that the *check* was counting paragraphs
inside the bubble, and a guard (`p.closest(".tip, .tip__bubble")`) was written for it. That guard is
right in principle and is kept — but it was not the cause here, and shipping only the guard would
have hidden a real page defect behind a silenced check. **When a check keeps reporting after a fix,
confirm the fix actually landed in the DOM before adjusting the check.**

**⚠️ Third time, and the check missed it because it was bound to the markup it was written on.**
Derek, on `/mlb/props`: *"remove the text off of the MLB value finder player prop pages and put
them in an informational scroll. Look for this across all pages."* The page carried a
`<div class="hb-legend">` paragraph, a games/players hint and a book legend — **645 characters**
above the grid — and `prose-above-board` reported clean, because it counted only `<p>` inside
`.hb-body / .ctxsec / .pmcat` and this page's copy was a `div` inside `.ncf-sec`. A check that
looks for one page's shape is silent on the next page's. It now scans `.ncf-sec` too and counts
`.hb-legend`, `.hint` and `.ncf-note` alongside `<p>`; two-way tested (645 → fires; after the
fix, 134 → silent). Swept all 20 boards afterwards: nothing else. **The standing shape for any
board is one `ctxsec__legend` line naming what the columns are, a `<Tip>` for everything else,
and no `ncf-note` paragraphs under the board either** — the links and the ✓ explanation go in
the scroll with the rest.

**🚨 And then the one line went too. The house pattern is now: NO copy on a board — only the scroll.**
The same afternoon, on the one-line legend left after the cut: *"remove the '5 games...' text and
place the 'one row per player..' text into the informational scroll. I do not want text like that
anywhere."* So the pattern above is superseded. What ships everywhere:
- the legend sentence is the FIRST LINE INSIDE the Tip (`<span className="tip__lead">…</span>`
  then `<br /><br />` and the detail);
- the Tip lives in the **panel bar** (`.hb-bar`, after the count — `.hb-bar .tip{order:1}`
  already places it), or in the **WeekBadge / DayBadge `tip` prop**, or inside the section's
  `<h2 className="ctxsec__h">` — never in a `<p>` of its own;
- no `hint`, `hb-legend`, `ctxsec__d`, `ctxsec__lead` or `ncf-note` sits above or under a board.
Applied to every board in one pass (NFL/NCAAF/MLB model, props, sweet spots, auditor). Exempt:
status notes (`tgsample` — "market lines to come"), copy inside a collapsed `<details>` explainer,
and cross-link sentences between sections.
Check: `legend-text-on-board` (medium) — any text outside a Tip in one of those classes, above the
first board of a container, fires regardless of length. Two-way tested: 58 characters injected →
fires; removed → silent. `prose-above-board` stays for long `<p>` copy generally.

**That last one is the general shape of a bad check: it fires on the ABSENCE of the thing it is
about.** When a new check reports something, confirm the page actually has the structure the check
presupposes before changing the page — twice now the honest fix has been to the probe.

**When you write a house rule, ask whether it can be a check instead.** Every rule in this file that
became a probe check has stayed fixed; the ones that stayed prose have all been re-broken at least
once.

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

### 🚨 A market can carry MORE THAN ONE LINE — key on it, or you publish the wrong question
Derek, reading the board: *"Is that Yandy Diaz number really accurate? The book has him at 36% and
we have him at 70%."* It was not accurate, and the tell was in the same screenshot: his two
team-mates read **64%** and **65%** while he read **36%** — a complement, which is what a
mismatched side or line looks like.

`batter_hits` carries **both** the 0.5 line ("will he record a hit") and the 1.5 line ("will he get
two") — 399 of 5,845 rows at 1.5. `propBookProb` keyed on `(player, book, side)` and took the
newest, so whichever line a book had posted most recently won. Díaz's newest quotes were 1.5
(`Over +160 / Under −220`), which de-vigs to 36%: **his P(2+ hits), displayed in a column labelled
as the chance of a hit, next to our P(1+).**

Two failures from one missing field. The second is worse and was invisible: an `Over 1.5` could be
paired with an `Under 0.5` from the same book (Chandler Simpson had all four rows) and "de-vigged"
into a number that means nothing at all.

```js
const k = `${player}|${book}|${Number(line)}|${side}`;   // the LINE is part of the identity
if (Number(r.line) !== WANT_LINE) continue;              // and keep only the one this board asks
```

**The comment above that function had asserted the opposite** — *"the LINE carries no information —
it is 0.5 on every row"* — and that sentence is exactly what stopped anyone checking. A comment
stating a data invariant is a claim; verify it against the data before trusting it:
```sql
select market, line, count(*) from mlb_prop_snapshots group by 1,2 order by 1,2;
```
After the fix Díaz reads **book 73% vs our 70%** — the market slightly above us, which is what a
leadoff hitter should look like. Board-wide the mean gap fell from +5.4pp to +3.3pp.

**Generalise: whenever a board joins to market data, list every dimension that identifies a quote**
— market, line, side, book, and period where one exists — and confirm each is in the key. A missing
dimension does not error; it silently answers a different question.

### 🚨 Never mix a DE-VIGGED price with a RAW one in the same average
Derek: *"our model % is almost always over the book %. That does not seem right."* Chasing it found
a real defect in the **book** column, not the model.

`propBookProb` de-vigs each book's two-sided quote, then takes the median across books — but when a
book posted only the Over it fell back to the **raw** implied probability. Measured on
`batter_hits`: **852 two-sided quotes and 270 one-sided**, with a mean hold of **6.77%**. So the
median mixed values around **56.7%** (de-vigged) with values around **60.5%** (raw) — up to four
points apart, and worst exactly for the players with thin two-way coverage.

**Two different quantities must never be averaged into one column.** Prefer the two-sided quotes
when a player has any; fall back only when he has none, and then bring the raw price onto the same
footing using the hold measured from that same snapshot rather than an assumed one.

**And the bigger lesson: a gap between "our fair %" and "book fair %" is mostly the VIG until
proven otherwise.** The numbers that settled it:

| | mean |
|---|---|
| our probability | 61.9% |
| raw implied Over | 60.5% |
| de-vigged book (the column) | 56.7% |
| **realized 1+ hit rate** | **60.6%** |

Our number sits on the rate batters actually achieve; the book column sits ~4 points below it
because a 6.77% hold has been removed. On a market with that much juice a board will *always* look
like it leans over, and that is arithmetic, not a signal. Before treating a one-sided board as a
model bug, put the realized base rate in the table — it tells you which column moved.

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

### The market line on every board is FanDuel's — one place, `LINE_BOOK` in lib/board.ts
The rule arrived three times: the NFL player board ("Sam Darnold is listed at 228.5 on
FanDuel. We have him at 230.5"), then NCAAF ("the market spread and over/unders do not match the
current lines on FanDuel"), then the NFL model board, whose "market" spread and total were still a
half-point-snapped median across ten books. `buildBoard()` now sets `spread.consensus` /
`total.consensus` to FanDuel's posted point where FanDuel has one and to the US-book median only
where it has not — so every reader of that field (NFL/MLB/NCAAF model boards, the homepage card,
Context, the run-line column) shows the same number as the app on Derek's phone, and the
sweet-spot key is computed on the line actually shown. Verified row for row against FanDuel's
rows in `odds_snapshots` (DET@BUF −3.5/52.5, NO@BAL −8.5/46.5, CIN@HOU −2.5/46.5 …). Before
building a new board with a market column, read `LINE_BOOK`; never re-derive a median.

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

### 🚨 A context row that says "arriving soon" for a whole week is a bug, not a caveat
Derek: *"we also need to get the referee crew data into the context. Also the ratings. Is that
weather current?"* Three rows on the same card, three different answers — and only one of them was
what it appeared to be.

| row | state | cause |
|---|---|---|
| Weather | **current** | `WEATHER_UPDATED` 1½ hours old, refreshed every 8h. Working as designed. |
| Ratings | **empty all week** | built from CURRENT-season points per game, and no 2026 game had been played |
| Referee | **empty for ever** | source cannot supply a crew before kickoff |

**Ratings: a current-season statistic needs a prior-season fallback, labelled.** "Off/def ratings
arrive with the season" is honest and useless on exactly the Week 1 board a reader is looking at.
Last season's scoring rate is the same kind of estimate the player projections already publish for
Week 1 — a prior-season baseline. It now falls back and stamps `RATINGS_IS_PRIOR` so the card can
print "Offense 2025" rather than implying it is current, and stops the moment a real game is played.

**Referee: the source could never do the job, and the script had already said so.** Its docstring
read *"if nflverse turns out to fill `referee` only post-game, we swap the source."* It does.
Measured: **272 of 272 games carry a referee for 2023, 2024 and 2025 — all played — and 0 of 272
for 2026.** So a daily workflow had been running for months, writing nothing, and reporting
success. ESPN publishes the assigned crew pre-game in `gameInfo.officials`; take the official whose
`position.name` is `"Referee"`, because the array is not ordered by seniority — `officials[0]` was
a Field Judge on the game checked.

**The general rule: a placeholder that never resolves is indistinguishable from a working feature
that is waiting.** Both look like "coming soon". For every "arrives with the season" string on a
page, ask what event makes it resolve and whether that event can actually happen — then check the
row count in the table behind it.
```bash
# every scheduled writer should be provably writing something
select count(*) from ref_assignments where season = 2026;   -- 0 after months of daily runs
```

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

**🚨 The NFL board had the identical bug from a different gate: PRIOR-SEASON HISTORY.** Derek:
*"I'm not seeing Jadarian Price... he is Seattle's starting running back and the sportsbooks have
him as the highest odds to score."* `player_proj_export` builds `rates` from last season's stats
and then:

```python
rate = rates.get(norm(player))
if not rate:
    unmatched.append(player); continue      # printed as "N unmatched (rookies/no 2025)"
```

**A rookie has no prior season, so he cannot have a row** — however short the market prices him.
Measured on the 2026 Week 1 slate: **136 of 552 priced players (25%) had no row**, and the misses
included the **four shortest anytime-TD prices on the entire slate** — Mike Washington Jr. (−200),
MarShawn Lloyd (−143), Jonathon Brooks (−140) and Jadarian Price (−115), Seattle's starter with
Charbonnet out. Fixed by falling back to the CURRENT ROSTER for team and position (it has every
rookie: Price, SEA, RB, ACT) and emitting the row with a null projection. Rows 876 → 998.

**The damning part: the count was printed on every single run and nobody read it.** Same shape as
`offteam` being "appended to a list nobody read". A drop counter is not a safeguard unless
something *reads* it, so these now name the players, not just tally them. The general rule:
**a log line is not a check.** If a number means coverage lost, assert on it or surface it.

And note this is the third distinct gate to cause the same bug — a scraped depth chart (NCAAF), a
stale team join (both sports), and now prior-season history (NFL). **Whatever decides who appears
on a prop board, reconcile it against who the market prices**, every audit:
```python
missing = {nm(r["player_name"]) for r in prop_snapshots} - {nm(p["player"]) for p in board}
# then rank the misses by their SHORTEST price — the market tells you which omissions matter
```
Rank by price, not by count: 136 missing sounds like a data gap, "the four shortest prices on the
slate are missing" is unmistakably a bug.

**It is a script now, not a rule: `analysis/board_coverage.py`.** Every rule in this file that
became runnable has stayed fixed; the ones that stayed prose have all been re-broken.
```bash
python analysis/board_coverage.py --season 2026 --week 1                  # report
python analysis/board_coverage.py --season 2026 --week 1 --max-missing 40  # gate
```
Measured before/after on 2026 Week 1: **25% missing → 7%**. And mind the filter that excludes team
defences — written as `"d/st"` it matched nothing, because it is applied AFTER `norm()` strips the
slash, so twenty D/ST entries sat in the results looking like real misses. Same false-zero shape as
every other parser in this file: **a filter that matches nothing is indistinguishable from a filter
that had nothing to match.**

The residual 7% is a different bug with a different fix: players the books price in a game their
roster team is not in (Khalil Herbert priced in SF @ LA while the roster has him on NYJ). Refreshing
the roster file did not move it, so these are genuine market-vs-roster disagreements — and per the
rule above, **the market is right about who is playing in which game**. Closing that gap means
trusting the priced game over the roster team, which is coverage information, not price information,
so it stays line-blind. Not yet done.

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

### 🚨 The market number on a board must be a number someone will actually take
Derek, twice in one session: *"Sam Darnold is listed at 228.5 on FanDuel. We have him at 230.5.
Where did we get that?"* and *"A.J. Brown listed at 61.5 and in FanDuel he is 64.5."* Three
separate faults stacked into those numbers, and each is worth checking on any board that shows a
market line.

**1. A dedupe key containing the LINE never expires a line.** `fetch_props` kept the newest row per
`(event, market, player, side, LINE, book)`. Because the line is in the key, a line a book has
moved off stays "current" for ever. Darnold carried **22 distinct lines from 197.5 to 258.5**;
A.J. Brown had a Fanatics quote from **17 August** sitting beside everyone else's from that
afternoon. Take the newest CAPTURE, not the newest row per key:
```python
len({r["line"] for r in rows_for_one_player_market})   # > 3 on a single market = you are pooling history
```
Use `collected_at` for that, never `snapshot_at` — the latter is the sweep key and equals kickoff
on legacy rows, so `max()` picks the latest GAME rather than the latest capture. That trap has now
cost two separate investigations.

**And a capture window is a WINDOW.** A sweep writes in batches, each with its own `collected_at`,
so matching the maximum exactly kept only the final batch and cut the slate from 16,901 quotes to
3,753. A filter can be too sharp as easily as too blunt — check the row count after adding one.

**2. An alternate ladder is one opinion, not seven.** Bovada posts seven rungs on a passing-yards
market (197.5 → 257.5, both sides). Pooled with books that post a single line, that let one book
cast seven votes and dragged the median away from the screen. Collapse each book to its MAIN line —
the rung whose two sides are closest to even money, since an alternate is priced away from even by
construction (257.5 was +175/−240, implying 36%).

**3. A median is not a bettable number.** Books at 64.5 and 65.5 median to **65.0**, which is not a
line any receiving-yards market posts. Derek's rule: *"we need to match FanDuel"* / *"the books will
always be the most accurate."* So print FanDuel's line where FanDuel posts one, and otherwise snap
the median to the nearest line a book actually offers. Name the source on the row — a column headed
"BOOK LINE" that shows a consensus nobody quotes is a small lie that a reader WILL check.

Standing check on any board with a market column — compare a few rows against the book by eye,
and assert the shape mechanically:
```python
# every displayed line must be one a book actually posted in the newest capture
assert all(row["book"] in posted_lines[(row["player"], row["market"])] for row in board)
```

### 🚨 A board must say who is NOT PLAYING, and it must say it live
Derek, on the Week 1 board: *"I believe Henderson or Stevenson is out tonight. Bettors rely on
fresh data."* TreVeyon Henderson had been ruled **Out (ankle)** at Wednesday's practice, and the
board was publishing a 37.5-yard rushing projection and a 48% career-over for him.

**We already held the fact.** `ingest/injuries_nflverse.py` had written `game_status: OUT` into
`practice_reports` hours earlier. It fed the game model's team adjustment (`injury_adj`) and
nothing else — nobody had ever joined it to the PLAYER board. Before assuming a data feed is
missing, grep for it: the gap is often a join, not a source.

**Check what is actually stale before optimising the wrong thing.** The instinct was "the page is
stale, run the workflow more often". Measured, the board's BOOK LINE was already live —
`PlayerModelView` calls `weekProps(week)` with `next: { revalidate: 120 }`. The projection is
build-time and *should* be: it is a prior-season baseline that does not move intraday. Only
availability was missing, and re-running the projections workflow hourly would have cost a commit
plus a full redeploy each time and **still shown Henderson**.

**Three rules the fix encodes:**
- **A player ruled OUT comes OFF the board.** Derek's call — *"if a player is injured and out for
  the game, we do not even need to list them."* I had argued for keeping the row with the
  projection dashed, on the grounds that a bettor should SEE he is out; Derek decided otherwise and
  that is the behaviour. Only the not-playing designations (Out / IR / suspended) remove a row —
  QUESTIONABLE and DOUBTFUL are game-time decisions, so those players stay, keep their projection
  and carry a tag. The trade-off to remember: a removed row is invisible, so a reversed designation
  makes a player silently reappear rather than visibly change. That is an argument for reading the
  feed LIVE (a reversal shows within 120s), not for baking it at build time.
- **Two sources, and the verifiable one leads.** `practice_reports` (ours) carries the Wed-Fri
  designations; ESPN's per-game block carries game-day movement and the T-90 INACTIVES, which the
  practice feed does not have at all. ESPN layers on top so a game-day change beats Wednesday.
- **A cron cannot serve a T-90 list.** Actions' finest useful cadence is ~5 min and scheduled runs
  routinely start 5-15 minutes late, so a T-90 sweep lands at T-70. A request-time read on a 120s
  cache is strictly fresher — and needs no table, no migration and no SQL anyone has to remember
  to run.

Watch the day-of-week field on any capture cron. `capture-practice.yml` ran `3,4,5,6` — Wed-Sat —
which covered the days the report is WRITTEN and stopped exactly before the days games are PLAYED.

**⚠️ ESPN 403s every request from some networks, including a local dev server.** A local probe had
it refuse every request carrying any `User-Agent` (and undici cannot omit one), while `cfbScores.ts`
has served live NCAAF scores from production for months using `User-Agent: Mozilla/5.0`. That is
egress fingerprinting, not ESPN policy. **When a local probe contradicts code that demonstrably
works in production, trust production** — but do not let an unverifiable source be the only one, which
is the second reason our own table leads.

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
- **401s from the anon lockdown**: the signed-out QA preview hits tables `anon` can no longer read.
  ⚠️ This was long recorded here as the CAUSE of the stall. **It is not — tested and disproved.**
  Setting `NEXT_PUBLIC_QA_PREVIEW=0` and restarting the dev server reproduces the stall exactly
  (live `main` reads "Loading…", 2 `main.wrap`, 1 pending `<template id="P:…">`), so the 401s are
  noise that happens to co-occur. Do not repeat the claim.

**What the stall actually is, measured.** The server is NOT slow and the HTML is NOT truncated:

| | |
|---|---|
| `/lines` server render (curl) | **0.59s**, 101KB, `</html>` present, 32 matchups in the markup |
| browser TTFB / response end | **105ms / 113ms** |
| state 50s later | live `main` = "Loading…", real content in a `[hidden]` div |
| React hydrated? | **yes** (`__reactFiber$` keys present) |
| inline scripts run? | **yes** |
| CSP | Report-Only, `unsafe-inline` allowed — not blocking |

So React hydrates, the document completes in a tenth of a second, and the route's Suspense boundary
still never resolves. Cause still unidentified; it is a `next dev` streaming behaviour in this
preview, NOT a page or query problem. Do not "optimise" a page because it shows Loading… here —
time the SERVER first (`curl -w "%{time_total}"`), and only chase it if the server is actually slow.

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

### ⚠️ A translucent background must be COMPOSITED before measuring contrast
`effectiveBg` returned any background with `alpha > 0.1` as if it were opaque, using its raw RGB.
The app's badges are `color-mix(in srgb, <the text colour> 13%, transparent)` — so the probe read
the pill's own text colour as its background and scored **contrast 1.00** on `.pmmatch--good` /
`--bad` ("soft pass D", "tough run D"): perfectly legible text reported as invisible, and it fired
only at mobile, which made it look like a responsive bug.

Collect the layers and alpha-blend down to the first opaque one:
```js
if (c && c.a > 0.01) { layers.push(c); if (c.a >= 0.99) break; }
let out = layers.pop();                       // opaque base
while (layers.length) { const t = layers.pop();
  out = { r: t.r*t.a + out.r*(1-t.a), g: t.g*t.a + out.g*(1-t.a), b: t.b*t.a + out.b*(1-t.a) }; }
```
Two-way tested — and the negative test took two attempts, which is itself the lesson: a synthetic
invisible-text element placed at `left:40px` did NOT fire, because it overlapped the rail's icons
and `effectiveBg` bails on imagery. **When a check fails to fire on a deliberate break, suspect the
placement of your test before concluding the check is broken.** Placed mid-viewport it reported
`contrast 1.00 ("INVISIBLE TEST TEXT")`, and 0 again on removal.

### 🚨 "Did it render?" is a CONTENT question, not a height question
The splice guard added one pass earlier tested `live.getBoundingClientRect().height <= 40`. A
Suspense shell is not short: `/considerations` rendered a **692px** live `main` containing the
single word "Loading…", sailed past the height check, and the probe audited an empty shell and
reported clean — the exact false pass the guard existed to prevent, reintroduced by a lazy test.

Count board rows in the live tree against the hidden copy, and splice only when the hidden one has
more:
```js
const CONTENT = '.pmrow--data, .hb-form tbody tr, .impgame, .aurow, .propgame, .refrow, .augame';
if (hid && hid.querySelectorAll(CONTENT).length > live.querySelectorAll(CONTENT).length) { /* splice */ }
```

**⚠️ That row-count guard has its own hole, and it fired on four pages in one pass.** A page with
no board ROWS at all — `/dashboard`, `/bankroll`, `/lines` and `/context` on an empty week — scores
`0 > 0`, so the splice never runs and the probe audits a "Loading…" shell that reports clean.
`/dashboard` was a **692px** live `main` containing one word. Test the row count **or** the text:
```js
const txt = live ? live.textContent.replace(/\s+/g,' ').trim() : '';
const stalled = !live || txt.length < 200 || /^Loading/.test(txt);
if (hid && hid.children.length && (stalled || richer)) { /* splice */ }
```
After the fix those pages measured 4,039 / 4,389 / 5,042 / 1,254 characters and one produced a real
finding. **Report the character count alongside `dataRows`** — on a page that legitimately has no
rows, characters are the only evidence anything was measured at all.
Report `dataRows` with every page result. **A page reporting zero rows was not audited**, whatever
its finding count says — treat it as unverified and say so, rather than counting it as clean.

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

**The same trap catches ad-hoc measuring, not just the probe.** A one-off `javascript_tool` snippet
that reads widths on `/mlb/model/players` came back with *every* number zero — header widths, row
heights, table width — because `document.querySelector` had handed back the copy inside `#S:0`. The
tell is a set of impossible zeros, and the fix is the same splice; do it before measuring, then
sanity-check one width against the screenshot. Also note the splice must be paired with removing the
live placeholder `<main>`, or the page renders two boards and the outer widths are wrong.

**Measuring cell-by-cell will hang the bridge.** Cloning ~5,000 cells into the document to read their
natural widths returned `javascript_tool failed: Internal error` twice. Append clones into one
reused off-screen container, measure one column at a time, and return a `JSON.stringify` string
rather than a large object graph.

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

**The generator now runs this itself** — `cfb_player_proj.main()` prints `reconciled: all N priced
player-markets have a row` or a `WARNING: … have NO row` naming the first eight. A refresh log
without the `reconciled:` line is a failed refresh. Read it before trusting the board.

### 🚨 "Missing players" is never ONE bug — it is a stack, and each layer hides the next
Derek's report on the 2026-09-12 NCAAF slate: *"One section says there's 30 games today and there
are about 80. We are missing players and games… I do not even see Isaiah Sategna III… Parker
Livingstone does not appear to be WR1… The players and odds in the model sections need to match the
players and odds in the sportsbooks (fanduel). Simple as that."*

That one sentence turned out to be **seven** separate defects, found one at a time because each one
capped the board at a size where the next could not be seen. Every layer below is a check to run,
in this order, whenever coverage looks short:

| # | Layer | Symptom | Measured | Check |
|---|---|---|---|---|
| 1 | Reader truncation | 6 games / 132 players | `cfbProps.fetchRows` used `limit=8000` → 1000 rows | `len(rows) == 1000` — page it |
| 2 | Export cadence | Priced Friday night, no row Saturday | daily 13:00 UTC export vs Fri/Sat postings | rows priced after the export's `snapshot_at` |
| 3 | Name key: suffix | Sategna absent | `"Isaiah Sategna III"` (book) ≠ `"Isaiah Sategna"` (CFBD) | `norm()` strips `jr/sr/ii/iii/iv/v` |
| 4 | Current season never fetched | 973 wrong depth slots | `HIST_SEASONS=[2024,2025]` only; 2026 week 1 never pulled | `LOG_SEASONS` includes `CUR_SEASON` |
| 5 | Team-name spelling | 3 whole games gone (55 players) | "Southern Mississippi Golden Eagles" / "Appalachian State" / "Hawaii" never prefix-match CFBD's "Southern Miss" / "App State" / "Hawai'i" | `cfbd_team_map` prints every unmapped feed name |
| 6 | Name key: nickname | Starting QB with no projection | "Gio Lopez" vs CFBD "Giovanni Lopez"; "Kam"/"Kameran"; "JoJo"/"Jovanni" | `reconcile_book_names` — last name + first initial on a game team, else depth-chart team + last name; ambiguous → leave alone |
| 7 | Team from the log | Transfer stranded on old school | `e["team"]` was the FIRST team parsed (alphabetical) | team = the team of his MOST RECENT game; depth chart still overrides |

Plus one that was not a data bug at all: the second pass `continue`d past any priced player it could
not project — no log, log on another team, too little history — **240 of 866 priced players (28%),
headed by the shortest TD prices on the slate.** A row with the book's line and no projection is
the honest answer; silently dropping him is not. The reasons are now counted and printed.

After all seven: **1,314 of 1,314 priced player-markets on the board, 45 of 45 games**, Sategna WR1
at FanDuel's 38.5%, 37 rows (2.8%) with no projection — all true freshmen or no-log names, all
still listed with their line.

**The rule: when a board is short, do not stop at the first cause.** Fix it, regenerate, re-measure
`priced − shown`, and keep going until the gap is zero or every remaining name has a reason you can
say out loud. Each fix here raised coverage by 10–30 points and exposed the next.

### The name on the board is the BOOK's spelling, the key is not
Rows carry the sportsbook's display name (`PROP_DISPLAY`, applied at the write step), keyed
internally on a suffix-blind, nickname-reconciled `norm()`. A reader checks the board against the
FanDuel app by the name they see there; CFBD's "Isaiah Sategna" against the app's "Isaiah Sategna
III" reads as a different player. Same reason the market column is FanDuel's number: the board is
read NEXT TO the book, so it has to use the book's words.

Team scoring props (`"… D/ST"`, `"… Defense"`) are filed by the books under player anytime TD.
They are not players — skip them at the reader (`fetch_props`) AND at the live-row path in
`PlayerModelView`, or the TD board grows 120 rows of "Michigan Wolverines Defense".

### 🚨 The market column is only as fresh as the capture job
Derek read Livingstone at **+900** in the FanDuel app while the board said **+550** — from a
snapshot ten hours old (`capture-cfb-props` ran twice daily). The boards read the NEWEST snapshot
live, so no amount of view-side work can beat the cron. Every "our number doesn't match the book"
report starts with `select max(snapshot_at)` — if it is hours old, the capture cadence is the bug.
Now every 2 hours (~540 credits per run on a Saturday), with the projections refresh twice daily.

And the anytime-TD market column now comes from the live capture too: `fanduelLines` /
`cfbFanduelLines` carry FanDuel's Yes price as an implied % (`impliedPct`), where before only
yardage lines were overridden and the TD % was the median baked into the projections file — nobody's
price. DK Metcalf: file 34.0%, FanDuel +185 = 35.1% — the board shows 35.1.

### 🚨 A generated data file can be too big for `tsc`
1,314 rows in one array literal, now mixing `slot: null` with `slot: "WR1"` and `proj: null` with
numbers, made `tsc` fail with **TS2590 "Expression produces a union type that is too complex to
represent"** on `lib/ncaafPlayerProjections.ts:8`. The generator emits `const P0…P4: PlayerProj[]`
chunks of 300 and spreads them into the export. Local `next dev` was fine — only `tsc` (CI) sees it.
Run the clean-state typecheck after any change that grows a generated file.

### A projection job fetches the live season TWICE unless you memoise it
`_fetch_all_logs` is called by `team_logs` and again by `defence_by_category`. Completed seasons hit
the disk cache; the CURRENT season is deliberately never disk-cached, so once `LOG_SEASONS` included
2026 the second call re-pulled all 138 payloads from CFBD. `_LIVE_MEMO` holds them in-process, and
`_fetch_one` retries once — a transient failure on a current-season pull is a whole team's week-1
usage missing (its QB1 with no log, no slot, no projection), and the run said only "4 of 414 pulls
failed" without naming which.

### 🚨 A line captured AFTER kickoff is a LIVE line, not a market line
Derek: *"I know Jalen Coker's market receiving yards is not 130.5."* It was not — pregame FanDuel
had him at 37.5. The 6-hourly props sweep ran at 20:13 UTC, three hours into Panthers–Bears, and
`/events/{id}/odds` for a game in play returns the books' LIVE props (he had ~120 yards at the
time). The capture wrote them like any other row, the export took the newest sweep per event as
"current", and the board published 130.5 as the market.

Three places had to change, and all three are checks now:
1. **Capture never polls a game in play.** `props_client.py` drops events whose `commence_time`
   is past, sorts by kickoff, THEN applies `--max-events` (the cap used to spend itself on whatever
   order the feed returned). `odds_client` already had this via `--commence-within`; `cfb_props.py`
   via `now <= ct`. **When you add a capture, look for the in-play guard first.**
2. **Every reader keeps pregame rows only** — `pregame()` in `lib/props.ts`, the same filter in
   `cfbProps.fetchRows`, and the export (`player_proj_export.current_rows`), which prints how many
   in-play rows it dropped. For a played game the newest PREGAME sweep is its close.
3. **The generated file can still carry the bad number** — the projections export that ran after
   kickoff baked 130.5 into `playerProjections.ts`, and the live override could not replace it
   (the pregame rows were outside the newest-capture window). Regenerate the file after fixing a
   reader; the reader fix alone leaves the stale value on the board.

Standing check, any snapshot table:
```python
late = [r for r in rows if r["collected_at"] >= r["commence_time"]]     # must be 0 going forward
```
And the eyeball version: **a yardage line above ~110 on a receiver, or any line that moved by
3× in one sweep, is a live line.** Compare the board's market column to FanDuel's PREGAME number,
not to whatever the app shows while the game is on.

### 🚨 The newest sweep drops every game that has kicked off — "? @ CAR"
Derek's screenshot of the NFL model board: `? @ CAR`, `? @ CIN`, `? @ DET` … every game but
Monday night's, with no market row. `fetchWeek` returned the week's newest full sweep, and the
odds feed removes a game the moment it starts, so once Sunday was over the newest week-1 sweep held
one event; `lib/model.ts` fell back to `{home: subject, away: "?"}` for the other fifteen.

`fetchWeek` now returns, for every played game, its **last pregame sweep — its closing line** —
alongside the newest sweep for the games still to come. That is also the number the report card
grades against. Standing check after any week completes:
```js
[...document.querySelectorAll('article.game .matchup')].filter(m => m.textContent.includes('?')).length   // 0
[...document.querySelectorAll('article.game')].filter(a => !a.textContent.includes('The market')).length  // 0
```
Sibling: the `PRE_KICKOFF` closing-line cron never fired for 1pm ET or prime-time games (window
`17-23 UTC` started AT the 1pm kickoff; SNF/MNF/TNF land after midnight UTC on the NEXT weekday),
so week 1 had zero PRE_KICKOFF rows. Now `16-23 UTC Sun/Mon/Thu` + `0-1 UTC Mon/Tue/Fri`, 45-min
window. **Check crons in UTC against the actual kickoff times, and count the rows they produced:**
`select capture_reason, count(*) … where week = N` — a reason with 0 rows is a cron that never ran.

### The weekly report card — grade what was PUBLISHED, not what the board shows now
`/report` (`weekly_report.py` → `lib/reportCards.ts`, review in `lib/reportNotes.ts`). Rules that
make it honest, each of which was a way to cheat by accident:
- **The files as committed before each kickoff** (`git rev-list -1 --before=<kickoff> main`, then
  `git show ref:path`), never the working copy — the nightly jobs regenerate the projections and
  the NCAAF card daily, and by Tuesday the file describes NEXT week (`PROJ_WEEK` had already moved
  to 2 when week 1 was being graded). One ref per kickoff time; a Saturday slate used 13.
- **The market is the closing line from the snapshot tables**, pregame, FanDuel where posted. Not
  the projections file's `book` (see the live-line entry above) and not the card's own market
  field (refreshed weekly, overlaid live).
- **Anytime TD is calibration, not W/L.** An "over" lean on a 15% player who does not score is the
  expected outcome. Report mean ours vs mean book vs scored %, and a Brier for each.
- **Ungraded rows are excluded, not counted as losses** — players with no stat line (inactive) or
  a name CFBD spells differently. Say how many.
- **The narrative cites the card's numbers** and is written after reading it. `reportNotes.ts` is
  hand-written and keyed `${sport}-${season}-${week}` so a regeneration never touches it.

Run it Tuesday for both sports (`--sport nfl --week N`, `--sport ncaaf --week N`), read the
summary it prints, write the note, commit both files. Week 1 NFL: SU 9-7, vs close 4-12, totals
5-11, prop leans 183-175, TD calibration 20.8 / 21.8 / 21.0. NCAAF week 2: SU 72-14, vs close
38-48, prop leans 183-153, projections 5–12 yards HIGH per category.

### 🚨 A week default of `weekRange().min` is week 1 forever
Every NFL page (`/model`, `/props`, `/lines`, `/best`, `/considerations`, `/context`,
`/local-intelligence`, `/audit`) defaulted to `range.min` — the EARLIEST week with any odds
captured, which is week 1 all season. The Tuesday after week 1, every board opened on the
completed week, `/props` on an empty one. Now `currentWeek()` (earliest week with a game still to
play), `min` only as the fallback. Same family as the NCAAF default-week bug: **a default must
name the week a reader wants NOW, and the audit checks the bare URL, not just `?week=N`.**
```bash
curl -s "$BASE/props" | grep -o "Sep [0-9]*" | head -3     # must be THIS week's dates
```

### "Adjust the model" means measure first — the two adjustments that survived week 1
Derek: *"deep analysis on what happened in week 1 and adjust accordingly."* Three candidates,
two changed, one deliberately not:
- **NFL game model: unchanged.** Week 1 (16 games): ours 12.6 MAE vs the close 11.2, Brier 0.244
  vs 0.210, margins compressed the same as the market's (3.7 vs 4.1), home lean +3.2 vs +2.7.
  Nothing there overturns parameters chosen on 2016-22 and held out on 2023-25; the in-season
  blend (PRIOR_K) is the designed week-2 adjustment. Retuning on one week is how a model gets
  worse — say so instead of changing a number to look responsive.
- **NFL props: current-season volume blended in** (`CUR_K = 1.5`, `player_proj_export.py`).
  They were prior-season-only all year. Backtest 2023-25, next-game volume from prior mean +
  season-to-date mean: carries 3.87 → 3.13, WR targets 2.05 → 1.93, QB attempts 8.36 → 7.76;
  flat optimum K = 1-2. The workflow now fetches `stats_<SEASON>.csv` (optional — missing before
  week 1 is not a failure).
- **NCAAF props: the role rule is a symmetric blend** (`ROLE_MODE = "blend2"`, K=3,
  `PRIOR_GAME_W = 0.25`). `max(role, own)` could only lift and ran +7.0 biased on week 2.
  `analysis/cfb_role_backtest.py` re-projects PLAYED weeks with `cfb_player_proj.py --week N
  --all-rows` (current-season logs cut off before the slate — the honesty guard) and scores
  every priced row: week 2 MAE 22.6 → 21.2, bias +7.0 → +2.8; week 1 tied. **K=3 was picked
  because it is best-or-tied in BOTH regimes**, not because it won either week.
The backtest mode itself is the reusable part: any projection change to `cfb_player_proj.py`
can now be scored on a played slate in minutes. Run it before shipping a "fix".

### The market is right about who is at home — join on the pair when the ordered key misses
`cfb.db` had "Arizona State @ Kansas"; every book priced "Kansas @ Arizona State". The prop
keys are `"away @ home"`, so all 42 of that game's priced player-markets found no slate game and
the reconciliation warned. The slate row now takes the feed's ordering when the reversed key is
priced. Same rule as the roster/team entries above: a fact the market cannot be wrong about wins
over our reference.

### 🚨 The `weekRange().min` bug again — this time in a CAPTURE job
Fixed in eight web pages one week, found in `weather_capture.py` the next: *"current week = the
earliest week still on the board"*, implemented as `order=week.asc&limit=1` over the whole season,
which is week 1 from September to January. So from week 2 onward the job refreshed the forecast for
games already played, `WEATHER_WEEK` stayed 1, and the model board showed no weather at all —
silently, with a green run every eight hours. Now `commence_time=gt.<now>` first, mirroring
`currentWeek()`.

**Grep for the shape after fixing it anywhere**, because it is copy-pasted per script and per page:
```bash
grep -rn "order=week.asc&limit=1\|week.asc" --include=*.py --include=*.ts . | grep -v commence_time
```
And the audit check that catches it without reading code: **a "current" data file whose week stamp
is not this week.** `grep -n "WEEK = " web/lib/*.ts` — every one of those should be the live week.

### The Context SECTION is gone — one game, one place
Derek, after moving Special Considerations onto the board: *"I want to remove the Context section
completely because I received feedback that there is too much data spread across the app and
website. We need to centralize."* So the three-step flow is two steps (The Model → Value Finder),
`ContextSubnav` is deleted, and `/context`, `/local-intelligence`, `/tailgate` and their NCAAF
twins redirect to their model board. The Chaos Board became the **Upset Meter** on each game.

**When you retire a whole section, the checklist is: FlowSteps, the drawer, the top nav, the
landing panels, the sub-nav component itself, and every route.** Each of those held a reference
here; `tsc` catches none of them because they are all strings.

### 🚨 An "Upset Meter" is a composite score — name its parts or it launders them
This project's founding rule is *"panels inform, they do not vote"*: combining zero-edge signals
produces zero edge while the appearance of rigor rises sharply. A single 0-100 upset number is
exactly that machine — unless it shows what produced it. `lib/upsetMeter.ts` therefore:
- weights **our model's own disagreement with the market** highest (40), because that is the only
  component with a graded track record;
- carries scoring, weather and referee as context (18 / 14 / 12), each measured, none an edge;
- gives the non-predictive chaos index the smallest share (16) and **says so on the card**;
- renders EVERY driver with its own bar, so a reader who disagrees can see which factor carried
  the reading, and renormalises when a component is missing (college has no referee crew).

If you ever find yourself writing a composite that hides its inputs, that is the tell. Publish the
breakdown or do not publish the number.

### One board = one column header, EXCEPT when the rows are far apart
The rule above ("One board = ONE column header") is right for a plain list and wrong once rows are
separated by tall panels. With Special Considerations and an Upset Meter under every game, a single
header at the top of a day group is off screen by the second game — Derek: *"Each game should have
the Game, Spread, Total, Model Spread, and Model Total headers to start."* So each `.impgame` card
carries its own header, and the Bottom Line stopped being a loose strip underneath and became the
sixth column. Verify the header and its data row share column edges rather than trusting the CSS:
```js
const L = (r) => [...r.children].map(c => Math.round(c.getBoundingClientRect().left));
JSON.stringify(L(head)) === JSON.stringify(L(data))   // must be true
```
The distinction that keeps both rules true: a header per CARD is fine, a header repeated inside
one continuous table is the bug the original rule was written for.

### Context lives WITH the number, not on its own page
Both sports' "Special Considerations" pages are retired; their factors sit under each game's row
on the model board (`app/SpecialConsiderations.tsx`, `app/ncaaf/NcaafSpecialConsiderations.tsx`).
Derek: *"move the context data into our model data... add a Special Considerations section under
the Bottom Line. I want to remove the Special Considerations section completely from the Context
section."*

Three things that pass forward to any block like it:
- **Retire a route by REDIRECTING it**, not by deleting it. `/considerations` and
  `/ncaaf/considerations` are pinned on dashboards and linked from the homepage; they now land on
  the board that carries the same facts. Also sweep the nav, the drawer and the landing panels —
  `grep -rn "/considerations" web/app` found five other references.
- **Only move what the sport HAS.** The NFL block is referee · weather · injuries · scoring;
  college has no pre-game referee crew and no injury report at all, so it carries site · weather ·
  conference · per-team scoring and power rating instead. An empty "Injuries" row on 71 college
  games would be a placeholder that never resolves — the rule this file already has about
  "arriving soon".
- **A full-width detail row needs its own mobile rule.** `.hb-form--cards` turns each table row
  into a two-column card at 375px, which squeezed the spanning cell into half the width and
  ellipsized it. `tr.hb-specrow{display:block}` + `td{grid-column:1/-1}`.

### 🚨 A season-to-date SIMPLE MEAN cannot see a role change — which is the only reason to look
Derek, on tonight's Green Bay backfield: *"Kaleb Johnson is projected to be Green Bay's starter and
get a bulk of the carries. We cannot look at his career % and need to predict his carries and volume
better."* Tracing it found THREE defects stacked in the same few lines, and the shape generalises.

**1. A simple mean averages the old role with the new one.** Johnson carried 0 times in week 1 and 8
in week 2; `current_season_rates` called that 4.0. The whole point of reading current-season usage is
to catch a role that has moved, and a flat mean is the one estimator guaranteed to split the
difference. Replaced with a recency-weighted mean, half-life 2.5 games.

**2. `apply_role` was weighted by the wrong count.** `blend_current` sets `games = prior_games +
current_games`, and the role blend then used that as "how much do I trust this player's own volume".
For a player whose role just changed, that count is mostly games in the role he no longer has:

    MarShawn Lloyd   no prior row, games=2   -> 2/(2+12)  = 14% own, 86% a league RB1 median
    Kaleb Johnson    12 prior + 2, games=12  -> 50% own, and that "own" was last year's reserve rate

So the back with 19 carries in two games was overwritten by a league median, and the back the market
now has leading was anchored to his old role — from one line of code.

**3. ROLE_K=12 was measured on the WEEK 1 problem and left switched on all season.** The depth-chart
rank is a coarse, LAGGING proxy for volume; once a player has actually carried the ball you hold a
direct measurement of the thing the proxy estimates. Swept against next-game volume on 25,193
player-games with the chart as it stood going into each week — the pull is monotonically harmful from
the second game onward, so it now tapers: `role_k_for(cur_n)` = 12 at 0 games, 2 at 1, **0 after**.

Held-out 2025-26 (train 2021-24 chose everything):

| | MAE | |
|---|---|---|
| all positions | 2.829 -> 2.774 | +1.9% |
| RB carries | 3.329 -> 3.257 | +2.2% |
| QB attempts | 8.349 -> 8.139 | +2.5% |
| role stepped up | 3.291 -> 3.156 | +4.1%, and **bias -1.88 -> -0.96** |

The board-wide number is small; the bias number is the one that mattered. We were projecting
newly-promoted players ~2 carries/targets per game under what they went on to do, every week.

**Two things that did NOT work, recorded so nobody rebuilds them:**
- **Last game only** is far worse than the simple mean (MAE 3.24 vs 2.93). The answer is "weight
  recent games more", never "use the recent game".
- **Volume as a share of team volume** added nothing (2.939 vs 2.927). There is no share layer on
  purpose.

**The cross-check that found it: NCAAF already did this right.** `cfb_player_proj` has had
`DECAY = 0.82` (a ~3.5-game half-life) and a *steeper* `DECAY_MOVED = 0.78` for promoted starters
since it was written. **When two sports run the same kind of model, diff their constants** — the one
without a recency term is not simpler, it is the one with the bug.

### 🚨 A "share of team volume" computed from the current season ERASES anyone out all season
Derek: *"have we considered Michael Penix's return into our model spread and over/under yet?"*
Checking turned up something worse than a missing feature. `injury_adj._shares` took each player's
share of his team's volume from CURRENT-SEASON games only, falling back to the prior season just in
week 1, when the current frame is empty. A starter out since the opener therefore has no volume, no
share, and **no adjustment at all**:

```
week 1   ATL QB shares: Penix 0.51, Cousins 0.49   -> adjustment -2.20   fires
week 2   ATL QB shares: Cooper Rush 1.00           -> adjustment  0.00   silent
```

The longer a starter was out, the more completely the model forgot him — and long absences are the
ones that move a line. The bug hides because the adjustment works fine for a player hurt in week 6,
who by then has five games of share on the books. The fix folds the prior season in at
`SHARE_PRIOR_K = 4` games; ATL week 2 goes 0.00 → **−2.81**.

**Be honest about what it bought: nothing measurable.** Swept 0/2/4/6/10 on train 2017-22 and
held-out 2023-25, every value lands within 0.05%, and in three held-out seasons exactly ONE game is
the forgotten-starter case — because a player out long enough usually goes to IR and drops off the
injury report entirely, where neither version can see him. It ships as a CORRECTION, on the footing
this project already uses for injury_adj: the standard is "do not publish a number we know is
stale", not "beat the line".

**The general check: whenever a feature weights by a share, ask what that share is for someone with
zero of the thing.** Zero usage should not silently mean zero importance.

### 🚨 Decompose a board-shaped complaint BEFORE fixing anything
Derek said three times that the top half of the receiving board was all unders and the bottom half
all overs. Two real bugs were found and shipped in between, and **neither changed the pattern**,
because neither was the cause. The decomposition that should have come first:

**1. Is the LEVEL wrong?** No. Sum each team's projected receiving yards and compare to the sum of
the same priced rows at the book's numbers — ATL 181.6 vs 177.0, GB 216.1 vs 205.5, BAL 59.2 vs
72.5. Team by team we allocate what the market allocates. So it is a distribution question, and
every level-shifting fix was doomed before it was written.

**2. Is the DISTRIBUTION wrong?** Yes, measurably — and mostly unfixable. Over 2,393 team-weeks
with no market data:

| share of a team's targets | ours | reality |
|---|---|---|
| top receiver | 27.2% | **30.7%** |
| top two | 47.4% | **52.3%** |

But sharpening it (`share^γ` renormalised) made per-player MAE **worse at every γ > 1**: 1.688 →
1.722 at the γ that matched the concentration exactly. **The flat split is not a failure to see the
WR1 — it is a hedge over WHICH receiver leads that week, and hedging minimises absolute error.** A
backfield is more stable, so the same transform pays there: carries γ=1.10, held-out MAE +0.56%,
top-1 share 56.5% → 59.2% against an actual 59.9%. Shipped for carries, refused for targets.

**3. Is it UNITS?** Mostly, yes — see the mean-vs-median entry below. And the attempted fix failed
in an instructive way: converting to a 50/50 number improved MAE **+4.44%** on all player-games,
then swung the board from 67% over to **33% over** when applied. The ratios were fitted on every
player-game, but **books only price players with real roles**, whose distributions are far less
skewed. Same population-selection trap as the `line >= 40` entry below, one more time.

**The rule: when a complaint is about a board's SHAPE, decompose into level, distribution and units
before touching a constant.** Each has a different fix and a different test, and a fix aimed at the
wrong one can measure clean and change nothing a reader can see.

### 🚨 A founding finding can be true for one position and wrong for the next one over
Derek: *"All of the main receivers are all unders and the bottom half players are all overs. That is
not correct."* He was right, and it took THREE wrong answers to get there. Worth keeping all of
them, because each was a plausible explanation that measured clean:

1. **Market skew** — real (see the entry below) but it explains the board's overall lean, not why
   the split lands exactly at the middle of one game's list.
2. **The current-season volume blend** — hypothesis was that `CUR_K = 1.0` over-weights a 2-game
   sample. Swept K separately at each n: the optimum at n≤2 is **0.5, LOWER** than we ship, and a
   per-n schedule made WR/TE at n≤3 **worse (−1.90%)** held-out. The blend is right.
3. **Volume-tiered efficiency** — measured earlier, no out-of-sample gain.

The actual cause is the efficiency term, and it is a founding finding applied one position too far.
`rec_yds` was volume × a LEAGUE catch rate × a LEAGUE yards-per-reception, discarding the player's
own efficiency entirely, because "volume persists, efficiency doesn't". **That finding is about
RUSHING** — yards per carry correlates 0.058 year to year. Receiving is a different quantity,
because yards per target is substantially a ROLE, and roles persist:

| | WR | TE | RB (receiving) | rushing YPC |
|---|---|---|---|---|
| season-over-season r | **0.207** | **0.336** | 0.104 | 0.058 |

So the league baseline marks efficient receivers down and inefficient ones up — the exact top-half-
under / bottom-half-over board Derek was reading. Held-out 2025-26, volume held identical so only
this term moves:

| | bias, league baseline | bias, own regressed |
|---|---|---|
| WR efficient (top third) | **−3.29 yds** | −1.63 |
| WR inefficient (bottom) | **+2.44** | +1.57 |
| TE efficient (top third) | **−3.64** | −1.06 |

`REC_YPT_K = {"WR": 500, "TE": 120}` now regresses a receiver's own yards-per-target toward the
league rather than replacing it — the same shape `PASS_K = 300` already used for QB passing yards,
whose comment had said *"QB YPA persists (unlike RB/WR efficiency)"* for as long as the file has
existed. Nobody had tested the receiver half of that parenthesis. RB stays on the league rate
(r = 0.104, held-out −0.10%).

**MAE barely moves (WR +0.30%, TE +0.14%) and it still ships**, because it is a CALIBRATION fix. A
number that is systematically 3.3 yards light on every good receiver is wrong in a way a reader can
see — which is precisely how it was found.

**The rule to carry: when a project-wide finding gets applied to a new position or market, re-measure
it there.** "Efficiency doesn't persist" was measured on carries and quietly inherited by targets.

### ⚠️ Whether a QB1 is out barely moves his receivers' VOLUME
Tested while explaining the above, because it was the obvious next suspect for a star whose targets
had halved. Within-player, comparing each receiver's games with and without his team's leading
passer, 2021-2025:

    all receivers (n=258)        3.34 -> 3.40 targets/game   (+0.06)
    high-volume only (n=40)      7.24 -> 6.74                (-0.50)

Essentially nothing. A back-up quarterback throws to the same people. So a receiver whose target
share has collapsed while his QB was hurt has genuinely lost role — do not explain it away with the
quarterback, and do not build a correction for it.

### 🚨 "X% of rows lean over" is measuring SKEW unless the market is symmetric
Derek: *"look into why starter rows lean 62% over."* The answer is that the metric was wrong, and
the same trap is available on every board this project publishes.

We publish a recency-weighted **MEAN**. A book prices a yardage line near the **MEDIAN**, because
that is where the two sides split. Receiving and rushing yards are strongly right-skewed — a floor
at zero, an occasional huge game — so the mean sits above the median almost always, and
`proj > line` fires far more than half the time **even when both numbers are perfectly calibrated**.

Measured on 44,619 player-weeks, 2021-2025, with no market data at all:

| market | mean/median at a LOW level | at a HIGH level | our mean above the median |
|---|---|---|---|
| rec_yds | 1.83 | 1.13 | **95.9%** of rows |
| rush_yds | 1.74 | 1.10 | 90.9% |
| receptions | 1.48 | 1.01 | 69.2% |
| **pass_yds** | **1.01** | **1.01** | **52.0%** |

**Passing yards is the control and it settles it.** Attempts and passing yards are near-symmetric,
mean/median is 1.01 at every level, and that market shows no lean. The lean tracks each market's
SKEW, not anything about the model. (Anytime TD is the other control, already in this file at 36-37%
over in both sports, because there `proj` and `book` are both probabilities.)

It also explains the shape seen on the board: projection-to-line ran **1.43** on lines under 15 and
**0.96** on lines over 50 — the same curve as the skew, because it IS the skew.

**Two consequences:**
- **Never rank a review queue by `|proj - line| / line`.** It sorts by smallness of line. The
  replacement in `weekly_flags.py` ranks by rows contradicting THEMSELVES — our projection says
  comfortably over while the player's own hit rate at that exact line is under 35%. Those are real
  (Xavier Hutchinson: ours 50.2, line 40.5, clears it 10% of the time) and need no market constant.
- **The boards were already right.** `projLean()` reads the arrow from the player's empirical
  exceedance rate, not from proj vs line, which is exactly this fix applied earlier for NCAAF. The
  bug was in the new QA metric, not in what users see — worth checking which of the two you are
  looking at before concluding the board is broken.

### ⚠️ Two measurements that disagree are usually measuring different populations
Derek: *"most of the receivers are an under for tonight's game. Is that correct or a data error?"*
Neither — the answer needed three separate numbers, and the first two look contradictory.

1. **The visible board is sorted by line size**, so every under clusters at the top where the eye
   lands. Tonight was 7 of 13 over (54%); the whole 16-game board was 66 of 111 (59%) over.
2. **Against the MARKET there is a real slope**: WR1 rows are 33% over while WR2 are 71% and RB1 78%,
   and the projection-to-line ratio runs 1.43 at lines under 15 down to 0.96 at lines over 50.
3. **Against ACTUAL RESULTS there is no compression at all.** Regressing actual on projected over
   held-out seasons gives b = 0.906 (WR), 0.913 (TE), 0.937 (RB) — all **below** 1, meaning our
   spread is already slightly too WIDE. Stretching projections to match the market's spread was
   measured and made MAE worse at every position (WR −1.26%, RB −1.61%).

So we sit inside the market's spread on star receivers, and our own calibration says the market's
spread — not ours — is the wide one. That is a Value Finder observation, untested, not a model bug.

**I had earlier called finding (2) an artifact and dropped it.** That was wrong in an instructive
way: bucketing by OUR projection finds the players we think are big and we overshoot those;
bucketing by the MARKET's line finds the players it thinks are big and we undershoot those. Both are
real. **When two slices disagree, name the population each one selected before deciding which is the
artifact** — and settle it with a third measurement that uses neither selector, which here was
regressing on outcomes.

### 🚨 The official injury report has two blind spots, and both hide the biggest role changes
Derek: *"I'm not seeing Jaxson Dart major injury in the NYG game (he's out for the season)... Also
the same for Caleb Williams for the Bears."* Both were genuinely missing, and not from a bug — from
what the feed IS. nflverse `injuries` is the league's official game-status report:

- **No designation lands before Friday.** Dart was in our week-3 data with `practice_status =
  "Did Not Participate In Practice"` and `report_status = NULL`. We only ever read `report_status`,
  so the strongest practice signal there is read as nothing.
- **A player moved to IR drops OFF the report entirely** rather than being marked, because he is no
  longer on the active roster. Caleb Williams had **zero rows**.

Measured the same morning against Sleeper (`api.sleeper.app/v1/players/nfl`, free, no key, 2.6MB
gzipped):

| | nflverse | Sleeper |
|---|---|---|
| Jaxson Dart | undesignated DNP | **Out** — Knee/MCL, *Surgery*, depth order 3 |
| Caleb Williams | nothing at all | **Doubtful** — hamstring |
| Jayden Daniels | nothing | **Out** |

It is layered BETWEEN our own capture and ESPN: it fills the silence the official report leaves,
and ESPN's game-day inactives still overrule it, because 90 minutes before kickoff the official
list is the truth and a wire report is not. **Skill positions only** — Sleeper carries ~14
designated players per team across the full roster, mostly long-term IR that changes nothing this
week; unfiltered it buried the block. Filtered it is ~4.4 per team, 140 rows across a 16-game
board.

**The general rule: know whether your feed is a RECORD or a REPORT.** A record of what a league
filed is on the league's schedule, not the news's. Anything that moves on news — a role change, a
surgery, a promotion — needs a source that moves on news. Check the same way: name two players you
know are hurt and grep the feed for them.

Also worth carrying: Sleeper's `gsis_id` is populated on only **20%** of active skill players (and
some values have leading whitespace), so it joins on normalised name **plus team** — the weaker key,
which is why the team has to agree too.

### ⚠️ A count of DESIGNATIONS is not a count of games missed
The "key players back" row (Derek: *"ATL is getting their QB1 Michael Penix Jr back"*) shipped with
two wrong numbers on the first pass, both from reading a feed literally:

- **"Tua Tagovailoa · missed 2 games"** counted a week he was listed DOUBTFUL. Doubtful is a
  designation, not an outcome; a doubtful player who suits up missed nothing. The count now takes
  OUT and IR only, while DOUBTFUL still qualifies him as having been hurt — two different questions,
  two different filters.
- **"TreVeyon Henderson · missed 1 game"** was three weeks stale. He was out in week 1 and back in
  week 2, and a three-week lookback happily announced him as returning in week 3. A player only
  counts as back if he was designated in the week IMMEDIATELY before; the wider window exists only
  to measure how long he was gone.

Also note the shape of the underlying count: `practice_reports` is written several times a week, so
counting ROWS says a player missed six games inside one week. Count distinct weeks.

**Verify any number the board publishes against the source before believing the render.** One query
settled both: `wk1=NONE/OUT wk2=NONE/OUT wk3=NONE` for Penix (2 is right), `wk1=NONE/OUT
wk2=DOUBTFUL/NONE` for Tua (2 was wrong).

### ⚠️ Next will not cache a fetch over 2MB, and says so only in the server log
Reading Sleeper's all-players endpoint straight from a server component looked fine — the page
rendered, the data was right. The dev log said otherwise:

```
Failed to set Next.js data cache for https://api.sleeper.app/v1/players/nfl,
items over 2MB can not be cached (19548885 bytes)
```

`next: { revalidate: 900 }` on a 19.5MB response is silently a no-op: every render refetches and
reparses the whole thing, and `/model` took 19.2s. The fix was the one Derek called for anyway —
a cron writes the ~450 rows that matter into a table and the page reads those. **Check
`preview_logs` after adding any large external fetch; a page that renders correctly can still be
paying full cost on every request.**

### 🚨 Pooling train and held-out will manufacture a signal that is not there
The sharpest self-inflicted error of this session, caught only because the confirmation step ran.

Looking for an in-week role-change signal, depth-chart MOVEMENT looked excellent — measured across
all seasons at once, a player promoted into the starting slot beat our volume estimate by **+0.85**
(RB +1.39, QB +2.37, n=477). It read as free, historical, line-blind and additive.

Split properly it evaporates:

| | train 2021-24 | held-out 2025-26 |
|---|---|---|
| climbed the chart | +0.931 | **+0.104** |
| promoted to starter | +1.016 | **-0.089** |

And the joint linear fit, which looked strong on train, made held-out **worse almost everywhere**
(-4.3% on the moved subset; the bias it was supposed to remove flipped from -0.020 to +0.251). The
depth chart lags the box score, and our recency weighting already had everything it carried.

Vacated volume — a same-position team-mate ruled Out — replicated instead, and only for RB:

| | train bias | held-out bias | shipped |
|---|---|---|---|
| RB | +1.721 | +1.924 | yes, k=+0.2065 → held-out MAE +5.2%, bias -1.924 → **-0.119** |
| WR | +0.267 | +0.312 | no — fitting it lost 0.3% |
| TE | +0.458 | +0.001 | no — fitting it lost 9.7% |

**Never read a coefficient off a pooled sample.** The first pass had no split, and it would have
shipped a correction that actively degraded the board.

### 🚨 A coefficient is only valid for the exact quantity it was fitted against
QB vacated volume fitted beautifully — k=+0.2970, held-out MAE 11.326 → 10.693, bias halved — and
was still wrong to ship. A week-2 replay is what caught it:

```
Jacoby Brissett   attempts/g  34.70 -> 41.12
Kirk Cousins      attempts/g  29.95 -> 39.06
```

The backtest estimates a QB from attempts averaged over **every appearance**, so a back-up sits near
zero and the coefficient has to lift him all the way to a starter's workload. Production's `att_pg`
is averaged over **starts only** — Brissett already reads 34.7 — so the same coefficient stacked on
top of a number that already assumed he starts. Right coefficient, wrong quantity, and both files
call it "attempts per game".

**Before shipping any fitted constant, replay it on real data and read the outputs.** The held-out
MAE said it worked. Two names and their numbers said it did not.

### ⚠️ Conditioning a check on the BOOK's line will invent a bias that is not there
Worth its own entry because it produced a confident, wrong finding that survived a whole session.

Grading weeks 1-2 on rows **with a posted line >= 40** said our receiving-yards projections came in
7.76 yards BELOW actual against the market's 3.82 — read as "we run low on starters". Re-measured
line-blind, bucketing by our OWN projected volume instead, the top decile projects **+3.57 yards
above** actual. Same players, opposite sign.

Selecting on the line selects games the market expected to be big, which are games that largely were
big. It is a market-chosen subset, so "projection minus actual" on it measures the selection as much
as the projection. **Bucket by something you produced, not by something the book produced** — the
whole point of a line-blind model is that its own errors can be measured without the line.

The follow-on test was a negative result worth keeping: efficiency really does slope with usage
(WR yards/target runs -7.6% in the lowest projected-volume quintile and +3.6% in the highest), but
tiering the efficiency baseline by volume **did not improve yards out of sample at all** (-0.11% to
+0.05% by position) and made the top-tier bias worse. The flat positional baseline stays. "Volume
persists, efficiency doesn't" survives contact with the data again.

### 🚨 A closed popover inside a SCROLL CONTAINER is dead space you cannot see
`scroll-height` includes absolutely-positioned descendants — including invisible ones. Every
closed Tip bubble on the model board sat inside `.imp-scroll`, so each one added its own height to
the scrollable area: ~500px of empty ground below the last game, plus a vertical scrollbar on a
panel that should not scroll at all. Derek: *"at the bottom of this new section there is dead
space."*

`visibility:hidden` is not enough — it keeps the box. **`content-visibility:hidden` removes it
from layout while keeping the element**, so the opacity transition still runs when it opens.

New check, `scroller-dead-space`: for any element that scrolls, compare its `scrollHeight` against
the bottom of the lowest VISIBLE descendant. Anything past that is by definition space nothing
occupies.
```js
let ink = box.top;
for (const c of el.querySelectorAll("*")) {
  const cs = getComputedStyle(c);
  if (cs.visibility === "hidden" || cs.display === "none" || cs.contentVisibility === "hidden") continue;
  const r = c.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) ink = Math.max(ink, r.bottom);
}
const dead = box.top + el.scrollHeight - ink;      // > 40px = a finding
```
Two-way tested: 0 as shipped, **500px reported** with `content-visibility:visible` forced back on,
0 again on restore. The general rule to carry: **whenever you put an absolutely-positioned element
inside something that scrolls, check what it does to the scroll extent in BOTH states.**

### 🚨 A feed can stop carrying a field mid-season, and the fallback text hides it
The referee row read "Crew assigned closer to kickoff" on games kicking off that night, all season.
ESPN's summary endpoint had simply stopped returning `gameInfo.officials` pre-game — the job
logged `+0 pre-game crews from ESPN` on every single run and nothing else changed, so the board
looked like it was waiting rather than broken. Our only other source was nflverse, which fills
`referee` AFTER a game is played.

**Football Zebras publishes the league's weekly assignments days ahead** and is now the pre-game
source (`fetch_zebras_crews`, nicknames mapped through `NFL_NICK`, unresolvable lines counted and
skipped, never guessed). Verified end to end: all 16 week-3 games have a crew in the table and all
16 render one on the board.

Two things to carry:
- **A counter that prints 0 forever is a broken source, not a quiet week.** Grep your own logs:
  a line like `+0 pre-game crews` repeating across every run is the signal.
- **Verify a data fix against the SCHEDULE, not against a sample.** The check that settles it is
  every scheduled game joined to the stored rows, with the misses named:
  ```python
  missing = [(r.away_team, r.home_team) for _, r in week_games.iterrows()
             if (r.away_team, r.home_team) not in stored]        # must be []
  ```

### 🚨 "Why so many unders?" — separate the VIG from the level, then split by subset
Derek, on the homepage player panel: *"How come we are showing so many unders for this week's
player reads?"* Board-wide it was 399 of 668 rows (60%) under. Two different answers, and only one
of them was ours:

| slice | under | what it means |
|---|---|---|
| anytime TD (416 rows) | 63% | the book's "%" is a PRICE, hold included — ours 17.5% vs book 20.1% |
| yards & receptions (252) | 55% | near even |
| starters only (the panel's filter) | 10 of 12 | a real lean, see below |

**The TD half is arithmetic, not a lean**, and the graded cards prove our level is the honest one:
week 1 ours 20.8% / book 22.0% / **actually scored 21.5%**; week 2 ours 19.3 / 20.8 / 15.5.

**The starters half is ours.** Graded on weeks 1-2, restricted to the same filter the panel uses:
```
rec_yds, line >= 40   n=94   proj-actual -7.76   line-actual -3.82    proj<line 69%, actual<line 55%
pass_yds, line >= 200 n=53   proj-actual -6.25   line-actual -4.54
receptions, line >= 3 n=164  proj-actual -0.16   line-actual +0.09
```
Everyone is low on high-volume receivers; **we are ~4 yards lower than the market**. That is
shrink-to-the-mean at the top of the distribution — the same shape as the NCAAF role blend, which
helps the middle and costs the top. It is a real, measured lead, and it gets a backtest before a
constant moves, not a nudge because a screenshot looked one-sided.

**The method is the reusable part: split the board by market and by the subset the SURFACE
actually shows before concluding anything.** A panel that filters to starters can be strongly
one-sided while the board it draws from is balanced.

### 🚨 A Tip bubble inherits `white-space` from wherever you put it
The Upset Meter's scroll went into a `<td>` on the NCAAF board, and `.hb-form td` is
`white-space:nowrap` — so the bubble's prose laid out on ONE 2,129px line and drove the table
wrapper's scrollWidth to 2,071px against an 878px box. Nine `table-overflows-container` findings
from one paragraph. `.tip__bubble` now sets `white-space:normal` itself: a bubble is prose and
must wrap wherever it lands. Same family as the `.hb-books` nowrap overflow.

Two other things that pass forward from the same fix:
- **A popover inside a NARROW header hangs off the card.** A 460px bubble centred on a 22px seal
  near a card's right edge overflowed by 194px (measured: 983px box, 1,176px of content). It now
  anchors to the section header (a declared wrapper it is always inside — not "whatever happens to
  be positioned above it") with an explicit `width:min(520px, 100vw - 48px)`. `left`+`right` with
  `width:auto` was not enough: inside a table cell the containing block resolved differently.
- **Put the seal at the END the bubble opens from.** With the bubble anchored left and the seal
  pushed right by `margin-left:auto`, `popover-unanchored` fired at 662px from its trigger — and
  it was right.

### ⚠️ On a STALLED page, a manual DOM measurement is as blind as the probe
Chasing the above, three hand-written measurements in the real tab came back "no overflow" while
the probe reported nine. Both were right about what they measured: `next dev` had the page in a
Suspense stall, so the live tree was 8 characters and every element I queried was the 0×0 copy
inside `#S:0`. The probe splices; my snippets did not.

**If you are measuring geometry on a page that might be stalled, splice FIRST — in a snippet
exactly as in the probe — or you will "disprove" a real finding.** The tell is the live tree's
character count:
```js
const live = document.querySelector('.siteshift main.wrap');
live.textContent.trim().length     // < 200 => you are measuring nothing
```
This is the mirror image of the rule above it: a splice can invent geometry findings, and NOT
splicing can hide them. Check the character count before believing either answer.

### Say it in words a reader has, not in the trade's slang
The Upset Meter's low tier read "Chalk holds up". Derek: *"What does chalk holds up mean? That
needs to be different."* Chalk is the favourite — obvious inside betting, opaque outside it, and
this product is aimed at people arriving with data questions rather than a glossary. The tiers are
now "Upset in play" / "Some upset risk" / "Favourite should hold". Worth a scan of any label that
came out of a betting habit rather than a plain description.

### A fixed track must be wider than its widest LABEL, or the label lands on its neighbour
The injury pill sits in a fixed column so every player's name starts at the same x. "QUESTIONABLE"
is ~78px of ink in a 44px track, so it printed straight over the name — Derek: *"there is also
overlapping text on top of each other"*. Two ways out, and the wrong one is widening the track:
that steals width from the name for a label that appears on half the rows. Abbreviate the label to
fit (`OUT / IR / SUSP / DOUBT / QUES`, full word on `title`) and size the track to the longest of
those.

Check it directly rather than by eye — the gap between a fixed cell's right edge and the next
cell's left edge must be positive on EVERY row:
```js
[...document.querySelectorAll('.impspec__inj li')].map(li => {
  const [a, b] = li.children;
  return b.getBoundingClientRect().left - a.getBoundingClientRect().right;   // all > 0
})
```

### Filling space is a LAYOUT question, not a font-size one
Same block, second pass. Derek: *"use the space more... move the injuries over to the right...
use grid lines to make it cleaner... make the Scoring, Weather, Referee headers bigger and stand
out."* What that came to, and it generalises to any dense panel:
- **Give the columns that hold the most content the most width.** The game facts are
  content-sized (`minmax(200px,auto)`); the two team columns split the remainder (`1fr 1fr`), so
  they widen as the card does — 206 / 331 / 331 at 1440 instead of three near-equal columns.
- **Separate with 1px rules, not with gaps.** `border-left` on each column after the first plus
  symmetric padding reads as a table; a big `column-gap` just reads as a hole.
- **A row of data is one LINE on tracks**, not a stack: status / player / detail across the
  column with the detail right-aligned uses the width the stack was wasting, and a dotted
  `border-bottom` per row makes a long list scannable.
- **Section headings earn their own rule**: 11px, 800 weight, ink colour, `border-bottom`. A
  heading in muted 9.5px over a list of 12px ink is quieter than the content it labels.

### 🚨 A full-width ANNOTATION row is not a data row — teach the probe, don't reshape the board
Adding that row made every model board report `chart-rows-uneven` (58px and 170px alternating)
and `chart-columns-lopsided`. Both were the probe measuring a detail panel as if it were data.
`spanRow()` is now a module-level helper — one cell with `colspan > 1` and nothing else — and the
row-height, column-width and ink checks all skip it.

Note the near-miss: the first patch landed the helper in the wrong loop (two checks in this file
open with a near-identical `for (const tbl of ...)` header), so the finding kept firing and it
looked like the logic was wrong. **When a check keeps reporting after a fix, confirm the fix is in
the block that emits it** — `grep -n 'add("<kind>"' ` to find the emitter, then read upward.

### A UI must not say "nobody" when it means "we do not know"
The Special Considerations block prints the injured players for a game. An empty list means two
different things — nobody is hurt, or the report is not in yet — and Wednesday's practice report
routinely lists 40+ players with NO designation, so early in the week the second is the true one.
Printing "Nobody carrying a designation" then is the same defect as the hardcoded `is-online`
class: the page stating a fact it never checked. It now distinguishes the two by whether the WEEK
has any designation at all. Whenever an empty collection renders as prose, ask which of "none" and
"unknown" it is, and prove you can tell.

### A page of several charts is not one chart — the probe scopes by sub-section now
`/report` holds one `<section class="rc">` per sport-week, each with a game table and two prop
tables that share a header (biggest misses, then every graded lean). `repeated-column-header`
reported the `<main>` as one board repeating its header 2×. Each chart now sits in its own
`<section class="rc-chart">`, and the probe skips any container whose tables are owned by two or
more distinct descendant sections. When you add a page with several same-shaped tables, wrap each
in its own section — it is what makes them separate charts to the probe AND to a screen reader.

### ⚠️ The Bash tool's heredoc eats backslashes
`\\b` inside a quoted `<<'PY'` heredoc reached Python as `\b` and wrote a **backspace byte** into a
regex in `PlayerModelView.tsx` (`/^H(D\/ST|Defense)$/` under `cat -A`). Twice now. Any patch whose
payload contains a backslash goes through the Edit/Write tool, never a heredoc; after a heredoc
patch, `cat -A` the touched line.

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

### 🚨 Even rows: budget for the widest DATA value, then fix the height
`chart-rows-uneven` + `card-property-as-column`. Derek asked twice for "evenly space the rows and
columns", and the first two attempts each made it **worse**. A row is its own grid, so it sizes to
its own tallest cell: one cell that wraps makes that one row taller and the board reads as broken.

Three things that do NOT fix it, in the order they were tried:

1. **`min-height`.** It is a floor. It lifts the short rows and leaves the tall ones exactly as tall.
   Measured: heights were `57, 62` before adding it and `62, 71, 82, 88` after — more varied, not
   less, because it was applied together with the next mistake.
2. **Narrowing a column to buy width elsewhere.** Every pixel taken from column A is a pixel that
   makes A's own cells wrap. That pass went from two distinct row heights to four.
3. **Budgeting from the measured HEADER widths.** A header that fits over a column whose *values*
   wrap still gives ragged rows. **Measure the widest DATA value, not the label.** Clone the cell
   into a `white-space:nowrap; display:inline-block` probe and read its width; the header is a
   separate, smaller constraint, and it is fine to let a long header wrap to two lines on purpose
   when its data is a single digit (`HR vs opp pitcher` is 152px of label over one character).

What works, in this order:

```
budget = scroller - row padding - (ncols - 1) x gap        // MEASURE all three; do not assume
```
give each column its widest data value on one line, then `height:<fixed>px; align-items:center` on
the data rows — and because a fixed height *clips* whatever overflows it, give the one column that
can still legitimately need two lines a tighter `line-height` so two lines fit inside the same box.
Verify with `new Set(rowHeights).size === 1` **and** zero cells where `scrollHeight > clientHeight`.
Measured on `/mlb/model/players`: 636 rows, one distinct height (56px), 0 clipped, 0 overflow.

**And before budgeting at all, ask whether a column should exist.** The HR board's `ballpark` column
was the actual cause: the park is a property of the GAME, so it printed one identical long string
down every row of a card, and its wrapping is what made the rows uneven. Moving it into the card
header said the same thing once and freed ~180px — which is what made every other column fit. The
tell is *constant within each card, different between cards*; `column-no-variance` will not catch it
because board-wide the column varies perfectly well.

### A five-column table becomes CARDS on a phone, not a sideways scroller
The NCAAF boards were 560px of table in a 301px scroller: it scrolled sideways AND its rows came
out 73 / 74 / 86 / 87 / 100px tall. No column budget can fix that — the matchup cell wraps to a
different number of lines per game ("Richmond at NC St" takes two, "#1 Ohio St at #4 Texas" takes
four) and the column is 168px wide. **When the content genuinely does not fit the viewport, stop
making it a table.** Below 560px each row becomes a card: the matchup takes the full width instead
of a sixth of it, and the four numbers sit in a 2x2 grid underneath carrying their column names on
`data-l`. Rows cannot be uneven because there are no rows — measured afterwards, every card is
exactly one height (188px and 147px on the two boards) with no horizontal scroll anywhere.

**Opt in with a new class, never by styling the shared one.** `.hb-form--mkt` is also the NFL model
card and three LandingHub tables; the card rules hang off `.hb-form--cards`, which only the two
NCAAF tables carry. Verified `/model` still reports clean and both boards still `display: table`
at 1440.

**And check what the mobile stylesheet already does to the cell you are widening.** `.hb-game` is
`inline-flex; flex-direction: column` on mobile — deliberately, so the Game COLUMN stays narrow in
a table. Inside a card that is exactly wrong, and it was the whole cause: the flex box had
collapsed to **41px wide inside a 309px cell**, stacking "#1 Ohio St" over "at" over "#4 Texas".
The first attempt (a forced line break after "at") changed the measured heights not at all, which
is the tell that the diagnosis was wrong — a fix that changes nothing measurable should be reverted,
not shipped as a fix.

### 🚨 Even COLUMNS: never mix `fr` tracks with fixed `px` ones
`chart-columns-lopsided`. Derek, on a board the probe had just reported clean: *"the rows and
columns are not spaced evenly."* He was right and the audit was useless, because **the check above
measures HEIGHT.** Row heights were identical to the pixel; nothing in the probe looked at how the
WIDTH was divided, so a board with two enormous name columns and four numeric ones crammed at the
right passed everything. *When a rule mentions two things ("rows and columns"), check that you did
not encode only the half that was easy to measure.*

**The mechanism is invisible at the width you design at.** `grid-template-columns: minmax(250px,
1.5fr) minmax(157px, 1.2fr) 110px 40px 66px 60px` is correct at the 795px minimum — every column
lands on its budget. At 1120px the surplus 170px goes **entirely** to the two `fr` tracks, because
that is what `fr` means. The player column swallows it and "AB", "book %", "our %" get none.

**Two obvious repairs both fail, and each looks right until it is measured at a second width:**

- **Pure `fr` weights** (`262fr 126fr 143fr …`) hold the RATIO, so the widest column still takes the
  largest share of the surplus. At ~1100px the player column had ~130px of empty width against
  ~25px on "AB". Better, still not even.
- **`minmax(ink, 1fr)` is NOT "min plus equal extra".** Equal flex factors make every flexible track
  the same TOTAL width, so the three wide columns pinned to their min and the three narrow ones
  absorbed everything: measured slack **0 / 0 / 0 / 55 / 21 / 33**. This one reads as obviously
  correct and is the trap worth remembering.

**What works is a shared `calc()`**, because the leftover has to be divided *outside* the track
sizing algorithm:
```css
.thing .row{--pmx:max(0px,calc((100% - 690px) / 6));   /* 690 = sum of ink + sum of gaps */
  grid-template-columns:calc(249px + var(--pmx)) calc(114px + var(--pmx)) /* …one per column */ }
```
`100%` resolves against the row's content box, so every column gets the same number of extra pixels
at every width. Verified across widths: **slack 12px on all six columns at 1440, 40px on all six at
1900** — even, not merely proportional. Five MLB boards had the mixed shape (`--mlb`, `--mlbp`,
`--mlbhr`, `--mlbk`, `--mlbg`).

**An equal share is the default, not the rule.** Where one column's content is genuinely much longer
than its neighbours', give it more of the surplus (`/8` with a `3 * var(--pmx)` on that track) —
"evenly spaced" means no column idle while another is squeezed, not identical slack regardless of
content. And check what the equal-width constraints actually require: the game board pinned all four
comparison columns to one width, but the rule is *spread equals spread* and *total equals total* —
holding the totals at the spreads' 88px cost 76px that the pitchers column needed.

**A cell that cannot fit gets a fixed ROW height, not a wider column.** Two pitcher names joined by
a slash is 285px of ink that no honest budget fits at 1440; shortening to first-initial form got it
to 234 and the row height does the rest. Where content genuinely must wrap, wrapping is fine — a
*ragged* row is the defect, not a tall one.

**Judge slack board-wide, not per table** — the same correction `column-no-variance` needed, and it
bit again immediately: within one game card every batter faces the SAME pitcher, so that column's
longest value is short and its slack looks enormous. Per-table, the check reported **12 findings on
the board it had just been used to fix.** Group tables by header signature, take each column's
widest ink anywhere on the board, evaluate once. Two-way tested afterwards: 0 on the fixed board,
1 with the old rule re-injected, 0 on removal.

**And run a new check across every board the same day you write it.** Sweeping this one found a
genuine second bug nobody had reported: the `/mlb/model` lineups panel had "batting slot" sitting on
71px of empty width while "player" was **20px short of its own longest name**.

**Three calibrations this check needed, all found by running it rather than by reasoning:**

1. **Header requirement is its longest WORD; data requirement is the whole string.** That asymmetry
   is the check. A label may wrap on purpose ("HR vs opp pitcher" over a single-digit column);
   a value may not, because a wrapping value is what makes rows ragged. Measuring headers whole
   reported −37px on two deliberately-wrapped labels; measuring data by word instead reported 149px
   of "slack" on a column sized precisely so names never wrap — i.e. it flagged the fix.
2. **The tight side is what makes it a defect, not the gap.** On a wide table every column's slack
   scales up and so does the difference between them: the homepage's 4-row shopping table fired at
   187px vs 107px with nothing squeezed at all. Require `tight <= 24px` as well as a large gap.
3. **Judge board-wide** (above).

**What counts as a column's NEED depends on whether it can wrap.** Getting this wrong produced
false findings in both directions before it settled:

| cell | requirement | why |
|---|---|---|
| header | longest word | a label may wrap; "HR vs opp pitcher" over a single digit is a trade, not a squeeze |
| `nowrap` data | full string | it has no second line, so anything short of the whole string ellipsizes |
| wrapping data | longest word | it uses the row's second line, which the row already has |

**And two columns are exempt from the IDLE side entirely** — they can still be reported as tight,
which is where the real bugs are:
- **the leading column**, which holds the name of the thing each row is about and is conventionally
  given more room than arithmetic demands. Wrapping every name onto a second line is worse design
  than leaving it generous.
- **any column whose data wraps**, because its width is a judgement about how many lines its prose
  should take. The MLB game board's "starting pitchers" holds two names and a slash and wraps on
  purpose; by longest-word it measured 197px "idle".

**A budget tuned to one moment's data drifts out of true within hours.** `.pmtable--mlb` was sized
when the status column read "in the lineup"; once real lineups posted it read "projected" and the
column sat on 78px of dead width. And a base shared across TABS has the same problem in space
rather than time — a player column sized for receivers leaves running backs' names swimming. Both
are why the tracks are `calc(<small base> + var(--pmx))`: a base that is only what the column needs
at minimum, plus an equal share of whatever is going.

**Run the sweep at a STRETCHED width, not just 1440.** This whole class of bug is invisible at the
width a table was budgeted for — the mixed `fr`/`px` grids all measured perfectly at their 795px
minimum. Add a 1900px pass whenever the finding is about how space is divided.

**A card header that gains a subtitle needs its own mobile pass.** The park moved into
`.pmgame__h`, which is a flex bar with the chevron on `margin-left:auto`; at 375px the matchup alone
filled it and the park silently ellipsized away 81px of itself. It now drops to its own line under
`max-width:560px` (`flex-wrap` plus `order:3`). Check `scrollWidth - clientWidth` on any new header
text at mobile — an ellipsis in a header is a truncation the desktop pass will never show you.

### MLB boards: abbreviate the team, and say what the tag MEANS
Derek's standing asks for the MLB section, all of which have bitten more than once:

- **Teams are abbreviated everywhere** — `Pete Alonso (BAL)`, `Bal`, `Cle`, never the full club
  name. The abbreviation comes from `mlb_availability.team_abbrs()` (id→abbr and name→abbr, process
  cached) and rides on the export rows as `teamAbbr` / `oppAbbr`; all three exporters
  (`mlb_availability`, `mlb_strikeouts`, `mlb_player_props`) carry it, so a new board reads it
  rather than re-deriving it. When you add a board, grep the exporter for `teamAbbr` before writing
  a name-to-abbr map of your own.
- **A market spread must name WHO it favours**: `−1.5 (BAL)`, not a bare `−1.5`. Derek: *"who is
  that spread for?"*
- **🚨 A "market" column shows what the book POSTS, never a number derived from it.** The MLB game
  board went round this twice. A bare run-line column printed `−1.5` on every row and read as
  "we make everyone a favourite", so it was replaced with the moneyline converted to runs
  (`marketMargin`) — and the board then showed `−0.9 (CLE)` / `−0.6 (NYY)` under a MARKET header.
  Derek: *"They would never be listed as −.9 or −.6 in a sports book. It's almost always −1.5."*
  Measured on one sweep of `mlb_odds_snapshots`: 163 rows at −1.5, 163 at +1.5, two at 2.0. The
  number IS fixed; **the information is in the price beside it** — NYY −1.5 **+150** is a slight
  favourite, −1.5 **−150** a heavy one. So the column shows the favourite's run line WITH FanDuel's
  price (`runLine()` in `app/mlb/model/page.tsx`: the side whose `point < 0`, price
  `byBook.fanduel ?? price`), and the derived margin lives only in "OUR SPREAD" and the Tip.
  The general rule: a column headed *market* is the book's own number as the book lists it. If a
  reader could not find the value on the sportsbook screen, it is not a market column — it is our
  number wearing the market's label, and it teaches the reader the market said something it never
  said. Check it by reading three rows and asking whether each appears verbatim on the book.
  A "derived" number that a book never posts (a fair spread, a de-vigged probability) belongs
  under OUR header or in the Tip, labelled as ours.
- **🚨 …and OUR column must be in the same currency as the market's, or it WILL be read as a
  side.** The day after the run line went in, Derek read the margin beside it as *"3 of 12 games
  in favor of taking the points"* — a margin of 1.3 against a 1.5 line looks like a lean to the
  dog, and it isn't, because the price is what makes a run line fair (favourites cover −1.5 in
  39% of games; that is why it pays +120 to +170). A margin and a priced line are different kinds
  of number, and a reader compares whatever two numbers sit in one row. So "OUR SPREAD" became
  **our cover %** for the SAME side the market names, with the market's de-vigged fair % under
  its line and our margin under our %. The rule: when a market cell carries a probability-shaped
  thing (a price), ours beside it is a probability too; when it carries a number (a total), ours
  is a number.
  **Measure before you publish a probability.** The first proposal — a normal on the margin — was
  4 points high held out (said 37.6%, saw 35.6%; 51% vs 36% in the top bucket). What ships is a
  logistic on the signed margin fitted on the train split (`cover_calibration()` in
  `mlb_game_model.py`, constants in `SCORES["cover"]`): Brier +0.9% over the base rate, within 3
  points in every bucket below 46%, still 8 high above it — and the Tip says so. A cover % that
  had not been scored against what happened would have been a decoration with a percent sign.
- **A cover % on the MARKET's favourite reads as "based off the market".** Derek's next message:
  *"I don't want our model based off of the market alone. I want real analysis of these teams
  and show who we think will win (ML), cover the +1.5 or −1.5."* The number was line-blind; the
  SIDE it was about was the market's, so the column read as derived. What ships: **our winner**
  (side + win %, `Φ(m/4.65)`, held out Brier +1.4%, favourite 55%) and **our run line** (whichever
  of favourite −1.5 / dog +1.5 we give the better chance) — both from our margin alone, the
  market's fair % left under ITS line for the comparison. When a column is "ours", the side it
  names must be ours too.
  **"Real analysis of these teams" was tested, not asserted.** Lineup strength from the posted
  nine (each hitter's causal rate, shrunk), bullpen (runs allowed minus starter ER), 15-game form
  and home field were each run walk-forward on the same held-out dates (`SCORES["tried"]`):
  lineup Brier 0.2444 → 0.2441 (noise), bullpen worse at every weight, form worse, home field
  +0.15 helped the TEST split only because home teams happened to win 53.6% there against 52.4%
  on TRAIN (+0.005 runs) — fails choose-on-train. The model is already the team analysis; the
  sport is the ceiling. Say so in the Tip rather than adding a feature because it sounds like one.
- **🚨 "Ours is always above the book" has THREE causes, and only one of them is our model.**
  Third time on the MLB hits board (Derek: *"I still do not like that our model % for hits is
  always higher than the market's"* — 77% of rows). Diagnosed with `--grade`, which scores ours
  AND the book's de-vigged price against what actually happened, plus the held-out split by
  month and by regulars:
  1. **A level drift, not a shape error.** Bias +0.1pp on train, +1.5pp on test, +2.6pp in
     September; regulars alone +0.4pp. A windowed league rate did nothing (10k–60k PA). Fixed
     with a CAUSAL trailing calibration (`CAL_WINDOW` in `mlb_player_props.py`: mean realized −
     predicted over the last ~3,000 batter-games, updated a day at a time): test bias → +0.2pp,
     Brier not worse. Never fit the level to the market — fit it to results.
  2. **The book's number was low, not ours high.** Proportional de-vig (`a/(a+b)`) splits the
     hold evenly; books load it onto the longshot, so a favourite market (1+ hit at −230/+175)
     comes out 1–1.5pp under its true chance. `deVig()` in `web/lib/fairValue.ts` is now the
     POWER method (`a^k + b^k = 1`) — identical at −110/−110, higher for favourites. Same in the
     grader so they agree.
  3. **The sort.** Ordering rows by OUR % puts the rows where we run hottest against the book at
     the top of every card, so the first screen reads "always higher" even when the board is
     balanced. Sort on the average of ours and the book's.
  After all three: higher on 54–57% of rows, lower on 34%, equal on 9%, means within 1pp. On the
  first 332 graded September props both numbers still sat above the 0.554 realized (ours 0.613,
  book 0.605) — a fortnight, not a verdict; the grader reruns every day.
  **Also caught in passing:** park. Coors ran 1.08× league on hits and the model had no park term
  for hits (only for HR): at Coors it predicted 0.643 against 0.689 realized. Batter and staff
  rates are now accumulated park-neutral and re-inflated by tonight's park (`PARK_HIT_K`), chosen
  on train, +0.03% Brier on both splits. Keyed on the HOME CLUB, because `venue` is on only 40 of
  4,600 lineup rows and `side` is on all of them.
- **A coherence check needs the MARKET's constant, not ours.** The MLB Sweet Spots page compares a
  run line with what its moneyline implies (fair win % × P(cover | win)). First cut used P(cover |
  win) measured on OUR model's favourites (0.710 home / 0.787 road) and every card on the board
  read "run line pays more" — one-sided, i.e. a bug. Measured on all games by venue it is 0.684 /
  0.765, and the books themselves price in 0.684 / 0.770 (2,001 quotes with both markets). With
  those the board split 3–3. When a page says "the market disagrees with itself", derive the
  constant from the market or from unconditioned data, never from our model — otherwise the page
  is quietly grading the market against us and calling it arithmetic. The walk-off asymmetry
  itself (home wins by one run 31.6%, road 23.5%) is real and is the page's headline.
- **The Value Finder is one component per board, parametrised by sport.** `BoardView` takes
  `sport` ("nfl" | "mlb") and a `SPORT` table (label, "Spread" vs "Run line", week wheel or
  `DayBadge`, pin, footer); `ShopSubnav` takes `base`; `SPORT_PATHS` carries the route. Adding a
  sport to the Value Finder is a row in each table and three thin pages — never a copy of
  BoardView. MLB chips carry abbreviations via an `abbr` map (full names wrapped a chip onto two
  lines); the card header keeps the full name.
- **🚨 US-licensed books only — and the filter must not eat the snapshot probe.** The feed's "us"
  region returns bovada, betonlineag, lowvig, mybookieag and betus, and every board shopped
  across them (Derek: *"I thought we should not include books like lowvig and bovada"*), so a
  "best price" could be a book a member cannot use. `US_BOOKS` / `usBooks()` in
  `web/lib/bookLabel.ts` is the one allow-list; every reader (board, props, cfbProps, mlbBoard,
  mlbProps) filters at the READ layer, and the Python graders mirror the set. Two traps hit while
  doing it: (1) the one-row `select=snapshot_at` probes go through the same `pg()` — a row with
  no `book` column fails the filter and the whole board reads "no odds captured"; guard on
  `out[0].book === undefined`. (2) A reader with an "empty → unbounded fallback" (props.ts) must
  filter AFTER the fallback decision, or an all-offshore sweep triggers the full-table scan the
  IO rule forbids. Check with `curl <page> | grep -ci "bovada\|lowvig"` → 0, and the stat strip
  now counts books dynamically ("6 US books compared"), never a hard-coded 10.
- **A floating handle is not an interceptor.** `click-intercepted` flagged two batter-grid chips
  "covered by the dock handle" at 375: a fixed floating button sits over whatever scrolls beneath
  it at every offset, which is what floating means. The probe now skips `.dock__handle` and
  `.slipbar__toggle` as the covering element; a fixed CONTAINER bigger than what it paints (the
  original dock bug) is still reported.
- **Row padding comes out of the column budget.** `.pmrow--data` carries 16px of padding each
  side, so `--pmx: calc((100% - <budget>px) / n)` has 32px less to give than it looks: a 818px
  budget in an 825px row put 9px of the last column outside the card (`content-escapes-card`).
  Budget against `100% − 32`, and measure ink with a clone appended INSIDE the row — a clone on
  `<body>` inherits the body font and reads ~14/12 wider.
- **Never publish a raw factor as if it were a reading.** `1.01 neutral` meant nothing to a reader.
  A park factor is shown as a worded verdict — `Favorable for HRs` / `Neutral for HRs` / `Tough for
  HRs` (`parkTag()`, cut at 1.05 / 0.95) — and the number itself goes in the Tip if anywhere. The
  same rule is why the strikeout cards carry no park at all: an HR factor above a pitching board
  would be a number that looks like information and isn't.
- **Completed games come off the board** (`commence > now` at render time), and each game shows its
  ET start in parentheses.

### Full-bleed elements and gutters
A hero/banner escapes its container with negative margins plus an over-100% width
(`margin-left:-Xpx; width:calc(100% + Xpx)`). If a gutter is later added on the **other** side, the
element has to cancel that too — otherwise it stops short and leaves a strip of page background.
Whenever you change a container's padding, re-check every full-bleed child inside it.

### 🚨 A page-time read of an APPEND-ONLY table will exhaust the database
The most expensive mistake in this file. Derek: *"the pages will not load anymore"* — with a
Supabase warning that the project had depleted its Disk IO budget. The instance was answering 503,
then 500.

`prop_snapshots` is append-only: every sweep writes a fresh row per (book, market, player, side,
line), so ONE NFL week holds **119,218 rows** and the table only grows. `weekProps` read the whole
week — ~120 paged requests — on every ISR revalidation, on `/props`, `/best`, `/audit`,
`/model/players` and the slip, each with its own cache. Only the newest sweep is ever used; the
other ~100,000 rows were scanned and thrown away. I then added `fanduelLines`, a SECOND full scan
of the same table, and spent a session reloading those pages for audits.

**The correct pattern was already in the codebase.** `cfbProps.ts` probes for the latest timestamp
with `limit=1` and then reads only rows at it — two cheap requests instead of a full scan:
```ts
const [{ collected_at }] = await get(`?...&select=collected_at&order=collected_at.desc&limit=1`);
const rows = await pgAll(`?...&collected_at=gte.${new Date(Date.parse(collected_at) - 60*60_000).toISOString()}`);
```
**Before adding any page-time read, ask how the table GROWS and how much of it the render
actually uses.** A snapshot table is the dangerous shape: correct on day one, ruinous by week two,
and the symptom arrives as "the site is down" rather than as a slow page.

```bash
# every runtime reader, and whether it bounds what it pulls
grep -rn "rest/v1" web/lib/*.ts | grep -v "limit=1"
```
**Measured once the instance recovered** (the week-1 table had grown from 119k to 194k rows
overnight — it never stops):

| read | before | after | |
|---|---|---|---|
| NFL `weekProps` | 194,465 rows | 10,277 | 18.9x less |
| NFL `fanduelLines` | 194,465 | 1,640 | 118x less |
| MLB `propLines` / `propBookProb` | 15,580 | 1,867 | 8.3x less |

**Read the CALLER before flagging a paging helper.** I told Derek `mlbBoard.ts` and `board.ts` had
the same defect because they share the paged-read shape. They do not: both already probe for the
latest `snapshot_at` with `limit=1` and read only that sweep. Only `mlbProps.ts` was unbounded. A
helper that pages is fine; a helper that pages *without a snapshot pin upstream* is the bug — and
you can only tell which by reading the query each caller builds. And note what an audit costs:
repeatedly reloading boards to re-run the probe is itself heavy traffic against these reads.

### 🚨 A CSS edit must be brace-balanced — check it, do not eyeball it
The homepage reported `page-overflow-x` of +413px at 1440 and no element past the right edge. The
cause: an `@media (max-width:640px)` block opened at line 4073 **and never closed**, so every rule
after it — the whole highlight banner, the feedback widget — became mobile-only. Above 640px those
elements fell back to UA defaults (`display:inline` on a flex row), and a 1600px image ran 413px
past the viewport.

I did it. A scripted edit anchored on text that ENDED with the block's closing `}` and the
replacement did not re-emit it. That is the specific hazard: **an anchor whose last character is
`}` deletes a block boundary unless the replacement puts it back.**

The tell in the DOM is a computed style that matches no rule you wrote:
```js
getComputedStyle(el).display    // "inline" where the CSS says flex => the rule is not applying
// then find out WHY — is it inside a media query that does not match?
[...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.conditionText)
```
After any scripted CSS edit, count braces outside comments — it takes a second and it is decisive:
```bash
python -c "import re,pathlib;t=re.sub(r'/\*.*?\*/','',pathlib.Path('web/app/globals.css').read_text(encoding='utf-8'),flags=re.S);print(t.count('{'),t.count('}'))"
```

### 🚨 Never rename a class with a blanket regex over a file
`card-width-mismatch`. Derek: *"the context cards got messed up... put them next to each other
again. How did this happen?"* I did it, one commit earlier, fixing a different bug.

`.cxgrid` had been introduced for a new stat grid and collided with the existing CARD grid (see
below), so it was renamed to `.cxstat` — with `re.sub(r'cxgrid...')` across the whole file. That
also renamed `<section className="cxgrid">`, the container that lays the cards out two across. It
lost `repeat(auto-fit, minmax(456px, 1fr))` and collapsed to one column.

**The rename is the most dangerous possible moment for exactly this, and the reason is circular:
you are only renaming BECAUSE the name is already in use elsewhere.** A blanket substitution is
therefore guaranteed to hit the other usage. Rename by matching the full attribute you wrote
(`className="cxgrid cxgrid--score"`), never the bare token, and grep the file afterwards for what
survived:
```bash
grep -n 'cxgrid' web/app/considerations/page.tsx   # should be ONLY the pre-existing usages
```

**Why no check caught it, which is the more useful half.** `grid-dead-space` looks for MORE tracks
than children — this was fewer. `unequal-row-height` needs two siblings sharing a row, and a
one-column grid never has two. A collapsed grid is invisible to both. It is obvious as a WIDTH
inconsistency though: the same card class rendered at **476px in one day group and 861px in
another**, because days with one game looked identical either way and only the 13-game day went
full width. Hence `card-width-mismatch` — same class, three or more instances, widest/narrowest
past 1.5x. Two-way tested: silent as shipped, fires with the exact widths when the template is
stripped, silent again on restore.

**⚠️ And hit-test from scrollY 0.** While verifying this, the probe reported five
`click-intercepted` on the week nav, all "covered by header.snav" — a sticky header covering what
is beneath it at that scroll offset, which is what a sticky header does. Every one vanished at the
top of the page. The check now scrolls to the top before hit-testing and restores the reader's
position after, so the result does not depend on where the page happened to be.

### 🚨 A NEW class name can collide as easily as an edited rule
The "shared global CSS" rule below is about EDITING a rule. Adding one is the same hazard from the
other direction: `.cxgrid` was introduced for a small stat grid inside a considerations card, and
`.cxgrid` already existed as the CARD grid that lays those cards out two across. The new
`align-items:baseline` silently replaced the container's stretch, and the homepage's two cards
stopped matching — 21px apart, two components away from anything that had been touched.

**Grep the name before you invent it**, exactly as you would before changing one:
```bash
grep -c "cxgrid" web/app/globals.css        # 0 means the name is free; anything else, pick another
```
The tell in the audit is a finding on a page you did not edit. Note also that the probe's
`unequal-row-height` container selector ends in a deliberately broad `[class*='grid']`, so a new
class with "grid" in its name is doubly worth checking — it opts the element into a check written
for cards.

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

**MEASURE the gap and the padding before doing column arithmetic — do not assume them.** The
seven-column props table was sized wrong twice: first by guessing 924px against an ~825px card
(12 × `table-overflows-container`), then by assuming a 14px gap when the rendered row uses **16px**,
and by sizing to the card (825) rather than the **scroller** (795). Read the real numbers off the
page first:
```js
const row = table.querySelector('[class*="--head"]');
getComputedStyle(row).columnGap;                    // 16px, not the 14 you remember
getComputedStyle(row).padding;                      // 10px 16px
table.closest('.pmscroll').getBoundingClientRect().width;   // 795, not the card's 825
// budget = scrollerW - 2*padX - (cols-1)*gap
```
Then confirm `scroller.scrollWidth <= scroller.clientWidth` at 1440 rather than trusting the sum.

**A column that is nearly always empty is worth reporting before it ships.** The batter-vs-pitcher
column reads "never faced" on **61%** of rows, because the median pair on an MLB slate has zero
career at-bats against tonight's starter. That is not a reason to drop it — a reader wants to see
it — but it IS a reason to print the sample beside the average and to keep it out of the model.
Measure a proposed column's fill rate before building it into a layout.

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

### ⚠️ The iframe harness audits 20 pages in minutes — and lies about width
A full matrix (22 pages × 2 viewports) by `navigate` + `javascript_tool` is ~50 round trips. Faster:
one host page, an `<iframe>` per page sized to the viewport, the probe `eval`ed inside
`iframe.contentWindow`. Two pages per call fits the 45s tool timeout. It found everything the
per-page pass finds, **with two artifacts that a per-page pass in the real tab does not have**:

- **No rails, so the content column is ~1032px instead of 861/826.** The iframe page never
  hydrates (Suspense stalls in dev), so `data-rail` is never set and the rail gutters never
  reserve. Anything width-derived is measured on the wrong container: the homepage hero reported
  `full-bleed-short` (44px each side) that does not exist with rails, and the considerations cards
  reported 476 vs 861 — a real finding, as it turned out, but with the wrong numbers.
- **`/context` at 375 reports +77px overflow after the splice** — the documented splice artifact.

**Rule: the harness triages; every finding it raises is re-measured in the real tab before it
is reported or fixed.** Three of six harness findings this pass were real (below); two were
container artifacts; one was the known contrast false positive.

### The rail-bounded width is the width that matters
Three real findings this pass, one cause: a layout that only fits at a width the rails never give.
- **Context cards** (`.cxgrid`): `minmax(456px,1fr)` needs 928 for two columns; the rails leave
  861, so a 13-game day fell to one 861px column while a 1-game day (dayBasis 476) drew a 476px
  card beside it. Now `minmax(420px)` and a 422 basis — two columns of 422 fit, every card one
  width. Then the coaching stat grid clipped "Schottenheimer" inside a 422 card, so that row is
  always stacked (label above the grid), not just below 560px.
- **NCAAF model table**: 19/16/19/16 gave the totals 82px of empty width while "Boston College
  −5.3" had 8 to spare. 21/14/21/14.
- **Value Finder cards**: three visible cards in a two-across grid = an orphan (Derek: "make the
  cards side-by-side for all of them"). The tail was a SECOND grid inside a `<details>`, so even
  after expanding, the fourth card started a new row. Now one grid, rows hidden in place by the
  `hb-moretbl` checkbox, and `GAME_CAP` is EVEN (4).
Design and budget for 826–861, not 1120; check `main.wrap` and the panel at 1440 **with rails**.

### One label map, or the new books get named twice
`slipPricing.BOOK_LABEL` was a second copy of `bookLabel.ts`'s map. The day the us2 books
arrived, the homepage shopping table read "ballybet / betparx" beside "BetRivers / Caesars",
because only one map had learned the names. `bookName` now delegates. Grep for a second copy
whenever a lookup table grows: `grep -rn "BOOK_LABEL" web/lib web/app`.

### MLB props: the MAIN line, in lineup order, markets in the category's order
Derek: *"let's get this cleaned up and organized by category."* The board had every hitting
market three across, alphabetical (Doubles before Hits), players alphabetical (a bench bat first),
names ellipsized by a two-book tie label, and rows pairing `O 0.5` with `U 1.5` — two different
questions dressed as one market, because the football collapse takes the bettor-friendliest LINE
per side. Fixes: `mainLine()` (the line the most books post BOTH sides of, FanDuel breaking
ties) with both sides at that line; markets in `MLB_CATEGORIES` order; players in lineup order
(away side, then home, leadoff to nine) from `MLB_PROPS` slots; `booksLabel(books, 1)` so one
book is named or a count shown, which gave the name column its width back.

### A page reporting 0 rows on its DEFAULT URL is a bug until proven otherwise
`/ncaaf/model/players` reported `dataRows: 0, chars: 794` in two audits running and was waved
through as "no projections this week". It had 889 projections — for week 2 — and the page
defaulted to `week = 1` while every other NCAAF page defaults to `NCAAF_MODEL.card.week`. The bare
URL, the one the nav links to, showed an empty board all of game week; `?week=2` had 1,036 TD
rows. When the harness prints a zero-row page, open the ITS default URL and the current week side
by side before accepting the zero. Same family as the week-gate rule above, from the other end:
the gate was right, the default was wrong.

### Two games across when a category has two markets; and the phone-width trap in `minmax()`
Home Runs has two markets, so a full-width table put ~500px of nothing between two columns
(Derek: "eliminate all that space in the charts … two games side-by-side"). `.propstack--pairs`
lays the game cards two across (`repeat(auto-fit, minmax(min(400px,100%), 1fr))`). Three things
it needed, all found by the probe: `minmax(400px …)` alone made the PAGE 420px wide on a
375px phone — wrap the minimum in `min(…, 100%)`; `.propgame[open]{grid-column:1/-1}` (an open
NFL prop card spans its stack) put every open card back to full width — undo it for the pair
grid; and the base `.propstack{align-items:start}` let two expanded cards differ by 183px —
`stretch` on the pair grid. A one-sided row (first HR is yes-only) is now 61px like every
other row (`tbody tr{height:61px}`).

### The batter grid: a table has columns — that is the alignment fix
Derek: *"line up the market totals evenly on top of each other. They are not spaced evenly."*
In the market-block layout every prop row was its own grid with `auto` tracks, so an Over row's
price and book sat at different x positions from the Under row beneath it. No amount of
per-row tuning aligns two independent grids. `/mlb/props` is now `BatterGrid.tsx`: one `<table>`
per game, one row per hitter in lineup order, one column per market, each cell the main line
with both sides as savable chips on fixed tracks (30 / 38 / 30). Measured: every price in a
column at the same x, one row height (61px), six hitting markets + a 150px name in the 859px
the rails leave. Three things it needed:
- **Book CODES in dense cells** (`bookCode`: DK, FD, MGM, CZR, FAN, BR, ESPN, HRK, BLY, PARX)
  with a legend line above the grid and the names on the tooltip — "DraftKings" is 55px and
  the cell had 34.
- **A per-game show-more needs its own row class.** The day's `hb-moretbl` checkbox hides every
  `hb-row--more` beneath it, so a nested per-game toggle on the same class can never win; the
  grid uses `bg-row--more` with its own rule.
- **🚨 `min-width:0` on the flex item, or the PAGE scrolls instead of the scroller.** A flex item's
  min-width is `auto`, so the game card grew to the table's 846px min-width and the document was
  868px wide at 375 — and mobile emulation then reported `innerWidth` 868, which looked like the
  emulator was broken. When a phone viewport reads wider than you set it, look for overflow first.
- **A board of per-game cards is not one chart.** `repeated-column-header` fired 6× because six
  games each drew their own header; it now skips a table whose nearest `.propgame/.pmgame/.augame/
  article.game` card holds exactly one table.

## Prerequisites (already in the repo)
- **QA preview mode** is automatic on the local dev server: `web/proxy.ts` opens the gate when
  `NODE_ENV==="development"`, and `web/lib/supabase/client.ts` mocks `auth.getUser/getSession` so
  gated client components (LeftRail, dashboards) hydrate with a mock member. Production is untouched.
  Requires `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env.local` (public
  values; already added). Set `NEXT_PUBLIC_QA_PREVIEW=0` to force a real signed-out dev session.
- **Market columns need `SUPABASE_URL` in `web/.env.local` too** (same public value as
  `NEXT_PUBLIC_SUPABASE_URL`; added 2026-09-11). Every server-side reader in `web/lib/*` reads
  `process.env.SUPABASE_URL`, and the boards catch the "not set" throw and degrade to `—` in the
  market columns — so a local dev server without it renders a board that LOOKS like "no lines
  posted yet". Before concluding a market column is empty, check `grep -c '^SUPABASE_URL=' web/.env.local`.
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
`/considerations?week=1`, `/ncaaf/model`, `/ncaaf/best`, `/report`, `/bankroll`, `/dashboard`, `/creator`.
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
