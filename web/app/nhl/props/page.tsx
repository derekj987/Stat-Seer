import { Brand, FlowSteps, ShopSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import PropsGrid from "../../PropsGrid";
import { etToday } from "@/lib/gameDays";
import { nhlPropBoard, NHL_CATEGORIES, NHL_PROP_LABELS, nhlCategoryByKey, ONE_SIDED } from "@/lib/nhlProps";
import { US_BOOKS, bookLegend } from "@/lib/bookLabel";
import Tip from "../../Tip";

// NHL · Value Finder · Player Props. The same grid the baseball board uses (one row per player,
// one column per market, every side at the single best US book, tap to add to the slip), fed from
// nhl_prop_snapshots.
//
// Four tabs, ordered deliberately: Shots first because shots on goal is the VOLUME market and the
// project's standing finding is that volume persists while efficiency does not. Points and assists
// next, goals last — a goal is a shot times a shooting percentage, which is the least persistent
// quantity on the page.
//
// 🚨 GOALS IS A SHOPPING-ONLY TAB, AND THE PAGE SAYS SO RATHER THAN QUIETLY DIFFERING. Books post
// anytime goal scorer as a single Yes price — 1,393 rows on the first live sweep, not one "No"
// anywhere. The fair price the ✓ tag compares against is de-vig arithmetic over the two sides of
// one question, so with one side quoted there is no fair price to compute and no tag to show. Best
// price across books still works perfectly, which is the whole of what that tab claims.
export const metadata = {
  title: "StatSeer — NHL Player Props",
  description:
    "NHL player props — shots on goal, points, assists and anytime goal scorer, each at the best price across books, one tap to your slip.",
};
export const revalidate = 120;

function CatNav({ current }: { current: string }) {
  return (
    <nav className="catnav" aria-label="Prop category">
      {NHL_CATEGORIES.map((c) => (
        <a key={c.key} href={`/nhl/props?cat=${c.key}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/nhl/props">) {
  const sp = await searchParams;
  const cat = nhlCategoryByKey(typeof sp.cat === "string" ? sp.cat : "shots");
  const catSet = new Set<string>(cat.markets);
  const all = await nhlPropBoard().catch(() => []);
  // Only this category's markets, and only games that still have something in it. No team tag
  // beside a name yet: the prop feed carries the two clubs per GAME, not the club per player, and
  // a card already names only those two. Inventing one from a name match would be worse than none.
  const games = all
    .map((g) => ({ ...g, markets: g.markets.filter((m) => catSet.has(m.market)) }))
    .filter((g) => g.markets.length > 0);
  const oneSided = cat.markets.every((m) => ONE_SIDED.has(m));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NHL</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <DayBadge tip={<Tip label="About this board" text={<>
              <span className="tip__lead">One row per player, one column per market — each side at the{" "}
            <b>single best US book</b>; tap any side to add it to your slip.</span><br /><br />
              {oneSided ? (
                // The "main line" sentence below would be false here: there is no line on an anytime-goal
                // row and no second side, so the grid copy has to say something different rather than
                // something generic.
                <><b>The grid.</b> One row per skater, highest-scoring players first, each at the single
                  best price across books. <b>Anytime goal</b> is quoted as one <b>Yes</b> price rather
                  than two sides, so this tab is pure shopping — on a market priced this long, the gap
                  between the best book and the rest is where the difference lives. The <b>✓</b>
                  fair-price tag compares the two posted sides of a market, so it appears on the Shots,
                  Points and Assists tabs.<br /><br /></>
              ) : (
                <><b>The grid.</b> Each cell is the player&apos;s <b>main line</b> for that market — the
                  line the most books post both sides of — with the best price for each side and the book
                  that has it. Rows run highest line first, so the heavy-usage players lead the card. A
                  dash means no book has posted that market for him.<br /><br /></>
              )}
              {!oneSided && (
                <><b>The ✓.</b> It marks a price that beats the de-vigged market — the{" "}
                  <a href="/audit">Pick Auditor</a>&apos;s arithmetic on the two posted sides, not a model
                  call.<br /><br /></>
              )}
              <b>The books.</b> {bookLegend([...US_BOOKS])}. A tie shows as ×2 / ×3; hover a chip for the
              names. US-licensed books only.<br /><br />
              <b>Why props.</b> Books price hundreds of these semi-independently, which is why a player
              prop is the likeliest place a price is wrong. Shots on goal leads the tabs on purpose: it is
              the volume market, and volume is the part of a player&apos;s night that carries from game to
              game. For moneylines, puck lines and totals, see <a href="/nhl/lines">Line Shopping</a>.
            </>} />} pin={<PinButton size="sm" pin={{ id: `/nhl/props?cat=${cat.key}`, kind: "props", label: `NHL Props · ${cat.label}`, detail: "upcoming slate", href: `/nhl/props?cat=${cat.key}` }} />} />
      <FlowSteps active="value" base="nhl" />
      <div className="subnavrow"><ShopSubnav active="props" base="nhl" only={["lines", "props"]} /></div>

      {all.length ? (
        <section className="ncf-sec">
          <CatNav current={cat.key} />
          {games.length ? (
            <PropsGrid games={games} markets={cat.markets} labels={NHL_PROP_LABELS} {...etToday()} />
          ) : (
            <p className="ncf-note">
              No <b>{cat.label.toLowerCase()}</b> props posted for the upcoming slate yet — books post them
              through the day. Try another category above, or check back closer to puck drop.
            </p>
          )}
        </section>
      ) : (
        // Not a failure: the NHL does not play every night, and props appear a day or two out.
        <p className="foot">
          No NHL props captured for upcoming games yet — the board fills as books post them and the
          capture runs.
        </p>
      )}

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> Every number here is a <b>pregame</b> price shopped across books. For
          moneylines, puck lines and totals, see <a href="/nhl/lines">Line Shopping</a>.
        </p>
      </footer>
    </main>
  );
}
