// Shared day-section header for every board's game-day grouping (Today / Tomorrow / date /
// Completed). Presentational + hook-free, so it works in both server and client components.
import type { DayTone } from "@/lib/gameDays";

export function DayHeader({ label, tone, count, noun = "game" }: { label: string; tone: DayTone; count: number; noun?: string }) {
  return (
    <div className={`gday gday--${tone}`}>
      {label}
      {tone === "done" && <span className="gday__tag">Completed</span>}
      <span className="gday__n">{count} {noun}{count === 1 ? "" : "s"}</span>
    </div>
  );
}
