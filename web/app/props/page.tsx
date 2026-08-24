import { weekRange } from "@/lib/board";
import { weekProps, CATEGORIES, categoryByKey } from "@/lib/props";
import { ShopSubnav, Brand, FlowSteps, ValueFinderNote } from "../Nav";
import Tip from "@/app/Tip";
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

function WeekNav({ min, max, current, cat }: { min: number; max: number; current: number; cat: string }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/props?cat=${cat}&week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
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
    .map((g) => ({ ...g, markets: g.markets.filter((m) => catSet.has(m.market)) }))
    .filter((g) => g.markets.length > 0);
  const snap = games[0]?.snapshot ?? "";

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={isPre
            ? `Value Finder · Player Props · Preseason`
            : `Value Finder · Player Props · ${cat.label}`}
          tip={<Tip text={<>Every player prop with the <b>best available price across ~10 sportsbooks</b> (tap any to add it to your slip), and the edge you gain by shopping it there. Prices only — for our own line-blind projections on props, see the <b>Player Model</b>.</>} />}
        />
        {!isPre && snap && <div className="asof">props as of<br /><b>{et(snap)}</b></div>}
      </header>

      <FlowSteps active="value" />
      <ValueFinderNote />
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
          <WeekNav min={min} max={max} current={week} cat={cat.key} />
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
