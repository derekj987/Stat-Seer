# Tailgate — automated fan-sentiment pipeline (Phase 2 spec)

**Status:** spec, not built. Phase 1 (curated seed feed + `/tailgate` page) is live.
**Owner setup needed:** a Reddit script app (client id/secret) and an Anthropic API key.

---

## What this builds

Phase 1 shipped the `/tailgate` page reading a hand-seeded `Buzz[]` from
`web/lib/tailgate.ts`. Phase 2 replaces the seed with an automated weekly scan:

```
Reddit team boards ──▶ pre-filter to player mentions ──▶ Claude (Haiku) extract
      (free API)            (roster resolver)              (structured Buzz)
                                                                  │
                                       Supabase `tailgate_buzz` ◀─┘
                                                                  │
                                        /tailgate page reads it ◀─┘
```

The **page and the `Buzz` type do not change.** The pipeline writes rows in the
exact shape the page already renders, so wiring it up is a one-line swap in
`weekTailgate()` (seed array → Supabase read) plus flipping `sample: false`.

### The discipline (unchanged from Phase 1)

This is **fan sentiment, never a StatSeer pick or model output.** The pipeline
inherits three hard rules:

1. Every item cites the board(s) it came from (`sources`), ideally with a thread link.
2. The extractor may only report **what fans actually said** — it never invents a
   line, a stat, or a take. Hallucination guard is a first-class requirement, not a nicety.
3. Nothing here feeds The Model, calibration, or grading. It's walled off in its
   own table and its own page.

---

## Components

### 1. Reddit ingest — `tailgate_reddit.py` (root, next to `props_client.py`)

**Auth.** A Reddit "script" app (free) → client id + secret. OAuth client-credentials
flow gives a bearer token good for 100 req/min. That's ~2 orders of magnitude more
than we need. No user login; read-only.

**What it pulls, per team:**
- The 32 team subreddits (static `TEAM_SUBREDDITS` map, e.g. `BUF → r/buffalobills`).
- `top?t=week` + `hot` listings (≈25 posts each), deduped by post id.
- For each post, the top ~10 comments (`?sort=top`), truncated to a char cap.

**Pre-filter before Claude (this is the cost lever).** Raw board text is mostly
noise (game threads, memes, refs). Before spending a single token:
- Run each post/comment through the existing roster to keep only text that
  **mentions a rostered player on that team** (reuse `ingest/player_resolver.py`
  + a weekly roster pull — the same names infrastructure the props/injury paths use).
- Keep a window of context around each hit (the sentence/comment), not the whole thread.
- This typically cuts a team's ~40k raw tokens down to ~10–15k of on-topic text.

**Output:** an intermediate `{ team, matchup, snippets: [{text, permalink, score}] }`
per team. `matchup` comes from the week's schedule (already in the odds DB).

