-- Group chat: conversations (1:1 OR multi-member groups), members, and messages that carry
-- text, a GIF, and/or a bet slip. Run once in Supabase (SQL editor). Idempotent.
--
-- This supersedes the 1:1 direct_messages flow for the widget: a DM is just a 2-member,
-- non-group conversation, so groups and DMs are one system. RLS keeps you to conversations
-- you belong to; a SECURITY DEFINER membership check keeps the member policy from recursing.
-- You can only add your ACCEPTED friends to a conversation.

create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references profiles(id) on delete set null,
  title           text,                          -- optional group name
  is_group        boolean not null default false,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  added_at        timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on conversation_members (user_id);

create table if not exists conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  kind            text not null default 'text' check (kind in ('text','gif','slip')),
  body            text check (body is null or char_length(body) between 1 and 4000),
  gif_url         text,
  slip            jsonb,
  created_at      timestamptz not null default now(),
  constraint msg_has_content check (body is not null or gif_url is not null or slip is not null)
);
create index if not exists conv_msg_idx on conversation_messages (conversation_id, created_at);

-- Membership check as SECURITY DEFINER so RLS policies that reference conversation_members
-- don't recurse on it.
create or replace function is_conv_member(conv uuid, uid uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from conversation_members m where m.conversation_id = conv and m.user_id = uid);
$$;

alter table conversations         enable row level security;
alter table conversation_members  enable row level security;
alter table conversation_messages enable row level security;

-- conversations
drop policy if exists "see my conversations" on conversations;
-- created_by is included so the `insert ... returning` on create works: at that instant the
-- creator isn't a member yet (members are added the next step), so a membership-only policy
-- would hide the just-created row and the client would think the insert failed.
create policy "see my conversations" on conversations for select using (
  is_conv_member(id, auth.uid()) or created_by = auth.uid());
drop policy if exists "create conversation" on conversations;
create policy "create conversation" on conversations for insert to authenticated with check (auth.uid() = created_by);
drop policy if exists "update my conversation" on conversations;
create policy "update my conversation" on conversations for update using (is_conv_member(id, auth.uid()));

-- members: see the roster of your conversations; add yourself (bootstrapping a new
-- conversation) or add an ACCEPTED FRIEND to a conversation you're already in.
drop policy if exists "see conversation members" on conversation_members;
create policy "see conversation members" on conversation_members for select using (is_conv_member(conversation_id, auth.uid()));
drop policy if exists "add conversation member" on conversation_members;
create policy "add conversation member" on conversation_members for insert to authenticated with check (
  auth.uid() = user_id
  or (is_conv_member(conversation_id, auth.uid()) and exists (
      select 1 from friendships f where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = user_id)))));
drop policy if exists "update my membership" on conversation_members;
create policy "update my membership" on conversation_members for update using (auth.uid() = user_id);
drop policy if exists "leave conversation" on conversation_members;
create policy "leave conversation" on conversation_members for delete using (auth.uid() = user_id);

-- messages: members read; members send as themselves.
drop policy if exists "read conversation messages" on conversation_messages;
create policy "read conversation messages" on conversation_messages for select using (is_conv_member(conversation_id, auth.uid()));
drop policy if exists "send conversation message" on conversation_messages;
create policy "send conversation message" on conversation_messages for insert to authenticated with check (
  auth.uid() = sender_id and is_conv_member(conversation_id, auth.uid()));

grant select, insert, update, delete on conversations        to authenticated, service_role;
grant select, insert, update, delete on conversation_members to authenticated, service_role;
grant select, insert, update        on conversation_messages to authenticated, service_role;

-- Live delivery (safe to re-run if already published).
do $$ begin
  alter publication supabase_realtime add table conversation_messages;
exception when duplicate_object then null; end $$;
