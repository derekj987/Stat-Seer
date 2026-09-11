import { WeekNav } from "../WeekNav";
import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "./model-data";

// NCAAF week wheel. The board now carries EVERY scheduled week (see cfb_export.py → card.weeks):
// the current slate has market lines, and future weeks show our line-blind projections with the
// market fields empty until books post them (~2-3 days before kickoff). The wheel spans the full
// regular season; picking a week swaps in that week's games.
export const NCAAF_MAX_WEEK = 16;   // FBS regular season + conference championships

/** Clamp the ?week param to the season; default to the current (posted) week. */
export function readNcaafWeek(spWeek: string | string[] | undefined, current: number): number {
  const w = typeof spWeek === "string" ? parseInt(spWeek, 10) : NaN;
  return Number.isFinite(w) ? Math.min(NCAAF_MAX_WEEK, Math.max(1, w)) : current;
}

/** A single week's board — the same shape every NCAAF page reads, for any week in the season. */
export interface NcaafWeekCard {
  season: number;
  week: number;
  preseasonSeeded: boolean;
  games: readonly NcaafCardGame[];
  upsets: readonly NcaafUpset[];
  hasLines: boolean;      // any game this week has a market line/total yet?
  isCurrent: boolean;     // the currently-posted slate (fully lined)?
}

/** Pull the card for a given week out of the full-season export. Season-level metadata
 *  (season, preseasonSeeded) always comes from the base card; games/upsets are per week. */
export function ncaafCard(week: number): NcaafWeekCard {
  const base = NCAAF_MODEL.card;
  const wk = base.weeks?.find((w) => w.week === week);
  const games: readonly NcaafCardGame[] = wk ? wk.games : (week === base.week ? base.games : []);
  const upsets: readonly NcaafUpset[] = wk ? wk.upsets : (week === base.week ? base.upsets : []);
  return {
    season: base.season,
    week,
    preseasonSeeded: base.preseasonSeeded,
    games,
    upsets,
    hasLines: games.some((g) => g.marketSpread !== null || g.marketTotal !== null),
    isCurrent: week === base.week,
  };
}

/** Honest note above a week's board: no games scheduled, or projections-up-lines-to-come. */
const asOfFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

/** "Market lines: FanDuel, as of 4:15 PM ET" — drawn whenever the card carries live lines (see
 *  liveCard.ts). A board that shows a book's number must say which book and when; the old
 *  median-across-books, refreshed four times a day, is exactly what Derek caught disagreeing
 *  with FanDuel. */
export function NcaafLinesAsOf({ card }: { card: NcaafWeekCard & { linesAsOf?: string | null; liveGames?: number } }) {
  if (!card.linesAsOf) return null;
  return (
    <p className="asof asof--inline">
      Market lines: <b>FanDuel</b>, as of <b>{asOfFmt.format(new Date(card.linesAsOf))} ET</b>
      {" "}· refreshed every 30 minutes{card.liveGames && card.liveGames < card.games.length
        ? ` · ${card.games.length - card.liveGames} game${card.games.length - card.liveGames === 1 ? "" : "s"} not yet posted` : ""}
    </p>
  );
}

export function NcaafWeekNote({ card }: { card: NcaafWeekCard }) {
  if (card.games.length === 0) {
    return (
      <p className="tgsample">
        <b>Week {card.week}.</b> No FBS matchups are on the schedule for this week yet — check
        back as the season fills in.
      </p>
    );
  }
  if (!card.hasLines) {
    return (
      <p className="tgsample">
        <b>Week {card.week} — projections up, market lines to come.</b> Sportsbooks post spreads,
        totals, and player props about <b>2–3 days before kickoff</b>. Our <b>line-blind</b> model
        read is published now; market prices, value tags, and props fill in automatically as books
        release them.
      </p>
    );
  }
  return null;
}

export function NcaafWeekNav({ base, week, params }: { base: string; week: number; params?: string }) {
  return <WeekNav min={1} max={NCAAF_MAX_WEEK} current={week} base={base} params={params} />;
}
