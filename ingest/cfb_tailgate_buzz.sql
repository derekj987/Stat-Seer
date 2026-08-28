-- CFB Local Intelligence ("Fan Stock") — the college analog of tailgate_buzz, written by
-- cfb_tailgate_reddit.py (r/CFB + team boards -> Claude -> here). Sentiment, NOT a pick and
-- NOT model output; never graded, never feeds The Model. Read by web/lib/cfbTailgate.ts.
-- Run once in Supabase (SQL editor). Idempotent.
create table if not exists cfb_tailgate_buzz (
    season      smallint    not null,
    week        smallint    not null,
    id          text        not null,   -- w{week}-{team}-{player-slug}
    player      text        not null,
    team        text        not null,   -- CFBD school name, e.g. "USC", "TCU"
    matchup     text,                   -- optional, e.g. "SJSU @ USC"
    angle       text        not null,   -- the prop fans tie them to (OVER when up, UNDER when down)
    direction   text        not null default 'up' check (direction in ('up','down')),
    heat        smallint    not null check (heat between 1 and 3),
    take        text        not null,   -- what the boards are saying + why
    sources     jsonb       not null default '[]',  -- [{board, url}]
    captured_at timestamptz not null default now(),
    primary key (season, week, id)
);

alter table cfb_tailgate_buzz enable row level security;

drop policy if exists "cfb tailgate readable by all" on cfb_tailgate_buzz;
create policy "cfb tailgate readable by all" on cfb_tailgate_buzz for select using (true);

grant select on cfb_tailgate_buzz to anon, authenticated;
grant select, insert, update, delete on cfb_tailgate_buzz to service_role;
