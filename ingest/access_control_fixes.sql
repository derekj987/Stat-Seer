-- Access-control hardening — DM / friendship RLS (ASVS L1 · V4 Access Control)
-- Run in the Supabase SQL editor. Idempotent (safe to re-run). Fixes findings #2, #4, #5 from the
-- access-control review. All changes are policy/grant tightening on the browser `authenticated`
-- role only; `service_role` (the server's service key) is left untouched.
--
-- Verified against the app's actual flows (web/app/ChatWidget.tsx):
--   * startWith / createGroup / addToGroup always: create conversation (created_by=me) -> add SELF
--     -> add friends. The tightened self-add still permits that exact order.
--   * markRead updates only conversation_members.last_read_at.
--   * acceptReq is performed by the ADDRESSEE, setting friendships.status='accepted'.
-- So these tighter policies close the exploits without breaking any real flow.

begin;  -- DDL is transactional in Postgres: apply all of it or none of it.

-- ─────────────────────────────────────────────────────────────────────────────
-- #2 (HIGH) — Any member could read anyone's private DMs.
-- Two vectors, both closed here:
--   (a) INSERT: the old "add conversation member" allowed `auth.uid() = user_id` for ANY
--       conversation_id (no created_by check) — insert yourself into someone else's thread, then
--       read it. Now self-add requires that YOU created that conversation.
--   (b) UPDATE: conversation_members had a full-row UPDATE grant, so a member could repoint their
--       own membership row's conversation_id to a target thread and become a member that way.
--       Now the browser may update only last_read_at.
drop policy if exists "add conversation member" on conversation_members;
create policy "add conversation member" on conversation_members for insert to authenticated with check (
  -- add YOURSELF only to a conversation you created (bootstrapping a brand-new thread) ...
  (auth.uid() = user_id and exists (
     select 1 from conversations c where c.id = conversation_id and c.created_by = auth.uid()))
  -- ... or add an ACCEPTED FRIEND to a conversation you are already a member of.
  or (is_conv_member(conversation_id, auth.uid()) and exists (
      select 1 from friendships f where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = user_id)))));

revoke update on conversation_members from authenticated;
grant  update (last_read_at) on conversation_members to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #4 (MEDIUM) — Friend-request consent bypass: a requester could self-accept their own outgoing
-- request (the old policy allowed requester_id and had no WITH CHECK), then DM the target. Restrict
-- acceptance to the ADDRESSEE, and column-scope the grant so only `status` can be changed.
drop policy if exists "accept friend request" on friendships;
create policy "accept friend request" on friendships for update
  using      (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

revoke update on friendships from authenticated;
grant  update (status) on friendships to authenticated;
-- (Either party can still cancel/unfriend via the existing "remove friendship" DELETE policy.)

-- ─────────────────────────────────────────────────────────────────────────────
-- #5 (MEDIUM) — A DM recipient could rewrite the sender's message: the "mark dm read" UPDATE policy
-- was meant only to stamp read_at, but the grant was full-row, so the recipient could change body/
-- slip. Column-scope the grant to read_at and add a matching WITH CHECK.
drop policy if exists "mark dm read" on direct_messages;
create policy "mark dm read" on direct_messages for update
  using      (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

revoke update on direct_messages from authenticated;
grant  update (read_at) on direct_messages to authenticated;

commit;
