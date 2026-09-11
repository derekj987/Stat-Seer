import { Brand, FlowSteps, ShopSubnav, WeekBadge } from "../../Nav";
import { NcaafWeekNav, NcaafWeekNote, readNcaafWeek } from "../NcaafWeek";
import { liveNcaafCard } from "../liveCard";
import PinButton from "../../PinButton";
import Tip from "@/app/Tip";
import { NCAAF_MODEL } from "../model-data";
import { StatCard } from "../StatCard";
import BoardView from "../../BoardView";
import { cfbBoard, normTeam } from "@/lib/cfbBoard";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { etToday } from "@/lib/gameDays";
import type { Game } from "@/lib/board";

// College Football — Value Finder · Line Shopping. The NFL board, same component, fed from
// cfb_odds_snapshots (every US book, every 30 minutes): moneyline, spread and total per game
// with the single best price and book, tap-to-slip, sweet-spot tags. This page carried a
// consensus table at −110 for a season while promising "per-book shopping turns on when the
// live NCAAF odds capture is deployed"; the capture exists now, so the promise is kept.
//
// WEEK SCOPE. The odds table has no week column (college has no clean one), so the board is cut
// to the selected week by matching each priced game to the card's schedule — the same name and
// kickoff matching liveCard.ts uses to lay FanDuel's line over the card. A future week shows the
// week note ("market lines to come") until books post it.
export const metadata = {
  title: "StatSeer — CFB Line Shopping",
  description: "College-football game lines — every game's moneyline, spread and total with the single best price across US books, one tap to your slip.",
};
export const revalidate = 120;

const M = NCAAF_MODEL;
const KICK_TOL_MS = 12 * 3600 * 1000;
const sameTeam = (card: string, feed: string) =>
  feed === card || feed.startsWith(card + " ") || card.startsWith(feed + " ");

/** College key numbers replace the NFL costs buildBoard stamps on a sweet-spot game. Measured
 *  on M.value.games FBS games: 3 lands 10.6% (NFL 15.0), 7 lands 8.5% (NFL 9.1). */
const CFB_KEY: Record<number, number> = Object.fromEntries(M.value.keyNumbers.map((k) => [k.margin, k.pct]));

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const bs = M.value.bookShop;
  const week = readNcaafWeek((await searchParams).week, M.card.week);
  const c = await liveNcaafCard(week);
  let all: Game[] = [], snapshot: string | null = null, err: string | null = null;
  try { ({ board: all, snapshot } = await cfbBoard()); } catch (e) { err = e instanceof Error ? e.message : String(e); }

  // Cut the sweep to this week's card, and learn each feed name's short form from the card
  // game it matched ("Louisville Cardinals" → "Louisville") so chips read like the rest of the
  // section. Unmatched priced games (an FCS matchup the card does not carry) stay off the board:
  // a game the section does not know is not one it can put a projection beside.
  const abbr: Record<string, string> = {};
  const board = all.filter((g) => {
    const t = Date.parse(g.commence);
    const hit = c.games.find((cg) =>
      sameTeam(normTeam(cg.away), normTeam(g.away)) && sameTeam(normTeam(cg.home), normTeam(g.home)) &&
      (!cg.commence || Math.abs(Date.parse(cg.commence) - t) <= KICK_TOL_MS));
    if (!hit) return false;
    // Chips get the abbreviation, keyed by BOTH spellings: the moneyline sides still carry the
    // feed's names. The card header gets the school name the rest of the section uses —
    // "Villanova @ Louisville", not "Villanova Wildcats @ Louisville Cardinals" on two lines.
    abbr[g.home] = abbr[hit.home] = abbrevTeam(hit.home);
    abbr[g.away] = abbr[hit.away] = abbrevTeam(hit.away);
    g.home = hit.home; g.away = hit.away; g.matchup = `${hit.away} @ ${hit.home}`;
    if (g.spread.key && CFB_KEY[g.spread.key.num] !== undefined) g.spread.key = { ...g.spread.key, cost: CFB_KEY[g.spread.key.num] };
    return true;
  });
  const { today, tomorrow } = etToday();

  const badge = (
    <WeekBadge week={c.week} tip={
      <Tip label="Line Shopping" text={<>
        <b>The board.</b> Every game on this week&apos;s card with a posted line: the <b>moneyline</b>,
        <b> spread</b> and <b>total</b>, each side priced at the <b>single best US book</b> for it, with the
        book named. Tap any side to drop it on your slip. Lines are captured every 30 minutes; the page
        re-reads them every two.<br /><br />
        <b>Sweet spots</b> are games whose spread sits on 3 or 7 — the margins college games land on most —
        with what the half-point is worth there. For our own line-blind read beside the market, see{" "}
        <a href="/ncaaf/model">The Model</a>.
      </>} />
    } pin={<PinButton size="sm" pin={{ id: "/ncaaf/lines", kind: "lines", label: "NCAAF · Line Shopping", detail: `Week ${week}`, href: `/ncaaf/lines?week=${week}` }} />} />
  );
  const nav = (
    <>
      <NcaafWeekNav base="/ncaaf/lines" week={week} />
      <NcaafWeekNote card={c} />
      {err && <p className="foot">Couldn&apos;t load odds: {err}</p>}
    </>
  );
  const after = (
    <section className="ncf-sec">
      <h2 className="ncf-h">Why the book matters <span className="ncf-h__note">measured across books on {bs.games.toLocaleString()} games</span></h2>
      <div className="ncf-cards">
        <StatCard tone="good" label="Books disagree ≥1 pt" value={`${bs.pctGap1}%`}
          sub="of games — that's how often shopping the number moves you across a full point or more." />
        <StatCard label="Average spread gap" value={`${bs.avgRange} pt`}
          sub="between the best and worst book on a typical game — small per game, real over a season of bets." />
        <StatCard tone="flat" label="Key numbers matter" value="3 & 7"
          sub="a point of shopping is worth most when it moves you onto a key number — see Sweet Spots." />
      </div>
    </section>
  );

  if (!board.length) {
    // Nothing priced for this week yet (a future week, or the capture has not run): the section's
    // own framing, not a bare "no odds" line.
    return (
      <main className="wrap">
        <header className="masthead">
          <Brand sub={<><span className="brand__sport">NCAAF</span> · Line Shopping</>} art={{ src: "/bag.png?v=1", alt: "Value Finder" }} />
        </header>
        {badge}
        <FlowSteps active="value" base="ncaaf" />
        <div className="subnavrow"><ShopSubnav active="lines" base="ncaaf" /></div>
        {nav}
        {!err && <p className="foot">No lines posted for Week {week} yet — books post college games 2–3 days before kickoff, and this board fills in as they do.</p>}
        {after}
      </main>
    );
  }

  return (
    <BoardView board={board} snapshot={snapshot ?? ""} today={today} tomorrow={tomorrow} sport="ncaaf"
      abbr={abbr} badge={badge} nav={nav} after={after} />
  );
}
