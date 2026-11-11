// NHL line shopping — the same board math as football and baseball, pointed at nhl_odds_snapshots.
//
// buildBoard() in lib/board.ts is generic over OddsRow and nhl_odds_snapshots carries exactly those
// columns, so best-price-per-side, the byBook map and the Pick Auditor de-vig are reused rather
// than reimplemented. Value Finder is arithmetic, and arithmetic does not change sport to sport —
// which is why this section works before any model exists.
//
// WHAT SHOPPING IS ACTUALLY WORTH HERE, measured on one live sweep (18 games, 19 books, 144 legs)
// so the page can say something true rather than something encouraging:
//
//     market        legs   median gain   p90     max      (implied-probability points saved by
//     moneyline       36      0.92%     1.53%   2.14%      taking the best book instead of the
//     puck line       38      1.32%     2.47%   3.19%      median one)
//     total           50      0.97%     1.68%   2.83%
//
// Against a median two-way vig of 4.62%, shopping recovers roughly a quarter of the house edge on
// essentially every bet. By contrast, quotes that BEAT the de-vigged consensus — a genuinely
// mispriced number — turned up on 7 of 1,048 book quotes (1%), worth a median 0.30%, and clustered
// in reduced-juice books. So the honest pitch is shopping, not mispricing, and the copy says so.
//
// WHAT DOES NOT CARRY OVER: buildBoard's key-number logic keys on football values (spreads of 3
// and 7, totals 37-51), so `key` comes back null on every NHL game. That is correct — and unlike
// baseball, hockey's key number HAS now been measured (see KEY_ONE_GOAL below), so if a real table
// is ever wanted the number exists.
import { bestPrice, buildBoard, LINE_BOOK, pairFair, type Game, type Line, type OddsRow } from "@/lib/board";
import { deVig } from "@/lib/fairValue";
import { usBooks } from "@/lib/bookLabel";

/** Single-game goal-margin SD, measured over all 1,312 completed 2025-26 regular-season games
 *  (NHL public API, club-schedule-season across all 32 clubs, deduped by game id).
 *  Home margin averaged +0.130 with SD 2.569, and the home side won 52.2% of the time. */
const MARGIN_SD = 2.569;

/** 🚨 HOCKEY'S KEY NUMBER IS ONE GOAL, and it is enormous: 43.2% of those 1,312 games finished
 *  with a one-goal margin, against 17.5% at two and 23.1% at three.
 *
 *  Two things follow, and both matter for anything built on this table.
 *
 *  First, THE PUCK LINE IS A PROBABILITY, NOT A MARGIN. It is ±1.5 on every game (confirmed: 284
 *  of 284 rows on a live sweep), and it sits directly on top of that 43.2% spike, so it is decided
 *  almost entirely by whether the game is a one-goal game. Comparing it to a projected margin is
 *  the mistake the MLB board made with the run line (EMPIRICAL_REFERENCE §12d).
 *
 *  Second, the spike is structural, not a quirk of one season. There are no ties, and 24.8% of
 *  games (OT 207 + SO 119) are decided past regulation where the winning margin can ONLY be one.
 *  That floor is built into the rules and will be there every year.
 *
 *  The 2-versus-3 inversion is the empty net: a team protecting a two-goal lead pulls its goalie,
 *  so late goals convert two into three rather than the other way round. */
const KEY_ONE_GOAL = 0.432;

/** Inverse standard normal (Acklam's rational approximation, ~4.5e-4 max error) — plenty for a
 *  number rendered to one decimal place. Same implementation as lib/mlbBoard.ts. */
