import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripeOrNull, billingConfigured, siteUrl } from "@/lib/billing";

// Self-serve billing: open Stripe's Billing Portal for the signed-in member.
//
// 🚨 THIS ROUTE IS THE CANCELLATION PROMISE. /terms section 4 says "You can cancel at any time
// from your account settings, by yourself, without contacting us", and several states' automatic-
// renewal laws require cancellation to be about as easy as signing up. The portal is what makes
// that sentence true: the member cancels, updates a card and reads past invoices without us
// building (or getting wrong) any of it, and the cancellation comes back as a webhook.
//
// The portal must be configured once in the Stripe dashboard with cancellation ENABLED. If it is
// not, Stripe answers with a configuration error and this returns 502 -- so test the button, do
// not assume it. A settings page with a dead Manage button is worse than no button, because the
// Terms promise it works.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const stripe = stripeOrNull();
  if (!stripe || !billingConfigured()) {
    return NextResponse.json({ ok: false, error: "billing not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });

  try {
    // Find the member's customer by the metadata stamped at checkout. Deliberately NOT by email:
    // an email can be changed or shared, and a customer lookup that can match the wrong person is
    // a route that shows one member another member's invoices.
    const found = await stripe.customers.search({
      query: `metadata['user_id']:'${user.id}'`, limit: 1,
    });
    const customer = found.data[0]?.id;
    if (!customer) {
      return NextResponse.json({ ok: false, error: "no subscription" }, { status: 404 });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${siteUrl()}/settings`,
    });
    return NextResponse.json({ ok: true, url: portal.url });
  } catch (e) {
    console.error("[billing/portal]", e);
    return NextResponse.json({ ok: false, error: "could not open billing portal" }, { status: 502 });
  }
}
