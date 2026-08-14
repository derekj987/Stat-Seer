-- =====================================================================
-- Ingestion + ledger schema (Supabase / Postgres)
--
-- Design principles carried over from the analysis work:
--
--  1. APPEND-ONLY. Nothing is ever UPDATEd. Practice status on Thursday is a
--     separate row from Wednesday, not an update to it -- the TRAJECTORY is the
--     signal, so overwriting destroys the thing we are collecting.
--
--  2. RAW SEPARATE FROM DERIVED. Presser transcripts are stored verbatim and
--     extractions live in their own table with a prompt_version. When the
--     extraction prompt improves you re-run it over the archive. If you only
--     store extractions you can never improve them retroactively.
--
--  3. collected_at ON EVERYTHING. Point-in-time reconstruction is impossible
--     without it, and every backtest depends on point-in-time correctness.
--
--  4. THE LEDGER IS IMMUTABLE AT THE DATABASE LEVEL. UPDATE and DELETE are
--     revoked, not merely avoided in application code. If predictions can be
--     edited, the track record is worth nothing -- and the track record is the
--     entire product differentiator.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Player identity. Seed from nflverse players.csv.
-- ---------------------------------------------------------------------
create table if not exists players (
    gsis_id        text primary key,
    pfr_id         text,
    display_name   text not null,
    first_name     text,
    last_name      text,
    football_name  text,
    position       text,
    latest_team    text,
    status         text,
    updated_at     timestamptz not null default now()
);
create index if not exists players_name_idx on players (lower(display_name));
create index if not exists players_last_idx on players (lower(last_name));
create index if not exists players_pfr_idx  on players (pfr_id);

-- Unresolved scraped names land here for manual review rather than being
-- silently dropped. A name that never resolves is a hole in the panel.
create table if not exists player_alias_queue (
    id            bigserial primary key,
    scraped_name  text not null,
    team          text,
    position      text,
    source        text,
    first_seen    timestamptz not null default now(),
    resolved_gsis text references players(gsis_id),
    resolved_at   timestamptz,
    unique (scraped_name, team)
);

-- ---------------------------------------------------------------------
-- DAILY PRACTICE REPORTS  -- the thing that cannot be backfilled.
-- nflverse stores only the final weekly designation. The Wed/Thu/Fri
-- trajectory (DNP -> DNP -> Limited vs Limited -> Limited -> Full) is the
-- signal, and it exists only if captured on the day.
-- ---------------------------------------------------------------------
create table if not exists practice_reports (
    id              bigserial primary key,
    season          smallint    not null,
    week            smallint    not null,
    team            text        not null,
    gsis_id         text        references players(gsis_id),
    scraped_name    text        not null,
    report_date     date        not null,
    practice_day    text        not null
        check (practice_day in ('WED','THU','FRI','SAT','SUN','OTHER')),
    participation   text
        check (participation in ('DNP','LIMITED','FULL','NOT_LISTED')),
    injury_primary  text,
    injury_secondary text,
    game_status     text
        check (game_status in ('OUT','DOUBTFUL','QUESTIONABLE','NONE')),
    source_url      text,
    source_hash     text,
    collected_at    timestamptz not null default now(),
    unique (season, week, team, scraped_name, practice_day)
);
create index if not exists practice_lookup_idx
    on practice_reports (season, week, team);
create index if not exists practice_player_idx
    on practice_reports (gsis_id, season, week);

-- Derived trajectory view. Rebuilt from raw rows, never stored as truth.
create or replace view practice_trajectory as
select
    season, week, team, gsis_id,
    max(scraped_name) as player_name,
    max(participation) filter (where practice_day = 'WED') as wed,
    max(participation) filter (where practice_day = 'THU') as thu,
    max(participation) filter (where practice_day = 'FRI') as fri,
    max(game_status)   filter (where practice_day = 'FRI') as final_status,
    concat_ws('-',
        max(participation) filter (where practice_day = 'WED'),
        max(participation) filter (where practice_day = 'THU'),
        max(participation) filter (where practice_day = 'FRI')
    ) as trajectory,
    count(*) as days_observed,
    min(collected_at) as first_collected
