import Stripe from "stripe";

// Stripe wiring, server-only. Nothing here is imported by a client component.
//
// 🚨 EVERY FUNCTION FAILS CLOSED WHEN STRIPE IS NOT CONFIGURED. The secret key, the webhook
// secret and the price ids are environment variables that only Derek can set, so for the whole
// window between this merging and those being added, the site must behave as though billing does
// not exist -- NOT as though everyone has paid, and NOT with a stack trace on a public page.
// `stripeOrNull()` returns null rather than throwing, and the one place that decides access
// (`proxy.ts`) treats "billing not configured" as "do not gate", so shipping this before the keys
// exist cannot lock out the entire membership. That is the same fail-open posture the private
// beta gate already takes, and for the same reason.

/** The product's price ids. Monthly is required; annual is optional and simply not offered when
 *  it is unset, so a one-plan launch needs no code change. */
export const PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY ?? "";
export const PRICE_ANNUAL = process.env.STRIPE_PRICE_ANNUAL ?? "";

/** Is billing switched on at all? Used by the gate and by the pricing page. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && PRICE_MONTHLY);
}

let cached: Stripe | null = null;

/** The Stripe client, or null when the key is absent. Never throws. */
export function stripeOrNull(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      // Pinned deliberately. Stripe's API is versioned per account, and letting the SDK default
      // means a dashboard change can alter the shape of a webhook payload this code parses.
      // Must match the version the installed SDK is typed against (stripe 19.1.0 →
      // 2025-09-30.clover). Bumping this without bumping the SDK is a type error, which is the
      // behaviour you want: the payload shapes this code parses are tied to the version.
      apiVersion: "2025-09-30.clover",
      appInfo: { name: "StatSeer", url: "https://statseeredge.com" },
      maxNetworkRetries: 2,
    });
  }
  return cached;
}

/** Where Stripe sends the member back to. Falls back to the production host so a misconfigured
 *  preview cannot send somebody to `undefined/settings`. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
    || "https://statseeredge.com";
  return raw.replace(/\/$/, "");
}

export interface SubRow {
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  card_brand: string | null;
  card_last4: string | null;
}

/** Statuses that grant access. Mirrors is_subscribed() in ingest/subscriptions.sql — the database
 *  is the authority; this exists for rendering copy, never for deciding the gate. */
export const ACTIVE_STATUSES = ["trialing", "active", "past_due"];

export const isActive = (s: string | null | undefined): boolean =>
  !!s && ACTIVE_STATUSES.includes(s);

/** Read one member's subscription with the service key. Returns null when billing is unconfigured,
 *  the table has not been migrated, or the member has never subscribed — all three are "no paid
 *  access", and none of them is an error worth surfacing on a page. */
export async function memberSubscription(userId: string): Promise<SubRow | null> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}` +
      "&select=status,price_id,current_period_end,cancel_at_period_end,card_brand,card_last4",
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as SubRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
