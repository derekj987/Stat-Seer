import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "../Nav";

// The feedback mailbox — founder/admin only. Lists everything submitted through the
// global "Tell us what's up?" widget, newest first.
export const dynamic = "force-dynamic";
const MOD_ROLES = ["founder", "admin"];

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

type Row = {
  id: string; created_at: string; message: string;
  email: string | null; path: string | null; user_id: string | null;
};

export default async function FeedbackInbox() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (prof?.role as string) ?? "member";

  if (!MOD_ROLES.includes(role)) {
    return (
      <main className="wrap">
        <header className="masthead"><Brand sub="Feedback" /></header>
        <p className="foot">This inbox is for the StatSeer team only.</p>
      </main>
    );
  }

  let items: Row[] = [];
  try {
    const { data } = await supabase
      .from("feedback").select("id,created_at,message,email,path,user_id")
      .order("created_at", { ascending: false }).limit(300);
    items = (data as Row[]) ?? [];
  } catch { items = []; }

  return (
    <main className="wrap">
      <header className="masthead"><Brand sub="Feedback inbox" /></header>
      <section className="explainer">
        <p><b>Everything members send through the “Tell us what’s up?” mailbox.</b> Newest first.</p>
      </section>

      {items.length === 0 ? (
        <p className="foot">
          No feedback yet. If you expected some, make sure the <code>feedback</code> table exists
          (see <code>ingest/feedback.sql</code>).
        </p>
      ) : (
        <div className="fbinbox">
          {items.map((f) => (
            <article className="fbmsg" key={f.id}>
              <div className="fbmsg__meta">
                <span className="fbmsg__when">{when(f.created_at)}</span>
                {f.path && <span className="fbmsg__path">{f.path}</span>}
                {f.email && <a className="fbmsg__email" href={`mailto:${f.email}`}>{f.email}</a>}
                {f.user_id && <span className="fbmsg__tag">member</span>}
              </div>
              <p className="fbmsg__body">{f.message}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
