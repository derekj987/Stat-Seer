// Browser Supabase client (uses the public anon key + row-level security).
// Separate from the server analytics reads, which use the service key.
//
// SINGLETON: every component that needs auth calls createClient(); returning ONE shared
// instance (instead of a fresh client per call) means a single token auto-refresh loop.
// Multiple browser clients each refreshing would race on refresh-token rotation and log
// the user out — the singleton is why sessions now persist.
import { createBrowserClient } from "@supabase/ssr";

// Concrete factory so the singleton keeps the fully-typed client (ReturnType of the
// generic createBrowserClient itself would collapse to `any`).
function make() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

let client: ReturnType<typeof make> | undefined;

// QA preview mode: on the local dev server (or with NEXT_PUBLIC_QA_PREVIEW="1"), pretend a member
// is signed in so gated client components (the LeftRail, dashboards, profile shells) hydrate and can
// be visually audited — without a real Supabase session. We override ONLY auth.getUser/getSession;
// every data read stays the real anon client (RLS just returns empty), so nothing throws and empty
// states render for free.
//
// 🚨 THE NON-PRODUCTION GUARD IS ON THE WHOLE EXPRESSION, NOT ONE BRANCH. The comment here used
// to end "Production builds are NODE_ENV='production' → this is inert", and that was false for
// the FIRST clause: `NEXT_PUBLIC_QA_PREVIEW === "1"` had no NODE_ENV test of its own, so setting
// that one variable in the Vercel project would have switched the mock on for every anonymous
// visitor to the live site. Same shape as the hardcoded `is-online` class and the "well
// calibrated" copy — a comment asserting an invariant the code does not enforce.
//
// What it would and would not have cost, because the difference decides the severity: the
// override is browser-only and touches ONLY auth.getUser/getSession, every data read stays the
// real anon client under RLS, and the fake access_token is the literal string "qa-preview" that
// Supabase rejects. So no member DATA could leak — but member-only UI (the rails, dashboards,
// profile shells) would render for signed-out visitors and the beta approval gate would look
// open. A gate whose only guard is an environment variable nobody has set yet is one deploy
// setting away from being off, so the guard belongs in the code.
//
// proxy.ts already does this correctly for the SERVER gate
// (`NODE_ENV === "development" && VERCEL_ENV !== "production"`); this mirrors it.
const QA_ALLOWED =
  process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
const QA_PREVIEW = QA_ALLOWED && (
  process.env.NEXT_PUBLIC_QA_PREVIEW === "1" ||
  (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_QA_PREVIEW !== "0"));

export function createClient() {
  if (client) return client;
  client = make();
  if (QA_PREVIEW && typeof window !== "undefined") {
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "qa-preview@statseer.local",
      app_metadata: {}, user_metadata: { username: "qa_preview" },
      created_at: new Date(0).toISOString(),
    };
    const session = {
      access_token: "qa-preview", refresh_token: "qa-preview", token_type: "bearer",
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    };
    // Override only the auth reads (cast past the strict return types — QA fixtures, dev-only).
    const auth = client.auth as unknown as Record<string, unknown>;
    auth.getUser = async () => ({ data: { user }, error: null });
    auth.getSession = async () => ({ data: { session }, error: null });
  }
  return client;
}
