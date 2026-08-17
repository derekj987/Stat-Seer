import { fetchPreseason, buildBoard } from "@/lib/board";
import { fetchPreseasonRatings } from "@/lib/preseason";
import { Brand, ShopSubnav, FlowSteps } from "../Nav";
import PreseasonView from "../PreseasonView";

export const revalidate = 120; // ISR: refresh Supabase reads every 2 min

const SEASON = 2026;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Shop Around · Preseason · exhibition lines · ${SEASON}`} />
      </header>
      <FlowSteps active="shop" />
      <ShopSubnav active="pre" />
      {children}
    </main>
  );
}

export default async function Page() {
  let board;
  try {
    board = buildBoard(await fetchPreseason(SEASON));
  } catch (e) {
    return (
      <Shell>
        <p className="foot">Couldn&apos;t load preseason odds: {e instanceof Error ? e.message : String(e)}</p>
      </Shell>
    );
  }

  const ratings = await fetchPreseasonRatings(SEASON);

  return (
    <PreseasonView
      board={board}
      ratings={ratings}
      season={SEASON}
      snapshot={board[0]?.snapshot ?? ""}
    />
  );
}
