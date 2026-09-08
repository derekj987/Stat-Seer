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

/** Tonight's board: one Game per matchup, best price per side across books. */
export async function mlbBoard(): Promise<{ board: Game[]; snapshot: string | null }> {
  const snapshot = await latestSnapshot();
  if (!snapshot) return { board: [], snapshot: null };
  const rows = await pg(
    `?snapshot_at=eq.${encodeURIComponent(snapshot)}` +
    "&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,outcome_name,outcome_point,price_american",
  );
  // Games already under way are not shoppable. The capture window reaches two days out, so
  // without this the board would lead with a game in the 6th inning.
  const now = new Date().toISOString();
  const upcoming = rows.filter((r) => r.commence_time > now);
  return { board: buildBoard(upcoming), snapshot };
}
