import { Brand, FlowSteps, ShopSubnav, WeekBadge } from "../../Nav";
import { NcaafWeekNav, NcaafOffWeek, readNcaafWeek } from "../NcaafWeek";
import PinButton from "../../PinButton";
import Tip from "@/app/Tip";
import { NCAAF_MODEL } from "../model-data";
import { StatCard } from "../StatCard";
import NcaafLinesTable from "./NcaafLinesTable";
import { etToday } from "@/lib/gameDays";

// College Football — Value Finder · Game Lines. Mirrors the NFL board: every game with
// the market's spread + total beside our line-blind read. NCAAF has a consensus snapshot
// (not yet per-book), so multi-book best-price shopping is the one piece still arriving;
// the durable book-disagreement measurement is shown below.
export const metadata = {
  title: "StatSeer — CFB Game Lines",
  description: "College-football game lines — every game's spread and total beside our model's read, plus how much sportsbooks disagree.",
};

const M = NCAAF_MODEL;

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const bs = M.value.bookShop;
  const c = M.card;
  const week = readNcaafWeek((await searchParams).week, c.week);
  const games = c.games.filter((g) => g.marketSpread)  // only games with a market line
    .sort((a, b) => (a.commence || "9999").localeCompare(b.commence || "9999")); // soonest kickoff first
  const total = c.games.length;                        // full slate (incl. games w/o odds yet)
  const noLine = total - games.length;                 // games still waiting on a posted line

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Line Shopping</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <WeekBadge week={c.week} tip={
        <Tip label="Line Shopping" text={<>
          <b>The board.</b> Every game with the market&apos;s <b>spread</b> and <b>total</b>, beside our
          line-blind read of which side it covers. The market number is a consensus snapshot; the per-book
          best-price shopping turns on as the live NCAAF odds capture feeds the site.
        </>} />
      } />
      <FlowSteps active="value" base="ncaaf" />
      <div className="subnavrow"><ShopSubnav active="lines" base="ncaaf" /></div>
      <NcaafWeekNav base="/ncaaf/lines" week={week} />
      <div className="pinrow"><PinButton pin={{ id: "/ncaaf/lines", kind: "lines", label: "NCAAF · Line Shopping", detail: `Week ${week}`, href: `/ncaaf/lines?week=${week}` }} /></div>
      <NcaafOffWeek current={c.week} week={week} />

      <section className="ncf-sec">
        <h2 className="ncf-h">Game lines — Week {c.week}
          <span className="ncf-h__note">{games.length} of {total} games have a market line{noLine > 0 ? ` · ${noLine} awaiting odds` : ""}</span>
          <Tip text={<>Every game with the market&apos;s <b>Spread</b> and <b>O/U</b> beside <b>Our Projection</b> — our own line-blind spread &amp; total. A ◆ marks an <b>off-consensus</b> game (our number is well off the market&apos;s). Our CFB rating predicts on par with the best public systems — published <b>line-blind</b> as informative context.</>} />
        </h2>
        <div className="hb-legend">
          <span className="hb-dia">◆</span> Off-consensus — our projected line is well off the market&apos;s.
          <span className="hb-x"> · <b>Tap any spread or total</b> to drop it on your Value Finder slip.
            <b> Our Projection</b> is our line-blind spread &amp; total, shown to compare against
            the market — published <b>line-blind</b> as context (see <a href="/ncaaf/model">The Model</a>).</span>
          {c.preseasonSeeded && (
            <span className="hb-x"> · <b>Preseason note:</b> with no {c.season} games played yet, these projections are
              seeded with published preseason ratings (SP+) blended with our own carryover; our in-season rating takes
              over as games are played.</span>
          )}
        </div>
        <NcaafLinesTable games={games} {...etToday()} />
        <p className="ncf-note">
          Consensus lines at −110 — <b>tap a side to add it to your slip</b>. Per-book best-price shopping (each
          book&apos;s number + the single best price per game, like <a href="/lines">the NFL board</a>) turns on when the
          live NCAAF odds capture is deployed.
        </p>
      </section>

      <section className="ncf-sec">
        <h2 className="ncf-h">Why the book matters <span className="ncf-h__note">measured across books on {bs.games.toLocaleString()} games</span></h2>
        <div className="ncf-cards">
          <StatCard tone="good" label="Books disagree ≥1 pt" value={`${bs.pctGap1}%`}
            sub="of games — that&apos;s how often shopping the number moves you across a full point or more." />
          <StatCard label="Average spread gap" value={`${bs.avgRange} pt`}
            sub="between the best and worst book on a typical game — small per game, real over a season of bets." />
          <StatCard tone="flat" label="Key numbers matter" value="3 & 7"
            sub="a point of shopping is worth most when it moves you onto a key number — see Sweet Spots." />
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> For which margins to pay up for, see <a href="/ncaaf/best">Sweet Spots</a>; for
          the line-blind read and its honest record, <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