from practice_reports
group by season, week, team, gsis_id;

-- ---------------------------------------------------------------------
-- PRESSERS. Raw transcripts, stored verbatim.
-- ---------------------------------------------------------------------
create table if not exists pressers (
    id            bigserial primary key,
    season        smallint    not null,
    week          smallint,
    team          text        not null,
    speaker_name  text        not null,
    speaker_role  text        not null
        check (speaker_role in ('HC','OC','DC','ST','QB','PLAYER','GM','OTHER')),
    presser_date  date        not null,
    source_url    text        not null,
    source_type   text        check (source_type in ('TRANSCRIPT','ASR','ARTICLE')),
    transcript    text,
    duration_sec  integer,
    content_hash  text        not null,
    collected_at  timestamptz not null default now(),
    unique (content_hash)
);
create index if not exists pressers_lookup_idx on pressers (season, week, team);
create index if not exists pressers_speaker_idx on pressers (team, speaker_role);

-- Extracted usage statements. Versioned so the archive can be re-processed.
create table if not exists presser_extractions (
    id               bigserial primary key,
    presser_id       bigint      not null references pressers(id),
    prompt_version   text        not null,
    model            text        not null,
    gsis_id          text        references players(gsis_id),
    subject_name     text,
    statement_type   text        not null
        check (statement_type in
               ('WORKLOAD_EXPLICIT','ROLE_DEPTH','AVAILABILITY_HEDGE',
                'EVALUATIVE_PRAISE','SCHEME','OTHER')),
    direction        smallint    check (direction in (-1, 0, 1)),
    confidence       numeric(3,2) check (confidence between 0 and 1),
    quote            text,
    extracted_at     timestamptz not null default now(),
    unique (presser_id, prompt_version, subject_name, statement_type, quote)
);
create index if not exists extraction_player_idx
    on presser_extractions (gsis_id, extracted_at);

-- Per-coach credibility: did stated usage actually happen? Populated by a job
-- that joins WORKLOAD_EXPLICIT / ROLE_DEPTH statements to next-week snap share.
create table if not exists coach_credibility (
    id                bigserial primary key,
    team              text     not null,
    speaker_name      text     not null,
    speaker_role      text     not null,
    season            smallint not null,
    statements_n      integer  not null,
    followed_through_n integer not null,
    mean_share_delta  numeric(5,3),
    computed_at       timestamptz not null default now(),
    unique (team, speaker_name, season, computed_at)
);

-- ---------------------------------------------------------------------
-- ODDS SNAPSHOTS. Append-only. Partitioning is unnecessary at the chosen
-- cadence (~1.5M rows/season) -- revisit only if props expand a lot.
-- ---------------------------------------------------------------------
create table if not exists odds_snapshots (
    id            bigserial primary key,
    snapshot_at   timestamptz not null,
    capture_reason text       not null
        check (capture_reason in ('SCHEDULED','PRE_KICKOFF','BACKFILL','MANUAL')),
    season        smallint    not null,
    week          smallint    not null,
    event_id      text        not null,
    commence_time timestamptz not null,
    home_team     text        not null,
    away_team     text        not null,
    book          text        not null,
    market        text        not null,
    outcome_name  text        not null,
    outcome_point numeric(6,2),
    price_american integer,
    gsis_id       text        references players(gsis_id),
    collected_at  timestamptz not null default now()
);
create index if not exists odds_event_idx  on odds_snapshots (event_id, market, book);
create index if not exists odds_time_idx   on odds_snapshots (snapshot_at);
create index if not exists odds_week_idx   on odds_snapshots (season, week);
-- Idempotency: a re-run of the same capture must not double-insert. `nulls not
-- distinct` (PG15+) is required so h2h rows, where outcome_point is NULL, still
-- dedupe. Pairs with the ingester's Prefer: resolution=ignore-duplicates.
create unique index if not exists odds_snapshots_dedupe on odds_snapshots
    (snapshot_at, event_id, book, market, outcome_name, outcome_point) nulls not distinct;

