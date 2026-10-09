import { nhlBoard } from "@/lib/nhlBoard";
import BoardView from "../../BoardView";
import { Brand, ShopSubnav } from "../../Nav";
import { etToday } from "@/lib/gameDays";

// NHL · Value Finder · Line Shopping. The same board component the NFL, NCAAF and MLB pages use,
// fed from nhl_odds_snapshots: every upcoming game's moneyline, puck line and total with the best
// price across books and one tap to the slip.
//
// This is the first NHL surface on purpose. Value Finder is arithmetic — no model, no season of
// history, no validation — which is exactly why the architecture puts it first.
//
// NOTE THE SHAPE: this returns BoardView BARE, exactly as the MLB page does, because BoardView
// supplies its own masthead, flow steps and Value Finder subnav. Wrapping it in another
// <main className="wrap"> with a second <ShopSubnav> renders the whole nav twice — which is what
// the first version of this page did, and it is only visible by looking at the page.
export const metadata = {
  title: "StatSeer — NHL Line Shopping",
  description:
    "NHL game lines — every game's moneyline, puck line and total with the single best price across books, one tap to your slip.",
};
export const revalidate = 120;

export default async function Page() {
  let board: Awaited<ReturnType<typeof nhlBoard>>["board"] = [];
  let snapshot: string | null = null;
  let err: string | null = null;
  try {
    ({ board, snapshot } = await nhlBoard());
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  if (err) {
    return (
      <main className="wrap">
        <header className="masthead">
          <Brand sub={<><span className="brand__sport">NHL</span> · Line Shopping</>} />
        </header>
        <ShopSubnav active="lines" base="nhl" only={["lines", "props"]} />
        <p className="foot">Couldn&apos;t load odds: {err}</p>
      </main>
    );
  }

  const { today, tomorrow } = etToday();
  return (
    <BoardView
      board={board}
      snapshot={snapshot ?? ""}
      today={today}
      tomorrow={tomorrow}
      sport="nhl"
      // An empty board is a normal state between slates, not a failure: the NHL plays most nights
      // but not every night, and the capture window reaches two days out. Say which it is.
      emptyText="No NHL games with posted lines in the next two days — the board fills as books price the next slate."
    />
  );
}
