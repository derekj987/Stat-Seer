// NBA line shopping — the same board math as football, pointed at nba_odds_snapshots.
//
// buildBoard() in lib/board.ts is generic over OddsRow, and nba_odds_snapshots carries exactly
// those columns, so the best-price-per-side logic, the byBook map and the Pick Auditor de-vig are
// reused rather than reimplemented. Value Finder is arithmetic, and arithmetic does not change
// sport to sport — which is the whole reason this section is the one that works first, and why the
// NBA module ships it before any model exists.
//
// 🚨 THE NBA SPREAD IS A REAL SPREAD, SO THIS FILE IS SHORTER THAN THE BASEBALL ONE — AND THE
// DIFFERENCE MATTERS IN THE OPPOSITE DIRECTION TO WHAT YOU'D EXPECT.
//
// mlbBoard.ts carries a `marketMargin()` helper with an inverse-normal approximation in it, and
// nhlBoard.ts carries a whole favourite-detection pass. Both exist because the run line and the
// puck line are ±1.5 on every single game: the handicap market there is a second moneyline, so the
// size of a favourite has to be recovered from the price. Basketball needs none of that. The
// spread is a genuine estimate of the margin, buildBoard's spread() reads it directly, and the
// board can print it as-is.
//
// WHAT THAT TEMPTS YOU INTO, AND MUST NOT: because the number is real, it looks ready for
// football's key-number machinery. It is not.
//
//   NFL margins land on exactly 3 in 15.0% of games and on 7 in 9.1%, which is what makes a
//   half-point at 3 worth ~9% of win probability — larger than any model edge realistically
//   claimable on a game line. BASKETBALL HAS NO SUCH NUMBERS. Margins are near-continuous, so
//   there is no half-point cliff to find and no Sweet Spots page for this sport.
//
// buildBoard's `key` field keys on football values (spreads of 3 and 7; totals 37-51). NBA spreads
// run ±1 to ±20 and totals 220-240, so nothing matches and `key` comes back null on every game.
// THAT IS THE CORRECT OUTCOME, not a gap to fill. A real basketball key-number table is a
// measurable thing — the most common NBA margin is worth a few percent, not fifteen — but it has
// not been measured here, and inventing one would be the "appearance of rigor" this project exists
// against.
import { buildBoard, type Game, type OddsRow } from "@/lib/board";
import { usBooks } from "@/lib/bookLabel";

/** PostgREST read, PAGED. `limit=` does not raise the 1000-row ceiling — a response sitting
 *  exactly at the cap is indistinguishable from a complete one, and one NBA sweep already runs
 *  well past it (measured 2026-10-26: 1,026 rows from 9 games across 19 books). */
async function pg(path: string): Promise<OddsRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/nba_odds_snapshots${path}`;
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

/** The newest complete sweep. Every row in a capture shares one snapshot_at (that is what makes a
 *  sweep a groupable thing), so pinning to the latest gives a coherent board rather than a mix of
 *  prices taken hours apart. */
export async function latestSnapshot(): Promise<string | null> {
  const rows = await pg("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  return rows.length ? rows[0].snapshot_at : null;
}

/** The newest sweep's rows for games that have not tipped off. */
export async function nbaOddsRows(): Promise<{ rows: OddsRow[]; snapshot: string | null }> {
  const snapshot = await latestSnapshot();
  if (!snapshot) return { rows: [], snapshot: null };
  const rows = await pg(
    `?snapshot_at=eq.${encodeURIComponent(snapshot)}` +
    "&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,outcome_name,outcome_point,price_american",
  );
  // Games already under way are not shoppable, and Derek's standing rule is that StatSeer never
  // offers a live or in-play number — every market figure on the site is PREGAME. The capture
  // window reaches two days out, so without this the board would lead with a game at halftime.
  const now = new Date().toISOString();
  return { rows: rows.filter((r) => r.commence_time > now), snapshot };
}

/** Tonight's board: one Game per matchup, best price per side across books. */
export async function nbaBoard(): Promise<{ board: Game[]; snapshot: string | null }> {
  const { rows, snapshot } = await nbaOddsRows();
  return { board: buildBoard(rows), snapshot };
}
