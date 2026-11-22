-- Parlay of the Week: the published ticket, and its grade.
--
-- WHY THIS EXISTS. The card's own tooltip tells the reader "Every ticket is published before
-- kickoff and graded at /report". Nothing backed that. The tickets were computed at RENDER time
-- from live odds, so the "published" ticket silently changed as prices moved and no record of any
-- version survived; the record line read "first graded ticket pending" permanently, because no
-- code ever passed a record. A trust claim with no mechanism behind it is the one thing this
-- product is built not to be.
--
-- The shape deliberately mirrors prediction_ledger, which already solved this for game
-- predictions, down to the three properties that make a record auditable:
--
--   1. APPEND-ONLY. update and delete are revoked below. A published ticket is a fact about what
--      was said before kickoff; it is never tidied up afterwards.
--   2. PUBLISHED BEFORE KICKOFF, enforced by the database rather than by the caller. A row whose
--      published_at is not strictly before the first leg's kickoff cannot exist, so a ticket can
--      never be back-dated into a week whose results are already known.
--   3. GRADED IN A SEPARATE TABLE. parlay_results references the ledger row and is never written
--      back into it, so grading cannot rewrite the claim it is grading.
--
-- One difference from prediction_ledger, and it is the point of the whole exercise: the unique
-- index makes the ticket WRITE-ONCE per (sport, season, week, ticket). prediction_ledger wants
-- revisions — a model number must be free to move while the facts move. A parlay must not: the
-- reader is being shown a specific ticket at a specific price, and "we'd have picked different
-- legs by Sunday" is exactly the hindsight the record exists to rule out. The publisher inserts
-- with on_conflict=do nothing, so re-running it is a no-op rather than a correction.

create table if not exists parlay_ledger (
    id              uuid primary key default gen_random_uuid(),
    published_at    timestamptz not null default now(),
    -- The earliest kickoff among the legs. The CHECK below hangs off this.
    first_commence  timestamptz not null,
    sport           text        not null check (sport in ('NFL','NCAAF')),
    season          smallint    not null,
    week            smallint    not null,
    -- Which ticket: 'Game lines', 'Player touchdowns', 'Player props'. Free text rather than an
    -- enum because the set of tickets is a product decision that will change, and a migration to
    -- add one would be friction with no safety bought.
    ticket          text        not null,
    american        text        not null,
    decimal_odds    numeric(12,4) not null check (decimal_odds > 1),
    our_prob        numeric(6,5)  not null check (our_prob between 0 and 1),
    market_prob     numeric(6,5)  check (market_prob between 0 and 1),
    break_even      numeric(6,5)  not null check (break_even between 0 and 1),
    -- Every leg, with the structured fields the grader needs: market key, player/team, side and
    -- line. The DISPLAY string is stored too, so the record can be shown exactly as published
    -- rather than re-derived from fields that may since have changed meaning.
    legs            jsonb       not null,
    constraint parlay_published_before_kickoff check (published_at < first_commence)
);
create unique index if not exists parlay_once_per_week
    on parlay_ledger (sport, season, week, ticket);
create index if not exists parlay_week_idx on parlay_ledger (sport, season, week);

create table if not exists parlay_results (
    parlay_id    uuid primary key references parlay_ledger(id),
    -- A parlay is all-or-nothing, so there is no PUSH at ticket level: a pushed leg drops out and
    -- the rest still have to land. VOID is for a ticket that cannot be graded at all (a game
    -- cancelled, a player who never took the field on a market with no settlement rule we model).
    outcome      text    not null check (outcome in ('WIN','LOSS','VOID')),
    legs_won     smallint not null,
    legs_total   smallint not null,
    -- Per-leg detail: what the actual was, so a reader can check the grade rather than trust it.
    leg_outcomes jsonb   not null,
    graded_at    timestamptz not null default now()
);

-- IMMUTABILITY, enforced in the database and not in application code — same as the rest of
-- ingest/schema.sql's published artifacts.
revoke update, delete on parlay_ledger  from public, anon, authenticated;
revoke update, delete on parlay_results from public, anon, authenticated;

-- 🚨 AND THEN GRANT, WHICH THE FIRST VERSION OF THIS FILE FORGOT. A new table in this project
-- arrives with no privileges for service_role — every other ingest/*.sql grants them explicitly
-- (cfb_odds_snapshots, consents, follows, ...) — so revoking without granting produced two tables
-- nothing could read or write. It did not look like a missing grant either: PostgREST answers
-- with 403 and code 42501, which reads like the key being wrong rather than the table being
-- unprivileged. The tell is that 42501 means the table EXISTS; a missing table is PGRST205.
--
-- SELECT and INSERT only. UPDATE and DELETE are deliberately withheld from service_role too, so
-- the append-only promise holds against the application's own key and not merely against anon:
-- the publisher inserts, the grader inserts, and nothing in this codebase can rewrite a published
-- ticket even by mistake.
grant select, insert on parlay_ledger  to service_role;
grant select, insert on parlay_results to service_role;
