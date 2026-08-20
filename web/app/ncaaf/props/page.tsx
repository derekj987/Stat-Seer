import { Brand, FlowSteps, ShopSubnav, ValueFinderNote } from "../../Nav";
import { NcaafSoon } from "../Soon";

// College Football — Value Finder · Player Props. Props are the likeliest place a real
// edge remains (hundreds of semi-independent markets). The capture is already running
// daily; nothing to shop until books post and history accrues.
export const metadata = {
  title: "StatSeer — CFB Player Props",
  description: "College-football player props — the capture is running; the board fills in as books post.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Value Finder · College Football · Player Props`} />
      </header>

      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="props" base="ncaaf" />
      <ValueFinderNote />

      <NcaafSoon
        title="Player props — the place an edge might actually live"
        blurb="Game lines are efficiently priced, but books post hundreds of player-prop markets semi-independently, so props are the likeliest spot a real college edge survives. When they&apos;re up, this board lists each market with the best price across books and one tap to add to your slip."
        waitingOn="books posting CFB props (they go up ~3-4 days before kickoff) — our daily capture is already running so the history builds from day one."
        links={[
          { href: "/ncaaf/best", label: "Sweet Spots (live now)" },
          { href: "/ncaaf/lines", label: "Game Lines" },
        ]}
      />

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> Key numbers are live on <a href="/ncaaf/best">Sweet Spots</a>; the line-blind
          read is <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
