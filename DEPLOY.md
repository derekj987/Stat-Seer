# Deploying StatSeer data capture

The data capture runs on **GitHub Actions**, not Vercel. Vercel Cron requires the
Pro plan (~$20/mo) for anything more frequent than once daily; GitHub Actions runs
the same tested `odds_client.py` on a schedule for free. Vercel stays the eventual
home for the *frontend*, not the capture jobs.

---

## Odds capture — `.github/workflows/capture-odds.yml`

Runs `odds_client.py --live --write` on a schedule and writes to `odds_snapshots`.

### One-time setup

1. **Add three repository secrets.**
   GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret | Value |
   |---|---|
   | `ODDS_API_KEY` | your the-odds-api.com key |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` (base, no `/rest/v1`) |
   | `SUPABASE_SERVICE_KEY` | the `sb_secret_...` service key |

   These never touch git — they live encrypted in GitHub and are injected as env
   vars at run time. `odds_client.load_env()` reads real env vars when there's no
   `.env` file, so no code change is needed.

2. **Test it before trusting the schedule.**
   GitHub → **Actions → Capture odds → Run workflow**. It runs the SCHEDULED sweep
   once. Check the log for `HTTP 200`, `accepted: <n>`, and confirm rows land in the
   Supabase table editor.

### Schedule (all UTC)

| Cron | What | Reason tag |
|---|---|---|
| `0 */3 * 8-12,1 *` | every 3h, Aug-Jan — all upcoming games | `SCHEDULED` |
| `*/15 17-23 * 8-12,1 0,1,4` | every 15 min, Sun/Mon/Thu game windows, games ≤30 min to kickoff | `PRE_KICKOFF` |

The `closing_lines` view takes the last snapshot before kickoff, so frequent
captures give you the closing line automatically. Tune the crons freely — they're
a starting point, not sacred.

### Costs

- **Odds API:** 3 credits per run (3 markets × 1 region). At this cadence ≈ a few
  thousand credits/month, well under the 100k plan.
- **GitHub Actions:** ~1–2 min per run, roughly ~1,000 of the 2,000 free
  private-repo minutes/month. Widen the pre-kickoff interval (e.g. `*/30`) to halve it.

### Gotchas

- **GitHub disables scheduled workflows after 60 days of no repo activity.** Any
  push resets the clock; during an active build this won't bite, but note it for a
  quiet off-season.
- **Night games (SNF/MNF/TNF)** kick off after 23:00 UTC, outside the pre-kickoff
  window; their closing line comes from the 3-hourly sweep instead. Tighten later
  if you want sharp night-game closes.

---

## Web frontend (Value Finder) — `web/`, deploy on Vercel

Next.js 16 app. A server component reads the latest complete odds snapshot from
Supabase (service key, server-side only — never shipped to the browser) and renders
Value Finder. ISR revalidates every 2 minutes, so it stays current as the capture
Action writes new snapshots. **Free on Vercel Hobby** (cron is the only thing that
needs Pro, and that lives in GitHub Actions).

### Deploy

1. Vercel → **Add New… → Project** → import the `Stat-Seer` repo.
2. **Set the Root Directory to `web`** (Vercel auto-detects Next.js from there).
3. Add two **Environment Variables** (same values as `.env`):
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_KEY` = the `sb_secret_...` service key
   *(Server-only — no `NEXT_PUBLIC_` prefix, so they never reach the client.)*
4. **Deploy.** Every push to `main` auto-builds and redeploys.

### Local dev

```
cd web
npm install          # needs a network where the npm registry is reachable
npm run dev          # http://localhost:3000
```
`web/.env.local` holds the Supabase vars locally (gitignored). Regenerate the baked
win-curve (`web/lib/winCurve.ts`) from `analysis/the_board.emp_winprob` if the
historical fit ever changes.

## Not yet deployed

- **Practice / injury capture** — `ingest/injury_collector.py` is ready but waits on
  the paid SportsDataIO feed. When live, it gets its own workflow (same pattern,
  `SPORTSDATA_API_KEY` secret, Wed/Thu/Fri schedule).
- The `api/cron/*.py` Vercel handlers remain in the repo as an alternative to the
  Actions capture if you ever move onto Vercel Pro.