function probit(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
             138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
             66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const fmtPrice = (p: number) => (p > 0 ? `+${p}` : `−${Math.abs(p)}`);

/** The posted puck line, exactly as a sportsbook shows it: the favourite laying 1.5, with the
 *  price. FanDuel's price where FanDuel posts one — the book Derek reads beside this board — else
 *  the best available, which the board's shopping logic has already picked. `fair` is the market's
 *  own de-vigged chance that THAT side covers (Pick Auditor arithmetic, averaged across books).
 *
 *  🚨 THIS IS THE THIRD TIME THIS PROJECT HAS LEARNED THE SAME THING, so it is written down here
 *  rather than in a page comment. A column headed "spread" must show WHAT THE BOOK POSTS. Derek,
 *  on the NHL cards: "I'm looking at the market hockey spreads and none should be -.4. Make the
 *  spreads match fanduel." He said the same thing about the MLB run line ("they would never be
 *  listed as -.9 or -.6 in a sports book"), and both times the number on the page was
 *  `marketMargin` below — a moneyline converted to goals.
 *
 *  THE OBJECTION THAT PUT IT THERE WAS REAL BUT ANSWERED WRONG. A bare ±1.5 column does print one
 *  number down the page: a live sweep is 497 rows at -1.5, 497 at +1.5 and 6 at ±2.5. But the
 *  information was never missing — it is in THE PRICE beside the line. A club laying 1.5 at +198
 *  is a coin-flip favourite; one laying it at -122 is a heavy one. Deriving a margin from the
 *  moneyline threw away the number the book actually posts in order to recover, approximately,
 *  something the price already said exactly.
 *
 *  So this is the market column, and `marketMargin` is demoted to what it is honestly good for:
 *  an internal signed magnitude for the Upset Meter's model-vs-market driver, never a displayed
 *  "spread". */
export type PuckLine = { text: string; fair: number | null; homeFav: boolean; point: number };

/** 🚨 READ FROM THE RAW ROWS, NOT FROM `game.spread` — which club is laying the line cannot be
 *  recovered from the built board's points, for the reason set out on `puckFavourite` below. The
 *  favourite comes from there; the price shown beside it is FanDuel's own, and `fair` de-vigs
 *  FanDuel's two prices against each other to that book's own cover chance. */
export function nhlPuckLines(rows: OddsRow[]): Map<string, PuckLine> {
  const out = new Map<string, PuckLine>();
  for (const [eventId, rs] of spreadsByEvent(rows)) {
    const anchor = puckFavourite(rs);
    if (!anchor) continue;
    const home = rs[0].home_team;
    // FanDuel's own two prices where FanDuel priced it — "make the spreads match fanduel". Where it
    // did not, the best price on offer for each side of the anchored number, which is the board's
    // shopping convention and the only other defensible answer.
    const pool = anchor.fromLineBook ? rs.filter((r) => r.book === LINE_BOOK) : rs;
    const fav = shortlist(pool, anchor.fav, anchor.point)
      .reduce<OddsRow | null>((b, r) => (b && b.price_american >= r.price_american ? b : r), null);
    if (!fav) continue;
    const against = shortlist(pool, otherSide(rs, anchor.fav), -anchor.point)
      .reduce<OddsRow | null>((b, r) => (b && b.price_american >= r.price_american ? b : r), null);
    const fair = against ? deVig(fav.price_american, against.price_american) : null;
    out.set(eventId, {
      text: `−${Math.abs(anchor.point).toFixed(1)} ${fmtPrice(fav.price_american)}`,
      fair: fair !== null && isFinite(fair) ? fair : null,
      homeFav: anchor.fav === home,
      point: anchor.point,
    });
  }
  return out;
}

/** 🚨 THE PUCK LINE'S TWO SIDES, REBUILT — because `lineSide(rows, "max")` in lib/board.ts CANNOT
 *  build them, and the generic board must not be changed to try.
 *
 *  In football "max" is the shopping convention and it is right: a book posts one number per side,
 *  books genuinely differ (-2.5 at one, -3 at another), and the most points IS the best version of
 *  a dog's line. Hockey breaks the assumption underneath it — that the point identifies the side.
 *  Both sides of a puck line are magnitude 1.5, and on 4 of 21 measured events the books do not
 *  agree on WHICH club is laying it, so "max" returns +1.5 for BOTH clubs: the majority's dog, and
 *  the minority book's dog, which is the other club. The card then offers two dog sides that cannot
 *  both exist, and the favourite's price — the +210 a reader came for — never appears at all.
 *
 *  Observed live on the 2026-10-16T11:21:35Z sweep, BOS @ ANA:
 *
 *      rendered   ANA +1.5 −250 Hard Rock  |  BOS +1.5 −275 BetMGM     (two dogs, no favourite)
 *      posted     BOS −1.5 +210 FanDuel    |  ANA +1.5 −280 FanDuel
 *      shopped    BOS −1.5 +225 (3 books)  |  ANA +1.5 −250 Hard Rock
 *
 *  So fix the SIDE ASSIGNMENT first (puckFavourite, which is FanDuel's own pair), then shop within
 *  it: the best price among rows that have the favourite at its negative number, and the best among
 *  rows that have the dog at the mirror. A book holding the game the other way round contributes to
 *  NEITHER side — it is not a better price on this bet, it is a different bet — which also keeps it
 *  out of the de-vig, where pairing a favourite's price against another book's favourite price
 *  would read as a 25% hold.
 *
 *  `consensus` is re-signed from the same anchor. buildBoard sets it from FanDuel's home row, which
 *  agrees with this whenever FanDuel priced the game; on the fallback path its median across books
 *  can land on 0.0 (the median of −1.5 and +1.5), which is not a line any book posts. */
export function nhlSpreadSides(board: Game[], rows: OddsRow[]): void {
  const byEvent = spreadsByEvent(rows);
  for (const g of board) {
    const rs = byEvent.get(g.eventId);
    const anchor = rs ? puckFavourite(rs) : null;
    // No spread rows, no favourite, or an outcome name that matches neither club: show nothing.
    // Every failure here is a side assignment, and a missing market is a better answer than a
    // confident wrong one.
    if (!rs || !anchor || (anchor.fav !== g.home && anchor.fav !== g.away)) {
      g.spread.home = null; g.spread.away = null; continue;
    }
    const homeFav = anchor.fav === g.home;
    const fav = lineAt(rs, anchor.fav, anchor.point);
    const dog = lineAt(rs, homeFav ? g.away : g.home, -anchor.point);
    g.spread.home = homeFav ? fav : dog;
    g.spread.away = homeFav ? dog : fav;
    g.spread.consensus = homeFav ? anchor.point : -anchor.point;
    pairFair(g.spread.home, g.spread.away);
  }
}

/** The spread rows of a snapshot grouped by event. A row with no point is not a puck line. */
function spreadsByEvent(rows: OddsRow[]): Map<string, OddsRow[]> {
  const byEvent = new Map<string, OddsRow[]>();
  for (const r of rows) {
    if (r.market !== "spreads" || r.outcome_point == null) continue;
    const list = byEvent.get(r.event_id);
    if (list) list.push(r); else byEvent.set(r.event_id, [r]);
  }
  return byEvent;
}

const shortlist = (rs: OddsRow[], name: string | null, point: number) =>
  name === null ? [] : rs.filter((r) => r.outcome_name === name && r.outcome_point === point);

/** The club that is not `fav`, named as the feed names it. */
const otherSide = (rs: OddsRow[], fav: string): string | null =>
  rs.find((r) => r.outcome_name !== fav)?.outcome_name ?? null;

/** One side of one number, shopped across books — board.ts's own best-price logic, pointed at rows
 *  this file has picked rather than at a max over points. */
function lineAt(rs: OddsRow[], name: string, point: number): Line | null {
  const at = shortlist(rs, name, point);
  if (!at.length) return null;
  return { point, ...bestPrice(at) };
}

/** WHICH CLUB IS LAYING THE LINE, AND ON WHAT NUMBER. Every NHL handicap number on the site comes
 *  from this one decision — the market column, both shopping sides, the slip legs the assistant
 *  offers — which is why it is one function and not a rule repeated per page. Measured over 4
 *  snapshots and 21 events in nhl_odds_snapshots:
 *
 *      distinct points one book posts for one side   1 on 21 of 21 events (no alternate lines)
 *      events where books disagree on the favourite  4 of 21  (19%)
 *      events with no FanDuel spread                 0 of 21
 *
 *  Those three numbers are the whole design. Because no book posts an alternate, there is exactly
 *  one number per side per book and nothing to shop for on the NUMBER. Because every event carries
 *  a FanDuel spread, FanDuel's own pair answers it outright and no consensus logic is needed: the
 *  row with the negative point is the favourite, on the number FanDuel posts — which is also
 *  literally what was asked for, "make the spreads match fanduel". And because a fifth of events
 *  have books on opposite sides, the question has to be ASKED rather than inferred from the points.
 *
 *  The fallback for an event FanDuel has not priced is the club the most books have laying it, on
 *  the number most of those books post. It fires on none of the 21 and exists so that a missing
 *  book degrades to a worse price rather than to an empty column — or, worse, to a minority book's
 *  dog being published as the favourite. */
type PuckFav = { fav: string; point: number; fromLineBook: boolean };
function puckFavourite(rs: OddsRow[]): PuckFav | null {
  const fd = rs.find((r) => r.book === LINE_BOOK && r.outcome_point! < 0);
  if (fd) return { fav: fd.outcome_name, point: fd.outcome_point!, fromLineBook: true };
  // votes: club → number → how many books post that club laying that number.
  const votes = new Map<string, Map<number, number>>();
  for (const r of rs) {
    if (r.outcome_point! >= 0) continue;
    const pts = votes.get(r.outcome_name) ?? new Map<number, number>();
    pts.set(r.outcome_point!, (pts.get(r.outcome_point!) ?? 0) + 1);
    votes.set(r.outcome_name, pts);
  }
  let best: PuckFav | null = null;
  let bestN = 0;
  for (const [fav, pts] of votes) {
    const n = [...pts.values()].reduce((a, b) => a + b, 0);
    if (n <= bestN) continue;
    bestN = n;
    // Most-posted number for that club; a tie goes to the smaller handicap, the one a favourite
    // would rather lay.
    const [point] = [...pts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    best = { fav, point, fromLineBook: false };
  }
  return best;
}

/** The market's expected margin, in GOALS, positive = home favoured. INTERNAL — see the warning on
 *  `puckLine` above: this is not a column, because it is not a number any book posts.
 *
 *  It is still the right input for the Upset Meter, which needs a signed magnitude of how big a
 *  favourite the market has made and cannot read that off a line that is ±1.5 either way. De-vig
 *  the two moneyline prices to a fair home win probability, then convert through the measured
 *  margin distribution: P(home wins) = P(margin > 0), so margin ≈ SD * probit(p).
 *
 *  THE APPROXIMATION IS WEAK, and that is survivable for a meter driver and was not survivable for
 *  a market column. A normal is a poor fit to a distribution with 43% of its mass on |1| and a
 *  hole at 0. The DIRECTION and the ORDERING of favourites are reliable; the decimal is "about a
 *  goal and a half" and was never a projection. */
export function marketMargin(g: Game): number | null {
  const home = g.ml?.[g.home], away = g.ml?.[g.away];
  const p = home?.fairProb ?? (home && away ? deVig(home.price, away.price) : null);
  if (p == null || !isFinite(p) || p <= 0 || p >= 1) return null;
  return Math.round(MARGIN_SD * probit(p) * 10) / 10;
}

/** Share of NHL games decided by exactly one goal — exported so a page can cite it rather than
 *  restate it, and so there is one number to change if it is ever re-measured. */
export const ONE_GOAL_SHARE = KEY_ONE_GOAL;

/** PostgREST read, PAGED. `limit=` does not raise the 1000-row ceiling — a response sitting exactly
 *  at the cap is indistinguishable from a complete one, and one sweep of a 15-game slate across 19
 *  books runs well past it (a live sweep was 1,568 rows). */
async function pg(path: string): Promise<OddsRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/nhl_odds_snapshots${path}`;
  const PAGE = 1000;
  const out: OddsRow[] = [];
  for (let off = 0; off < 200000; off += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Range-Unit": "items", Range: `${off}-${off + PAGE - 1}`,
      },
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as OddsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  // The snapshot probe selects only snapshot_at; a row without a book is not a quote to filter.
  return out.length && out[0].book === undefined ? out : usBooks(out);
}

/** The newest complete sweep. Every row in a capture shares one snapshot_at — that is what makes a
 *  sweep a groupable thing, and it is why nhl_props.py was fixed to stamp once per run rather than
 *  once per event. Pinning to the latest gives a coherent board rather than prices taken hours
 *  apart. */
export async function latestSnapshot(): Promise<string | null> {
  const rows = await pg("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  return rows.length ? rows[0].snapshot_at : null;
}

/** The newest sweep's rows for games that have not started. */
export async function nhlOddsRows(): Promise<{ rows: OddsRow[]; snapshot: string | null }> {
  const snapshot = await latestSnapshot();
  if (!snapshot) return { rows: [], snapshot: null };
  const rows = await pg(
    `?snapshot_at=eq.${encodeURIComponent(snapshot)}` +
    "&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,outcome_name,outcome_point,price_american",
  );
  // Games already under way are not shoppable, and the capture window reaches two days out, so
  // without this the board would lead with a game in the second period.
  const now = new Date().toISOString();
  return { rows: rows.filter((r) => r.commence_time > now), snapshot };
}

/** Tonight's board: one Game per matchup, best price per side across books, plus the posted puck
 *  line per event keyed by event id. `lines` is returned from here rather than derived from the
 *  board because it has to be read off the RAW rows — see nhlPuckLines.
 *
 *  🚨 EVERY NHL READER GOES THROUGH HERE, which is why the puck line's sides are repaired here
 *  rather than in each page. `buildBoard` is generic and its football side-assignment is wrong for
 *  hockey (nhlSpreadSides says why); fixing it at this one seam means /nhl/lines and the assistant's
 *  NHL menu — the two surfaces that read `game.spread` — cannot drift apart or be forgotten. */
export async function nhlBoard(): Promise<{
  board: Game[]; snapshot: string | null; lines: Map<string, PuckLine>;
}> {
  const { rows, snapshot } = await nhlOddsRows();
  const board = buildBoard(rows);
  nhlSpreadSides(board, rows);
  return { board, snapshot, lines: nhlPuckLines(rows) };
}
