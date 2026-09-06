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
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Google carries no username, so handle_new_user() named this member 'member_<8 hex>'.
      // Send them to pick a real one before they land anywhere their name is shown. Email signups
      // supply a username in their metadata, so they never match and go straight through.
      //
      // Best effort only: if the read fails for any reason we continue to `next` rather than
      // block a valid sign-in on a cosmetic step.
      if (data?.user) {
        const { data: prof } = await supabase.from("profiles")
          .select("username").eq("id", data.user.id).single();
        const uname = (prof?.username as string) ?? "";
        if (/^member_[0-9a-f]{8}$/.test(uname)) {
          return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(next)}`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
