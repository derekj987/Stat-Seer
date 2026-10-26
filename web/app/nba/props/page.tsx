import { Brand, FlowSteps, ShopSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import PropsGrid from "../../PropsGrid";
import { etToday } from "@/lib/gameDays";
import { nbaPropBoard, NBA_CATEGORIES, NBA_PROP_LABELS, nbaCategoryByKey, THIN } from "@/lib/nbaProps";
import { US_BOOKS, bookLegend } from "@/lib/bookLabel";
import { nbaTeamFor } from "@/lib/nbaTeamTag";
import Tip from "../../Tip";

// NBA · Value Finder · Player Props. The same grid the baseball and hockey boards use (one row per
// player, one column per market, every side at the single best US book, tap to add to the slip),
// fed from nba_prop_snapshots.
//
// 🚨 EVERY TAB HERE CARRIES A VALID ✓, WHICH IS THE ONE THING /nhl/props COULD NOT SAY. Measured
// before this page was written: points, rebounds, assists, threes, steals, blocks and PRA are all
// quoted on BOTH sides across US books, so the de-vigged fair price exists everywhere and the tag
// means the same thing on every tab. Hockey's anytime-goal tab is a lone "Yes" price and had to be
// marked shopping-only; nothing here needs that caveat. Double-double and first basket DO (Yes 100
// / No 4 and Yes 100 / No 0), which is exactly why they are captured but not shown — see
// lib/nbaProps.ts.
//
// There is no NBA model, so no model panel sits above the grid. The flow still renders both steps
// and says The Model is not built yet, rather than hiding the journey or linking a 404.
export const metadata = {
  title: "StatSeer — NBA Player Props",
  description:
    "NBA player props — points, rebounds, assists, threes and more, each at the best price across books, one tap to your slip.",
};
export const revalidate = 120;

function CatNav({ current }: { current: string }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {NBA_CATEGORIES.map((c) => (
        <a key={c.key} href={`/nba/props?cat=${c.key}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/nba/props">) {
  const sp = await searchParams;
  const cat = nbaCategoryByKey(typeof sp.cat === "string" ? sp.cat : "points");
  const catSet = new Set<string>(cat.markets);
  const all = await nbaPropBoard().catch(() => []);
  // Only this category's markets, and only games that still have something in it — plus the team
  // beside each name. The prop feed carries the two teams per GAME and none per PLAYER, so the tag
  // is resolved against those two rosters (lib/nbaTeamTag.ts). It returns null rather than guess,
  // and the grid simply omits the tag then, which is why a player books price while he is off the
  // roster feed shows up untagged instead of wrongly tagged.
  const games = all
    .map((g) => ({
      ...g,
      markets: g.markets.filter((m) => catSet.has(m.market)).map((m) => ({
        ...m,
        quotes: m.quotes.map((q) => ({ ...q, team: nbaTeamFor(q.player, g.home, g.away) ?? undefined })),
      })),
    }))
    .filter((g) => g.markets.length > 0);
  const thin = THIN.has(cat.key);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NBA</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <DayBadge tip={<Tip label="About this board" text={<>
              <span className="tip__lead">One row per player, one column per market — each side at the{" "}
            <b>single best US book</b>; tap any side to add it to your slip.</span><br /><br />
              <b>The grid.</b> Each cell is the player&apos;s <b>main line</b> for that market — the line
              the most books post both sides of — with the best price for each side and the book that has
              it. Rows run highest line first, so the starters and the high-minute rotation lead the card.
              A dash means no book has posted that market for him.<br /><br />
              {thin && (
                // A near-empty card has to explain itself. On the NFL board an empty Defense tab was a
                // capture gap; here it is the market — books price steals for one or two players a
                // night, on a single 1.5 line league-wide.
                <><b>This tab is thin on purpose.</b> Books post steals and blocks for only a
                  couple of players a night — a short card here is the market, not a missing
                  feed.<br /><br /></>
              )}
              <b>The ✓.</b> It marks a price that beats the de-vigged market — the{" "}
              <a href="/audit">Pick Auditor</a>&apos;s arithmetic on the two posted sides, not a model
              call. Every market on this board is quoted on both sides, so the tag means the same thing
              on every tab.<br /><br />
              <b>The books.</b> {bookLegend([...US_BOOKS])}. A tie shows as ×2 / ×3; hover a chip for the
              names. US-licensed books only.<br /><br />
              <b>Why props.</b> Books price hundreds of these semi-independently, which is why a player
              prop is the likeliest place a price is wrong — and basketball posts more of them per game
              than any sport here. For moneylines, spreads and totals, see{" "}
              <a href="/nba/lines">Line Shopping</a>.
            </>} />} pin={<PinButton size="sm" pin={{ id: `/nba/props?cat=${cat.key}`, kind: "props", label: `NBA Props · ${cat.label}`, detail: "upcoming slate", href: `/nba/props?cat=${cat.key}` }} />} />
      <FlowSteps active="value" base="nba" />
      <div className="subnavrow"><ShopSubnav active="props" base="nba" only={["lines", "props"]} /></div>

      {all.length ? (
        <section className="ncf-sec">
          <CatNav current={cat.key} />
          {games.length ? (
            <PropsGrid games={games} markets={cat.markets} labels={NBA_PROP_LABELS} {...etToday()} />
          ) : (
            <p className="ncf-note">
              No <b>{cat.label.toLowerCase()}</b> props posted for the upcoming slate yet — books post them
              through the day. Try another category above, or check back closer to tip-off.
            </p>
          )}
        </section>
      ) : (
        // Not a failure: props appear the morning of the game and the NBA does not play every night.
        <p className="foot">
          No NBA props captured for upcoming games yet — the board fills as books post them and the
          capture runs.
        </p>
      )}

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> Every number here is a <b>pregame</b> price shopped across books. For
          moneylines, spreads and totals, see <a href="/nba/lines">Line Shopping</a>.
        </p>
      </footer>
    </main>
  );
}
