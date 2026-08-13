# StatSeer

Statistical analysis and betting advice for NFL games. **Advice only — not a
sportsbook.**

The differentiator is *verifiable* trust: published probabilities, published track
record including bad stretches, calibration anyone can check.

---

## First: read `CLAUDE.md`

It's the project primer. Claude Code reads it automatically each session, so you
never have to re-explain the project. Everything else below is mechanics.

---

## Setup

**1. Environment**

```bash
cp .env.example .env
# fill in your keys — .env is gitignored
```

**2. Python dependencies**

```bash
pip install pandas numpy scikit-learn scipy requests beautifulsoup4
```

**3. Database**

Paste `ingest/schema.sql` into the Supabase SQL editor and run it. Creates every
table, the append-only triggers, and the calibration view.

Then seed the `players` table from
`https://github.com/nflverse/nflverse-data/releases/download/players/players.csv`
via Supabase's table editor.

**4. Reproduce the analysis** (optional — all findings are already written up)

```bash
python analysis/fetch_data.py     # ~150 MB from nflverse, no auth needed
python analysis/build_panel.py
python analysis/features.py
python analysis/model.py
```

---

## Layout

```
CLAUDE.md              Project primer — read first
docs/                  Decisions, findings, build plan
ingest/                Schema, scrapers, cron config
analysis/              Every model and hypothesis test
skills/                model-validation skill
```

### `docs/`

| File | Contents |
|---|---|
| `IDEA_TRACKER.md` | **Every decision and why.** The single most important file. |
| `EMPIRICAL_REFERENCE.md` | Every number measured, with sample sizes |
| `ATTRIBUTE_CATALOG.md` | 31 attributes tested, ~25 untested with priorities |
| `CONFIDENCE_DESIGN.md` | Tier design + Week 1 2026 board audit |
| `TODO.md` | Build plan with costs and timing |
| `TODO_SPLIT.md` | What needs accounts/money vs what's just writing |

### `analysis/`

| File | What it establishes |
|---|---|
| `build_panel.py` → `features.py` → `model.py` → `model_v2.py` | Snap-share model. **+8.2% over persistence on change weeks** — the one measured signal that survived a real benchmark. |
| `persistence.py` | Volume persists (carries 0.678), efficiency doesn't (YPC 0.058) |
| `spread_fundamentals.py` | Key numbers: margin lands on 3 in 15.0% of games |
| `team_attributes.py` | 31 team attributes vs the closing line — none clear the vig |
| `referee_analysis.py` | Crew outcomes are noise; penalty rates are real (r=+0.267) |
| `injury_burden.py` | Snap-weighted injury burden — monotonic but not significant |
| `surprise_teams.py` | Hot starts regress ~24 pts and are fully priced |
| `trend_analysis.py` | 21 streak/trend angles — none clear the vig |
| `odds_audit_v2.py` | Market coherence audit |
| `alt_lines_v2.py` | Alternate-line fair pricing |
| `parlay_math.py` | EV compounding + correlation mispricing |
| `week1_picks.py` / `model_epa.py` | Game-line model — **failed validation.** Kept as the record. |

Scripts with a `_v2` suffix supersede the original. The originals are kept
deliberately — each documents a specific failure worth not repeating.

---

## Next steps

1. **Deploy data collection.** Practice trajectory can't be backfilled — the
   Wed/Thu/Fri sequence exists only if captured on the day. Hard seasonal deadline.
2. **Build the odds API client** against `the-odds-api.com/liveapi/guides/v4/`,
   mapped to `odds_snapshots`. This is the immediate task.
3. **Stage A availability model** — the player pipeline is currently conditioned
   on a player being active.
4. **Touch-share layer** — converts snap share into prop numbers.
5. **Value Finder** — needs no model at all, and it's where the value is.

---

## The discipline

A candidate enters the model only if it is **(1)** observable and recorded
historically, **(2)** has a mechanism stated in advance, and **(3)** improves
results **against the closing line**, out of sample. Fails any one → it's Context,
not a model feature.

Install the `model-validation` skill in `skills/`. It encodes seven checks derived
from seven real failures on this project, four of which were caught by automated
assertions rather than by review.

The single most valuable assertion, worth writing on day one:

```python
assert abs(base_case_prob - 0.5) < 0.035, "efficient baseline shows free money"
```

---

## Data

All analysis runs on public data from [nflverse](https://github.com/nflverse) —
no auth required. Live odds come from
[The Odds API](https://the-odds-api.com) (note the hyphens; there are
impersonator domains).
