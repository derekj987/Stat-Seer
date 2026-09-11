// MLB Sweet Spots — the baseball version of lib/bestbets.ts. Everything here is a PRICE edge we
// can prove (same bet, better number) or a measured landing frequency, never an outcome call.
//
// Football's sweet spots are 3 and 7. Baseball's are different in kind:
//   1. THE ONE-RUN GAME. 27.5% of games are decided by exactly one run (2,165 games, 2026) — and
//      WHICH team wins by one is not symmetric. A home team's wins are by exactly one run 31.6% of
//      the time; a road team's 23.5%. The walk-off: a home team that scores in the ninth or later
//      stops playing the moment it leads. So a team covers −1.5 in 68.4% of its home wins and
//      76.5% of its road wins (973 / 886 wins). CHECKED AGAINST THE MARKET, not just our data:
//      across 2,001 book-quotes with both a moneyline and a run line, the ratio the books
//      themselves price in is 0.684 for home favourites and 0.770 for road favourites — the same
//      numbers. (Conditioning on OUR favourites instead gave 0.710 / 0.787, and every game on the
//      board then read "run line pays more" — a one-sided board, which is a bug, not a signal.)
//      That pair of numbers is the whole relationship between the moneyline and the run line, so
//      every game gets a coherence read: does the run-line price agree with what the moneyline
//      implies once the one-run wins are taken out? Where it does not, by two points or more, one
//      of the two ways to back the same team is cheaper than the other.
//   2. WHOLE-NUMBER TOTALS. A total sitting on 7 pushes 11.4% of the time, on 9 9.0%, on 8 8.1% —
//      the same order of magnitude as an NFL 3. The half-run across one is worth that much.
//   3. Best prices across books, exactly as the NFL page does it (buildBets, relabelled).
import { buildBets, type Play, type KeyPlay } from "./bestbets";
import { implied, median, type OddsRow } from "./board";
import { deVig } from "./fairValue";
import { mlbOddsRows } from "./mlbBoard";
import { mlbPropBoard } from "./mlbProps";

/** Measured on 2,165 completed 2026 games (mlb_game_model.py's team log cache). */
export const MLB_KEYS = {
  games: 2165,
  margin: [ { by: 1, pct: 27.5 }, { by: 2, pct: 19.0 }, { by: 3, pct: 14.4 }, { by: 4, pct: 10.0 }, { by: 5, pct: 8.8 } ],
  /** P(the favourite covers −1.5 | the favourite wins), by where it plays. 1 − this is the share
   *  of its wins that come by exactly one run — and home teams win by one far more often, because
   *  a walk-off ends the game at a one-run lead. */
  coverGivenWin: { home: 0.684, away: 0.765 },
  /** Share of a team's WINS that are by exactly one run, home vs road. */
  oneRunWins: { home: 31.6, away: 23.5 },
  /** P(total lands exactly on n), the half-run's push value at that number. */
  total: { 5: 9.7, 6: 7.1, 7: 11.4, 8: 8.1, 9: 9.0, 10: 6.6, 11: 7.1, 12: 4.1 } as Record<number, number>,
};

export interface RunLinePlay {
  eventId: string;
  game: string;
  commence: string;
  fav: string;
  dog: string;
  ml: { price: number; books: string[]; fair: number };        // favourite's moneyline
  rl: { price: number; books: string[]; fair: number };        // favourite −1.5
  favHome: boolean;
  impliedCover: number;   // what the moneyline says the −1.5 should be worth: fair × coverGivenWin[venue]
  gap: number;            // impliedCover − rl.fair: + = the run line pays more than the moneyline implies
}

