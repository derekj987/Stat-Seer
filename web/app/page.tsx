import { fetchWeek, weekRange, buildBoard } from "@/lib/board";
import BoardView from "./BoardView";

export const revalidate = 120; // ISR: refresh Supabase reads every 2 min

const SEASON = 2026;

function Shell({ children, sub }: { children: React.ReactNode; sub: string }) {
  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">VALUE&nbsp;FINDER</span>
          <span className="brand__sub">{sub}</span>
        </div>
      </header>
      {children}
    </main>
  );
}

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;

  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch (e) {
    return (
      <Shell sub="Line shopping & sweet spots">
        <p className="foot">Couldn&apos;t load odds: {e instanceof Error ? e.message : String(e)}</p>
      </Shell>
    );
  }
  if (!range) {
    return (
      <Shell sub="Line shopping & sweet spots">
        <p className="foot">No odds captured yet. Once the capture job has run, games will appear here.</p>
      </Shell>
    );
  }

  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested)
    ? Math.min(range.max, Math.max(range.min, requested))
    : range.min;

  const board = buildBoard(await fetchWeek(week, SEASON));
  return (
    <BoardView
      board={board}
      min={range.min}
      max={range.max}
      week={week}
      season={SEASON}
      snapshot={board[0]?.snapshot ?? ""}
    />
  );
}
