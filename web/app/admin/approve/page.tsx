import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyApprove } from "@/lib/betaMail";
import { Brand } from "../../Nav";
import ApproveConfirm from "./ApproveConfirm";

export const dynamic = "force-dynamic";
const ADMIN_ROLES = ["founder", "admin"];

// The one-click approve landing from the ops-inbox email. Gated: the proxy already forces a login
// before /admin/*, and here we ALSO require founder/admin AND a valid signed token — so approving
// still needs YOU (a logged-in founder), not just the email link.
export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ m?: string; exp?: string; t?: string }> }) {
  const sp = await searchParams;
  const m = typeof sp.m === "string" ? sp.m : "";
  const exp = Number(typeof sp.exp === "string" ? sp.exp : 0);
  const t = typeof sp.t === "string" ? sp.t : "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/admin/approve?m=${m}&exp=${exp}&t=${t}`)}`);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  const role = (me?.role as string) ?? "member";

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <main className="wrap">
      <header className="masthead"><Brand sub="Admin · Approve member" /></header>
      <div className="authwrap"><div className="authcard">{children}</div></div>
    </main>
  );

  if (!ADMIN_ROLES.includes(role)) {
    return <Shell><h1 className="authcard__h">Team only</h1><p className="authcard__ok">Only the StatSeer team can approve members.</p></Shell>;
  }
  if (!verifyApprove(m, exp, t)) {
    return <Shell>
      <h1 className="authcard__h">Link invalid or expired</h1>
      <p className="authcard__ok">This approve link is no longer valid. Approve from <a href="/admin/members">Beta approvals</a> instead.</p>
    </Shell>;
  }

  // Signup detail (username, status, first_name, referral) via the staff-only member_detail() definer;
  // fall back to a direct read of the public columns + member_status() until the migrations are applied.
  let username = "", targetStatus: string | null = null, firstName: string | null = null, referral: string | null = null, found = false;
  const md = await supabase.rpc("member_detail", { target: m });
  if (!md.error && Array.isArray(md.data) && md.data[0]) {
    const d = md.data[0]; username = d.username ?? ""; targetStatus = d.status ?? null; firstName = d.first_name ?? null; referral = d.referral ?? null; found = true;
  } else {
    const { data: t } = await supabase.from("profiles").select("username").eq("id", m).maybeSingle();
    if (t) {
      found = true; username = (t.username as string) ?? "";
      const ms = await supabase.rpc("member_status", { target: m });
      if (!ms.error && typeof ms.data === "string") targetStatus = ms.data;
      else { const { data: s } = await supabase.from("profiles").select("status").eq("id", m).maybeSingle(); targetStatus = (s?.status as string) ?? null; }
    }
  }
  if (!found) {
    return <Shell><h1 className="authcard__h">Member not found</h1><p className="authcard__ok">Check <a href="/admin/members">Beta approvals</a>.</p></Shell>;
  }

  return (
    <Shell>
      <h1 className="authcard__h">Approve this member?</h1>
      <p className="authcard__ok">
        <b>{firstName ? `${firstName} (@${username})` : `@${username}`}</b> requested beta access{targetStatus === "approved" ? " — already approved ✓" : "."}
      </p>
      {referral && <p className="authcard__sub">Heard about StatSeer via: <b>{referral}</b></p>}
      <ApproveConfirm memberId={m} username={username} already={targetStatus === "approved"} />
    </Shell>
  );
}
