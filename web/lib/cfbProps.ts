// NCAAF player-props board — reads the CFB prop capture (cfb_prop_snapshots), best price
// per player across books, shaped as PropGame[] so it can reuse the NFL PropsView UI
// (tap-to-add chips + single best book). Server-side only (Supabase service key).
import type { PropGame, Quote, MarketBlock } from "./props";
import { PROP_LABELS, impliedPct } from "./props";
import { usBooks } from "./bookLabel";
import { etDayKey } from "./gameDays";
import { NCAAF_MODEL } from "@/app/ncaaf/model-data";

/** The ET day-keys a scheduled week covers, taken from the card's own kickoffs.
 *
 *  cfb_prop_snapshots carries no season/week column — only `commence` — so the week has to be
 *  derived from the kickoff. Returns null when the card knows nothing about that week, which the
 *  caller treats as "no props for this week" rather than "show everything". */
function weekDays(week: number): Set<string> | null {
  const card = NCAAF_MODEL.card;
  const wk = card.weeks?.find((w) => w.week === week) ?? (card.week === week ? card : null);
  if (!wk || !wk.games.length) return null;
  const days = new Set<string>();
  for (const g of wk.games) if (g.commence) days.add(etDayKey(g.commence));
  return days.size ? days : null;
}

const label = (k: string) => PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

interface Row {
  event_id: string; commence: string | null; home_team: string | null; away_team: string | null;
  book: string; market: string; player: string | null; side: string | null; line: number | null;
  price: number; snapshot_at: string;
}

