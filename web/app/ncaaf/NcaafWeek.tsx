import { WeekNav } from "../WeekNav";

// NCAAF week wheel. College data is published a week at a time (the board overwrites to the
// current week), so this is UI parity with the NFL side: the wheel shows the full regular
// season with the current week active, and an honest note explains that only the current
// week is posted. When per-week college storage lands, this becomes fully functional.
export const NCAAF_MAX_WEEK = 16;   // FBS regular season + conference championships

/** Clamp the ?week param to the season; default to the current (posted) week. */
export function readNcaafWeek(spWeek: string | string[] | undefined, current: number): number {
  const w = typeof spWeek === "string" ? parseInt(spWeek, 10) : NaN;
  return Number.isFinite(w) ? Math.min(NCAAF_MAX_WEEK, Math.max(1, w)) : current;
}

export function NcaafWeekNav({ base, week, params }: { base: string; week: number; params?: string }) {
  return <WeekNav min={1} max={NCAAF_MAX_WEEK} current={week} base={base} params={params} />;
}

/** Shown when a member scrolls to a week that isn't the currently-posted one. */
export function NcaafOffWeek({ current, week }: { current: number; week: number }) {
  if (week === current) return null;
  return (
    <p className="tgsample">
      <b>Week {week}.</b> College boards post one week at a time — Week {week}{" "}
      {week < current ? "isn't archived" : "isn't up yet"}. Showing the current{" "}
      <b>Week {current}</b> below.
    </p>
  );
}
