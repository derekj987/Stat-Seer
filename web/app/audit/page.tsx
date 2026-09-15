import { weekRange, currentWeek } from "@/lib/board";
import { weekProps, CATEGORIES, categoryByKey } from "@/lib/props";
import { playerSlot } from "@/lib/playerSlot";
import { Brand, FlowSteps, ShopSubnav, WeekBadge } from "../Nav";
import { WeekNav } from "../WeekNav";
import { etToday } from "@/lib/gameDays";
import AuditView from "./AuditView";
import PinButton from "../PinButton";

export const revalidate = 120;
const SEASON = 2026;

export const metadata = {
  title: "StatSeer — Pick Auditor",
  description: "Every player-prop price, checked against the market's own de-vigged fair number — green for value, white for fair, red for overpriced. No inputs, no picks.",
};

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function CatNav({ current, week }: { current: string; week: number }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {CATEGORIES.map((c) => (
        <a key={c.key} href={`/audit?cat=${c.key}&week=${week}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/audit">) {
  const sp = await searchParams;
  const cat = categoryByKey(typeof sp.cat === "string" ? sp.cat : "passing");

  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  // Default to the CURRENT week (earliest with a game still to play), not the earliest week that
  // has odds — `min` is week 1 all season, so every NFL board opened on the completed week.
  let cur: number | null = null;
  try { cur = await currentWeek(SEASON); } catch { cur = null; }
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : (cur ?? min);

  const catSet = new Set(cat.markets);
  const games = (await weekProps(week, SEASON))
    .map((g) => ({
      ...g,
      markets: g.markets.filter((m) => catSet.has(m.market)).map((m) => ({
        ...m, quotes: m.quotes.map((q) => ({ ...q, slot: playerSlot(q.player, "nfl") ?? undefined })),
      })),
    }))
    .filter((g) => g.markets.length > 0);
  const snap = games[0]?.snapshot ?? "";

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">Value Finder</span> · Pick Auditor</>}
          art={{ src: "/bag.png?v=1", alt: "Pick Auditor" }}
        />
        {snap && <div className="asof">prices as of<br /><b>{et(snap)}</b></div>}
      </header>

      <WeekBadge week={week} />
      <FlowSteps active="value" />
      <div className="subnavrow"><ShopSubnav active="auditor" /></div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Is your price fair?
          <span className="ncf-h__note">every prop, checked against the de-vigged market — value · fair · overpriced</span>
        </h2>

        <div className="pinrow">
          <PinButton pin={{ id: `/audit?cat=${cat.key}`, kind: "auditor", label: `Pick Auditor · ${cat.label}`, detail: `NFL · Week ${week}`, href: `/audit?cat=${cat.key}&week=${week}` }} />
        </div>

        <CatNav current={cat.key} week={week} />
        <WeekNav min={min} max={max} current={week} base="/audit" params={`cat=${cat.key}`} />
        <AuditView games={games} {...etToday()} />

        <details className="pa__how">
          <summary className="pa__howsum">How the Pick Auditor works</summary>
          <div className="pa__howbody">
            <p>
              Every price a book posts has its margin — the <b>vig</b> — built into both sides, which is why
              the two implied chances add up to more than 100%. The auditor strips that margin back out to
              recover the market&apos;s own <b>fair probability</b>, then turns it into a fair price.
            </p>
            <p>
              A <span className="aucircle aucircle--value" /> <b>green</b> circle means the book price beats that fair
              number, <span className="aucircle aucircle--fair" /> <b>white</b> means it&apos;s a normal, in-line
              price, and <span className="aucircle aucircle--cheat" /> <b>red</b> means it&apos;s worse than a typical
              hold explains. It&apos;s pure arithmetic on the book&apos;s own numbers — transparent and easy to
              check for yourself.
            </p>
            <p>
              <b>A green is a real deal, earned two ways.</b> Either the price <b>beats the true no-vig fair</b>
              (a genuine edge — rare, because every posted price normally sits a little worse than fair, and that
              gap is how the book makes money), <b>or</b> it&apos;s a <b>line-shopping win</b>: the best book is
              paying materially more than the rest of the field on that exact bet, so you pocket the difference by
              placing it there. Most prices land fair (white); the juiciest are red. When a green shows up, it&apos;s
              worth a look.
            </p>
            <p>
              A one-sided market with no posted opposite side can&apos;t be de-vigged — for those, compare the
              best number across books on <a href="/props">Player Props</a>.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
