import { weekRange } from "@/lib/board";
import { weekProps, CATEGORIES, categoryByKey } from "@/lib/props";
import { playerSlot } from "@/lib/playerSlot";
import { ShopSubnav, Brand, FlowSteps, ValueFinderNote } from "../Nav";
import { WeekNav } from "../WeekNav";
import PropsView from "./PropsView";

export const revalidate = 120;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function CatNav({ current, week }: { current: string; week: number }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {CATEGORIES.map((c) => (
        <a key={c.key} href={`/props?cat=${c.key}&week=${week}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/props">) {
  const sp = await searchParams;
  const isPre = sp.season === "pre";
  const cat = categoryByKey(typeof sp.cat === "string" ? sp.cat : "td");

  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch {
    range = null;
  }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const catSet = new Set(cat.markets);
  const games = isPre ? [] : (await weekProps(week, SEASON))
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
          sub={<><span className="brand__sport">NFL</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
        {!isPre && snap && <div className="asof">props as of<br /><b>{et(snap)}</b></div>}
      </header>

      <ValueFinderNote />
      <FlowSteps active="value" />
      <ShopSubnav active="props" />

      {isPre ? (
        <div className="tgwall" role="note">
          <span className="tgwall__tag">Preseason props — not offered</span>
          <p>
            Books rarely post <b>player props</b> for preseason games — snap counts are unpredictable and
            starters barely play, so there&apos;s no reliable market to shop. If preseason props do appear,
            they&apos;ll show here. For now, shop preseason <a href="/preseason">Game Lines</a>, or switch to
            <a href="/props"> Regular Season</a> props.
          </p>
        </div>
      ) : (
        <>
          <CatNav current={cat.key} week={week} />
          <WeekNav min={min} max={max} current={week} base="/props" params={`cat=${cat.key}`} />
          {games.length === 0 ? (
            <p className="foot">
              No <b>{cat.label.toLowerCase()}</b> props posted for Week {week} yet. Books post most player
              props closer to kickoff — this fills in on its own during game week.
            </p>
          ) : (
            <PropsView games={games} />
          )}
        </>
      )}
    </main>
  );
}
