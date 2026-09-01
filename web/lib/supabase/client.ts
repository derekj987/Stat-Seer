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
// states render for free. Production builds are NODE_ENV="production" → this is inert.
const QA_PREVIEW =
  process.env.NEXT_PUBLIC_QA_PREVIEW === "1" ||
  (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_QA_PREVIEW !== "0");

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
