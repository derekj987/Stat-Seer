import { Brand, FlowSteps, ModelSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import Tip from "../../Tip";
import { DayHeader } from "../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { nhlBoard } from "@/lib/nhlBoard";
import { projectGame, type NhlGameProj } from "@/lib/nhlGame";
import { marketMargin, type PuckLine } from "@/lib/nhlBoard";
import type { Game } from "@/lib/board";
import NhlGameCard from "../NhlGameCard";

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
// the question the number can answer.
//
// 🚨 BUT THE MARKET COLUMN IS THE POSTED LINE. Not calling a side is one decision; showing a
// number no sportsbook prints is a different and worse one, and this board made it. The column
// carried `marketMargin` — the de-vigged moneyline converted to goals — which published rows like
// "NJD -0.4" under a header reading "spread". Derek: "I'm looking at the market hockey spreads and
// none should be -.4. Make the spreads match fanduel." It now shows FanDuel's posted ±1.5 and its
// price, which is where the size of a favourite actually lives. `marketMargin` survives as an
// internal input to the Upset Meter and nowhere else.
export const metadata = {
  title: "StatSeer — NHL Game Model",
  description:
    "NHL line-blind game projections — expected score, margin and total for every game, published before puck drop and graded.",
};
export const revalidate = 120;

/** Game cards shown before the "show more" control, board-wide. The NFL board's number. */
const CAP = 4;

export default async function Page() {
  let board: Game[] = [];
  let lines = new Map<string, PuckLine>();
  try {
    ({ board, lines } = await nhlBoard());
  } catch { /* odds not up yet */ }

  const rows = board
    .map((g) => ({ g, p: projectGame(g.home, g.away), mkt: marketMargin(g),
                   line: lines.get(g.eventId) ?? null }))
    .filter((r): r is { g: Game; p: NhlGameProj; mkt: number | null; line: PuckLine | null } =>
      r.p !== null);
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
            <b>What the columns are.</b> <b>Puck line</b> and <b>total</b> are the market&apos;s;
            <b> model margin</b> and <b>model total</b> are ours. The <b>bottom line</b> is the home
            side&apos;s win chance — what our margin is worth once hockey&apos;s scoring
            distribution is taken into account.<br /><br />
            <b>Reading the puck line.</b> Hockey&apos;s is &plusmn;1.5 on essentially every game, so
            the line itself tells you almost nothing and <b>the price is the information</b>: a club
            laying 1.5 at <b>+198</b> is barely a favourite, one laying it at <b>&minus;122</b> is a
            heavy one. This column shows FanDuel&apos;s posted line and price, with the market&apos;s
            own de-vigged chance that side wins by two or more underneath — that percentage is
            arithmetic on the two prices, not a projection.<br /><br />
            <b>Why our margin is not shown as a puck-line pick.</b> It would need our probability
            for that exact bet, and 43% of games finish by one goal — a line sitting right on top of
            that spike. Putting a smooth curve over it to manufacture a percentage is the kind of
            number that looks rigorous and is not, so there is no column for it. Our margin and the
            win chance are what we have measured, and they are what is published.<br /><br />
            <b>Special considerations</b> under each game are <b>context, not inputs</b>: each
            club&apos;s scoring and conceding rate with its league rank, the days of rest either
            side is carrying, and who has actually been starting in goal. None of it is in the
            projection above it.<br /><br />
            <b>How it has done.</b> Scored on 2,504 games the model never saw: the margin beats a
            no-information baseline by about 2%, the winner is called right 54% of the time, and
            <b> the total is level with simply using the league average</b>. Those are the numbers;
            they are published so the record can be read rather than described.<br /><br />
            For prices on these games see <a href="/nhl/lines">Line Shopping</a>; for the player
            read, <a href="/nhl/model/players">Player Model</a>.
          </>} />} pin={<PinButton size="sm" pin={{ id: "/nhl/model", kind: "model", label: "NHL · Game Model", detail: "line-blind", href: "/nhl/model" }} />} />
      <FlowSteps active="analyze" base="nhl" />
      <div className="subnavrow"><ModelSubnav active="game" base="nhl" /></div>

      {rows.length ? (
        <>
          {/* The NFL card layout, reused rather than re-implemented: `imptable` wrapping one
              `impgame` per game, each with its own column header and a considerations block.
              The scroller wraps the TABLE ONLY and `.imptable` never carries overflow-x itself —
              that makes every row size to the phone rather than the content, and the model columns
              then draw outside the card border (audit, content-escapes-card). */}
          <div className="imp-wrap hb-moretbl">
            <p className="imp-scrollhint" aria-hidden="true">
              Swipe for totals <span className="imp-scrollhint__a">&rarr;</span>
            </p>
            {/* Capped at CAP cards, the rest revealed in place by the checkbox — the NFL board's
                control, for the same reason. A card runs to ~500px with its considerations block
                and its meter, so a 13-game Tuesday is six screens of scrolling before anything
                else on the page. Hidden rows stay INSIDE the one table: slicing it into two would
                duplicate the day header and strand the control mid-list. `gi` counts across day
                groups so the cap is a board-wide count, not a per-day one. */}
            <input type="checkbox" id="nhl-gm-more" className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            <div className="imp-scroll">
              <div className="imptable" role="table" aria-label="NHL lines and the model's read">
                {(() => { let gi = 0; return days.map((grp) => {
                  const groupHidden = gi >= CAP;
                  return (
                  <div key={grp.key} className={groupHidden ? "hb-row--more" : undefined}>
                    <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                    {grp.items.map(({ g, p, mkt, line }) => {
                      const hidden = gi >= CAP && !groupHidden;
                      gi++;
                      return (
                        <div key={g.eventId} className={hidden ? "hb-row--more" : undefined}>
                          <NhlGameCard
                            g={{ eventId: g.eventId, home: g.home, away: g.away,
                                 commence: g.commence, total: g.total.consensus }}
                            p={p}
                            mkt={mkt}
                            line={line}
                          />
                        </div>
                      );
                    })}
                  </div>
                  );
                }); })()}
              </div>
            </div>
            {rows.length > CAP && (
              <label htmlFor="nhl-gm-more" className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">&#9656;</span>
                <span className="hb-moretbl__more">Show {rows.length - CAP} more game{rows.length - CAP === 1 ? "" : "s"}</span>
                <span className="hb-moretbl__less">Show fewer</span>
              </label>
            )}
          </div>
          <p className="lp-cardfoot">
            Puck line is <b>FanDuel&apos;s posted line and price</b> &mdash; it is &plusmn;1.5 on
            every game, so the size of a favourite is in the price, and the percentage underneath is
            the market&apos;s own de-vigged chance that side covers. The bottom line is the home
            side&apos;s win chance, which is the question our margin can answer.
          </p>
        </>
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
