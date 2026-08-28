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
  return path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
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

  // Gate: a signed-out visitor gets bounced to /login for anything but the public paths.
  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "?next=" + encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
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
