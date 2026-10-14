import { Brand, FlowSteps, ModelSubnav, DayBadge } from "../../../Nav";
import PinButton from "../../../PinButton";
import Tip from "../../../Tip";
import { NHL_MODEL_CATS, nhlCatByKey } from "../../NhlModelPanel";
import NhlPlayerBoard from "../../NhlPlayerBoard";
import { nhlPropBoard } from "@/lib/nhlProps";

// NHL · The Model. The section's home, and the first step of the flow every other sport has.
//
// 🚨 IT IS A PLAYER MODEL AND THERE IS NO GAME MODEL, WHICH IS A MEASURED DECISION RATHER THAN AN
// UNFINISHED ONE. The input a hockey game model would be built on is the starting goalie, and that
// was tested against four seasons of closing moneylines: 3,241 games, ROI +0.15% with a standard
// error of 2.60, calibration slope t = +1.81 (EMPIRICAL_REFERENCE §18d). The market has it priced.
// Publishing a game board anyway would be the "appearance of rigor" this project exists against, so
// the Model section carries the one thing that measured up — the line-blind player read.
//
// WHY THE PLAYER READ IS WORTH PUBLISHING WHEN THE GAME READ IS NOT: shots on goal persist at
// r = 0.949 across 239,197 games, more than any NFL volume metric here (§15a). That is a real,
// stable quantity. It is published as a PROBABILITY of clearing the posted line rather than as a
// projected number of shots, because a mean and a half-point line are not the same statistic —
// printed as a mean it read 58% over, as a probability it sits at 47.3% against the market's 48.8%
// (§15d).
//
// Still unproven, and the copy must not imply otherwise: none of this has been scored against the
// closing line, because NHL shots props have only been captured since 2026-10-09. It is published
// line-blind and graded, and the record will say.
export const metadata = {
  title: "StatSeer — NHL Player Model",
  description:
    "NHL line-blind player projections — shots, points, assists, goals and goalie saves, broken down by game and published before puck drop.",
};
export const revalidate = 120;

// One tab per market, the way the football player models are laid out — the sameness of that
// shape across sports is the product, even where the markets underneath are entirely different.
function CatNav({ current }: { current: string }) {
  return (
    <nav className="catnav" aria-label="Projection category">
      {NHL_MODEL_CATS.map((c) => (
        <a key={c.key} href={`/nhl/model/players?cat=${c.key}`}
          className={c.key === current ? "catnav__c active" : "catnav__c"}
          aria-current={c.key === current ? "page" : undefined}>{c.label}</a>
      ))}
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/nhl/model/players">) {
  const sp = await searchParams;
  const cat = nhlCatByKey(typeof sp.cat === "string" ? sp.cat : "shots");
  const games = await nhlPropBoard().catch(() => []);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NHL</span> · The Model</>}
          art={{ src: "/scroll1.png?v=1", alt: "The Model" }}
        />
      </header>

      <DayBadge tip={<Tip label="About this board" text={<>
            <span className="tip__lead">Our own read on tonight&apos;s players, set{" "}
              <b>without looking at the book&apos;s line</b>, published before puck drop and graded
              against what actually happens.</span><br /><br />
            <b>What the number is.</b> The headline figure is the <b>chance of clearing the posted
            line</b> — a probability, which is what compares directly to a price. The projection
            beside it is the expected count: shots on goal per game for a skater, saves per start for
            a goalie.<br /><br />
            <b>Why shots.</b> A player&apos;s shot volume is the most repeatable thing he does —
            measured across 239,197 games it carries from one half of a season to the other better
            than any comparable football number we track. Goals are shots multiplied by a shooting
            percentage, and that second part barely repeats at all, which is why the read is built on
            the volume and not on the finishing.<br /><br />
            <b>Goalies.</b> Saves are shots faced multiplied by a save percentage. The shots a goalie
            faces repeat; his save percentage does not, so the number leans on his workload and takes
            the league rate for the rest.<br /><br />
            <b>Hockey has no game board here on purpose.</b> The starting goalie is the input a
            game model would turn on, and measured across 3,241 games the market already has it in
            the closing price. We publish what measured up rather than filling the page.<br /><br />
            For prices on these same players, see <a href="/nhl/props">Player Props</a>; for game
            lines, <a href="/nhl/lines">Line Shopping</a>.
          </>} />} pin={<PinButton size="sm" pin={{ id: `/nhl/model/players?cat=${cat.key}`, kind: "model", label: `NHL · Player Model · ${cat.label}`, detail: "line-blind", href: `/nhl/model/players?cat=${cat.key}` }} />} />
      <FlowSteps active="analyze" base="nhl" />
      <div className="subnavrow"><ModelSubnav active="player" base="nhl" /></div>

      {games.length ? (
        <section className="pmcat">
          <CatNav current={cat.key} />
          {/* A card per GAME inside the category, the way the NFL and NCAAF player models read.
              The flat league-wide list this replaced was a ranking by our own projection, and the
              top of a ranking reads as the night's best plays — which is the one thing this panel
              is not. */}
          <NhlPlayerBoard games={games} cat={cat.key} />
        </section>
      ) : (
        <p className="foot">
          No NHL players priced for the next slate yet — the board fills as books post their props.
        </p>
      )}

      <footer className="foot">
        <p>
          <b>Line-blind and graded.</b> These numbers are set from each player&apos;s own history and
          published before puck drop. To shop the prices beside them, see{" "}
          <a href="/nhl/props">Player Props</a>.
        </p>
      </footer>
    </main>
  );
}
