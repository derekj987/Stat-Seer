import { fetchWeek, weekRange, buildBoard, currentWeek } from "@/lib/board";
import { Brand, ShopSubnav } from "../Nav";
import BoardView from "../BoardView";
import { etToday } from "@/lib/gameDays";

export const revalidate = 120; // ISR: refresh Supabase reads every 2 min

const SEASON = 2026;

function Shell({ children, sub }: { children: React.ReactNode; sub: string }) {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={sub} />
      </header>
      <ShopSubnav active="lines" />
      {children}
    </main>
  );
}

export default async function Page({ searchParams }: PageProps<"/lines">) {
  const sp = await searchParams;

  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch (e) {
    return (
      <Shell sub="Value Finder · Game Lines">
        <p className="foot">Couldn&apos;t load odds: {e instanceof Error ? e.message : String(e)}</p>
      </Shell>
    );
  }
  if (!range) {
    return (
      <Shell sub="Value Finder · Game Lines">
        <p className="foot">No odds captured yet. Once the capture job has run, games will appear here.</p>
      </Shell>
    );
  }

  // Default to the CURRENT week (earliest with a game still to play), not `range.min`, which is
  // week 1 all season — every NFL board opened on the completed week the Tuesday after it.
  let cur: number | null = null;
  try { cur = await currentWeek(SEASON); } catch { cur = null; }
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested)
    ? Math.min(range.max, Math.max(range.min, requested))
    : (cur ?? range.min);

  const board = buildBoard(await fetchWeek(week, SEASON));
  const { today, tomorrow } = etToday();
  return (
    <BoardView
      board={board}
      min={range.min}
      max={range.max}
      week={week}
      season={SEASON}
      snapshot={board[0]?.snapshot ?? ""}
      today={today}
      tomorrow={tomorrow}
    />
  );
}