async function fetchRows(): Promise<Row[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/cfb_prop_snapshots`;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  // Pin to the latest full snapshot so the board is whole and current.
  const latRes = await fetch(`${base}?select=snapshot_at&order=snapshot_at.desc&limit=1`, { headers: h, next: { revalidate: 120 } });
  if (!latRes.ok) throw new Error(`Supabase ${latRes.status}`);
  const lat = (await latRes.json()) as { snapshot_at: string }[];
  if (!lat.length) return [];
  const snap = encodeURIComponent(lat[0].snapshot_at);
  // PAGED. `limit=8000` was one request, and PostgREST caps every response at 1,000 rows without
  // saying so: the newest sweep held 7,280 rows across 45 games and 882 players, and this read
  // returned the first 1,000 — 6 games, 132 players. Derek: "One section says there's 30 games
  // today and there are about 80. We are missing players and games." The skill's single
  // highest-yield rule, and this reader had never been checked against it.
  const sel = `?snapshot_at=eq.${snap}&select=event_id,commence,home_team,away_team,book,market,player,side,line,price,snapshot_at`;
  const PAGE = 1000;
  const out: Row[] = [];
  for (let off = 0; off < 200000; off += PAGE) {
    const res = await fetch(`${base}${sel}`, {
      headers: { ...h, "Range-Unit": "items", Range: `${off}-${off + PAGE - 1}` },
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = (await res.json()) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return usBooks(out);
}

/** FanDuel's CURRENT line per `${normalised player}|${market}` on this week's slate — the number
 *  the NCAAF player board shows as the book's line. Same idea as props.ts fanduelLines: the
 *  board's market column must match the app on Derek's phone, so it is FanDuel's main line (the
 *  rung priced closest to even money), read live on the same 120s window as the chips, not the
 *  line baked into the projections file when it was last generated. */
export async function cfbFanduelLines(week?: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let rows: Row[];
  try { rows = await fetchRows(); } catch { return out; }
  if (week !== undefined) {
    const days = weekDays(week);
    if (!days) return out;
    rows = rows.filter((r) => days.has(etDayKey(r.commence)));
  }
  // Each book's MAIN line per player-market (the rung closest to even money). FanDuel's where
  // FanDuel posts one; otherwise the median of the other US books' main lines, snapped to a
  // half — FanDuel carries 24 of the 45 priced games on a Saturday, and a line the reader can
  // actually find at a US book beats the stale value baked into the projections file.
  // Anytime TD has no line: its "line" here is the book's Yes price as an implied %, FanDuel's
  // where posted, else the median of the other US books' — so the TD board's market column is a
  // price a reader can find, not the median baked into the projections file.
  const perBook = new Map<string, Map<string, { line: number; gap: number }>>();
  for (const r of rows) {
    if (!r.player) continue;
    if (r.side !== "Over" && r.side !== "Yes") continue;
    const k = `${r.player}|${r.market}`;
    const books = perBook.get(k) ?? perBook.set(k, new Map()).get(k)!;
    if (r.line === null) {
      if (r.market !== "player_anytime_td" || r.price == null || books.has(r.book)) continue;
      books.set(r.book, { line: impliedPct(r.price), gap: 0 });
      continue;
    }
    const gap = Math.abs(r.price ?? 0);
    const prev = books.get(r.book);
    if (!prev || gap < prev.gap) books.set(r.book, { line: r.line, gap });
  }
  for (const [k, books] of perBook) {
    const fd = books.get("fanduel");
    if (fd) { out.set(k, fd.line); continue; }
    const lines = [...books.values()].map((b) => b.line).sort((a, b) => a - b);
    const mid = lines.length % 2 ? lines[(lines.length - 1) / 2] : (lines[lines.length / 2 - 1] + lines[lines.length / 2]) / 2;
    out.set(k, k.endsWith("|player_anytime_td") ? Math.round(mid * 10) / 10 : Math.round(mid * 2) / 2);
  }
  return out;
}

// Better bet for the member (same player+side): lower line for Over, higher for Under, then
// better price; no line (ATTD) breaks on price. Mirrors props.isBetter.
function isBetter(a: Quote, b: Quote): boolean {
  if (a.line !== null && b.line !== null && a.line !== b.line) {
    if (a.side === "Over") return a.line < b.line;
    if (a.side === "Under") return a.line > b.line;
  }
  return a.price > b.price;
}

/** The NCAAF prop board for one week.
 *
 *  `week` is optional only for callers that genuinely want "whatever is in the latest snapshot".
 *  Prefer passing it: without a week this returns the whole snapshot, so a week-scoped page would
 *  pair week 1's prices with any week you selected — the same class of bug as the player board
 *  rendering week 1's games on every week. */
export async function cfbWeekProps(week?: number): Promise<PropGame[]> {
  let rows: Row[];
  try { rows = await fetchRows(); } catch { return []; }
  if (!rows.length) return [];
  if (week !== undefined) {
    const days = weekDays(week);
    if (!days) return [];                                  // card has no games that week
    rows = rows.filter((r) => days.has(etDayKey(r.commence)));
    if (!rows.length) return [];
  }

  // Best price per book for each (event, market, player, side, line).
  const agg = new Map<string, { r: Row; byBook: Record<string, number> }>();
  for (const r of rows) {
    if (!r.player || !r.side || !Number.isFinite(r.price)) continue;
    const k = `${r.event_id}|${r.market}|${r.player}|${r.side}|${r.line}`;
    let a = agg.get(k);
    if (!a) { a = { r, byBook: {} }; agg.set(k, a); }
    if (a.byBook[r.book] === undefined || r.price > a.byBook[r.book]) a.byBook[r.book] = r.price;
  }

  const games = new Map<string, PropGame>();
  const mmap = new Map<string, Map<string, Quote[]>>();
  for (const a of agg.values()) {
    const r = a.r;
    const entries = Object.entries(a.byBook);
    const best = Math.max(...entries.map(([, p]) => p));
    const books = entries.filter(([, p]) => p === best).map(([b]) => b).sort();
    if (!games.has(r.event_id)) {
      games.set(r.event_id, {
        eventId: r.event_id, matchup: `${r.away_team} @ ${r.home_team}`,
        home: r.home_team ?? "", away: r.away_team ?? "", commence: r.commence ?? "",
        snapshot: r.snapshot_at, markets: [],
      });
      mmap.set(r.event_id, new Map());
    }
    const mm = mmap.get(r.event_id)!;
    if (!mm.has(r.market)) mm.set(r.market, []);
    mm.get(r.market)!.push({ player: r.player!, market: r.market, side: r.side!, line: r.line, price: best, books, byBook: a.byBook, eventId: r.event_id });
  }

  const out: PropGame[] = [];
  for (const g of games.values()) {
    const mm = mmap.get(g.eventId)!;
    g.markets = [...mm.entries()].map(([market, quotes]) => {
      const bestByKey = new Map<string, Quote>();
      for (const q of quotes) {
        const key = `${q.player}|${q.side}`;
        const prev = bestByKey.get(key);
        if (!prev || isBetter(q, prev)) bestByKey.set(key, q);
      }
      const qs = [...bestByKey.values()].sort((x, y) => x.player.localeCompare(y.player) || x.side.localeCompare(y.side));
      return { market, label: label(market), quotes: qs } as MarketBlock;
    }).sort((x, y) => x.label.localeCompare(y.label));
    out.push(g);
  }
  out.sort((x, y) => (x.commence || "").localeCompare(y.commence || ""));
  return out;
}
