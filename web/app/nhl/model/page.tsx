import { Brand, FlowSteps, ModelSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import Tip from "../../Tip";
import { DayHeader } from "../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { nhlBoard } from "@/lib/nhlBoard";
import { projectGame, type NhlGameProj } from "@/lib/nhlGame";
import { marketMargin } from "@/lib/nhlBoard";
import type { Game } from "@/lib/board";

// NHL · Game Model — our line-blind expected score, margin and total for every game on the board,
// beside what the market says. The spreads-and-totals half of the section, matching the shape the
// NFL, NCAAF and MLB boards already use.
//
// 🚨 WHAT IT IS WORTH, AND THE PAGE SAYS SO. Held out on 2,504 games across two seasons the model
// never saw: margin MAE 1.7405 against a no-information baseline of 1.7768 (+2.04%), total MAE
// 1.8622 against 1.8635 (+0.07%), winner called right 54.0% with a Brier of 0.2465 against 0.2500.
// The margin carries a little and THE TOTAL CARRIES ESSENTIALLY NOTHING. Both are published
// because a line-blind number graded in public is what this section is for; neither is an edge
// claim, and nothing here has been scored against the closing line.
//
// 🚨 NO PUCK-LINE CALL, EVER. The puck line is ±1.5 on every game in the league and 43.2% of games
// finish inside one goal, so "our margin beats their spread" is the mistake the MLB run line
// already taught this project (§12d). Our margin converts to a WIN PROBABILITY instead, which is
// the question the number can answer, and the market column shows the moneyline converted to goals
// rather than a column of -1.5 repeated down the page.
export const metadata = {
  title: "StatSeer — NHL Game Model",
  description:
    "NHL line-blind game projections — expected score, margin and total for every game, published before puck drop and graded.",
};
export const revalidate = 120;

const fmt1 = (n: number) => n.toFixed(1);
const fmt2 = (n: number) => n.toFixed(2);

export default async function Page() {
  let board: Game[] = [];
  try {
    ({ board } = await nhlBoard());
  } catch { /* odds not up yet */ }

  const rows = board
    .map((g) => ({ g, p: projectGame(g.home, g.away), mkt: marketMargin(g) }))
    .filter((r): r is { g: Game; p: NhlGameProj; mkt: number | null } => r.p !== null);
  const { today, tomorrow } = etToday();
  const days = groupByGameDay(rows, (r) => r.g.commence, today, tomorrow);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NHL</span> · Game Model</>}
          art={{ src: "/scroll1.png?v=1", alt: "The Model" }}
        />
      </header>

      <DayBadge tip={<Tip label="About this board" text={<>
            <span className="tip__lead">Our own expected score for every game, built from each
              team&apos;s scoring and conceding rates and set <b>without looking at the
              market</b>.</span><br /><br />
            <b>What the columns are.</b> <b>Our score</b> is the expected goals for each side, and
            the <b>win chance</b> is what that margin is worth once hockey&apos;s scoring
            distribution is taken into account. <b>Our total</b> is the two added together. The
            market column is the moneyline expressed in goals, so there is something to compare
            against — a puck-line column would print ±1.5 down the page and say nothing.<br /><br />
            <b>How it has done.</b> Scored on 2,504 games the model never saw: the margin beats a
            no-information baseline by about 2%, the winner is called right 54% of the time, and
            <b> the total is level with simply using the league average</b>. Those are the numbers;
            they are published so the record can be read rather than described.<br /><br />
            <b>Why there is no pick on the puck line.</b> It is ±1.5 on every game in the league and
            43% of games finish inside one goal, so a margin against that number is not a
            comparison. The win chance is the question our number can answer.<br /><br />
            For prices on these games see <a href="/nhl/lines">Line Shopping</a>; for the player
            read, <a href="/nhl/model/players">Player Model</a>.
          </>} />} pin={<PinButton size="sm" pin={{ id: "/nhl/model", kind: "model", label: "NHL · Game Model", detail: "line-blind", href: "/nhl/model" }} />} />
      <FlowSteps active="analyze" base="nhl" />
      <div className="subnavrow"><ModelSubnav active="game" base="nhl" /></div>

      {rows.length ? (
        <section className="ncf-sec">
          {days.map((grp) => (
            <div className="propday" key={grp.key}>
              <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
              <div className="hb-formwrap">
                <table className="hb-form hb-form--nhlgame">
                  <thead>
                    <tr>
                      <th className="hb-l">Game</th>
                      <th>Market Spread</th>
                      <th>Market O/U</th>
                      <th>Model Spread</th>
                      <th>Model O/U</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.items.map(({ g, p, mkt }) => {
                      // Favourite-and-number, the way every other board on this site writes a
                      // spread: the favoured club then its line as a negative.
                      const spread = (m: number, abbr: [string, string]) =>
                        `${m > 0 ? abbr[0] : abbr[1]} -${Math.abs(m).toFixed(1)}`;
                      const ab: [string, string] = [p.homeAbbr, p.awayAbbr];
                      return (
                      <tr key={g.eventId}>
                        {/* Full club names on a wide screen, abbreviations on a phone. Measured at
                            375px the long names wrapped to different line counts and split the row
                            heights 67/50 — the same long/short swap the books column already uses. */}
                        <td className="hb-l">
                          <span className="hb-books__long">{g.away}<span className="at">@</span>{g.home}</span>
                          <span className="hb-books__short">{p.awayAbbr}<span className="at">@</span>{p.homeAbbr}</span>
                        </td>
                        {/* 🚨 THE MARKET SPREAD IS THE MONEYLINE IN GOALS, NOT THE PUCK LINE, and the
                            footnote says so. A puck-line column would print ±1.5 down the page and
                            carry no information — the size of a hockey favourite lives in the price,
                            exactly as the MLB board found with the run line. */}
                        <td className="hb-num">
                          {mkt === null ? <span className="bg__none">&mdash;</span> : spread(mkt, ab)}
                        </td>
                        <td className="hb-num">
                          {g.total.consensus === null
                            ? <span className="bg__none">&mdash;</span>
                            : fmt1(g.total.consensus)}
                        </td>
                        <td className="hb-num">
                          <b className="hb-model">{spread(p.margin, ab)}</b>
                          <span className="propq__slot"> {(p.homeWinPct * 100).toFixed(0)}% {p.homeAbbr}</span>
                        </td>
                        <td className="hb-num"><b className="hb-model">{fmt2(p.total)}</b></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="lp-cardfoot">
                  Market Spread is the <b>moneyline expressed in goals</b> &mdash; the puck line is
                  &plusmn;1.5 on every game, so the size of a favourite lives in the price. Under our
                  spread is the home side&apos;s win chance.
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="foot">
          No NHL games with posted lines in the next two days — the board fills as books price the
          next slate.
        </p>
      )}

      <footer className="foot">
        <p>
          <b>Line-blind and graded.</b> These numbers are set from each team&apos;s own results and
          published before puck drop. For prices, see <a href="/nhl/lines">Line Shopping</a>.
        </p>
      </footer>
    </main>
  );
}
