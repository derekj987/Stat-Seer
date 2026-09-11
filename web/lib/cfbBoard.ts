// NCAAF game lines, live — the newest sweep of cfb_odds_snapshots.
//
// Two readers over one fetch:
//   cfbBoard()       every upcoming game with the best price per side across US books, in the
//                    NFL/MLB Game shape (buildBoard), for the Value Finder.
//   cfbMarketLines() FanDuel's CURRENT spread and total per game, keyed so the exported card's
//                    games can be matched by name — the number the college boards show as
//                    "market". Falls back to the best available book's line only when FanDuel has
//                    not posted one, and says which it was.
//
// WHY. The card's market columns were a median across every book, rebuilt four times a day.
// Derek reads the board beside FanDuel: a median is nobody's number and a six-hour-old one is not
// the current line. Same rule as the NFL player board ("Book line now FanDuel's and live").
//
// Same IO discipline as every capture reader: one-row probe for the newest snapshot_at, then an
// exact `eq.` read of that sweep. Never a scan of the table.
import { buildBoard, type Game, type OddsRow } from "@/lib/board";
import { usBooks } from "@/lib/bookLabel";

const BOOK = "fanduel";

async function pg(path: string): Promise<OddsRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/cfb_odds_snapshots${path}`;
  const PAGE = 1000;
  const out: OddsRow[] = [];
  for (let off = 0; off < 200000; off += PAGE) {
    const res = await fetch(base, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Range-Unit": "items", Range: `${off}-${off + PAGE - 1}` },
      next: { revalidate: 120 },
    });
    // 404 = the table has not been created yet (ingest/cfb_odds_snapshots.sql). Not an error
    // for the page: it renders the card's own numbers until the capture exists.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as OddsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  // The snapshot probe selects only snapshot_at; a row without a book is not a quote to filter.
  return out.length && out[0].book === undefined ? out : usBooks(out);
}

export async function cfbOddsRows(): Promise<{ rows: OddsRow[]; snapshot: string | null }> {
  const probe = await pg("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  if (!probe.length) return { rows: [], snapshot: null };
  const snapshot = probe[0].snapshot_at;
  const rows = await pg(
    `?snapshot_at=eq.${encodeURIComponent(snapshot)}` +
    "&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,outcome_name,outcome_point,price_american",
  );
  const now = new Date().toISOString();
  return { rows: rows.filter((r) => r.commence_time > now), snapshot };
}

export async function cfbBoard(): Promise<{ board: Game[]; snapshot: string | null }> {
  const { rows, snapshot } = await cfbOddsRows();
  return { board: buildBoard(rows), snapshot };
}

/** Normalise a team name for cross-source matching — the port of cfb_export._norm. The feed
 *  says "Louisville Cardinals", the card says "Louisville"; accents and apostrophes are stripped
 *  rather than split ("San José State" → "san jose state", "Hawai'i" → "hawaii"). */
export const normTeam = (s: string): string =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// The same aliases cfb_export carries, both directions.
const ALIAS: Record<string, string> = {
  "massachusetts": "umass", "umass": "massachusetts",
  "nc state": "north carolina state", "north carolina state": "nc state",
  "ole miss": "mississippi", "southern mississippi": "southern miss", "southern miss": "southern mississippi",
  "louisiana monroe": "ul monroe", "sam houston": "sam houston state",
  "app state": "appalachian state",
};
const sameTeam = (card: string, feed: string): boolean => {
  if (feed === card || feed.startsWith(card + " ") || card.startsWith(feed + " ")) return true;
  const alt = ALIAS[card];
  return !!alt && (feed === alt || feed.startsWith(alt + " "));
};

export interface MarketLine {
  homeSpread: number | null;   // the HOME team's point at FanDuel (negative = home favoured)
  total: number | null;
  book: string;                // "fanduel", or the book the fallback came from
  awayN: string; homeN: string; commence: string;
}

/** FanDuel's current spread and total for every upcoming game in the newest sweep. */
export async function cfbMarketLines(): Promise<{ lines: MarketLine[]; snapshot: string | null }> {
  let rows: OddsRow[], snapshot: string | null;
  try { ({ rows, snapshot } = await cfbOddsRows()); } catch { return { lines: [], snapshot: null }; }
  return { lines: marketLinesFrom(rows), snapshot };
}

/** Pure: one sweep's rows → one MarketLine per event. Separate from the fetch so it can be tested
 *  against a saved sweep without a database. */
export function marketLinesFrom(rows: OddsRow[]): MarketLine[] {
  const byEvent = new Map<string, OddsRow[]>();
  for (const r of rows) (byEvent.get(r.event_id) ?? byEvent.set(r.event_id, []).get(r.event_id)!).push(r);
  const lines: MarketLine[] = [];
  for (const rs of byEvent.values()) {
    const home = rs[0].home_team, away = rs[0].away_team;
    const at = (book: string) => rs.filter((r) => r.book === book);
    const pick = (book: string) => {
      const b = at(book);
      const hs = b.find((r) => r.market === "spreads" && r.outcome_name === home)?.outcome_point ?? null;
      const tot = b.find((r) => r.market === "totals" && r.outcome_name === "Over")?.outcome_point ?? null;
      return { hs, tot };
    };
    let book = BOOK;
    let { hs, tot } = pick(BOOK);
    if (hs === null && tot === null) {
      // FanDuel has not posted this game: take the first US book that has, and say so.
      const other = [...new Set(rs.map((r) => r.book))].find((b) => { const p = pick(b); return p.hs !== null || p.tot !== null; });
      if (!other) continue;
      book = other; ({ hs, tot } = pick(other));
    }
    lines.push({ homeSpread: hs, total: tot, book, awayN: normTeam(away), homeN: normTeam(home),
                 commence: rs[0].commence_time });
  }
  return lines;
}

/** The live line for a card game, matched by normalised names (shortest match wins, as in
 *  cfb_export.match_odds) and, when the card knows its kickoff, a kickoff within 12 hours.
 *  Not the same ET day: CFBD stamps a TBD kickoff 23:59 ET, and Hawai'i's Saturday night game
 *  sat at 11:59pm ET on the card against 12:00am ET on the feed — one minute, different day. */
const KICK_TOL_MS = 12 * 3600 * 1000;
export function matchMarketLine(away: string, home: string, commence: string | undefined, lines: MarketLine[]): MarketLine | null {
  const a = normTeam(away), h = normTeam(home);
  const t = commence ? Date.parse(commence) : NaN;
  const near = (l: MarketLine) => Number.isNaN(t) || Math.abs(Date.parse(l.commence) - t) <= KICK_TOL_MS;
  const cands = lines.filter((l) => sameTeam(a, l.awayN) && sameTeam(h, l.homeN) && near(l));
  if (!cands.length) return null;
  return cands.reduce((best, l) => (l.awayN.length + l.homeN.length < best.awayN.length + best.homeN.length ? l : best));
}
