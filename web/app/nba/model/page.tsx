import { Brand, FlowSteps, ModelSubnav, DayBadge } from "../../Nav";
import PinButton from "../../PinButton";
import Tip from "../../Tip";
import { DayHeader } from "../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { NBA_MODEL, NBA_MODEL_VALIDATION, type NbaModelGame } from "@/lib/nbaGameModel";
import { nbaBoard } from "@/lib/nbaBoard";

// NBA · The Model — our line-blind projected spread and total for every upcoming game, beside
// what the market says. Same shape as the NFL, NCAAF and MLB game boards.
//
// 🚨 NOT GRADED AGAINST THE CLOSING LINE, AND THE PAGE LEADS WITH THAT. Every other sport's model
// panel can point at a track record; this one cannot, because NBA odds capture began 2026-10-26
// and there are no closing lines for completed games yet. What IS measured is held-out accuracy
// against the actual margin — 12.08 MAE against a home-court baseline of 15.11 on 247 games the
// model never saw, a 20% improvement. That says the rating carries information. It does NOT say
// the rating carries information the market has not already priced, which is the bar this project
// requires before anything is called an edge, and which every football and hockey rating here has
// so far failed. Saying so plainly is the point of publishing line-blind in the first place.
//
// 🚨 THE MARKET COLUMN IS THE POSTED LINE, never a number derived from one. That rule cost the
// NHL board a release when it printed a de-vigged moneyline converted to goals under a header
// reading "spread" (Derek: "none should be -.4. Make the spreads match fanduel"). Here the market
// spread and total come straight from the capture, and a game the books have not priced shows a
// dash rather than our own number wearing the market's hat.
export const metadata = {
  title: "StatSeer — NBA Game Model",
  description:
    "NBA line-blind game projections — our projected spread and total for every game, published before tip-off.",
};
export const revalidate = 120;

const CAP = 4;

function fmt(n: number | null | undefined, dp = 1) {
  return n === null || n === undefined ? "—" : n.toFixed(dp);
}

