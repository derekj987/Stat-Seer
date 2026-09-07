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

---

# Applied-SQL ledger

Every `.sql` in this folder is hand-run in the Supabase SQL editor — there is no
migration tool, so **nothing but this table records what has actually been
applied.** A restored backup or a new Supabase project comes back without any of
it.

Status was **verified against the live database** on 2026-09-06 by checking for
the object each file creates (table, column, function, policy, bucket setting) —
not from memory. Re-verify the same way rather than trusting the column.

Every file is idempotent, so re-running one is safe if you are ever unsure.

## Core

| File | Creates / does | Applied |
|---|---|---|
| `schema.sql` | Ingestion + ledger schema; append-only triggers; `public_calibration` view | ✅ `prediction_ledger` exists |
| `creator.sql` | `site_visits` counter behind the /creator dashboard | ✅ table exists |
| `rate_limits.sql` | `api_rate_limits` — Postgres fixed-window limiter for the paid-LLM routes | ✅ table exists |

## Social layer

| File | Creates / does | Applied |
|---|---|---|
| `social.sql` | `friendships`, `direct_messages` | ✅ tables exist |
| `group_chat.sql` | `conversations`, `conversation_members`, `conversation_messages`, `is_conv_member()` | ✅ tables + fn exist |
| `follows.sql` | `follows` directed follow graph | ✅ table exists |
| `profile_upgrade.sql` | `profiles.cover_url`, `.last_seen`; `stories` | ✅ columns + table exist |
| `favorite_teams.sql` | `profiles.favorite_teams` | ✅ column exists |
| `pinned_post.sql` | `profiles.pinned_post_id` | ✅ column exists |
| `wall_media.sql` | `wall-media` public bucket; `wall_posts.media` | ✅ bucket + column exist |
| `wall_social.sql` | `wall_comments`, `wall_reactions` | ✅ tables exist |
| `wall_slip.sql` | `wall_posts.slip` | ✅ column exists |
| `feedback.sql` | `feedback` mailbox | ✅ table exists |
| `consents.sql` | `consents` audit trail (ToS/Privacy version + timestamp) | ✅ table exists |
| `owner_auto_friend.sql` | Every member auto-friended to the founder | ✅ run 2026-09 |
| `push_subscriptions.sql` | `push_subscriptions` — Web Push endpoints per device | ❌ **NOT RUN** — see below |

## Private beta / access control

| File | Creates / does | Applied |
|---|---|---|
| `beta_approval.sql` | `profiles.status`, `set_member_status()`; grandfathered testers to approved | ✅ column + fn exist |
| `beta_signup_fields.sql` | `profiles.first_name`, `.referral`; `handle_new_user()` | ✅ columns exist |
| `beta_notify.sql` | `profiles.request_notified` — one ops email per pending member | ✅ column exists |
| `beta_gate_rls.sql` | Restrictive **INSERT** gate on 14 member tables; `is_approved()` | ✅ 14 INSERT policies |
| `beta_gate_read.sql` | Restrictive **SELECT** gate on the same 14 + `profiles` (own-row exception) | ✅ 15 SELECT policies |
| `username_change.sql` | `profiles.username_changed_at`, `change_username()` — one rename | ✅ column + fn exist |
| `username_change_grant.sql` | Grants members read on their own `username_changed_at` | ✅ card renders live |
| `oauth_username.sql` | `claim_username()` — Google signups pick a name, keeping their one rename | ✅ fn exists |

## Security hardening

| File | Creates / does | Applied |
|---|---|---|
| `access_control_fixes.sql` | DM / friendship RLS (findings #2, #4, #5) | ✅ policies in place |
| `hardening.sql` | LOW/INFO ASVS items; tightens `authenticated` only | ✅ |
| `injection_hardening.sql` | Profile CHECKs; pinned `search_path`; bucket MIME allow-list | ✅ buckets restricted to raster types |
| `roster_privacy.sql` | Stops `anon` reading the member roster; `list_members()` etc. | ✅ fns exist |
| `roster_privacy_authed.sql` | Column allow-list on `profiles` for `authenticated`; `member_status()` | ✅ fn exists |
| `anon_lockdown.sql` | Revokes `anon` SELECT on forum, walls, `profiles` | ✅ anon reads return 401 |
| `storage_limits.sql` | 5 MB `file_size_limit` on both public buckets | ✅ both read 5242880 |

## Data capture

| File | Creates / does | Applied |
|---|---|---|
| `cfb_depth_snapshots.sql` | Weekly NCAAF depth-chart snapshots | ✅ 23,676 rows |
| `cfb_tailgate_buzz.sql` | CFB Fan Stock sentiment | ✅ 69 rows |

---

## ⚠️ `push_subscriptions.sql` has never been run

The table does not exist (`PGRST205`), but the app is fully wired for Web Push —
`lib/push.ts`, `app/api/push/send/route.ts`, `ChatWidget.tsx`, and the `web-push`
dependency are all shipped. So push notifications **fail silently in production**:
a member can opt in, and the subscription is written nowhere.

This is exactly the gap the ledger exists to catch — the code shipped, the SQL
did not, and nothing errored loudly enough to notice.

Decide before running it: push is only worth enabling if the notifications it
sends are wanted. If not, the honest fix is to remove the client-side opt-in
rather than leave a control that pretends to work.

---

## Keeping this honest

When you run a new `.sql`, add its row here in the same commit. When you need to
confirm the live state rather than trust this table, these are the checks:

```sql
-- tables + columns
select table_name, column_name from information_schema.columns
 where table_schema = 'public' order by table_name, ordinal_position;

-- functions
select proname, pg_get_function_arguments(oid) from pg_proc
 where pronamespace = 'public'::regnamespace order by proname;

-- policies (the beta gate should show 14 INSERT + 15 SELECT, all RESTRICTIVE)
select tablename, policyname, cmd, permissive from pg_policies
 where schemaname = 'public' order by tablename, cmd;

-- storage buckets
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
```

A note on verifying functions from outside Postgres: calling an RPC through
PostgREST with the **wrong parameter name** returns `PGRST202`, which reads
exactly like "function does not exist". Two functions were briefly recorded as
missing that way. Confirm the signature before believing an absence.
