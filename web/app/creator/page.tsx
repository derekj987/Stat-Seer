import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorStats } from "@/lib/creator";
import { Brand } from "../Nav";

// The Creator's private dashboard — FOUNDER ONLY (not admins/mods). Business-at-a-glance:
// members, site visits, feedback, flagged posts, forum activity, and the revenue metrics
// that light up once subscriptions ship.
export const dynamic = "force-dynamic";

const dfmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => dfmt.format(new Date(iso));
const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());

function Stat({ label, value, sub, tone, href }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "gold" | "flag" | "soon"; href?: string;
}) {
  const inner = (
    <>
      <span className="cstat__label">{label}</span>
      <span className={`cstat__value${tone ? ` cstat__value--${tone}` : ""}`}>{value}</span>
      {sub && <span className="cstat__sub">{sub}</span>}
    </>
  );
  return href
    ? <a className="cstat cstat--link" href={href}>{inner}</a>
    : <div className={`cstat${tone === "soon" ? " cstat--soon" : ""}`}>{inner}</div>;
}

export default async function CreatorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: prof } = await supabase.from("profiles").select("role,username").eq("id", user.id).single();
  const role = (prof?.role as string) ?? "member";

  // Anyone but the founder gets a plain 404 — the dashboard leaves no trace for members
  // (no "Creator" masthead, no "this is private" hint that it exists).
  if (role !== "founder") notFound();

  const s = await getCreatorStats();

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">Creator</span> · Dashboard</>} />
      </header>

      <section className="explainer">
        <p><b>Your private control room.</b> Only you (the creator) can see this. A business-at-a-glance view — refreshed live.</p>
      </section>

      <h2 className="csect">Audience &amp; engagement</h2>
      <div className="cgrid">
        <Stat label="Members" value={n(s.members)} tone="gold"
          sub={s.membersThisWeek ? <><b>+{s.membersThisWeek}</b> in the last 7 days</> : "total registered accounts"} />
        <Stat label="Site visits" value={n(s.visitsTotal)} tone="gold"
          sub={s.visitsTotal === null ? "run ingest/creator.sql to enable" : <><b>{n(s.visits7d)}</b> in the last 7 days</>} />
        <Stat label="Feedback received" value={n(s.feedbackTotal)} href="/feedback"
          sub="acted-on tracking coming · open inbox →" />
        <Stat label="Beta requests" value={n(s.pendingBeta)} href="/admin/members"
          tone={s.pendingBeta ? "flag" : undefined}
          sub={s.pendingBeta ? "awaiting approval — review →" : "none waiting ✓"} />
        <Stat label="Flagged posts" value={n(s.reportsOpen)} href="/forum/reports"
          tone={s.reportsOpen ? "flag" : undefined}
          sub={s.reportsOpen ? "open reports to review →" : "all clear ✓"} />
        <Stat label="Forum activity" value={<>{n(s.threads)} <span className="cstat__unit">threads</span></>}
          sub={<><b>{n(s.replies)}</b> replies</>} />
      </div>

      <h2 className="csect">Revenue <span className="csect__tag">coming with subscriptions</span></h2>
      <div className="cgrid">
        <Stat label="Monthly revenue" value="—" tone="soon" sub="lights up when paid plans launch" />
        <Stat label="Paid subscribers" value="—" tone="soon" sub="active paying members" />
        <Stat label="MRR / churn" value="—" tone="soon" sub="recurring revenue & retention" />
        <Stat label="ARPU" value="—" tone="soon" sub="avg revenue per member" />
      </div>

      <div className="ccols">
        <section className="ccard">
          <h3 className="ccard__h">Newest members</h3>
          {s.recentMembers.length === 0 ? (
            <p className="ccard__empty">No members yet.</p>
          ) : (
            <ul className="clist">
              {s.recentMembers.map((m) => (
                <li key={m.username}><a className="hb-plrlink" href={`/u/${m.username}`}>{m.username}</a><span className="clist__when">{when(m.created_at)}</span></li>
              ))}
            </ul>
          )}
        </section>

        <section className="ccard">
          <h3 className="ccard__h">Recent feedback</h3>
          {s.recentFeedback.length === 0 ? (
            <p className="ccard__empty">No feedback yet.</p>
          ) : (
            <ul className="clist clist--fb">
              {s.recentFeedback.map((f, i) => (
                <li key={i}><span className="clist__msg">{f.message.slice(0, 90)}{f.message.length > 90 ? "…" : ""}</span><span className="clist__when">{when(f.created_at)}</span></li>
              ))}
            </ul>
          )}
          <p className="ccard__more"><a href="/feedback">Open the full inbox →</a></p>
        </section>
      </div>
    </main>
  );
}
