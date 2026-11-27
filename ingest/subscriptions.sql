-- Paid subscriptions. One row per member, mirrored from Stripe by the webhook.
--
-- STRIPE IS THE SOURCE OF TRUTH, NOT THIS TABLE. Everything here is a cache of what Stripe
-- already knows, written only by the webhook under the service key, so that the request path can
-- answer "is this member paid up" with one indexed read instead of a network call to Stripe on
-- every page view. If this table and Stripe ever disagree, Stripe is right and the fix is to
-- replay the webhook, never to hand-edit a row.
--
-- WHY A DEFINER FUNCTION AND NOT A DIRECT READ: `is_approved(uid)` already exists for the private
-- beta and proxy.ts calls it, because profiles.status stopped being client-readable once
-- roster_privacy_authed.sql landed. The subscription gate needs exactly the same shape, so it gets
-- exactly the same mechanism rather than a second pattern.

create table if not exists subscriptions (
    user_id                uuid primary key references auth.users(id) on delete cascade,
    stripe_customer_id     text not null,
    stripe_subscription_id text,
    -- Stripe's own status string, stored verbatim: trialing | active | past_due | canceled |
    -- incomplete | incomplete_expired | unpaid | paused. Deliberately NOT narrowed to a boolean:
    -- "past_due" is a member who should keep access while their card is retried, and collapsing
    -- that to false would lock out someone who has paid every month for a year over one expired
    -- card. The decision of which statuses grant access lives in is_subscribed() below, in one
    -- place, where it can be read.
    status                 text not null,
    price_id               text,
    -- What the member is actually paying, so billing history can be shown without calling Stripe.
    current_period_end     timestamptz,
    cancel_at_period_end   boolean not null default false,
    -- Card brand + last four ONLY. Never the full number, which we never receive (see /privacy).
    card_brand             text,
    card_last4             text,
    updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);
create index if not exists subscriptions_status_idx   on subscriptions (status);

alter table subscriptions enable row level security;
-- A member may read their OWN subscription (settings shows plan, renewal date, card last4).
-- Nobody writes through the client: every write is the webhook, under the service key.
drop policy if exists "see own subscription" on subscriptions;
create policy "see own subscription" on subscriptions for select using (auth.uid() = user_id);
revoke insert, update, delete on subscriptions from public, anon, authenticated;
grant select on subscriptions to authenticated;
grant select, insert, update on subscriptions to service_role;

-- Does this member have paid access right now?
--
-- SECURITY DEFINER so the gate can ask without the member being able to read other rows, and so
-- the access RULE is defined once, in the database, rather than re-implemented in middleware, in
-- a page and in an API route -- three copies that would drift.
--
-- 'trialing' and 'active' are obviously in. 'past_due' is in ON PURPOSE: Stripe keeps a
-- subscription past_due while it retries a failed card, and the Terms promise we give you "a
-- chance to fix it" before ending access. It becomes 'canceled' or 'unpaid' when Stripe gives up,
-- and those are out.
create or replace function public.is_subscribed(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.subscriptions s
        where s.user_id = uid
          and s.status in ('trialing', 'active', 'past_due')
    );
$$;
revoke all on function public.is_subscribed(uuid) from public;
grant execute on function public.is_subscribed(uuid) to authenticated, service_role;
