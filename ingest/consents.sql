-- Consent audit trail. Records that a member agreed to the Terms of Service + Privacy
-- Policy (and attested 18+) at signup: which version, when they checked the box, and the
-- user agent. Immutable, one row per consent event. Run once in Supabase. Idempotent.
--
-- The signup form passes the consent details in the auth signUp metadata
-- (raw_user_meta_data: legal_version, consent_at, user_agent); the same trigger that
-- creates the profile writes the consent row, so it's captured atomically with the account.

create table if not exists consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  legal_version text not null,                 -- version of Terms/Privacy agreed to
  agreed_at     timestamptz,                   -- client-reported moment the box was checked
  user_agent    text,
  recorded_at   timestamptz not null default now()
);
create index if not exists consents_user_idx on consents (user_id);
create index if not exists consents_version_idx on consents (legal_version);

alter table consents enable row level security;
-- A member can read their own consent history and INSERT their own consent (needed for the
-- re-accept prompt when the docs change); nobody edits/deletes it (append-only audit).
drop policy if exists "see own consent" on consents;
create policy "see own consent" on consents for select using (auth.uid() = user_id);
drop policy if exists "record own consent" on consents;
create policy "record own consent" on consents for insert to authenticated with check (auth.uid() = user_id);
revoke update, delete on consents from public, anon, authenticated;
drop trigger if exists no_update_consents on consents;
create trigger no_update_consents before update or delete on consents
  for each row execute function block_mutation();   -- block_mutation() defined in schema.sql
grant select, insert on consents to authenticated;
grant select, insert on consents to service_role;

-- Extend the signup trigger to also record consent from the signup metadata. This REPLACES
-- the function body from schema.sql (keeping the profile creation identical) and adds the
-- consent insert. The on_auth_user_created trigger already points at this function.
create or replace function public.handle_new_user() returns trigger as $$
declare
    is_first boolean;
begin
    select count(*) = 0 into is_first from public.profiles;
    insert into public.profiles (id, username, role, title)
    values (
        new.id,
        coalesce(nullif(new.raw_user_meta_data->>'username', ''),
                 'member_' || substr(new.id::text, 1, 8)),
        case when is_first then 'founder'     else 'member' end,
        case when is_first then 'The Creator' else null      end
    )
    on conflict (id) do nothing;

    -- Record consent when the signup metadata carries it (the form always does).
    if new.raw_user_meta_data->>'legal_version' is not null then
        insert into public.consents (user_id, legal_version, agreed_at, user_agent)
        values (
            new.id,
            new.raw_user_meta_data->>'legal_version',
            nullif(new.raw_user_meta_data->>'consent_at', '')::timestamptz,
            new.raw_user_meta_data->>'user_agent'
        );
    end if;

    return new;
end;
$$ language plpgsql security definer;
