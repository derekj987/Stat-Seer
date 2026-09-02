import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "../../Nav";
import MemberActions from "./MemberActions";

export const dynamic = "force-dynamic";
const ADMIN_ROLES = ["founder", "admin"];

// Format in Eastern time so the " ET" label is accurate — without timeZone this rendered in the
// server's zone (UTC on Vercel) but still said "ET", so the time read ~4-5 hours off.
const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

type Row = { id: string; username: string; status: string; role: string; created_at: string };

export default async function MembersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (me?.role as string) ?? "member";

  if (!ADMIN_ROLES.includes(role)) {
    return (
      <main className="wrap">
        <header className="masthead"><Brand sub="Admin" /></header>
        <p className="foot">This page is for the StatSeer team only.</p>
      </main>
    );
  }

  // status is no longer client-readable once roster_privacy_authed.sql is applied — get the roster via
  // the staff-only list_members() definer; fall back to a direct read until then.
  const lm = await supabase.rpc("list_members");
  let all: Row[];
  if (!lm.error && Array.isArray(lm.data)) {
    all = lm.data as Row[];
  } else {
    const { data: rows } = await supabase
      .from("profiles").select("id, username, status, role, created_at")
      .order("created_at", { ascending: false });
    all = (rows ?? []) as Row[];
  }
  const pending = all.filter((r) => r.status === "pending");
  const approved = all.filter((r) => r.status === "approved");
  const rejected = all.filter((r) => r.status === "rejected");

  return (
    <main className="wrap">
      <header className="masthead"><Brand sub="Admin · Beta members" /></header>

      <h1 className="secthead__h">
        Pending requests {pending.length > 0 && <span className="repcount">{pending.length}</span>}
      </h1>

      {pending.length === 0 ? (
        <p className="foot">No one waiting — all caught up. ✅</p>
      ) : (
        <div className="memberlist">
          {pending.map((r) => (
            <div key={r.id} className="memberrow">
              <div className="memberrow__main">
                <span className="memberrow__name">{r.username}</span>
                <span className="memberrow__meta">requested {when(r.created_at)}</span>
              </div>
              <MemberActions id={r.id} username={r.username} status={r.status} />
            </div>
          ))}
        </div>
      )}

      <details className="memberroster">
        <summary>Approved members ({approved.length}){rejected.length ? ` · rejected (${rejected.length})` : ""}</summary>
        <div className="memberlist">
          {approved.map((r) => (
            <div key={r.id} className="memberrow memberrow--calm">
              <div className="memberrow__main">
                <span className="memberrow__name">{r.username}{r.role !== "member" && <span className="memberrow__role"> · {r.role}</span>}</span>
                <span className="memberrow__meta">joined {when(r.created_at)}</span>
              </div>
              <MemberActions id={r.id} username={r.username} status={r.status} />
            </div>
          ))}
          {rejected.map((r) => (
            <div key={r.id} className="memberrow memberrow--calm">
              <div className="memberrow__main">
                <span className="memberrow__name">{r.username}</span>
                <span className="memberrow__meta">rejected</span>
              </div>
              <MemberActions id={r.id} username={r.username} status={r.status} />
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}
