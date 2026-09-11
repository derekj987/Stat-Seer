// MLB line shopping — the same board math as football, pointed at mlb_odds_snapshots.
//
// buildBoard() in lib/board.ts is generic over OddsRow, and mlb_odds_snapshots carries exactly
// those columns, so the best-price-per-side logic, the byBook map and the Pick Auditor de-vig are
// reused rather than reimplemented. Value Finder is arithmetic, and arithmetic does not change
// sport to sport — which is the whole reason this section is the one that works first.
//
// WHAT DOES NOT CARRY OVER, deliberately: buildBoard's key-number logic keys on football values
// (spreads of 3 and 7; totals 37-51). MLB's run line is a fixed ±1.5 and its totals live around
// 7-11, so nothing matches and `key` comes back null on every game. That is the correct outcome.
// Roughly a third of baseball games are decided by exactly one run, so a real MLB key-number
// table is a measurable thing — but it has not been measured, and inventing costs here would be
// the "appearance of rigor" this project exists against.
import { buildBoard, type Game, type OddsRow } from "@/lib/board";
import { deVig } from "@/lib/fairValue";

/** Single-game margin SD, measured over 1,859 completed 2026 games (see mlb_game_model.py). */
const MARGIN_SD = 4.63;

/** Inverse standard normal (Acklam's rational approximation, ~4.5e-4 max error) — plenty for a
 *  number rendered to one decimal place. */
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

/** The market's expected margin, in RUNS, positive = home favoured.
 *
 *  WHY THIS EXISTS. Football's consensus spread does not transfer to baseball: the MLB run line is
 *  a fixed +/-1.5 on every single game, so a "market spread" column can only ever print -1.5, +1.5
 *  or -- when books disagree about which side is favoured -- a median of 0, which is not a real
 *  line at all. Derek read a board of -1.5s as "too many favourites", and he was right that the
 *  column was saying something false; it was saying nothing.
 *
 *  In baseball the size of a favourite lives in the MONEYLINE, so that is what we read. De-vig the
 *  two prices to a fair home win probability, then convert to runs through the measured margin
 *  distribution: P(home wins) = P(margin > 0), so margin ~= SD * probit(p).
 *
 *  Approximation stated plainly: real margins are integers and can never be 0 (no ties), so a
 *  normal is not exactly right. It is close enough for a one-decimal display number and it is
 *  honest about direction and size, which -1.5 on every row was not. */
export function marketMargin(g: Game): number | null {
  const home = g.ml?.[g.home], away = g.ml?.[g.away];
  const p = home?.fairProb ?? (home && away ? deVig(home.price, away.price) : null);
  if (p == null || !isFinite(p) || p <= 0 || p >= 1) return null;
  return Math.round(MARGIN_SD * probit(p) * 10) / 10;
}

/** PostgREST read, PAGED. `limit=` does not raise the 1000-row ceiling — a response sitting
 *  exactly at the cap is indistinguishable from a complete one, and one snapshot of a 15-game
 *  slate across 8 books already runs past it. */
async function pg(path: string): Promise<OddsRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/mlb_odds_snapshots${path}`;
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
  return out;
}

/** The newest complete sweep. Every row in a capture shares one snapshot_at (that is what makes a
 *  sweep a groupable thing), so pinning to the latest gives a coherent board rather than a mix of
 *  prices taken hours apart. */
export async function latestSnapshot(): Promise<string | null> {
  const rows = await pg("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  return rows.length ? rows[0].snapshot_at : null;
}

/** The newest sweep's rows for games that have not started — the raw material for both the game
 *  board and the Sweet Spots page, so the two never disagree about which sweep they are reading. */
export async function mlbOddsRows(): Promise<{ rows: OddsRow[]; snapshot: string | null }> {
  const snapshot = await latestSnapshot();
  if (!snapshot) return { rows: [], snapshot: null };
  const rows = await pg(
    `?snapshot_at=eq.${encodeURIComponent(snapshot)}` +
    "&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,outcome_name,outcome_point,price_american",
  );
  // Games already under way are not shoppable. The capture window reaches two days out, so
  // without this the board would lead with a game in the 6th inning.
  const now = new Date().toISOString();
  return { rows: rows.filter((r) => r.commence_time > now), snapshot };
}

/** Tonight's board: one Game per matchup, best price per side across books. */
export async function mlbBoard(): Promise<{ board: Game[]; snapshot: string | null }> {
  const { rows, snapshot } = await mlbOddsRows();
  return { board: buildBoard(rows), snapshot };
}
