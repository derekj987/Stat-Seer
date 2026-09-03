---
name: visual-audit
description: Sweep StatSeer's pages in the dev browser for the visual/layout bugs Derek keeps catching by eye — unequal card heights, horizontal overflow, dead space, invisible/low-contrast text, collapsed (zero-size) elements, clipped text, click-intercepted buttons, broken images. Use for a "maintenance day" pass, before a deploy, or whenever asked to check the app/website for visual bugs across pages. Runs an automated DOM probe at desktop + mobile and light + dark, then reports ranked candidates for Derek to approve — replacing the screenshot-and-send loop.
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
screen — usually the per-column widths don't cover every column).
Console errors + network 4xx/5xx are collected separately (see step 4).

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
   - `navigate` to the URL, then in `javascript_tool`:
     `await new Promise(r=>setTimeout(r,1500)); JSON.parse(eval(await (await fetch('/__ss_audit.js?v='+Date.now())).text()))`
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
  photo won't be assessed either way.
- **Dev CSS-ordering quirks**: a contrast/background finding that only appears in dev may not
  reproduce in production — confirm ambiguous ones against the live site before asserting a prod bug.
- Tune thresholds via `window.__SS_AUDIT_CFG = { rowHeightTol, contrastMin, maxPerType }` before eval.

## Cleanup
Remove `web/public/__ss_audit.js`, `resize_window {preset:"desktop"}`, and (if you set it) clear the
`colorScheme` emulation before finishing. The probe (`web/qa/visual-audit.js`) and QA mode stay.