function modal(nums: number[]): number {
  const c = new Map<number, number>();
  for (const n of nums) c.set(n, (c.get(n) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function best(rows: OddsRow[]): { price: number; books: string[] } {
  const top = Math.max(...rows.map((r) => r.price_american));
  return { price: top, books: [...new Set(rows.filter((r) => r.price_american === top).map((r) => r.book))].sort() };
}

/** De-vigged fair probability of `side`, per book against `other`, median across books. */
function fairOf(side: OddsRow[], other: OddsRow[]): number | null {
  const o: Record<string, number> = {};
  for (const r of other) o[r.book] = r.price_american;
  const ps = side.filter((r) => o[r.book] != null).map((r) => deVig(r.price_american, o[r.book]));
  return ps.length ? median(ps) : null;
}

export function buildMlbBets(rows: OddsRow[]): { plays: Play[]; keys: KeyPlay[]; runLines: RunLinePlay[] } {
  const { plays } = buildBets(rows);
  // buildBets speaks football: the handicap market is a "Spread" there and a run line here.
  const relabelled = plays.map((p) => (p.market === "Spread" ? { ...p, market: "Run line" as const } : p));

  const byEvent: Record<string, OddsRow[]> = {};
  for (const r of rows) (byEvent[r.event_id] ??= []).push(r);
  const keys: KeyPlay[] = [];
  const runLines: RunLinePlay[] = [];

  for (const [eventId, rs] of Object.entries(byEvent)) {
    const home = rs[0].home_team, away = rs[0].away_team;
    const game = `${away} @ ${home}`, commence = rs[0].commence_time;
    const mk = (m: string) => rs.filter((r) => r.market === m);
    const sides = (m: string) => {
      const s: Record<string, OddsRow[]> = {};
      for (const r of mk(m)) (s[r.outcome_name] ??= []).push(r);
      return s;
    };

    // Whole-number totals: the consensus (modal) line sits on a number games actually land on.
    const tot = sides("totals");
    const pts = mk("totals").map((r) => r.outcome_point).filter((p): p is number => p !== null);
    if (pts.length) {
      const n = modal(pts);
      const cost = MLB_KEYS.total[n];
      const over = (tot["Over"] ?? []).filter((r) => r.outcome_point === n);
      const under = (tot["Under"] ?? []).filter((r) => r.outcome_point === n);
      if (cost && over.length && under.length) {
        const o = best(over), u = best(under);
        keys.push({
          eventId, game, commence, market: "Total", num: n, cost,
          sideA: { label: `Over ${n}`, price: o.price, books: o.books },
          sideB: { label: `Under ${n}`, price: u.price, books: u.books },
        });
      }
    }

    // Run line vs moneyline. The favourite is the moneyline favourite; its run line is the −1.5
    // side. Compare the de-vigged run-line price with what the de-vigged moneyline implies once
    // the one-run wins are removed.
    const ml = sides("h2h");
    const mlNames = Object.keys(ml);
    if (mlNames.length === 2) {
      const [a, b] = mlNames;
      const fa = fairOf(ml[a], ml[b]);
      if (fa !== null) {
        const fav = fa >= 0.5 ? a : b, dog = fav === a ? b : a;
        const favFair = fav === a ? fa : 1 - fa;
        const sp = sides("spreads");
        const favRl = (sp[fav] ?? []).filter((r) => r.outcome_point === -1.5);
        const dogRl = (sp[dog] ?? []).filter((r) => r.outcome_point === 1.5);
        const rlFair = favRl.length && dogRl.length ? fairOf(favRl, dogRl) : null;
        if (rlFair !== null) {
          const favHome = fav === home;
          const impliedCover = favFair * MLB_KEYS.coverGivenWin[favHome ? "home" : "away"];
          const m = best(ml[fav]), r = best(favRl);
          runLines.push({
            eventId, game, commence, fav, dog, favHome,
            ml: { ...m, fair: favFair }, rl: { ...r, fair: rlFair },
            impliedCover, gap: impliedCover - rlFair,
          });
        }
      }
    }
  }

  keys.sort((a, b) => b.cost - a.cost || a.commence.localeCompare(b.commence));
  runLines.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return { plays: relabelled, keys, runLines };
}

export async function fetchMlbBets(): Promise<{ plays: Play[]; keys: KeyPlay[]; runLines: RunLinePlay[]; snapshot: string | null }> {
  const { rows, snapshot } = await mlbOddsRows();
  return { ...buildMlbBets(rows), snapshot };
}

export interface MlbPropPlay {
  eventId: string; game: string; commence: string;
  player: string; market: string; label: string;
  price: number; books: string[]; edge: number;
}

/** The biggest prop shopping edges — best book vs the field at the same line, ≥2 books. */
export async function fetchMlbBestProps(topN = 8): Promise<MlbPropPlay[]> {
  const games = await mlbPropBoard();
  const plays: MlbPropPlay[] = [];
  for (const g of games) {
    for (const m of g.markets) {
      for (const q of m.quotes) {
        const prices = Object.values(q.byBook);
        if (prices.length < 2) continue;
        const edge = (median(prices.map(implied)) - implied(q.price)) * 100;
        if (edge <= 0.5) continue;
        plays.push({
          eventId: q.eventId, game: g.matchup, commence: g.commence,
          player: q.player, market: m.label,
          label: q.line !== null ? `${q.side} ${q.line}` : q.side,
          price: q.price, books: q.books, edge,
        });
      }
    }
  }
  plays.sort((a, b) => b.edge - a.edge);
  return plays.slice(0, topN);
}
