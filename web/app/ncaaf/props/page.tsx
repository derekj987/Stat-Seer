import { Brand, FlowSteps, ShopSubnav, WeekBadge } from "../../Nav";
import { NcaafWeekNav, NcaafWeekNote, readNcaafWeek, ncaafCard } from "../NcaafWeek";
import PinButton from "../../PinButton";
import { NCAAF_MODEL } from "../model-data";
import { NcaafSoon } from "../Soon";
import PropsView from "../../props/PropsView";
import Tip from "../../Tip";
import { etToday } from "@/lib/gameDays";
import { cfbWeekProps } from "@/lib/cfbProps";
import { CATEGORIES, categoryByKey } from "@/lib/props";
import { playerSlot, playerTeam } from "@/lib/playerSlot";

function CatNav({ current }: { current: string }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {CATEGORIES.map((c) => (
        <a key={c.key} href={`/ncaaf/props?cat=${c.key}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

// College Football — Value Finder · Player Props. Props are the likeliest place a real
// edge remains (hundreds of semi-independent markets). Reuses the NFL PropsView board
// (tap-to-add chips + single best book across sportsbooks), fed from the CFB prop capture
// (cfb_prop_snapshots). Falls back to "coming soon" only when no props are posted yet.
export const metadata = {
  title: "StatSeer — CFB Player Props",
  description: "College-football player props — every market with the best price across books and one tap to add to your slip.",
};

export const revalidate = 120;

export default async function Page({ searchParams }: PageProps<"/ncaaf/props">) {
  const sp = await searchParams;
  const cat = categoryByKey(typeof sp.cat === "string" ? sp.cat : "td");
  const cur = NCAAF_MODEL.card.week;
  const week = readNcaafWeek(sp.week, cur);
  const catSet = new Set(cat.markets);
  const all = await cfbWeekProps(week);
  // Filter each game to the active category's markets — same tabbed layout as the NFL board
  // and The Model, so every prop type is represented (not a single ATTD wall).
  const games = all
    .map((g) => ({
      ...g,
      markets: g.markets.filter((m) => catSet.has(`player_${m.market}`) || catSet.has(m.market)).map((m) => ({
        ...m, quotes: m.quotes.map((q) => ({
          ...q,
          slot: playerSlot(q.player, "ncaaf") ?? undefined,
          team: playerTeam(q.player, "ncaaf") ?? undefined,
        })),
      })),
    }))
    .filter((g) => g.markets.length > 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      {/* The SELECTED week, not `cur` — everything else on the page (nav, note, the board itself)
          follows the selection, so a badge pinned to the current week just mislabels the board. */}
      <WeekBadge week={week} pin={<PinButton size="sm" pin={{ id: `/ncaaf/props?cat=${cat.key}`, kind: "props", label: `NCAAF Props · ${cat.label}`, detail: `Week ${week}`, href: `/ncaaf/props?cat=${cat.key}&week=${week}` }} />} />
      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="props" base="ncaaf" />
      <NcaafWeekNav base="/ncaaf/props" week={week} params={`cat=${cat.key}`} />
      <NcaafWeekNote card={ncaafCard(week)} />

      {all.length ? (
        <section className="ncf-sec">
          <p className="ctxsec__legend">
            Every posted prop at the <b>single best US book</b>; tap any chip to add it to your slip.
            <Tip label="About this board" text={<>
              <b>The board.</b> Each row is a player&apos;s number with the single best price across the US
              books we track and which book has it. A <b>✓</b> marks a price that beats the de-vigged market —
              the Pick Auditor&apos;s arithmetic, not a model call.<br /><br />
              <b>Why props.</b> Game lines are priced efficiently; books post hundreds of player props
              semi-independently, so a prop is the likeliest place a real college edge survives. Once enough
              captured history exists they are graded, same as everything else.<br /><br />
              For the line-blind read, see <a href="/ncaaf/model">The Model</a>; for key numbers,{" "}
              <a href="/ncaaf/best">Sweet Spots</a>.
            </>} />
          </p>
          <CatNav current={cat.key} />
          {games.length ? (
            <PropsView games={games} embedded {...etToday()} />
          ) : (
            <p className="ncf-note">
              No <b>{cat.label.toLowerCase()}</b> props posted for this slate yet — books post them closer to
              kickoff. Try another category above, or check back as the slate fills in.
            </p>
          )}
        </section>
      ) : (
        <NcaafSoon
          title="Player props — the place an edge might actually live"
          blurb="Game lines are efficiently priced, but books post hundreds of player-prop markets semi-independently, so props are the likeliest spot a real college edge survives. When they're up, this board lists each market with the best price across books and one tap to add to your slip."
          waitingOn="books posting CFB props for the upcoming slate (they go up ~3-4 days before kickoff) — our daily capture is already running so the history builds from day one."
          links={[
            { href: "/ncaaf/best", label: "Sweet Spots (live now)" },
            { href: "/ncaaf/lines", label: "Game Lines" },
          ]}
        />
      )}

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> Key numbers are live on <a href="/ncaaf/best">Sweet Spots</a>; the line-blind
          read is <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
