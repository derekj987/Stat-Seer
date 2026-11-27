import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeOrNull } from "@/lib/billing";

// Stripe -> subscriptions table. This is the ONLY writer.
//
// 🚨 THREE THINGS THAT MUST NOT BE "SIMPLIFIED":
//
// 1. THE RAW BODY. Signature verification hashes the exact bytes Stripe sent. `request.json()`
//    re-serialises and the signature then fails for reasons that look like a bad secret. Read
//    `request.text()` and hand that string to constructEvent.
//
// 2. THE SIGNATURE CHECK ITSELF. This endpoint is public — /api is outside the login gate (see
//    proxy.ts, "API routes self-gate"). Without verification anyone could POST a
//    `customer.subscription.created` and grant themselves a paid account forever. A missing
//    STRIPE_WEBHOOK_SECRET therefore REFUSES the request; it never falls back to trusting the
//    body.
//
// 3. IDEMPOTENCE. Stripe retries, and events can arrive out of order. Every handler upserts the
//    whole row keyed on user_id rather than mutating fields, so a replayed event is a no-op and a
//    late-arriving stale event cannot half-update a member into a state that never existed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pg(path: string, init: RequestInit): Promise<Response> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("supabase env");
  return fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

/** Period end moved from the Subscription to its items in Stripe's 2025 API versions. Read either,
 *  so pinning a different apiVersion later does not silently null the renewal date. */
function periodEnd(sub: Stripe.Subscription): string | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const secs = top ?? item?.current_period_end;
  return secs ? new Date(secs * 1000).toISOString() : null;
}

/** The account this subscription belongs to. Stamped at checkout onto both the session and the
 *  subscription; the customer is the last resort. Returns null rather than guessing — a row
 *  written against the wrong user_id is worse than a row not written. */
async function resolveUser(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  const fromSub = sub.metadata?.user_id;
  if (fromSub) return fromSub;
  const cid = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!cid) return null;
  try {
    const cust = await stripe.customers.retrieve(cid);
    if (!cust || cust.deleted) return null;
    return (cust.metadata?.user_id as string) ?? null;
  } catch { return null; }
}

async function upsert(stripe: Stripe, sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUser(stripe, sub);
  if (!userId) {
    console.error("[billing/webhook] subscription with no user_id", sub.id);
    return;
  }
  // Card brand + last4 only, for the settings card. Never the number — we never receive it.
  let brand: string | null = null, last4: string | null = null;
  const pm = sub.default_payment_method;
  if (pm && typeof pm !== "string" && pm.card) {
    brand = pm.card.brand ?? null; last4 = pm.card.last4 ?? null;
  }

  const row = {
    user_id: userId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: sub.items?.data?.[0]?.price?.id ?? null,
    current_period_end: periodEnd(sub),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    card_brand: brand,
    card_last4: last4,
    updated_at: new Date().toISOString(),
  };

  const res = await pg("subscriptions?on_conflict=user_id", {
    method: "POST",
    body: JSON.stringify([row]),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
  if (!res.ok) console.error("[billing/webhook] upsert failed", res.status, (await res.text()).slice(0, 200));
}

export async function POST(request: Request) {
  const stripe = stripeOrNull();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // Fail CLOSED. An unverifiable webhook is not a webhook.
  if (!stripe || !secret) {
    return NextResponse.json({ ok: false, error: "billing not configured" }, { status: 503 });
  }
  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ ok: false }, { status: 400 });

  const raw = await request.text();                       // RAW bytes — see note 1 above
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("[billing/webhook] bad signature", (e as Error).message);
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        if (!subId) break;
        // Re-retrieve rather than trusting the session's thin copy, and expand the payment method
        // so the settings card can show "Visa ending 4242".
        const sub = await stripe.subscriptions.retrieve(subId, { expand: ["default_payment_method"] });
        // The session carries user_id even when the subscription somehow does not.
        if (!sub.metadata?.user_id && (s.client_reference_id || s.metadata?.user_id)) {
          sub.metadata = { ...sub.metadata, user_id: (s.client_reference_id || s.metadata?.user_id)! };
        }
        await upsert(stripe, sub);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const thin = event.data.object as Stripe.Subscription;
        const sub = await stripe.subscriptions.retrieve(thin.id, { expand: ["default_payment_method"] })
          .catch(() => thin);   // a deleted subscription may not re-retrieve; the event copy is enough
        await upsert(stripe, sub);
        break;
      }
      default:
        break;   // everything else is acknowledged and ignored
    }
  } catch (e) {
    // 500 so Stripe RETRIES. Swallowing an error here would silently drop a cancellation or a
    // renewal and leave the table disagreeing with Stripe for good.
    console.error("[billing/webhook]", event.type, e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
