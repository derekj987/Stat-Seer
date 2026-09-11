import { ncaafCard, type NcaafWeekCard } from "./NcaafWeek";
import type { NcaafCardGame } from "./model-data";
import { cfbMarketLines, matchMarketLine } from "@/lib/cfbBoard";
import { marginHome } from "./lean";

// The exported card with LIVE market lines laid over it.
//
// The card is rebuilt four times a day and its market columns are a median across books at that
// moment. Derek, reading beside FanDuel: "the market spread and market over/unders do not match
// the current lines on FanDuel. How come this is not auto updating as the lines change?" This
// replaces each game's marketSpread / marketTotal with FanDuel's current number from the newest
// capture sweep (every 30 minutes; pages revalidate every 120s), and re-derives the three fields
// the export computes FROM the market line so they cannot disagree with it:
//   off        — our favourite is not the market's
//   pick       — which side our projected margin covers at this line
//   totalLean  — our total vs the market's, when 2+ points apart
// Everything line-blind (projSpread, projTotal, ratings) is untouched.
//
// Falls back to the card's own numbers game by game when the capture has no line for a game, and
// entirely when the table does not exist yet — so nothing on the page depends on the capture
// having run.

export interface LiveWeekCard extends NcaafWeekCard {
  linesAsOf: string | null;   // newest sweep's snapshot_at, null when the card's own lines are showing
  liveGames: number;          // how many games carry a live line
}

function overlay(g: NcaafCardGame, homeSpread: number | null, total: number | null): NcaafCardGame {
  const out: NcaafCardGame = { ...g };
  if (homeSpread !== null) {
    const fav = homeSpread <= 0 ? g.home : g.away;
    const line = Math.abs(homeSpread);
    out.marketSpread = { fav, num: -line };
    out.off = fav !== g.projSpread.fav;
    const margin = marginHome(g.projSpread, g.home);          // our projected HOME margin
    if (margin !== null) {
      const favIsHome = homeSpread <= 0;
      const favMargin = favIsHome ? margin : -margin;
      out.pick = favMargin >= line
        ? { side: fav, num: Math.round(-line * 10) / 10 }
        : { side: favIsHome ? g.away : g.home, num: Math.round(line * 10) / 10 };
    }
  }
  if (total !== null) {
    out.marketTotal = total;
    out.totalLean = Math.abs(g.projTotal - total) >= 2
      ? { dir: g.projTotal > total ? "OVER" : "UNDER", num: total }
      : null;
  }
  return out;
}

export async function liveNcaafCard(week: number): Promise<LiveWeekCard> {
  const base = ncaafCard(week);
  const { lines, snapshot } = await cfbMarketLines();
  if (!lines.length) return { ...base, linesAsOf: null, liveGames: 0 };
  let liveGames = 0;
  const games = base.games.map((g) => {
    const m = matchMarketLine(g.away, g.home, g.commence, lines);
    if (!m) return g;
    liveGames++;
    return overlay(g, m.homeSpread, m.total);
  });
  return {
    ...base, games,
    hasLines: games.some((g) => g.marketSpread !== null || g.marketTotal !== null),
    linesAsOf: liveGames ? snapshot : null, liveGames,
  };
}
