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
import { buildBoard, LINE_BOOK, type Game, type OddsRow } from "@/lib/board";
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

/** 🚨 READ FROM THE RAW ROWS, NOT FROM `game.spread`. The generic board's spread sides are built by
 *  `lineSide(rows, "max")` — the LARGEST point posted for each side — and that is correct for
 *  football, where a book posts one number per side and the most points is the best version of a
 *  dog's line. Hockey breaks it, because the two sides of a ±1.5 are the same magnitude and books
 *  do not always agree on which club is laying it. Measured over 4 snapshots and 21 events:
 *
 *      distinct points one book posts for one side   1 on 21 of 21 events (no alternate lines)
 *      events where books disagree on the favourite  4 of 21  (19%)
 *      events with no FanDuel spread                 0 of 21
 *
 *  On those 4, `max` returns +1.5 for BOTH clubs — one side's +1.5 from the majority, the other's
 *  from whichever book had the game the other way round — so neither side has a negative point and
 *  the favourite cannot be identified at all. ANA/BOS came back exactly that way: FanDuel had
 *  BOS -1.5 / ANA +1.5, and the built sides were ANA +1.5 (eight books) and BOS +1.5 (betmgm
 *  alone), with FanDuel's actual Boston price discarded.
 *
 *  Since every event carries a FanDuel spread and no book posts an alternate, FanDuel's OWN PAIR is
 *  the whole answer and needs no consensus logic: the row with the negative point is the favourite,
 *  the other row is the price of the other side, and de-vigging the two gives that book's own fair
 *  cover chance. That is also literally what was asked for — "make the spreads match fanduel".
 *
 *  The fallback for an event FanDuel has not priced is the majority favourite across books at its
 *  best available price. It fires on none of the 21 and exists so a missing book is a worse number
 *  rather than an empty column. */
export function nhlPuckLines(rows: OddsRow[]): Map<string, PuckLine> {
  const byEvent = new Map<string, OddsRow[]>();
  for (const r of rows) {
    if (r.market !== "spreads" || r.outcome_point == null) continue;
    const list = byEvent.get(r.event_id);
    if (list) list.push(r); else byEvent.set(r.event_id, [r]);
  }
  const out = new Map<string, PuckLine>();
  for (const [eventId, rs] of byEvent) {
    const home = rs[0].home_team;
    const fd = rs.filter((r) => r.book === LINE_BOOK);
    let fav = fd.find((r) => r.outcome_point! < 0);
    let against = fav ? fd.find((r) => r.outcome_name !== fav!.outcome_name) : undefined;
    if (!fav) {
      // No FanDuel price. Whichever club the most books have laying the line, at the best price
      // on offer for it — the board's own shopping convention.
      const votes = new Map<string, number>();
      for (const r of rs) if (r.outcome_point! < 0)
        votes.set(r.outcome_name, (votes.get(r.outcome_name) ?? 0) + 1);
      const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) continue;
      const lay = rs.filter((r) => r.outcome_name === top[0] && r.outcome_point! < 0);
      fav = lay.reduce((best, r) => (r.price_american > best.price_american ? r : best));
      const other = rs.filter((r) => r.outcome_name !== top[0] && r.outcome_point! > 0);
      against = other.length
        ? other.reduce((best, r) => (r.price_american > best.price_american ? r : best))
        : undefined;
    }
    const fair = against ? deVig(fav.price_american, against.price_american) : null;
    out.set(eventId, {
      text: `−${Math.abs(fav.outcome_point!).toFixed(1)} ${fmtPrice(fav.price_american)}`,
      fair: fair !== null && isFinite(fair) ? fair : null,
      homeFav: fav.outcome_name === home,
      point: fav.outcome_point!,
    });
  }
  return out;
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
 *  board because it has to be read off the RAW rows — see nhlPuckLines. */
export async function nhlBoard(): Promise<{
  board: Game[]; snapshot: string | null; lines: Map<string, PuckLine>;
}> {
  const { rows, snapshot } = await nhlOddsRows();
  return { board: buildBoard(rows), snapshot, lines: nhlPuckLines(rows) };
}
