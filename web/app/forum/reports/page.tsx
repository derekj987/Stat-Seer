import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listReports } from "@/lib/forum";
import { Brand } from "../../Nav";
import { AuthorTag } from "../AuthorTag";
import ResolveButton from "./ResolveButton";

export const dynamic = "force-dynamic";
const MOD_ROLES = ["founder", "admin"];

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (prof?.role as string) ?? "member";

  if (!MOD_ROLES.includes(role)) {
    return (
      <main className="wrap">
        <header className="masthead"><Brand sub="Community" /></header>
        <p className="foot">This inbox is for moderators only.</p>
      </main>
    );
  }

  const reports = await listReports();

  return (
    <main className="wrap">
      <header className="masthead"><Brand sub="Community · Moderation" /></header>
      <nav className="crumbs"><a href="/forum">Community</a><span>›</span>Reports</nav>
      <h1 className="secthead__h">Reports {reports.length > 0 && <span className="repcount">{reports.length}</span>}</h1>

      {reports.length === 0 ? (
        <p className="foot">Nothing flagged — all clear. ✅</p>
      ) : (
        <div className="reports">
          {reports.map((r) => (
            <div key={r.id} className="report">
              <div className="report__main">
                <span className="report__type">{r.type}</span>
                {r.gone
                  ? <span className="report__label report__label--gone">{r.label}</span>
                  : <a href={r.link} className="report__label">{r.label}</a>}
                {r.reason && <p className="report__reason">“{r.reason}”</p>}
                <span className="report__meta">
                  reported by <AuthorTag author={r.reporter} /> · {when(r.createdAt)}
                </span>
              </div>
              <div className="report__actions">
                {!r.gone && <a href={r.link} className="btn">View</a>}
                <ResolveButton id={r.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