-- The closing line: last PRE_KICKOFF snapshot before commence_time.
create or replace view closing_lines as
select distinct on (event_id, book, market, outcome_name, outcome_point)
    event_id, season, week, home_team, away_team, book, market,
    outcome_name, outcome_point, price_american, snapshot_at
from odds_snapshots
where snapshot_at < commence_time
order by event_id, book, market, outcome_name, outcome_point, snapshot_at desc;

-- ---------------------------------------------------------------------
-- CALIBRATION LEDGER. The most important table in the application.
-- ---------------------------------------------------------------------
create table if not exists prediction_ledger (
    id              uuid primary key default gen_random_uuid(),
    published_at    timestamptz not null default now(),
    commence_time   timestamptz not null,
    season          smallint    not null,
    week            smallint    not null,
    event_id        text        not null,
    section         text        not null check (section in ('BOARD','MODEL')),
    model_version   text        not null,
    market          text        not null,
    subject         text        not null,
    line_at_publish numeric(6,2),
    price_at_publish integer,
    model_prob      numeric(5,4) not null check (model_prob between 0 and 1),
    model_se        numeric(5,4),
    tier            text        not null
        check (tier in ('BEST','GOOD','MODERATE','BAD','NO_BET')),
    reasoning       jsonb,
    -- graded later, in a SEPARATE table. Never written back here.
    constraint published_before_kickoff check (published_at < commence_time)
);
create index if not exists ledger_event_idx on prediction_ledger (event_id);
create index if not exists ledger_week_idx  on prediction_ledger (season, week);

create table if not exists prediction_results (
    prediction_id uuid primary key references prediction_ledger(id),
    outcome       text    not null check (outcome in ('WIN','LOSS','PUSH','VOID')),
    closing_line  numeric(6,2),
    closing_price integer,
    clv_points    numeric(6,2),
    graded_at     timestamptz not null default now()
);

-- =====================================================================
-- IMMUTABILITY. Enforced in the database, not in application code.
-- =====================================================================
revoke update, delete on prediction_ledger  from public, anon, authenticated;
revoke update, delete on practice_reports   from public, anon, authenticated;
revoke update, delete on pressers           from public, anon, authenticated;
revoke update, delete on odds_snapshots     from public, anon, authenticated;

create or replace function block_mutation() returns trigger as $$
begin
    raise exception 'append-only table: % on % is not permitted',
        tg_op, tg_table_name;
end;
$$ language plpgsql;

drop trigger if exists no_update_ledger on prediction_ledger;
create trigger no_update_ledger before update or delete on prediction_ledger
    for each row execute function block_mutation();

drop trigger if exists no_update_practice on practice_reports;
create trigger no_update_practice before update or delete on practice_reports
    for each row execute function block_mutation();

drop trigger if exists no_update_pressers on pressers;
create trigger no_update_pressers before update or delete on pressers
    for each row execute function block_mutation();

drop trigger if exists no_update_odds on odds_snapshots;
create trigger no_update_odds before update or delete on odds_snapshots
    for each row execute function block_mutation();

-- =====================================================================
-- BACKEND WRITER PRIVILEGES. The append-only revokes above never granted
-- service_role its write privilege, so the ingest pipeline (which connects
-- as service_role via the secret key) cannot insert. Grant it here.
-- INSERT/SELECT everywhere it writes; UPDATE/DELETE only on the mutable
-- tables. The four append-only tables get INSERT/SELECT ONLY — immutability
-- stays enforced by both the absent grant and the block_mutation() trigger.
-- =====================================================================
grant select, insert on
    players, player_alias_queue, practice_reports, pressers,
    presser_extractions, coach_credibility, odds_snapshots,
    prediction_ledger, prediction_results
    to service_role;
