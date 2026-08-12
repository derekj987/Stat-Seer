# Split task lists

Same work as `TODO.md`, sorted by **where it happens**. Companion to that file —
this one tells you which window you need to be in.

---

# LIST A — Do here with Claude

Anything that is writing, analysis, design, or debugging. You don't need accounts
or money for any of it.

## Ready to do right now

- [ ] **Build the odds API client.** Once you've picked a provider, paste me their
  docs page and I'll write the fetch-and-store code, mapped to the
  `odds_snapshots` table, with the event-anchored pre-kickoff logic and quota
  guarding built in.

- [ ] **Write the Vercel cron handlers.** The `vercel.json` points at
  `/api/cron/...` routes that don't exist yet. I'll write them.

- [ ] **Build the Stage A availability model.** The biggest gap in the player
  pipeline — everything downstream is currently conditioned on a player being
  active. I have the data and can build it now.

- [ ] **Build the touch-share layer.** Converts the snap-share model into actual
  prop numbers. `rush_share` and `target_share` are already computed in the panel
  and unmodelled.

- [ ] **Build the line-shopping / key-number engine.** Pure arithmetic, no model
  risk, and the most useful feature in the app. Needs multi-book odds shape,
  which I can write against the provider's schema.

- [ ] **Build the grading job.** Reads `prediction_ledger`, joins closing lines,
  writes `prediction_results` with CLV. This is what makes the calibration view
  work.

- [ ] **Design the actual UI.** I can mock screens and write the React
  components. Start with the plain web version.

- [ ] **Write a terms-of-service and disclaimer DRAFT** for your lawyer to review.
  Cheaper than having them draft from scratch — but it must be reviewed, not used
  as-is.

## Once you have something to hand me

- [ ] **Validate the practice-report parser.** Save a real injury-report page
  (`curl <url> > page.html`), upload it here, and I'll fix the selectors against
  the actual markup. I can't reach those sites myself.

- [ ] **Debug anything that breaks.** Paste the error and the code. This is
  probably where most of our time goes once you start deploying.

- [ ] **Review your environment config.** Paste your `vercel.json`, migration
  files, or route handlers and I'll check them.

- [ ] **Interpret API responses.** Paste a raw JSON response and I'll write the
  parser and tell you what's missing.

- [ ] **Test the coordinator-change hypothesis.** The one attribute test still
  open that I expect might show something — head coaches came back at 49.9%
  across every split, which is suspiciously flat. Needs coordinator history,
  which isn't in nflverse. If you find a source, upload it.

- [ ] **Re-validate the models on real prop lines**, once you have the odds
  archive. This is the test that finally answers whether any of the player work
  converts to money.

## Ongoing

- [ ] Refine the extraction prompt as real pressers come in
- [ ] Add features to the model and re-run the backtest
- [ ] Update the tracker and catalog as decisions change

---

# LIST B — Do outside Claude

Anything involving your identity, your money, live network access, or a console I
can't reach.

## This weekend — start these first

- [ ] **Apple Developer Program enrollment** — $99/year, apple.com/developer.
  **It's a queue.** Days to weeks. Start it before you need it.

- [ ] **Talk to a lawyer.** Betting-advice regulation varies by state and I can't
  advise on it. Ask about: state restrictions, required disclaimers, age gating,
  and whether you need an LLC before taking payments.

- [ ] **Decide the business model.** Subscription or affiliate. I can help you
  think it through, but it's your call and it changes what the app may say.

## Accounts — 5 minutes each

- [ ] GitHub — create a **private** repo
- [ ] Supabase — create one project, save the URL and service key
- [ ] Vercel — note that **cron requires the $20/month Pro plan**
- [ ] Domain name — ~$12/year
- [ ] Google Play Developer — $25 once

## The odds subscription

- [ ] **Sign up for a free tier** and get a key
- [ ] **Make one test call in your browser** to confirm the data looks right
- [ ] **Email the provider**: does your plan include daily injury and
  practice-participation data? If yes, you can delete `practice_scraper.py`
  entirely.
- [ ] **Compare two or three providers on prop-history depth** — that's the number
  that determines whether you can validate a prop model
- [ ] **Then** pay for the tier with props and history

## Deployment and operations

- [ ] **Run `schema.sql`** in the Supabase SQL editor (paste, run)
- [ ] **Import `players.csv`** through Supabase's table editor
- [ ] **Set environment variables** in Vercel and Supabase — API keys go here,
  never in code or GitHub
- [ ] **Deploy** (`git push`, Vercel builds automatically)
- [ ] **Check the data daily for the first week.** Just open the table and look.
  Broken collection found in week 1 costs a week; found in week 8 costs a season.

## Before launch

- [ ] Read Apple's and Google's current gambling-adjacent app guidelines —
  **before** you finish building, since it can affect architecture
- [ ] App store submission
- [ ] Set pricing

---

# How the handoffs work

A few tasks need both of us, in a specific order. These are the ones where people
get stuck:

| You do | Then I do |
|---|---|
| `curl` a real injury report page, upload the HTML | Fix the parser selectors against actual markup |
| Pick a provider, paste their docs | Write the API client against their exact schema |
| Deploy and hit an error | Debug from the error text |
| Run one week of collection | Review the data for gaps and silent failures |
| Get the odds archive | Re-validate every model against real prop lines |

The pattern: **you handle anything requiring credentials or live network access,
and hand me the artifact.** I write and analyze; you deploy and pay.

---

# Two practical notes about working with me

**Files don't persist between conversations.** I remember our discussions, but not
the code files. When you come back, **upload the relevant files from the
`betting_app` folder** — especially `IDEA_TRACKER.md`, which carries every
decision we've made and why. That one file gets us back up to speed fastest.

**I can't reach most sites.** My network access is restricted to an allowlist that
covers GitHub, PyPI, and some public data sources — but not nfl.com, ESPN, or the
odds providers. That's why anything involving a live page has to come through you
as an upload. It's also why every model I've built runs on public nflverse data
pulled from GitHub.

---

# The shortest useful path

**Outside Claude, this weekend:** start the Apple enrollment, create the four
accounts, run `schema.sql`, sign up for a free odds tier, email the provider about
practice data.

**Back here, next session:** bring me the provider's docs and I'll build the odds
client and the cron handlers. That's the piece that turns the schema into a
running pipeline.

Everything after that is iteration.
