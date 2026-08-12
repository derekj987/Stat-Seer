# Ingestion setup

Two collections that must start with the season or the data is gone. Neither
needs a model — a scheduled job and a table.

| File | Purpose |
|---|---|
| `schema.sql` | Postgres DDL. Run this first. |
| `player_resolver.py` | Scraped name → `gsis_id`. **Tested, 13/14.** |
| `practice_scraper.py` | Daily Wed/Thu/Fri participation |
| `presser_collector.py` | Raw transcripts + versioned LLM extraction |
| `vercel.json` | Cron schedule |

---

## Why these two can't wait

**Practice trajectory cannot be backfilled.** nflverse retains only the final
weekly designation. `DNP → DNP → LIMITED` and `LIMITED → LIMITED → FULL` both
end "Questionable" and mean very different things for snap share. That sequence
exists only if captured on the day.

**Presser archives are patchy and biased.** Older seasons often survive only as
beat-writer quotes rather than full transcripts, which skews the sample toward
statements someone already judged newsworthy — exactly the wrong selection for
finding *under-covered* usage signals.

---

## Order of operations

**1. Run `schema.sql`** in the Supabase SQL editor. It creates the tables, the
append-only triggers, and the `public_calibration` view.

**2. Seed `players`** from nflverse:

```
https://github.com/nflverse/nflverse-data/releases/download/players/players.csv
```

Map `gsis_id, pfr_id, display_name, first_name, last_name, football_name,
position, latest_team, status`. Refresh weekly — rosters churn.

**3. Check whether you need the scraper at all.** Several odds providers include
daily injury and practice data. If yours does, delete `practice_scraper.py` and
consume the API instead — fewer moving parts, no layout breakage, no terms-of-
service question.

**4. If you do scrape**, validate the parser before scheduling:

```bash
curl <one team injury report URL> > fixtures/kc_week1.html
python practice_scraper.py --test-parse fixtures/kc_week1.html
```

Then keep that fixture and run it in CI. Sources change layout without warning,
and a golden-file test is the only thing that tells you before the data silently
goes empty. **A scraper that returns zero rows looks identical to a week with no
injuries.**

**5. Populate `SOURCES`** as a team → URL map in config, not in the module.

---

## The DST gotcha

**Vercel cron is UTC only.** The NFL season crosses the DST boundary in early
November, so a fixed UTC schedule drifts an hour mid-season.

5:00 PM ET is `21:00 UTC` in EDT (Sept–Oct) and `22:00 UTC` in EST (Nov–Jan).

The `vercel.json` here fires practice collection at **both 21:00 and 23:00 UTC**
rather than trying to be clever. The unique constraints make re-runs free, so
running twice is strictly better than running once at the wrong hour.

Same reasoning for the pre-kickoff odds window: it sweeps every 15 minutes across
16:00–23:00 UTC on Sundays, Mondays, and Thursdays. Cheap, and it cannot miss a
kickoff wave. Filter to events inside 20 minutes of `commence_time` in the
handler rather than trying to encode kickoff times in cron.

---

## Idempotency

Every table has a unique constraint and every write uses
`Prefer: resolution=ignore-duplicates`. Re-running a job is free. Design for
"run it more often than necessary" rather than "run it exactly once" — missed
runs cost data you can never recover, duplicate runs cost nothing.

One team failing must not abort the run. Partial data beats none.

---

## Two-stage presser design

Stage 1 stores the **raw transcript**. Stage 2 extracts structured statements
tagged with `prompt_version`.

Keep them separate. The extraction prompt will improve for years, and versioned
extractions let you re-run the whole archive against a better prompt. If you only
store extractions, every improvement applies to future data only — and the
archive is the asset.

Extraction priority, from the analysis work:

| Type | Value |
|---|---|
| `WORKLOAD_EXPLICIT` — "we're going to lean on him" | Rare, high |
| `ROLE_DEPTH` — "he's earned more snaps" | Moderate |
| `AVAILABILITY_HEDGE` — how a coach talks around a Q tag | Pairs with practice data |
| `EVALUATIVE_PRAISE` — "he's a pro's pro" | Near zero. Will swallow the pipeline if allowed in. |

Capture `speaker_role`. Coordinators leak more than head coaches, who are heavily
media-trained — and recording the role makes that measurable rather than assumed.

**The timing edge:** props for secondary players often post *after* Wednesday
pressers, so the information can arrive before the market for that player exists.

---

## Unresolved names

`player_alias_queue` collects names the resolver can't match, rather than dropping
them silently. Review it weekly.

An unresolved name is a hole in the panel, and holes are invisible until a
backtest quietly drops rows. The resolver handles initials, comma-flipped names,
apostrophes, hyphens, and suffixes — but rookies and practice-squad elevations
will still miss until the roster file catches up.

---

## What the schema enforces, and why

`UPDATE` and `DELETE` are **revoked** on `prediction_ledger`, `practice_reports`,
`pressers`, and `odds_snapshots` — plus a trigger that raises on either. This is
deliberately belt-and-braces.

The ledger also carries `check (published_at < commence_time)`, so a prediction
physically cannot be recorded after kickoff.

If past predictions can be edited, the track record is worth nothing — and the
track record is the entire differentiator. Enforce it in the database, not in
application code that a future refactor can quietly bypass.

`prediction_results` is a separate table. Grading never writes back to the
ledger.
