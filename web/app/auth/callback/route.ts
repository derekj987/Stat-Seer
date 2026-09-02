// Exchanges the email-confirmation (and later OAuth) code for a session, then
// redirects home. Supabase sends confirmation links here via emailRedirectTo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-site paths: `${origin}${next}` with an unvalidated `next` escapes the host entirely
  // (e.g. "@evil.com" -> https://statseer.info@evil.com, "//evil.com", or "/\evil.com" which the URL
  // parser normalizes to //evil.com) — an open redirect off the back of a valid confirmation code.
  const raw = searchParams.get("next") ?? "/forum";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/forum";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