grant update, delete on players, player_alias_queue, coach_credibility to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Read-only public calibration report. This is the trust artefact.
create or replace view public_calibration as
select
    l.season,
    l.section,
    width_bucket(l.model_prob, 0.30, 0.80, 10) as prob_bucket,
    round(avg(l.model_prob)::numeric, 4)       as mean_predicted,
    count(*)                                   as n,
    round(avg(case when r.outcome = 'WIN' then 1.0
                   when r.outcome = 'LOSS' then 0.0 end)::numeric, 4) as actual_rate,
    round(avg(r.clv_points)::numeric, 3)       as mean_clv
from prediction_ledger l
join prediction_results r on r.prediction_id = l.id
where r.outcome in ('WIN','LOSS')
group by l.season, l.section, prob_bucket
order by l.season, l.section, prob_bucket;

-- =====================================================================
-- PLAYER PROPS. Player-centric, so a separate table from odds_snapshots.
-- player_name is always stored (as the book posts it); gsis_id is resolved
-- later and may stay null. Append-only, like the other capture tables.
-- =====================================================================
create table if not exists prop_snapshots (
    id             bigserial primary key,
    snapshot_at    timestamptz not null,
    capture_reason text        not null
        check (capture_reason in ('SCHEDULED','PRE_KICKOFF','BACKFILL','MANUAL')),
    season         smallint    not null,
    week           smallint    not null,
    event_id       text        not null,
    commence_time  timestamptz not null,
    home_team      text        not null,
    away_team      text        not null,
    book           text        not null,
    market         text        not null,   -- e.g. player_pass_yds, player_anytime_td
    player_name    text        not null,   -- as posted by the book (outcome.description)
    gsis_id        text        references players(gsis_id),  -- resolved later; nullable
    side           text        not null,   -- Over / Under / Yes / No
    line           numeric(7,2),           -- prop line; null for yes/no markets
    price_american integer,
    collected_at   timestamptz not null default now()
);
create index if not exists prop_event_idx  on prop_snapshots (event_id, market, book);
create index if not exists prop_time_idx   on prop_snapshots (snapshot_at);
create index if not exists prop_week_idx    on prop_snapshots (season, week);
create index if not exists prop_player_idx on prop_snapshots (player_name);
create unique index if not exists prop_snapshots_dedupe on prop_snapshots
    (snapshot_at, event_id, book, market, player_name, side, line) nulls not distinct;

revoke update, delete on prop_snapshots from public, anon, authenticated;
drop trigger if exists no_update_props on prop_snapshots;
create trigger no_update_props before update or delete on prop_snapshots
    for each row execute function block_mutation();
grant select, insert on prop_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

-- =====================================================================
-- MEMBERS. A public profile per auth user (username shown in the forum).
-- auth.users lives in the auth schema; we mirror the public bit here with
-- RLS. A trigger creates the profile from the signup metadata (username).
-- =====================================================================
create table if not exists profiles (
    id         uuid primary key references auth.users(id) on delete cascade,
    username   text unique not null,
    created_at timestamptz not null default now()
);
alter table profiles enable row level security;

drop policy if exists "profiles readable by all" on profiles;
create policy "profiles readable by all" on profiles for select using (true);

drop policy if exists "user updates own profile" on profiles;
create policy "user updates own profile" on profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

-- On signup, create the profile row (username from raw_user_meta_data).
create or replace function public.handle_new_user() returns trigger as $$
begin
    insert into public.profiles (id, username)
    values (
        new.id,
        coalesce(nullif(new.raw_user_meta_data->>'username', ''),
                 'member_' || substr(new.id::text, 1, 8))
    )
    on conflict (id) do nothing;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();
