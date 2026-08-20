import { Brand, FlowSteps, ShopSubnav, ValueFinderNote } from "../../Nav";
import { NCAAF_MODEL } from "../model-data";
import { StatCard } from "../StatCard";
import { NcaafSoon } from "../Soon";

// College Football — Value Finder · Game Lines. Line shopping: books post different
// numbers, so the best book is free value. The measured spread across books is real;
// the live, tap-to-shop board turns on with the odds capture.
export const metadata = {
  title: "StatSeer — CFB Game Lines",
  description: "College-football line shopping — how much sportsbooks disagree, and why the best book is free value.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const bs = M.value.bookShop;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Value Finder · College Football · Game Lines · line shopping`} />
      </header>

      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="lines" base="ncaaf" />
      <ValueFinderNote />

      <section className="explainer">
        <p>
          <b>The best book is free value.</b> Sportsbooks post different numbers on the same game, so the same bet
          at the right book is worth real points over the season. Here&apos;s how much they actually disagree in
          college football, measured across books on {bs.games.toLocaleString()} games.
        </p>
      </section>

      <div className="ncf-cards">
        <StatCard tone="good" label="Books disagree ≥1 pt" value={`${bs.pctGap1}%`}
          sub="of games — that&apos;s how often shopping the number moves you across a full point or more." />
        <StatCard label="Average spread gap" value={`${bs.avgRange} pt`}
          sub="between the best and worst book on a typical game — small per game, real over a season of bets." />
        <StatCard tone="flat" label="Key numbers matter" value="3 & 7"
          sub="a point of shopping is worth most when it moves you onto a key number — see Sweet Spots." />
      </div>

      <NcaafSoon
        title="Live board — tap any line to shop it"
        blurb="The full game board — every FBS matchup, each book's spread, total, and moneyline, with one tap to add a pick to your slip and see the single best book for it — turns on as the odds capture fills in. The measured shopping value above is the durable part; it doesn't need the live board to be true."
        waitingOn="the NCAAF odds capture feeding the site (the historical lines are already in the model; the live board is the deploy step)."
        links={[{ href: "/ncaaf/best", label: "Sweet Spots (key numbers)" }, { href: "/ncaaf/model", label: "The Model" }]}
      />

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> For which margins to pay up for, see <a href="/ncaaf/best">Sweet Spots</a>; for
          the line-blind read, <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
