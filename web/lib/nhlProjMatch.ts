// Match a prop-feed player to his line-blind projection.
//
// 🚨 THE TWO SOURCES SPELL NAMES DIFFERENTLY AND NEITHER IS WRONG. The projections come from the
// NHL boxscore, which abbreviates the first name — "N. MacKinnon" — while the odds feed posts
// "Nathan MacKinnon". An exact-name join returns nothing at all, which is the kind of failure that
// renders an empty panel and looks like missing data rather than a broken key.
//
// So the join is SURNAME + FIRST INITIAL + CLUB. The club comes from lib/nhlTeamTag.ts, which
// already resolves a feed name to one of the two rosters in that game, and it is what makes a bare
// surname safe: within one club a surname is all but unique, and where it is not, the first
// initial separates them.
//
// Logic lives here rather than in lib/nhlPlayerProjections.ts, which is AUTO-GENERATED and
// rewritten on every refresh — a helper added there is wiped by the next run.
import { NHL_PROJ, NHL_OVER_TABLES, type NhlProj } from "./nhlPlayerProjections";
import { nhlTeamFor } from "./nhlTeamTag";

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** "Nathan MacKinnon" and "N. MacKinnon" both reduce to "mackinnon|n". */
export function projKey(name: string, team: string): string {
  const toks = name
    .replace(/\(.*?\)/g, " ")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[.]/g, " ").replace(/['’]/g, "").replace(/-/g, " ")
    .split(/\s+/).filter((t) => t && !SUFFIX.has(t));
  if (!toks.length) return "";
  const last = toks[toks.length - 1];
  const initial = toks[0][0] ?? "";
  return `${team}|${last}|${initial}`;
}

// Keyed by MARKET too, now that one player carries four projections.
const INDEX = (() => {
  const m = new Map<string, NhlProj>();
  for (const r of NHL_PROJ) {
    if (!r.player || !r.team) continue;
    const k = `${r.market}|${projKey(r.player, r.team)}`;
    // A collision inside one club would mean two players share a surname AND an initial. Keep the
    // first and let the second go unmatched rather than show one man's number against another's
    // name: a missing projection reads as missing, a wrong one reads as real.
    if (!m.has(k)) m.set(k, r);
  }
  return m;
})();

/** The projection for a prop-feed player in a given game, or null when he has none (a rookie with
 *  fewer than two games, a call-up, or anyone the club join cannot place). */
export type NhlMarket = "shots" | "goals" | "assists" | "points" | "saves";

export function projFor(player: string, home: string, away: string,
                        market: NhlMarket): NhlProj | null {
  const team = nhlTeamFor(player, home, away);
  if (!team) return null;
  return INDEX.get(`${market}|${projKey(player, team)}`) ?? null;
}

/** P(shots > line) for a projected per-game mean, interpolated between the empirical bands.
 *
 *  This is what the panel publishes, instead of printing our mean beside the book's half-point
 *  number. A mean and a threshold are not the same statistic — measured on the live board, that
 *  comparison made 58% of players read as overs purely because shots on goal is a right-skewed
 *  count. A probability IS comparable to the book's, which is the same reason the football boards
 *  publish anytime-TD as a percentage rather than as a number of touchdowns.
 *
 *  Linear between band midpoints and clamped at the ends; the table is monotone in the mean for
 *  every line, so interpolating it cannot produce a number that moves the wrong way. */
export function pOver(market: NhlMarket, projMean: number, line: number): number | null {
  const key = String(line);
  const band = (NHL_OVER_TABLES[market] ?? []).filter((b) => b.p[key] !== undefined);
  if (band.length < 2) return null;              // a line the table was never built for (e.g. 4.5)
  if (projMean <= band[0].mean) return band[0].p[key];
  const last = band[band.length - 1];
  if (projMean >= last.mean) return last.p[key];
  for (let i = 0; i < band.length - 1; i++) {
    const a = band[i], b = band[i + 1];
    if (projMean >= a.mean && projMean <= b.mean) {
      const t = (projMean - a.mean) / (b.mean - a.mean);
      return a.p[key] + t * (b.p[key] - a.p[key]);
    }
  }
  return null;
}
