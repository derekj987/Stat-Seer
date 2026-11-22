// Player-prop legs for Parlay of the Week — Derek: "Make one for player TDs and other player props."
//
// The game ticket picks legs by our published win probability. Props have no such number: projLean
// returns a DIRECTION (over/under), not a probability. So the selector here is the one published
// number a prop actually carries — **how often that player has cleared that exact line**, the
// cOver/cG rate already printed on the props board.
//
// Two things that look like details and are not:
//
// 🚨 THE RATE ONLY DESCRIBES THE LINE IT WAS COMPUTED AGAINST. A player clearing 4.5 receptions in
//    70% of his games says nothing about 6.5. So an Over/Under leg is dropped unless the book's
//    line equals the line behind the rate. Without that check the card would print a real number
//    against the wrong question, which is worse than printing none.
//
// 🚨 ANYTIME TOUCHDOWN CANNOT BE DE-VIGGED. Measured on the live week 11 sweep: 4,737 "Yes" rows
//    against 93 "No". With one side quoted there is no pair to strip the vig from, so marketProb
//    is null on TD legs and the card prints no market column for them — the same finding the NHL
//    anytime-goal market already forced. Do not substitute the raw implied probability and label
//    it fair; it is the price WITH the vig in it.
//
// ONE LEG PER GAME, always. Two props from the same game are not two independent legs — the same
// script drives both, and the card's combined number multiplies as if they were independent. The
// best-rated leg per game wins and the rest are dropped before the search sees them.
import { impliedProb } from "./fairValue";
import type { PropGame } from "./props";
import { PLAYER_PROJECTIONS, type PlayerProj } from "./playerProjections";
import type { ParlayLeg } from "./parlayOfWeek";

/** props market key -> the key the projections file uses. They genuinely differ
 *  (player_reception_yds vs rec_yds), so this cannot be a prefix strip. */
const PROJ_MARKET: Record<string, string> = {
  player_anytime_td: "anytime_td",
  player_reception_yds: "rec_yds",
  player_receptions: "receptions",
  player_rush_yds: "rush_yds",
  player_pass_yds: "pass_yds",
  player_pass_tds: "pass_tds",
};

export const TD_MARKETS = ["player_anytime_td"];
export const SKILL_MARKETS = [
  "player_reception_yds", "player_receptions", "player_rush_yds",
  "player_pass_yds", "player_pass_tds",
];

/** Games behind a rate before it may carry a ticket. projLean's MIN_PROJ_GAMES is 5, which is fine
 *  for a direction arrow; a number multiplied into a published parlay price wants more behind it. */
const MIN_GAMES = 15;

/** 🚨 HOW FAR OUR RATE MAY SIT FROM THE PRICE BEFORE THE LEG IS DROPPED, and it is the load-
 *  bearing line in this file. A career hit rate is an ADVERSE SELECTOR on its own, because the
 *  rate is high exactly when the line has fallen:
 *
 *    first build, live week 11 -- "Alvin Kamara O6.5 Rush Yds, we rate 96.5% (141 g), mkt 49.3%",
 *    on a ticket footing "we rate 82.7% - market 11.0%".
 *
 *  Nothing was miscomputed. He really did clear 6.5 rushing yards in 96.5% of 141 career games.
 *  The market prices THIS week at a coin flip because his role now is not the role those 141
 *  games were played in, and ranking by the historical rate hunts for precisely that gap -- the
 *  players whose number collapsed. It is the same trap the game ticket's marketProb note
 *  describes: "most confident by our number" and "most overconfident versus the market" are close
 *  to the same list.
 *
 *  So a leg survives only where the history and the current price broadly AGREE. That is the
 *  subset where the rate is corroborated rather than contradicted, and it is also what keeps the
 *  card's combined figure anywhere near the market's. */
const MAX_GAP = 0.15;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

const projIndex = (() => {
  const m = new Map<string, PlayerProj>();
  for (const p of PLAYER_PROJECTIONS) m.set(`${norm(p.player)}|${p.market}`, p);
  return m;
})();

const SHORT: Record<string, string> = {
  player_anytime_td: "Anytime TD",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
  player_rush_yds: "Rush Yds",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
};

/** Best-rated prop leg per game, across the markets asked for. Pregame only — every market number
 *  on StatSeer is a pregame price. */
export function propLegs(games: PropGame[], markets: string[], now = new Date()): ParlayLeg[] {
  const bestPerGame = new Map<string, ParlayLeg>();

  for (const g of games) {
    if (Date.parse(g.commence) <= now.getTime()) continue;
    for (const block of g.markets) {
      if (!markets.includes(block.market)) continue;
      const pm = PROJ_MARKET[block.market];
      if (!pm) continue;

      for (const q of block.quotes) {
        const proj = projIndex.get(`${norm(q.player)}|${pm}`);
        if (!proj || !proj.cG || proj.cG < MIN_GAMES) continue;

        const isYes = q.side === "Yes";
        const isOver = q.side === "Over";
        if (!isYes && !isOver && q.side !== "Under") continue;
        // The rate describes proj.book. A different line is a different question.
        if (!isYes && proj.book !== q.line) continue;

        const rate = proj.cOver / proj.cG;
        const ourProb = q.side === "Under" ? 1 - rate : rate;
        if (!Number.isFinite(ourProb) || ourProb <= 0 || ourProb >= 1) continue;
        if (!q.byBook || !Object.keys(q.byBook).length) continue;

        const best = Math.max(...Object.values(q.byBook));
        // The agreement guard. Anytime TD cannot be de-vigged, so it is checked against the
        // price's own implied probability instead — that still carries the vig, which makes the
        // comparison conservative in the right direction (implied sits ABOVE fair, so a rate
        // that clears this test against implied would clear it against fair too).
        const ref = q.fairProb ?? impliedProb(best);
        if (!Number.isFinite(ref) || Math.abs(ourProb - ref) > MAX_GAP) continue;
        const lineTxt = q.line == null ? "" : ` ${q.side === "Under" ? "U" : "O"}${q.line}`;
        const leg: ParlayLeg = {
          eventId: g.eventId,
          matchup: g.matchup,
          home: g.home,
          away: g.away,
          pick: `${q.player}${lineTxt}`,
          market: SHORT[block.market] ?? block.market,
          ourProb,
          sample: proj.cG,
          marketProb: q.fairProb ?? null,
          price: best,
          books: Object.entries(q.byBook).filter(([, v]) => v === best).map(([b]) => b),
          byBook: q.byBook,
          marketKey: block.market,
          player: q.player,
          side: q.side,
          line: q.line ?? null,
          commence: g.commence,
        };
        const held = bestPerGame.get(g.eventId);
        if (!held || leg.ourProb > held.ourProb) bestPerGame.set(g.eventId, leg);
      }
    }
  }
  return [...bestPerGame.values()];
}
