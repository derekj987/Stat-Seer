// Next 16 renamed `middleware` -> `proxy`. Refreshes the Supabase auth session cookie on
// each request AND gates the site: only the homepage + auth/legal pages are public. Every
// other page (the model, value finder, forum, profiles, settings, …) requires a logged-in
// member, so visitors can't see member info (usernames, profiles, the community).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Paths a signed-out visitor may reach. Everything else redirects to /login.
const PUBLIC_PREFIXES = [
  "/login", "/signup", "/auth", "/reset",      // authentication flow
  "/terms", "/privacy",                          // legal (must be reachable pre-signup)
  "/api",                                        // API routes self-gate (JSON, not HTML)
  "/_next", "/icon", "/apple-icon", "/opengraph-image", "/twitter-image",
  "/manifest", "/robots", "/sw.js", "/favicon",  // assets + metadata
];
function isPublicPath(path: string): boolean {
  // QA preview: on the LOCAL dev server only (NODE_ENV==="development"; never on Vercel, where
  // NODE_ENV==="production") the whole app is reachable signed-out so member pages can be
  // rendered + audited without a real session. Pairs with the auth mock in lib/supabase/client.ts.
  if (process.env.NODE_ENV === "development" && process.env.VERCEL_ENV !== "production") return true;
  return path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}
// A signed-in but not-yet-approved member may reach only these (plus the public paths):
// the waiting-room page itself, the pick-your-username step a Google sign-up lands on
// (they arrive there straight from /auth/callback, before approval), and the auth flow so
// they can sign out.
function isPendingAllowed(path: string): boolean {
  return isPublicPath(path)
    || path === "/pending" || path.startsWith("/pending")
    || path === "/welcome";
}

// What an approved member may reach WITHOUT an active subscription. Three things have to be here
// or the gate traps people:
//   * /pricing   — where the gate sends them; gating it would be an infinite redirect.
//   * /settings  — a lapsed member must still be able to manage billing, re-subscribe, or delete
//                  their account. Locking the exit behind the paywall is the pattern consumer-
//                  protection regulators single out, and /terms promises self-serve cancellation.
//   * /pending, /welcome and the public paths, via isPendingAllowed.
//
// /report is here by Derek's call, and it is the one entry that is a PRODUCT decision rather than
// a mechanical necessity. It is the graded track record — the weeks we beat the close and the
// weeks we did not — and it is the only claim this product makes that its competitors do not.
// Behind the paywall, someone deciding whether to subscribe cannot see the evidence that the
// record is honest, which is precisely the evidence that would make them subscribe.
const SUBSCRIBER_EXEMPT = ["/pricing", "/settings", "/report"];
function isSubscriberExempt(path: string): boolean {
  return isPendingAllowed(path)
    || SUBSCRIBER_EXEMPT.some((p) => path === p || path.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Auth not configured yet — don't break the analytics site.
  if (!url || !key) return response;

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // IMPORTANT: refresh the session (do not run other logic between this and returning response).
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Gate: a signed-out visitor gets bounced to /login for anything but the public paths.
  if (!user && !isPublicPath(path)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "?next=" + encodeURIComponent(path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Private beta: a signed-in member who hasn't been approved yet can see only the
  // homepage + the waiting-room page. Everything else redirects to /pending.
  // Fail OPEN: only gate when we affirmatively read a non-approved status. If the
  // query errors (e.g. the `status` column isn't migrated yet) we let them through,
  // so shipping this before the migration runs can't lock everyone out.
  if (user && !isPendingAllowed(path)) {
    // Prefer the is_approved() definer (profiles.status is no longer client-readable once
    // roster_privacy_authed.sql is applied); fall back to a direct status read until then.
    let approved: boolean | null = null;
    const ia = await supabase.rpc("is_approved", { uid: user.id });
    if (!ia.error && typeof ia.data === "boolean") approved = ia.data;
    else {
      const { data: prof, error } = await supabase.from("profiles").select("status").eq("id", user.id).maybeSingle();
      if (!error && prof && prof.status) approved = prof.status === "approved";
    }
    if (approved === false) {   // null = couldn't determine → fail OPEN (as before)
      const pending = request.nextUrl.clone();
      pending.pathname = "/pending";
      pending.search = "";
      return NextResponse.redirect(pending);
    }
  }

  // Paid gate: an approved member without an active subscription sees the pricing page.
  //
  // 🚨 FAILS OPEN, TWICE OVER, AND BOTH ARE DELIBERATE. `STRIPE_SECRET_KEY` absent means billing
  // is not switched on yet, so NOBODY is gated — this can merge before the keys exist without
  // locking out all 29 members. And if the is_subscribed() call errors (the migration has not
  // been run, Supabase hiccups), `subscribed` stays null and the member goes through. The private
  // beta gate above takes exactly this posture for exactly this reason: the cost of wrongly
  // letting someone in for one page view is a page view; the cost of wrongly locking everyone out
  // is the product.
  //
  // THE EXEMPT LIST IS ONE LINE ON PURPOSE. Derek chose to gate the whole site; if the graded
  // track record (/report) should later sit outside the paywall — it is the "calibration anyone
  // can check" artifact, and a prospective member currently cannot see it before paying — add it
  // to SUBSCRIBER_EXEMPT and nothing else changes.
  if (user && process.env.STRIPE_SECRET_KEY && !isSubscriberExempt(path)) {
    let subscribed: boolean | null = null;
    const { data, error } = await supabase.rpc("is_subscribed", { uid: user.id });
    if (!error && typeof data === "boolean") subscribed = data;
    if (subscribed === false) {
      const pricing = request.nextUrl.clone();
      pricing.pathname = "/pricing";
      pricing.search = "?next=" + encodeURIComponent(path + request.nextUrl.search);
      return NextResponse.redirect(pricing);
    }
  }

  return response;
}

export const config = {
  // Run on everything except static assets / images so auth cookies stay fresh
  // without blocking CSS, JS, or the OG images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|opengraph-image|twitter-image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