> Empty-week safety (mirrors `practice_scraper.py`'s lesson): a team returning zero
> snippets looks identical to "the scraper broke." Log per-team snippet counts every
> run, and fail loudly if *all* teams come back empty.

### 2. Claude extraction — same script, `--extract` stage

One `messages.create` call **per team** (not one giant call — keeps each prompt
small, cacheable, and independently retryable). Model: **`claude-sonnet-5`** —
chosen over Haiku because the judgment parts of this (the `heat` call, the "why"
behind a take, telling real buzz from noise) reward a sharper read, and the cost
delta is small at this volume. Run it **thinking-off** (`thinking: {type: "disabled"}`)
— this is a bounded extraction, not a reasoning task, so that keeps it cheap and fast.

**Structured output** (guarantees valid `Buzz` rows — no parsing/retry loop):

```python
BUZZ_SCHEMA = {
  "type": "object",
  "properties": {
    "buzz": {"type": "array", "items": {"type": "object", "properties": {
      "player":  {"type": "string"},
      "angle":   {"type": "string"},   # the OVER fans tie them to, e.g. "OVER 62.5 rec yds"
      "heat":    {"type": "integer", "enum": [1, 2, 3]},
      "take":    {"type": "string"},   # 1–2 sentences: what the boards are saying + why
      "quotes":  {"type": "array", "items": {"type": "string"}}  # short verbatim snippets, for the source links
    }, "required": ["player", "angle", "heat", "take"], "additionalProperties": False}}
  },
  "required": ["buzz"], "additionalProperties": False
}
# client.messages.create(model="claude-sonnet-5", thinking={"type": "disabled"},
#     output_config={"format": {"type": "json_schema", "schema": BUZZ_SCHEMA}}, ...)
```

**Prompt (system):**

> You read NFL fan message-board chatter for **one team** and surface players fans
> are buzzing about to go **OVER** a number this week. You are not predicting
> anything and not giving picks — you are summarizing what fans are saying, as
> "ammo" for someone doing their own research.
>
> Rules:
> - Only report players and takes **actually present in the snippets.** Never
>   invent a player, a stat line, or an over/under number. If fans didn't name a
>   specific number, describe the angle qualitatively ("fans expect a big rushing day").
> - `heat`: 3 = loud/repeated across multiple threads; 2 = a few fans, real thread;
>   1 = one-off simmering mention. Be conservative — most weeks have few 3s.
> - `take` is 1–2 sentences, plain, quoting the *sentiment* not a specific poster.
> - Include 1–3 short `quotes` (verbatim, <15 words each) that back each buzz item,
>   so we can link back to the thread.
> - If nothing rises above noise, return an empty `buzz` array. That's a valid answer.

The script then joins Claude's `quotes` back to the snippet permalinks to populate
`sources` (board name + thread URL), assigns a stable `id`
(`w{week}-{team}-{slug(player)}`), and attaches `team`/`matchup`.

> **Copyright guard:** `quotes` are capped short and used only to locate the source
> thread — we link out, we don't reproduce threads. Keeps us clean the same way the
> app's other content does.

### 3. Storage — Supabase `tailgate_buzz`

New table (append to `ingest/schema.sql`), mirroring the `Buzz` type:

```sql
create table if not exists tailgate_buzz (
  season      int  not null,
  week        int  not null,
  id          text not null,
  player      text not null,
  team        text not null,
  matchup     text,
  angle       text not null,
  heat        int  not null check (heat between 1 and 3),
  take        text not null,
  sources     jsonb not null default '[]',   -- [{board, url}]
  captured_at timestamptz not null default now(),
  primary key (season, week, id)
);
-- read grants for the web app (server + client), like the other web-read tables
grant select on tailgate_buzz to service_role, anon, authenticated;
```

Writes are an **upsert** on `(season, week, id)` so re-running mid-week refreshes a
player's take instead of duplicating it. A run replaces that week's rows for each
team it successfully processed (delete-then-insert per team, so a team dropping out
of the buzz clears cleanly).

### 4. Scheduler — `.github/workflows/capture-tailgate.yml`

Same shape as `capture-props.yml`:

```yaml
on:
  schedule:
    - cron: "0 14 * * 3"   # Wed 14:00 UTC (~9-10am ET) — after Wed practice chatter
    - cron: "0 15 * * 5"   # Fri 15:00 UTC — post-final-practice / injury designations
    - cron: "0 14 * * 0"   # Sun 14:00 UTC (~9-10am ET) — late buzz before the 1pm ET games
  workflow_dispatch: {}
jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install --quiet certifi praw anthropic
      - env:
          REDDIT_CLIENT_ID:     ${{ secrets.REDDIT_CLIENT_ID }}
          REDDIT_CLIENT_SECRET: ${{ secrets.REDDIT_CLIENT_SECRET }}
          ANTHROPIC_API_KEY:    ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL:         ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: python tailgate_reddit.py --current --write
```

Three runs a week to start — **Wed / Fri / Sun** — spanning the practice-report arc
(Wed chatter → Fri designations → Sunday-morning late buzz). Easy to add a fourth
cron later if a slot proves valuable. `workflow_dispatch` lets you run it by hand
while testing.

### 5. Web wiring — one function changes

`web/lib/tailgate.ts` `weekTailgate()` swaps the `SEED` return for a Supabase
read of `tailgate_buzz` filtered by `(week, season)`, ordered by `heat desc`.
`sample` becomes `false` (drops the "sample feed" banner). **`BuzzCard`, the page,
the CSS, and the nav are untouched** — the whole point of shipping the shape first.

---

## Cost & rate limits (recap)

- **Reddit:** $0. Free tier is 100 req/min; a full 32-team scan is a few hundred
  requests total, spread over minutes. (Commercial-ToS is a later "read the terms"
  item, not a build blocker.)
- **Claude (Sonnet):** ~$2/run for an all-32 scan (≈12k pre-filtered input + ~1k
  output per team, thinking-off). At **3 runs/week ≈ ~$20–25/month** (a little less
  now — Sonnet 5 intro pricing runs through Aug 31 2026). Sharper reads than Haiku
  for a rounding-error difference at this volume.
- Both scale trivially; nothing here threatens a budget.

## Secrets Derek adds (GitHub → repo secrets)

| Secret | Where from |
|---|---|
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | reddit.com/prefs/apps → create a **script** app (free) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (pay-as-you-go) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | already set for the other capture jobs |

(As always: I never handle the key values — you paste them into GitHub secrets.)

---

## Build order

1. **`tailgate_buzz` table** — add to `ingest/schema.sql`, Derek runs it in Supabase.
2. **`tailgate_reddit.py` ingest stage** — Reddit pull + roster pre-filter, `--dry`
   prints per-team snippet counts. Validate against one or two teams first (like the
   presser collector's "3–4 teams before scaling" rule).
3. **Extraction stage** — add the Haiku call + structured schema; `--dry` prints the
   `Buzz` rows it *would* write. Eyeball them for hallucination before wiring writes.
4. **`--write`** — upsert into Supabase; run once by hand, check the rows.
5. **Web swap** — `weekTailgate()` reads Supabase; `sample: false`.
6. **Workflow** — add `capture-tailgate.yml`, confirm a manual `workflow_dispatch` run
   lands rows, then let the cron take over.

Ships behind a real season anyway — there's no live board chatter until games start,
so the seed feed stays visible until the first scan has something to say.

## Decisions (settled Aug 16 2026)

- **Model:** Sonnet (`claude-sonnet-5`), thinking-off — sharper sentiment reads;
  cost delta is negligible at this volume.
- **Cadence:** 3×/week (Wed / Fri / Sun) to start; add more slots if a run proves valuable.
- **Sources:** Reddit first (all 32, one API). Marquee off-Reddit team forums come
  later as bespoke per-site scrapers.

## Still open / future

- **Verifiable-trust angle (future):** because these are timestamped, locked-pre-game
  claims, we *could* later grade how often fan-buzzed overs actually hit — turning
  Tailgate from pure color into another public track record. On-brand, not now.
