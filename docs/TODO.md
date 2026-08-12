# Build plan — ordered to-do list

Written for someone who hasn't shipped an app before. Ordered by **dependency and
urgency**, not by importance.

**The key thing to understand up front:** the urgent work is small, and the big
work isn't urgent. Data collection is a couple of weekends and has a hard
deadline. The app itself is a multi-month project with no deadline at all.

Today is **August 10, 2026**. Week 1 kicks off **September 9** — about 30 days.

---

# PHASE 0 — Two decisions to make this week

Nothing technical. But these shape everything downstream, and changing them later
is expensive.

- [ ] **Decide the business model: subscription or affiliate?**
  Affiliate links pay you when users bet more, which is structurally opposed to
  saying "no edge this week, sit out." Subscription aligns with honest advice but
  grows slower. This decides what the app is *allowed to say*, so decide it before
  you build the confidence tiers.

- [ ] **Talk to a lawyer about betting-advice regulation.**
  Not optional and not something I can advise on. Betting advice sits in a
  genuinely messy regulatory space — rules vary by state, some jurisdictions
  regulate paid tipsters, and app stores treat gambling-adjacent apps differently
  from ordinary apps. A one-hour consult now is far cheaper than a takedown later.
  Ask specifically about: state-by-state restrictions, required disclaimers, age
  gating, and whether you need an entity (LLC) before taking payments.

---

# PHASE 1 — Accounts and subscriptions (one weekend)

Some of these take days to approve, so start them before you need them.

## Free, five minutes each

- [ ] **GitHub** — where your code lives. Free.
  Create a **private** repository named something like `nfl-advice-app`.

- [ ] **Supabase** — your database. Free tier is plenty to start.
  Create one project. Save the **project URL** and the **service role key** —
  you'll need both. Treat the service key like a production password.

- [ ] **Vercel** — hosts your website and runs your scheduled jobs. Free tier
  works, but **cron jobs require the Pro plan ($20/month)**. Budget for it.

- [ ] **Domain name** — ~$12/year at Namecheap or Cloudflare. Buy it now even if
  you're undecided on the name; good ones disappear.

## Paid, and one takes weeks

- [ ] **Apple Developer Program — $99/year. START THIS FIRST.**
  Approval takes anywhere from two days to several weeks, and longer if you
  enroll as a company rather than an individual. You cannot put an app on
  iPhones without it. This is the single most common thing that delays first-time
  builders, purely because nobody expects a queue.

- [ ] **Google Play Developer — $25, one time.** Approval is usually faster.

- [ ] **Anthropic API key** — for the presser extraction. Pay-as-you-go, and the
  extraction workload is small. Likely a few dollars a month at your volume.

- [ ] **Odds API subscription** — see the next section.

**Phase 1 running cost: roughly $130 up front, plus ~$20–120/month depending on
the odds plan.**

---

# PHASE 2 — Buying the odds API (half a day)

You asked how this works. It's simpler than it sounds — an API subscription is
just a paid login for data, and the "login" is a long string of characters.

## How to do it without wasting money

- [ ] **Step 1: Sign up for the FREE tier first.** Most providers have one. You
  get an API key immediately.

- [ ] **Step 2: Make one test call before paying anything.** Paste this in your
  browser with your key substituted in:

  ```
  https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=spreads,totals&oddsFormat=american&apiKey=YOUR_KEY
  ```

  You'll get raw JSON back. Ugly, but it confirms the data exists and looks the
  way you expect.

- [ ] **Step 3: Confirm the free tier's limits.** Free tiers usually exclude
  player props and historical data — the two things you actually need. Verify what
  you'd be paying for *before* paying.

- [ ] **Step 4: Only then upgrade.** For this app you need the tier that includes
  **player props** and **historical odds**. Expect $99+/month; props-inclusive
  plans across the market generally run $200–500/month, and historical props are
  premium-priced.

- [ ] **Step 5: Compare two or three providers on one criterion — how far back
  does prop history go?** The Odds API has props from May 2023. SportsDataIO
  covers from 2019. Sports Game Odds has a free tier at slower refresh. That
  history depth is the thing that determines whether you can validate a prop
  model at all.

## The one strategic point

**Start live capture immediately. Backfill later.**

Live capture is cheap and compounds from day one. The historical archive will
still be there in three months at the same price. But a week of uncaptured
closing lines is gone permanently — and closing lines are what your entire
calibration ledger depends on.

Also worth one email before you build a scraper: **ask whether their plan
includes daily injury and practice-participation data.** Several providers bundle
it. If yours does, you can delete `practice_scraper.py` entirely.

## Where the key goes

Never in your code, never in GitHub. API keys go in **environment variables** —
settings stored outside the code that the code reads at runtime.

- In Supabase and Vercel there's a settings page called "Environment Variables."
- Locally, a file named `.env` that you add to `.gitignore`.

If a key ever lands in a public repo, assume it's compromised and rotate it.
Scrapers watch GitHub for exactly this.

---

# PHASE 3 — Start collecting data (URGENT — one weekend, before Sept 9)

