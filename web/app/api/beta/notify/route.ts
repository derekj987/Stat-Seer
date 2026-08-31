import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALERT_TO, SITE_URL, signApprove, sendMail, adminClient } from "@/lib/betaMail";

export const runtime = "nodejs";

// Called from /pending when a member is awaiting approval — emails the ops inbox once, with a
// one-click approve link, then flags the profile so we don't email again.
export async function POST() {
  let user: { id: string; email?: string } | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      user = { id: data.user.id, email: data.user.email ?? undefined };
      const { data: prof } = await supabase.from("profiles").select("username, status, request_notified").eq("id", data.user.id).single();
      if (!prof || prof.status !== "pending" || prof.request_notified) {
        return NextResponse.json({ ok: true, sent: false });
      }
      const username = (prof.username as string) || "a new member";
      const sig = signApprove(user.id);
      const approveLink = sig ? `${SITE_URL}/api/beta/approve?m=${user.id}&exp=${sig.exp}&t=${sig.token}` : "";
      const email = user.email || "(no email on file)";
      await sendMail(
        ALERT_TO,
        `New StatSeer beta request: ${username}`,
        `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.6;color:#12261b">
           <h2 style="color:#b8860b">New beta access request</h2>
           <p><b>${username}</b> just requested access.<br>Email: ${email}</p>
           ${approveLink ? `<p><a href="${approveLink}" style="display:inline-block;background:#17794a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700">Approve ${username}</a></p>` : ""}
           <p style="color:#576a5e;font-size:13px">Or review everyone in <a href="${SITE_URL}/admin/members">Beta approvals</a>.</p>
         </div>`,
        `New StatSeer beta request from ${username} (${email}).` +
          (approveLink ? `\nApprove: ${approveLink}` : "") +
          `\nAll requests: ${SITE_URL}/admin/members`,
      );
      const admin = adminClient();
      if (admin) await admin.from("profiles").update({ request_notified: true }).eq("id", user.id);
      return NextResponse.json({ ok: true, sent: true });
    }
  } catch { /* env not configured */ }
  return NextResponse.json({ ok: true, sent: false });
}