export default async function Page() {
  // The market side is best-effort: the model board must render even when the odds read fails,
  // because our own projection does not depend on it. A failure shows dashes in the market
  // columns, never an empty page.
  // The odds feed writes full club names ("Atlanta Hawks"); the model writes ESPN abbreviations
  // ("ATL"). The generated rows carry BOTH, so they are the translation table — no alias list to
  // maintain, and a club the model does not know simply fails to join rather than being guessed.
  const abbrOf = new Map<string, string>();
  for (const g of NBA_MODEL) {
    abbrOf.set(g.homeName, g.home);
    abbrOf.set(g.awayName, g.away);
  }

  let market = new Map<string, { spread: string | null; total: number | null }>();
  try {
    const { board } = await nbaBoard();
    for (const g of board) {
      const s = g.spread?.home ?? null;
      const t = g.total?.consensus ?? null;
      // 🚨 THE MARKET SPREAD IS RENDERED WITH THE SAME TEAM CODE AS OURS. It first printed the
      // feed's full name beside our abbreviation — "Atlanta Hawks -2.5" against "ATL -4.7" — and
      // two codes for one club in adjacent columns is the kind of thing a reader has to stop and
      // decode before they can compare the only two numbers on the row that matter.
      const home = abbrOf.get(g.home) ?? g.home;
      market.set(`${g.away}|${g.home}`, {
        spread: s && s.point !== null ? `${home} ${s.point > 0 ? "+" : ""}${s.point}` : null,
        total: t,
      });
    }
  } catch {
    market = new Map();
  }

  const { today, tomorrow } = etToday();
  const games: NbaModelGame[] = [...NBA_MODEL].sort((a, b) => a.commence.localeCompare(b.commence));
  const groups = groupByGameDay(games, (g) => g.commence, today, tomorrow);
  let shown = 0;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">NBA</span> · The Model</>} />
      </header>

      <DayBadge
        tip={<Tip label="About this board" text={<>
          <span className="tip__lead">Our own projected spread and total for every upcoming game,
            published <b>line-blind</b> — the model never sees the betting line.</span><br /><br />
          <b>How to read it.</b> The market columns are the <b>posted</b> number at the book; ours
          sit beside them so you can see where they differ. A game the books have not priced yet
          shows a dash rather than borrowing our number.<br /><br />
          <b>What it is built on.</b> Opponent-adjusted scoring margin, with this season weighted in
          as it accumulates and home court measured from results rather than assumed.<br /><br />
          <b>Where it stands.</b> {NBA_MODEL_VALIDATION.gradedAgainstClosingLine
            ? "Graded in public against the closing line."
            : "Not graded against the closing line yet — NBA price history only began this season, and grading starts as soon as there is enough of it. Until then this is a published number you can check, not a claim about the market."}<br /><br />
          For prices, see <a href="/nba/lines">Line Shopping</a> and{" "}
          <a href="/nba/props">Player Props</a>.
        </>} />}
        pin={<PinButton size="sm" pin={{ id: "/nba/model", kind: "model", label: "NBA · The Model", detail: "spreads & totals", href: "/nba/model" }} />}
      />
      <FlowSteps active="analyze" base="nba" />
      <div className="subnavrow"><ModelSubnav active="game" base="nba" only={["game"]} /></div>

      {/* 🚨 THE UNGRADED NOTE IS NOT A DISCLAIMER TO BE TIDIED AWAY LATER. Every other sport's
          model board earns its place by pointing at a graded record; this one is published before
          it has one, which is a deliberate choice and has to be visible on the board itself rather
          than buried in the scroll. It is written to state what IS known — a real held-out result
          — not merely to hedge. */}
      {!NBA_MODEL_VALIDATION.gradedAgainstClosingLine && (
        <p className="statnote">
          <b>Not graded yet.</b> NBA price history began this season, so there is no closing line
          to grade against until enough of it accumulates — grading starts then, in public, like
          every other sport here. What is measured today: on{" "}
          <b>247</b> games the model never saw, its projected margin missed by{" "}
          <b>{fmt(NBA_MODEL_VALIDATION.marginMae, 1)}</b> points against{" "}
          <b>{fmt(NBA_MODEL_VALIDATION.marginMae + NBA_MODEL_VALIDATION.gainVsHomeCourtBaseline, 1)}</b>{" "}
          for a home-court baseline. Home court itself measured{" "}
          <b>+{fmt(NBA_MODEL_VALIDATION.homeCourt, 1)}</b> points.
        </p>
      )}

      {games.length ? (
        <div className="hb-moretbl">
          <input type="checkbox" id="nba-model-more" className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
          {groups.map((grp) => (
            <section key={grp.key} className="ncf-sec">
              <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
              <div className="hb-bl">
                <table className="hb">
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
                    {grp.items.map((g) => {
                      const mk = market.get(`${g.awayName}|${g.homeName}`);
                      const hide = shown++ >= CAP;
                      return (
                        <tr key={`${g.away}-${g.home}-${g.commence}`} className={hide ? "hb-row--more" : undefined}>
                          <td className="hb-l">{g.away} @ {g.home}</td>
                          <td className="hb-num">{mk?.spread ?? "—"}</td>
                          <td className="hb-num">{fmt(mk?.total ?? null)}</td>
                          <td className="hb-num hb-model">{g.spread}</td>
                          <td className="hb-num hb-model">{fmt(g.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {shown > CAP && (
            <label className="hb-moretbl__btn" htmlFor="nba-model-more">
              <span className="hb-moretbl__show">Show {shown - CAP} more game{shown - CAP === 1 ? "" : "s"}</span>
              <span className="hb-moretbl__hide">Show fewer</span>
            </label>
          )}
        </div>
      ) : (
        <p className="foot">
          No upcoming NBA games projected yet — the board fills as the schedule is published.
        </p>
      )}

      <footer className="foot">
        <p>
          <b>Published line-blind.</b> The model never sees the betting line. For prices, see{" "}
          <a href="/nba/lines">Line Shopping</a>.
        </p>
      </footer>
    </main>
  );
}
