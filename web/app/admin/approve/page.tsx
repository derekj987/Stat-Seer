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

  const { data: target } = await supabase.from("profiles").select("username").eq("id", m).single();
  if (!target) {
    return <Shell><h1 className="authcard__h">Member not found</h1><p className="authcard__ok">Check <a href="/admin/members">Beta approvals</a>.</p></Shell>;
  }
  // status via the staff-only member_status() definer (profiles.status isn't client-readable once
  // roster_privacy_authed.sql is applied); fall back to a direct read until then.
  let targetStatus: string | null = null;
  const ms = await supabase.rpc("member_status", { target: m });
  if (!ms.error && typeof ms.data === "string") targetStatus = ms.data;
  else { const { data: s } = await supabase.from("profiles").select("status").eq("id", m).maybeSingle(); targetStatus = (s?.status as string) ?? null; }

  return (
    <Shell>
      <h1 className="authcard__h">Approve this member?</h1>
      <p className="authcard__ok">
        <b>{target.username}</b> requested beta access{targetStatus === "approved" ? " — already approved ✓" : "."}
      </p>
      <ApproveConfirm memberId={m} username={target.username} already={targetStatus === "approved"} />
    </Shell>
  );
}
