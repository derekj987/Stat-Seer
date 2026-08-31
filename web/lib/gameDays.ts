// Shared game-day grouping used by every board (NFL + NCAAF), so all charts read the same way:
// games are grouped by their Eastern calendar day and labeled Today / Tomorrow / <weekday, date>,
// ordered TODAY first, then upcoming (soonest first), then completed (most recent first). Compute
// the "today"/"tomorrow" keys once per render on the server with etToday() and pass them in.

export type DayTone = "today" | "upcoming" | "done" | "tbd";
export interface DayGroup<T> { key: string; tone: DayTone; label: string; items: T[] }

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const ET_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });

/** Today's and tomorrow's ET day-keys (YYYY-MM-DD). Call in a server component per render. */
export function etToday(now: number = Date.now()): { today: string; tomorrow: string } {
  return { today: ET_DAY.format(new Date(now)), tomorrow: ET_DAY.format(new Date(now + 86_400_000)) };
}

/** The ET day-key for one kickoff ISO (for callers that need to match a single game to a day). */
export const etDayKey = (iso?: string | null): string => (iso ? ET_DAY.format(new Date(iso)) : "TBD");

/** Inline flex-basis for a packed day-block (used with the `.daygrid` CSS): a small day
 *  sits beside its neighbours, a big day gets enough width for up to `cols` cards across.
 *  So consecutive light days (Thu, Fri) pack side-by-side instead of each taking a full row. */
export function dayBasis(count: number, cols = 3, card = 340, gap = 14): { flexBasis: string } {
  const n = Math.min(Math.max(count, 1), cols);
  return { flexBasis: `${n * card + (n - 1) * gap}px` };
}

export function groupByGameDay<T>(
  items: readonly T[],
  getCommence: (it: T) => string | null | undefined,
  today: string,
  tomorrow: string,
): DayGroup<T>[] {
  const by = new Map<string, T[]>();
  const sample = new Map<string, string>();   // a real kickoff per day, for the weekday/date label
  for (const it of items) {
    const iso = getCommence(it);
    const k = iso ? ET_DAY.format(new Date(iso)) : "TBD";
    (by.get(k) ?? by.set(k, []).get(k)!).push(it);
    if (iso && !sample.has(k)) sample.set(k, iso);
  }
  for (const arr of by.values()) {
    arr.sort((a, b) => (getCommence(a) || "9999").localeCompare(getCommence(b) || "9999"));
  }
  const toneOf = (k: string): DayTone => k === "TBD" ? "tbd" : k === today ? "today" : k > today ? "upcoming" : "done";
  const labelOf = (k: string) =>
    k === "TBD" ? "Date TBD"
      : k === today ? "Today"
        : k === tomorrow ? "Tomorrow"
          : ET_LABEL.format(new Date(sample.get(k)!));
  const rank: Record<DayTone, number> = { today: 0, upcoming: 1, done: 2, tbd: 3 };
  return [...by.entries()]
    .map(([key, arr]): DayGroup<T> => ({ key, tone: toneOf(key), label: labelOf(key), items: arr }))
    // Today first, then upcoming (soonest first), then completed (most recent first), then TBD.
    .sort((a, b) => rank[a.tone] - rank[b.tone] || (a.tone === "done" ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
}
