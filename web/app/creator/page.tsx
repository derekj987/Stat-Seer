import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorStats, getEmailHealth } from "@/lib/creator";
import { EXPENSES, USAGE, monthlyTotal, annualTotal } from "@/lib/expenses";
import { Brand } from "../Nav";

// The Creator's private dashboard — FOUNDER ONLY (not admins/mods). Business-at-a-glance:
// members, site visits, feedback, flagged posts, forum activity, and the revenue metrics
// that light up once subscriptions ship.
export const dynamic = "force-dynamic";

const dfmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => dfmt.format(new Date(iso));
const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());
const fmtBytes = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`;

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

  const [s, email] = await Promise.all([getCreatorStats(), getEmailHealth()]);

  // Boil the email health down to one status word + tone for the card.
  const emailOk = email.keyPresent && email.keyValid !== false && !email.error;
  const emailValue = !email.keyPresent ? "Not configured"
    : email.keyValid === false ? "Key invalid"
      : email.error ? "Needs attention"
        : "Sending ✓";
  const sendingDomain = email.domains?.find((d) => email.from.includes(d.name)) || email.domains?.[0] || null;

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

      <h2 className="csect">System health <span className="csect__tag">outgoing email</span></h2>
      <div className="cgrid">
        <Stat label="Email delivery (Resend)" value={emailValue} tone={emailOk ? "gold" : "flag"}
          sub={email.error ? email.error : <>welcome &amp; alert emails are sending from <b>{email.from}</b></>} />
        <Stat label="Sending domain"
          value={sendingDomain ? (sendingDomain.status === "verified" ? "Verified ✓" : sendingDomain.status) : (email.keyPresent && email.keyValid ? "None added" : "—")}
          tone={sendingDomain?.status === "verified" ? "gold" : sendingDomain ? "flag" : undefined}
          sub={sendingDomain ? <b>{sendingDomain.name}</b> : "add & verify a domain in Resend to send"} />
      </div>

      <h2 className="csect">Out-of-pocket costs <span className="csect__tag">what you&apos;re spending now</span></h2>
      <div className="ccosts">
        <div className="ccosts__head">
          <div className="ccosts__total">
            <span className="ccosts__totv">${monthlyTotal().toLocaleString()}</span>
            <span className="ccosts__totl">/ month</span>
          </div>
          <span className="ccosts__year">≈ ${annualTotal().toLocaleString()} / year</span>
        </div>
        <div className="ccosts__bars">
          {[...EXPENSES].sort((a, b) => b.monthly - a.monthly).map((e) => {
            const max = Math.max(...EXPENSES.map((x) => x.monthly), 1);
            return (
              <div className="ccostbar" key={e.name} title={e.note}>
                <span className="ccostbar__name">{e.name}{e.variable && <span className="ccostbar__tag">usage</span>}</span>
                <span className="ccostbar__track"><span className="ccostbar__fill" style={{ width: `${Math.max((e.monthly / max) * 100, e.monthly ? 3 : 0)}%` }} /></span>
                <span className="ccostbar__val">{e.monthly ? `$${e.monthly}` : "—"}</span>
              </div>
            );
          })}
        </div>
        <p className="ccosts__note">Edit <code>lib/expenses.ts</code> to change amounts. Usage-based items (like the API) are your run-rate.</p>
      </div>

      <h2 className="csect">Plan usage <span className="csect__tag">how much you&apos;ve used &amp; how much is left</span></h2>
      <div className="ccosts">
        <div className="ccosts__bars">
          {USAGE.map((mtr) => {
            const rawUsed = mtr.key === "storage" ? s.storageBytes : s.members;
            const known = rawUsed !== null && rawUsed !== undefined;
            const usedInUnit = mtr.key === "storage" ? (rawUsed ?? 0) / 1e9 : (rawUsed ?? 0);
            const pct = known ? Math.min((usedInUnit / mtr.limit) * 100, 100) : 0;
            const usedLabel = !known ? "—" : mtr.key === "storage" ? fmtBytes(rawUsed as number) : (rawUsed as number).toLocaleString();
            const leftLabel = !known ? "usage unavailable"
              : mtr.key === "storage" ? `${fmtBytes(mtr.limit * 1e9 - (rawUsed as number))} left`
                : `${(mtr.limit - (rawUsed as number)).toLocaleString()} left`;
            return (
              <div className="cusage" key={mtr.key}>
                <div className="cusage__top">
                  <span className="cusage__name">{mtr.name}</span>
                  <span className="cusage__nums">{usedLabel} <span className="cusage__of">of {mtr.limitLabel}</span></span>
                </div>
                <span className="ccostbar__track"><span className="cusage__fill" style={{ width: `${known ? Math.max(pct, 0.6) : 0}%` }} /></span>
                <span className="cusage__left">{leftLabel}{known ? ` · ${pct < 1 ? pct.toFixed(2) : Math.round(pct)}% used` : ""}</span>
              </div>
            );
          })}
        </div>
        <p className="ccosts__note">Live from Supabase — file storage is summed across your buckets. (MAU shows registered members; Supabase bills on monthly-active users.) Add more meters in <code>lib/expenses.ts</code>.</p>
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
