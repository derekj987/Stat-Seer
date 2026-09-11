import { Brand, FlowSteps, ShopSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import PropsView from "../../props/PropsView";
import { etToday } from "@/lib/gameDays";
import { mlbPropBoard, MLB_CATEGORIES, mlbCategoryByKey, norm } from "@/lib/mlbProps";
import { MLB_PROPS } from "@/lib/mlbPlayerProps";

// MLB · Value Finder · Player Props. The NFL/NCAAF prop board (PropsView: tap-to-add chips, the
// single best book per player-side, Pick Auditor value tags), fed from mlb_prop_snapshots.
// Tabs split the board the way a sportsbook does; the team beside each name comes from the
// projected lineups so a reader knows which side of the game a hitter is on.
export const metadata = {
  title: "StatSeer — MLB Player Props",
  description: "MLB player props — every market with the best price across books and one tap to add to your slip.",
};
export const revalidate = 120;

function CatNav({ current }: { current: string }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {MLB_CATEGORIES.map((c) => (
        <a key={c.key} href={`/mlb/props?cat=${c.key}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/mlb/props">) {
  const sp = await searchParams;
  const cat = mlbCategoryByKey(typeof sp.cat === "string" ? sp.cat : "hitting");
  const catSet = new Set(cat.markets);
  const all = await mlbPropBoard().catch(() => []);
  // Team abbreviation and batting slot per player from the lineup projections (the feed carries
  // teams per GAME, not per player). Pitchers are not in the batting projections: no tag, sorted
  // last. Rows read in LINEUP ORDER — away side first, then home, leadoff to nine-hole — the way
  // a sportsbook's own game page lists them, instead of A.J. Ewing first by alphabet.
  const info = new Map(MLB_PROPS.map((p) => [norm(p.player), { team: p.teamAbbr || p.team, slot: p.slot, home: p.game.endsWith(`@ ${p.team}`) }]));
  const order = (q: { player: string }) => { const i = info.get(norm(q.player)); return i ? (i.home ? 100 : 0) + (i.slot || 50) : 999; };
  const games = all
    .map((g) => ({
      ...g,
      markets: g.markets.filter((m) => catSet.has(m.market)).map((m) => ({
        ...m,
        quotes: m.quotes
          .map((q) => ({ ...q, team: info.get(norm(q.player))?.team }))
          .sort((a, b) => order(a) - order(b) || a.player.localeCompare(b.player) || (a.side === "Over" ? -1 : 1)),
      })),
    }))
    .filter((g) => g.markets.length > 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">MLB</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <DayBadge pin={<PinButton size="sm" pin={{ id: `/mlb/props?cat=${cat.key}`, kind: "props", label: `MLB Props · ${cat.label}`, detail: "today's slate", href: `/mlb/props?cat=${cat.key}` }} />} />
      <FlowSteps active="value" base="mlb" />
      <div className="subnavrow"><ShopSubnav active="props" base="mlb" /></div>

      {all.length ? (
        <section className="ncf-sec">
          <div className="hb-legend">
            <b>Player props, best price across the books we track.</b> Each row is a player&apos;s number with
            the <b>single best price</b> and which book has it — <b>tap any chip to add it to your slip</b>.
            Books price hundreds of these semi-independently, which is why props are the likeliest place a
            price is wrong. For our own read on hits, home runs and strikeouts, see{" "}
            <a href="/mlb/model/players">The Model</a>.
          </div>
          <CatNav current={cat.key} />
          {games.length ? (
            <PropsView games={games} embedded {...etToday()} />
          ) : (
            <p className="ncf-note">
              No <b>{cat.label.toLowerCase()}</b> props posted for the upcoming slate yet — books post them
              through the afternoon. Try another category above, or check back closer to first pitch.
            </p>
          )}
          <p className="ncf-note">
            Best price shown per player across the books we track; ✓ marks a price that beats the
            de-vigged market. For run lines and totals, see <a href="/mlb/lines">Line Shopping</a>; for
            where the half-run matters, <a href="/mlb/best">Sweet Spots</a>.
          </p>
        </section>
      ) : (
        <p className="foot">No props captured for upcoming games yet — the board fills as the capture runs.</p>
      )}

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> The line-blind read on these players is{" "}
          <a href="/mlb/model/players">The Model</a>; the half-run and the run line are on{" "}
          <a href="/mlb/best">Sweet Spots</a>.
        </p>
      </footer>
    </main>
  );
}
