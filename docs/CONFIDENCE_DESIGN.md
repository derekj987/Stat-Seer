# Confidence Tier Design + Week 1 2026 Board Audit

## Part 1: What the audit found

I transcribed your DraftKings Week 1 board and ran four coherence checks against
6,967 real games (1999–2025) with closing spreads.

### The board is internally coherent. There is no free money in it.

| Check | Result |
|---|---|
| Two-way ML overround | 4.06% mean — normal and consistent across all 16 games |
| Spread ↔ moneyline agreement | Within ~2 pts of the empirical curve on 14 of 16 |
| Largest single gap | TB@CIN, +4.2 pts — about **2 standard errors**, not significant |
| Cross-game consistency | Identical spreads price to within 0.1 pts where comparable |

The two "REVIEW" flags (TB@CIN, MIA@LV at +4.2 pts) sit inside the confidence
interval of my own empirical estimator (SE ≈ 0.9 pts at these spreads, so ±1.8 at
2SE). They are not edges. They are noise, plus possible transcription error on my
end.

**This is the expected result.** A single sharp book prices its game lines from one
model, so they are internally consistent by construction. The coherence detector I
proposed earlier was designed for **player props**, where books price hundreds of
markets semi-independently and inconsistencies genuinely appear. Applying it to
game lines at one book finds nothing, and that is not a bug.

### What the board *does* give you for free: line movement

12 of 16 games have moved off their open. This is real information, visible
without any model:

| Game | Move | Read |
|---|---|---|
| ARI@LAC | -11.5 → **-10.5** | Market moved a full point *toward the underdog* |
| WAS@PHI | -5.5 → **-4.5** | Same — a full point toward Washington |
| SF@LAR | -2.5 → **-3.5** | A point toward the Rams |
| CLE@JAX | -7 → -7.5 | Toward Jacksonville |
| DEN@KC | -2.5 → **-3** | Through the key number 3 — significant |
| MIA@LV | -3 → -3.5 | Through 3 the other way |
| NYJ@TEN | total 39.5 → 38.5 | Down a point |
| CHI@CAR | total 44.5 → 46.5 | Up two points |

Two full-point moves toward underdogs (LAC, PHI) and two moves through the key
number 3 are the most informative items on the entire board. If you build nothing
else, showing open→current movement with key-number crossings highlighted is real,
verifiable value.

### Why key numbers matter — and why a Gaussian model fails

From the 6,967 games:

| Margin | Frequency |
|---|---|
| **3** | **15.01%** |
| **7** | **9.10%** |
| 6 | 5.96% |
| 10 | 5.60% |
| 4 | 4.89% |

A margin of exactly 3 is one game in seven. Any model that smooths this into a
normal distribution will misprice -2.5 vs -3.5 — the two most heavily traded
numbers on the board.

---

## Part 2: Three errors I made, and what they cost

Worth recording, because all three are the failure modes that produce confident,
wrong betting products.

**1. Normal-margin model (caught by the data).** My first audit flagged **15 of 16
games as incoherent**. The market wasn't wrong — my Gaussian was low by 2–4 points
at every spread. Had I shipped that, the app would have declared nearly the entire
board mispriced. Replacing the assumption with the empirical curve dropped it to
2 marginal flags.

**2. Transcription errors (caught by the audit itself).** I entered moneylines in
the wrong order for all five road favorites (BAL, BUF, CHI, GB, DAL). The
coherence checker caught it by flagging impossible values — which is a useful
property, but the deeper point is that **hand-transcribed screenshot data is not a
foundation for a confidence model.**

**3. An assertion the data doesn't support.** I claimed lower totals mean less
variance, so a favorite at a given spread should win more often. The data says
otherwise:

| Spread 2.5–4.5 | P(favorite wins) |
|---|---|
| Total ≤ 43 | 60.0% |
| Total ≥ 48 | 61.1% |

Slightly the *opposite* direction, and not significant. My "cross-game
inconsistency" flags were built on a wrong premise. Deleted.

---

## Part 3: The confidence tier design

### The trap

"Best bet / moderate / low / don't bet" is a UI concept. Without a probability
model behind it, a tier label is a vibe with authority borrowed from the
surrounding statistics. The moment "BEST BET" appears next to a game, you have
made a promise you must be able to audit.

### Tiers must be a function of edge **and** uncertainty

Edge alone is not enough. If your model says you have a 3-point edge and its
standard error is 4 points, you cannot distinguish that from zero.

```
edge = p_model − p_breakeven(offered price)
t    = edge / SE(p_model)
```

| Tier | Condition | Meaning |
|---|---|---|
| **No Bet** | t < 1.0 | Edge indistinguishable from zero |
| **Low** | 1.0 ≤ t < 1.5 | Lean, small stake at most |
| **Moderate** | 1.5 ≤ t < 2.0 | Defensible |
| **Strong** | t ≥ 2.0 | Rare |

### What this means in practice — the number that should shape the product

At −110 you need **52.38%** to break even, so you need 2.38 points of edge before
you make a cent. With a realistic model SE of 3–4 points on a game win
probability, **"Strong" requires a 6–8 point edge** — which essentially never
occurs on a sharp Week 1 game line.

**Applied to your board, the honest output is "No Bet" on all 16 games.**

That is not a failure of the model. That is the product. An app that lights up
with best bets every week is manufacturing confidence, and that is precisely the
behavior of the touts you want to beat. Your differentiator is being the one app
willing to say the board is fairly priced.

### Where tiers will actually fire

1. **Player props** — softer pricing, lower limits, more markets than books can
   carefully price. This is where your model work pays.
2. **Line shopping** — a half point on a 3.5, or −105 vs −115, is a real and
   *verifiable* edge with no model risk. Highest trust-per-unit-effort feature
   available to you.
3. **Stale lines after news** — books differ in reaction speed.
4. **Correlated parlay mispricing** — books price legs semi-independently.

Note that only #1 requires a model. The others are pipeline and speed.

### Non-negotiables for the tiering system

- **Publish the probability, not just the tier.** "Moderate — 54.1% vs market
  52.4%" is auditable. "Moderate confidence" is not.
- **Track calibration publicly.** When you say 55%, it must hit 55%. This is the
  entire trust proposition.
- **Track closing line value.** It converges in dozens of bets rather than
  thousands, and it's what sharp users will judge you on.
- **Show the sit-outs.** A visible "no edge this week" record is the strongest
  trust signal you can produce, and the hardest for a competitor to copy.

---

## Part 4: The blocking dependency

None of the above can be validated without **historical prop lines with
timestamps**. Until then:

- You cannot compute closing line value
- You cannot calibrate an edge estimate
- You cannot know whether a 5.9% snap-share improvement converts to money

MAE improvement and betting edge are unrelated quantities. The bridge between them
is historical line data, and it is the highest-value thing you can acquire.

Screenshots will not substitute. You need an odds API with history —
timestamped, multi-book, including props.

## Files

| File | Purpose |
|---|---|
| `odds_audit_v2.py` | Empirically-calibrated board audit (run this) |
| `odds_audit.py` | v1, normal-margin. Kept as the record of the false-positive failure |
| `IDEA_TRACKER.md` | Running log of every idea, status, and reasoning |
| `FINDINGS.md` | Snap-share model build 1 results |
