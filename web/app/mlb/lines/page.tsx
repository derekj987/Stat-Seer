import { mlbBoard } from "@/lib/mlbBoard";
import BoardView from "../../BoardView";
import { Brand, ShopSubnav } from "../../Nav";
import { etToday } from "@/lib/gameDays";
import { MLB_GAMES } from "@/lib/mlbGameModel";

// MLB · Value Finder · Line Shopping. The NFL board, same component, fed from mlb_odds_snapshots:
// every upcoming game's moneyline, run line and total with the best price across books and one
// tap to the slip. Baseball has days rather than weeks, so there is no week wheel — the board is
// the newest sweep's upcoming games, grouped by ET day exactly as The Model is.
export const metadata = {
  title: "StatSeer — MLB Line Shopping",
  description: "MLB game lines — every game's moneyline, run line and total with the single best price across books, one tap to your slip.",
};
export const revalidate = 120;

export default async function Page() {
  let board: Awaited<ReturnType<typeof mlbBoard>>["board"] = [];
  let snapshot: string | null = null;
  let err: string | null = null;
  try {
    ({ board, snapshot } = await mlbBoard());
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (err) {
    return (
      <main className="wrap">
        <header className="masthead"><Brand sub={<><span className="brand__sport">MLB</span> · Line Shopping</>} /></header>
        <ShopSubnav active="lines" base="mlb" />
        <p className="foot">Couldn&apos;t load odds: {err}</p>
      </main>
    );
  }
  const { today, tomorrow } = etToday();
  // Club name → abbreviation, from the model's slate (which carries both). A club not on it keeps
  // its full name rather than a guessed code.
  const abbr: Record<string, string> = {};
  for (const g of MLB_GAMES) { abbr[g.home] = g.homeAbbr; abbr[g.away] = g.awayAbbr; }
  return <BoardView board={board} snapshot={snapshot ?? ""} today={today} tomorrow={tomorrow} sport="mlb" abbr={abbr} />;
}
