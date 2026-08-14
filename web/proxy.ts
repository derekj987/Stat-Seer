// Next 16 renamed `middleware` -> `proxy`. Refreshes the Supabase auth session
// cookie on each request so server components see a valid user.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Run on everything except static assets / images so auth cookies stay fresh
  // without blocking CSS, JS, or the OG images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|opengraph-image|twitter-image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
