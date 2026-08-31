import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// Shared helpers for the beta approval emails (Resend) + the signed "approve from email" link.
// Best-effort: if Resend / the service key isn't configured, sends are skipped, not fatal.
const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

export const SITE_URL = "https://statseeredge.com";
export const ALERT_TO = process.env.BETA_ALERT_TO || process.env.FEEDBACK_TO || "customerservice@statseer.info";
const FROM = process.env.BETA_FROM || process.env.FEEDBACK_FROM || "StatSeer <notify@statseeredge.com>";

/** Service-role client (bypasses RLS) — for reading a member's email + flipping their status. */
export function adminClient() {
  if (!SUPA_URL || !SERVICE) return null;
  return createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
}

/** A signed, expiring approve token so the ops inbox can approve straight from the email. */
export function signApprove(memberId: string): { exp: number; token: string } | null {
  if (!SERVICE) return null;
  const exp = Date.now() + 14 * 24 * 3600 * 1000; // 14 days
  const token = crypto.createHmac("sha256", SERVICE).update(`${memberId}:${exp}`).digest("hex");
  return { exp, token };
}
export function verifyApprove(memberId: string, exp: number, token: string): boolean {
  if (!SERVICE || !memberId || !exp || exp < Date.now() || !token) return false;
  const expected = crypto.createHmac("sha256", SERVICE).update(`${memberId}:${exp}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token)); } catch { return false; }
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    return res.ok;
  } catch { return false; }
}

/** Email a just-approved member the welcome. Best-effort (needs the service role to read their
 *  email from auth.users) — never blocks the approval itself. */
export async function sendWelcomeEmail(memberId: string): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  try {
    const { data: prof } = await admin.from("profiles").select("username").eq("id", memberId).single();
    const { data: u } = await admin.auth.admin.getUserById(memberId);
    const email = u?.user?.email;
    const name = (prof?.username as string) || "there";
    if (email) {
      await sendMail(
        email,
        "You're in — welcome to StatSeer",
        `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.6;color:#12261b">
           <h2 style="color:#17794a">You're approved 🎉</h2>
           <p>Hi ${name}, your StatSeer beta access is live. Just sign in and the full site opens up.</p>
           <p><a href="${SITE_URL}/login" style="display:inline-block;background:#17794a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700">Sign in to StatSeer</a></p>
           <p style="color:#576a5e;font-size:13px">See the model, find the value, build your dashboard. Have fun — and bet responsibly.</p>
         </div>`,
        `You're approved! Your StatSeer beta access is live — sign in at ${SITE_URL}/login`,
      );
    }
  } catch { /* welcome email best-effort */ }
}
