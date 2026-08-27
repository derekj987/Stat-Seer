import { Brand, FlowSteps, ShopSubnav, ValueFinderNote } from "../../Nav";
import { NcaafSoon } from "../Soon";
import PropsView from "../../props/PropsView";
import { cfbWeekProps } from "@/lib/cfbProps";

// College Football — Value Finder · Player Props. Props are the likeliest place a real
// edge remains (hundreds of semi-independent markets). Reuses the NFL PropsView board
// (tap-to-add chips + single best book across sportsbooks), fed from the CFB prop capture
// (cfb_prop_snapshots). Falls back to "coming soon" only when no props are posted yet.
export const metadata = {
  title: "StatSeer — CFB Player Props",
  description: "College-football player props — every market with the best price across books and one tap to add to your slip.",
};

export const revalidate = 120;

export default async function Page() {
  const games = await cfbWeekProps();

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Player Props</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <ValueFinderNote />
      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="props" base="ncaaf" />

      {games.length ? (
        <section className="ncf-sec">
          <div className="hb-legend">
            <b>Player props, best price across ~10 books.</b> Each row is a player&apos;s number with the
            <b> single best price</b> and which book has it — <b>tap any chip to add it to your slip</b>. Props are the
            one place a real college edge might survive (books price hundreds of them semi-independently); once we have
            enough captured history we grade them, same as everything else.
          </div>
          <PropsView games={games} embedded />
          <p className="ncf-note">
            Best price shown per player across the books we track. For the line-blind read, see <a href="/ncaaf/model">The Model</a>;
            for key numbers, <a href="/ncaaf/best">Sweet Spots</a>.
          </p>
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
