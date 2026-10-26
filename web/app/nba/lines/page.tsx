import { nbaBoard } from "@/lib/nbaBoard";
import BoardView from "../../BoardView";
import { Brand, ShopSubnav } from "../../Nav";
import { etToday } from "@/lib/gameDays";

// NBA · Value Finder · Line Shopping. The same component every other sport's board uses, fed from
// nba_odds_snapshots: every upcoming game's moneyline, spread and total with the best price across
// books and one tap to the slip. Basketball runs on days rather than weeks, so there is no week
// wheel — the board is the newest sweep's upcoming games, grouped by ET day.
//
// NBA arrives Value-Finder-first, which is the architecture's own order: the Value Finder is
// arithmetic and needs no model. NHL shipped the same way and its nav comment records it. There is
// no /nba/model and the flow says so plainly rather than linking a 404.
//
// 🚨 NO SWEET SPOTS TAB, AND THAT IS A MEASUREMENT, NOT AN OMISSION. The key-number panel exists
// because NFL margins land on exactly 3 in 15.0% of games and on 7 in 9.1%, which makes a
// half-point at 3 worth ~9% of win probability. Basketball margins are near-continuous — there is
// no half-point cliff to find — so buildBoard's `key` comes back null on every NBA game and the
// subnav is restricted to the two tabs that mean something here. See lib/nbaBoard.ts.
export const metadata = {
  title: "StatSeer — NBA Line Shopping",
  description: "NBA game lines — every game's moneyline, spread and total with the single best price across books, one tap to your slip.",
};
export const revalidate = 120;

export default async function Page() {
  let board: Awaited<ReturnType<typeof nbaBoard>>["board"] = [];
  let snapshot: string | null = null;
  let err: string | null = null;
  try {
    ({ board, snapshot } = await nbaBoard());
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (err) {
    return (
      <main className="wrap">
        <header className="masthead"><Brand sub={<><span className="brand__sport">NBA</span> · Line Shopping</>} /></header>
        <ShopSubnav active="lines" base="nba" only={["lines", "props"]} />
        <p className="foot">Couldn&apos;t load odds: {err}</p>
      </main>
    );
  }
  const { today, tomorrow } = etToday();
  return (
    <BoardView
      board={board} snapshot={snapshot ?? ""} today={today} tomorrow={tomorrow} sport="nba"
      emptyText="No NBA games captured for the upcoming slate yet — the board fills as books post
        lines and the capture runs."
    />
  );
}
