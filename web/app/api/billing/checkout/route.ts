import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripeOrNull, billingConfigured, siteUrl, PRICE_MONTHLY, PRICE_ANNUAL } from "@/lib/billing";

// Start a subscription: create a Stripe Checkout Session for the signed-in member and hand back
// its URL for the browser to follow.
//
// 🚨 THE PRICE IS CHOSEN HERE, SERVER-SIDE, FROM AN ALLOW-LIST. The client sends a PLAN NAME
// ("monthly" | "annual"), never a price id and never an amount. If the body could name a Stripe
// price, anyone could post the id of a 1-cent price from any Stripe account we have ever used and
// buy a full subscription for a penny; if it could name an amount, worse. The only thing the
// client gets to do is pick between the two plans we sell.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = stripeOrNull();
  if (!stripe || !billingConfigured()) {
    return NextResponse.json({ ok: false, error: "billing not configured" }, { status: 503 });
  }

  // Must be signed in: the subscription is attached to a user id, and an anonymous checkout would
  // produce a payment we cannot map back to an account.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user.email) {
    return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const plan = body?.plan === "annual" ? "annual" : "monthly";
  const price = plan === "annual" ? PRICE_ANNUAL : PRICE_MONTHLY;
  if (!price) {
    return NextResponse.json({ ok: false, error: `no ${plan} plan` }, { status: 400 });
  }

  try {
    // Reuse the member's Stripe customer if they have one, so a resubscribe does not create a
    // second customer and split their billing history in two.
    const existing = await stripe.customers.search({
      query: `metadata['user_id']:'${user.id}'`, limit: 1,
    }).catch(() => null);
    const customer = existing?.data?.[0]?.id;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      ...(customer ? { customer } : { customer_email: user.email }),
      // user_id travels on BOTH the session and the subscription, because the webhook sees
      // subscription events that do not reference the checkout session at all (a renewal months
      // later, a cancellation from the portal). Without it on the subscription, those events
      // arrive with no way home to an account.
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${siteUrl()}/settings?subscribed=1`,
      cancel_url: `${siteUrl()}/pricing?cancelled=1`,
      allow_promotion_codes: true,
      // Stripe collects and stores the card; we never see the number (see /privacy).
      billing_address_collection: "auto",
    });

    if (!session.url) {
      return NextResponse.json({ ok: false, error: "no checkout url" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    // Never echo the Stripe error verbatim to the browser: it can carry account and key context.
    console.error("[billing/checkout]", e);
    return NextResponse.json({ ok: false, error: "could not start checkout" }, { status: 502 });
  }
}
