// Shared game-day grouping used by every board (NFL + NCAAF), so all charts read the same way:
// games are grouped by their Eastern calendar day and labeled Today / Tomorrow / <weekday, date>,
// ordered TODAY first, then upcoming (soonest first), then completed (most recent first). Compute
// the "today"/"tomorrow" keys once per render on the server with etToday() and pass them in.

export type DayTone = "today" | "upcoming" | "done" | "tbd";
/** Set when a day is split across a "show more" boundary:
 *  - `cont` marks the HIDDEN tail. The renderer must NOT draw a day header for it — the day already
 *    has one above the boundary, and drawing a second is exactly the duplicate-header bug (two
 *    "Sat, Sep 5" sections).
 *  - `total` is the day's FULL game count, carried on the VISIBLE part so its header can still say
 *    "Today 11 games" instead of counting only the 4 rows above the boundary. */
export interface DayGroup<T> { key: string; tone: DayTone; label: string; items: T[]; cont?: boolean; total?: number }

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

/** Split already-grouped days at a cap of `limit` games: whole days go to `head` while they fit,
 *  the remainder to `rest` (for a "show N more" disclosure). If the next day is too big to take
 *  whole, it is split so the board shows exactly `limit` games — the visible part keeps the day
 *  header (with the day's real `total`), the hidden tail is flagged `cont` so no SECOND header is
 *  drawn for it.
 *
 *  Always group ONCE over the FULL list and cap the groups — never `slice()` the games first and
 *  group each half. Grouping each half re-derives day headers from that half, which duplicates a day
 *  that straddles the cut ("two Sep 5 sections"), strands the collapse control in the middle of the
 *  list, and re-sorts each half independently so a completed day can appear among upcoming ones.
 *  That was one bug reported three different ways on the NCAAF model board. Splitting HERE is safe
 *  precisely because the grouping is already done: the header is rendered exactly once either way. */
export function capDayGroups<T>(groups: DayGroup<T>[], limit: number): {
  head: DayGroup<T>[]; rest: DayGroup<T>[]; restCount: number;
} {
  const head: DayGroup<T>[] = [];
  let shown = 0, i = 0;
  // Take whole days while they fit.
  for (; i < groups.length && shown + groups[i].items.length <= limit; i++) {
    head.push(groups[i]);
    shown += groups[i].items.length;
  }
  const rest = groups.slice(i);
  // Still short of the limit and the next day is too big to take whole? Split THAT day: the visible
  // part keeps the day header, the hidden tail is flagged `cont` so no second header is drawn. This
  // is what lets a board honour "show the first N" without the duplicate-header bug — the header is
  // rendered exactly once either way.
  if (shown < limit && rest.length) {
    const g = rest[0], take = limit - shown;
    if (take > 0 && take < g.items.length) {
      head.push({ ...g, items: g.items.slice(0, take), total: g.items.length });
      rest[0] = { ...g, items: g.items.slice(take), cont: true };
    }
  }
  return { head, rest, restCount: rest.reduce((n, g) => n + g.items.length, 0) };
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