This is the only thing with a real deadline. **Practice trajectory cannot be
backfilled** — the Wed/Thu/Fri sequence exists only if captured on the day.

Presser collection should start **now**, since training camp is already underway.

- [ ] **Run `ingest/schema.sql`** in the Supabase SQL editor. Paste, run, done.
  Creates every table plus the append-only protections.

- [ ] **Seed the `players` table** from the nflverse players file. Download the
  CSV, import it through Supabase's table editor. Set a weekly refresh later —
  rosters churn constantly.

- [ ] **Deploy the presser collector** and confirm rows are landing. Start with
  three or four teams, not all 32. Get one working end to end before scaling.

- [ ] **Validate the practice-report parser against a saved page** before
  scheduling it:

  ```bash
  curl <a team injury report URL> > fixtures/test.html
  python practice_scraper.py --test-parse fixtures/test.html
  ```

  **Then keep that saved page as a test.** A scraper returning zero rows looks
  identical to a week with no injuries — this is the only thing that warns you
  before your data quietly goes empty.

- [ ] **Set up the cron jobs** using `ingest/vercel.json`.

- [ ] **Check the data every day for the first week.** Just open the table and
  look. Broken collection discovered in week 1 costs you a week; discovered in
  week 8 costs you a season.

**If you do nothing else this month, do Phase 3.** Everything else can wait
without loss.

---

# PHASE 4 — Build the app (months, not weeks)

Realistic expectation: working alongside a full-time job, a shippable first
version is **three to six months**. Anyone who tells you otherwise hasn't done it.

## Build in this order — it's the reverse of what feels natural

- [ ] **4a. A plain website that shows one thing.** Not the app. A single page
  listing this week's games with their lines, pulled from your database. No
  styling, no login, no mobile. Just prove the pipeline works end to end.

- [ ] **4b. The Board section.** Line shopping, key-number flags, alternate-line
  fair prices. Start here because it's arithmetic — no model risk, and it's the
  most useful part of the whole app.

- [ ] **4c. The Context section.** Weather, referee crew, injury burden, implied
  totals, line movement. All true, none of it claiming to be an edge.

- [ ] **4d. The calibration ledger, running live.** Publish predictions before
  kickoff, grade them after. **Run this for a full season before showing anyone a
  confidence tier.** The ledger is your entire trust proposition, and it has to
  have history to mean anything.

- [ ] **4e. The Model section.** Last, because it needs the ledger to be
  meaningful.

- [ ] **4f. The mobile app.** React Native and Expo, sharing code with the
  website. Last of all — the web version teaches you what the app should be.

## The hard truth about ordering

The temptation is to build the pretty mobile app with confidence picks first,
because that's the vision. Resist it. Every part of that depends on a data
pipeline and a track record you don't have yet, and rebuilding a polished UI
around a changed data model is the most expensive mistake available to you.

---

# PHASE 5 — Before you launch

- [ ] **Terms of service and disclaimers**, reviewed by the lawyer from Phase 0.

- [ ] **Age gating** (18+ or 21+ depending on jurisdiction).

- [ ] **A full season of ledger history** before publishing confidence tiers.

- [ ] **Read Apple's and Google's current guidelines on gambling-adjacent apps.**
  Do this *before* you finish building, not after — the requirements can affect
  architecture, and rejection means weeks of delay.

- [ ] **Decide what you show a losing user.** If someone follows your advice and
  loses for a month, what does the app say? Answer that on purpose rather than by
  accident. It's the moment your trust proposition is actually tested.

---

# What to do this weekend

If you only have two days:

1. **Start the Apple Developer enrollment.** It's a queue; get in it.
2. **Run `schema.sql`** and seed the players table. An hour.
3. **Sign up for the free odds API tier** and make one test call in your browser.
4. **Get the presser collector running for four teams.**
5. **Email your odds provider** to ask whether their plan includes daily practice
   data.

That's it. Those five things put you ahead of the season deadline and cost under
$100.

---

# Cost summary

| Item | Cost | When |
|---|---|---|
| Apple Developer | $99/year | Now — it's a queue |
| Google Play | $25 once | Before launch |
| Domain | ~$12/year | Now |
| Supabase | Free → $25/mo when you grow | Now free |
| Vercel Pro (needed for cron) | $20/mo | Phase 3 |
| Odds API | $99–500/mo | Phase 2 |
| Anthropic API | a few dollars/mo | Phase 3 |
| Lawyer consult | $200–500 once | Now |

**Realistic first-year total: $2,000–7,000**, driven almost entirely by which
odds plan you need. Everything else is rounding error.

---

# The two mistakes that would hurt most

**Missing the data window.** Practice trajectory can't be backfilled. Miss
September and you've lost a season of the one feature nobody else has. This is
the only irreversible item on the entire list.

**Shipping confidence picks before the ledger has history.** Your differentiator
is a verifiable track record. Publishing tiers with no history behind them makes
you indistinguishable from every other picks app — and it's a reputation you only
get to spend once.
