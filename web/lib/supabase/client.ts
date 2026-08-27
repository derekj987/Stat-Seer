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

export function createClient() {
  return (client ??= make());
}
