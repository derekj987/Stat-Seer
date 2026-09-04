---
name: workflow-triage
description: Diagnose failing GitHub Actions runs for StatSeer — the "Run failed" emails Derek gets from the scheduled data jobs (Grade predictions, Capture referee assignments, Refresh CFB ratings, the capture-* crons) and from CI. Pulls the real run logs via the stored git credential, classifies the failure against the known recurring causes, and fixes the root cause rather than the symptom. Use whenever a workflow-failure email or screenshot arrives, or when asked why a job/cron/CI is failing.
---

# StatSeer workflow triage

## Why this exists
The scheduled jobs email on every failure. Several of those emails have turned out to be **one bug
class repeating**, and at least one was a bug **already fixed** whose emails were still in flight. So
the job is: get the real log, classify it, and only then decide whether anything is broken.

## Rule 0 — read the log before theorising
A failure was once misdiagnosed as "the `CFBD_API_KEY` secret is missing", inferred from a local
blank-key repro. The real log showed `CFBD_API_KEY: ***` present and a transient `CFBD HTTP 502`. The
run would have recovered on its own. **Never diagnose one of these from the email, the job name, or a
local repro.** Pull the log.

## Getting the logs (never prints the token)
The token comes from the stored git credential and is piped straight into curl — it must never be
echoed, written to a file, or pasted into chat.

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')

# recent failures
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/derekj987/Stat-Seer/actions/runs?per_page=25&status=failure"

# one run's logs (a zip of per-step .txt files)
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/derekj987/Stat-Seer/actions/runs/<RUN_ID>/logs" -o "$SCRATCH/run.zip"
```

Then grep the extracted members for `##[error]`, `Traceback`, `Error:`, `FileNotFoundError`.
Write the zip to the **scratchpad**, not the repo.

## ⚠️ Check whether it is ALREADY FIXED before touching anything
Emails arrive after the fact and keep arriving for runs that predate a fix. Compare the failing run's
timestamp against the fix commit, then look at whether later runs went green:

```bash
git log -1 --format="%H %ci  %s" <fix-commit>
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/derekj987/Stat-Seer/actions/workflows/ci.yml/runs?per_page=8"
```

This exact case happened: CI failed at 22:47–22:49 UTC with 11 × `Cannot find name 'PageProps'`, and
the `next typegen` fix landed at 22:51 UTC — every run afterwards was green. Nothing to do. **Say so
plainly instead of "fixing" a healthy workflow.**

## Known failure classes

### 1. Writing into a gitignored directory that doesn't exist  ← most recent
`Grade predictions` and `Capture referee assignments` both died with:

```
FileNotFoundError: [Errno 2] No such file or directory: 'data/games.csv'
```

The download **succeeded**. `data/` is gitignored (`.gitignore:10`), so on a fresh CI checkout the
DIRECTORY does not exist and `open("data/games.csv","wb")` fails. The transient-failure guard only
caught `URLError`/`HTTPError`, so a `FileNotFoundError` escaped as a traceback and emailed a FAILURE.

**The rule: any script writing under a gitignored path must `os.makedirs(dirname, exist_ok=True)`
first.** Every other script in this repo already did (`cfb_backfill`, `cfb_lines`, `cfb_weather`,
`odds_backfill`, …) — these two were the only ones that didn't, which is the tell that it's an
oversight and not a design choice.

When you find one, **grep for the siblings** rather than fixing only the workflow that emailed:
```bash
grep -rn 'open(.*data/\|makedirs' *.py
```

### 2. Transient upstream blip (recovers on its own)
Network timeout, upstream 5xx, an empty pre-season feed, a lost git-push race. Commit `a3485ee`
deliberately made these exit 0 and skip the day. If a log shows one of these AND the script exited
non-zero, the guard has a gap — widen the guard; do not add a retry that masks a real outage.
Genuine outages (401 bad key, 429 quota, Supabase 4xx) must still exit non-zero so a real break
emails once.

### 3. Missing/expired secret
Real ones exist (an Aug 25 run genuinely had no `CFBD_API_KEY`). Confirm from the log: a present
secret prints as `***`. Derek adds secrets himself in GitHub → Settings → Secrets and variables →
Actions. **Never ask for, echo, or handle a secret value.**

### 4. CI typecheck: `Cannot find name 'PageProps' / 'LayoutProps'`
Next 16 generates those globals into `.next/types`, which a clean checkout doesn't have, so `tsc`
alone fails while it passes locally (because `next dev` already wrote them). `ci.yml` runs
`npx next typegen` before `tsc`. Reproduce locally by deleting `.next/types` and running `tsc`.

## Verifying a fix without waiting for the cron
Reproduce the runner's condition rather than trusting the code read — for class 1 that means an empty
directory with no `data/`:

```bash
mkdir -p "$SCRATCH/repro" && cd "$SCRATCH/repro"   # no data/ dir, like a fresh checkout
```
then exercise just the failing path. The class-1 fix was confirmed this way: the same
`FileNotFoundError` before, a clean write after.

Then `workflow_dispatch` the job ("Run workflow") and check the conclusion rather than waiting for
tomorrow's schedule.

## Related
`visual-audit` covers browser/layout bugs — a different job. If a failure is a rendering problem
rather than a workflow one, use that skill instead.
