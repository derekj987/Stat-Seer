// Slip-assistant data + math (server-only — reads odds via the service key). Builds a
// "menu" of real, priced candidate bets (game spreads/totals + player props) that both the
// deterministic menu builder and the Claude text builder pick from. Nothing is fabricated:
// every leg is a real market with real best-price odds; the model's TD% is attached to
// anytime-TD legs for "highest-% scorer" requests.
import { fetchWeek, buildBoard } from "./board";
import { weekProps } from "./props";
import { PLAYER_PROJECTIONS } from "./playerProjections";
import { toDecimal, decToAmerican } from "./slipPricing";
import { NCAAF_MODEL } from "@/app/ncaaf/model-data";

export type Sport = "nfl" | "ncaaf";

export type CandGroup = "spread" | "total" | "moneyline" | "td" | "passing" | "rushing" | "receiving";

export interface Candidate {
  id: string;
  kind: "line" | "prop";
  group: CandGroup;
  market: string;                // fine-grained: "spread","total","player_pass_yds",…
  title: string;                 // "BUF -2.5", "Over 48.5", "Josh Allen Anytime TD"
  detail: string;                // matchup / context
  price: number;                 // best american price across books
  books: string[];
  byBook: Record<string, number>;
  model?: number;                // model signal for ranking (TD legs: model TD %)
  off?: boolean;                 // game line the model reads as OFF-CONSENSUS (◆ on the board)
}

const fmtPt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);

// model TD % by player, from the line-blind projections.
function tdModelMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of PLAYER_PROJECTIONS) {
    if (r.market === "anytime_td") m.set(normName(r.player), r.proj);
  }
  return m;
}

const PROP_CAT: Record<string, CandGroup> = {
  player_anytime_td: "td",
  player_pass_yds: "passing", player_pass_tds: "passing",
  player_rush_yds: "rushing", player_rush_attempts: "rushing",
  player_reception_yds: "receiving", player_receptions: "receiving",
};
const PROP_LABEL: Record<string, string> = {
  player_pass_yds: "Pass Yds", player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds", player_rush_attempts: "Rush Att",
  player_reception_yds: "Rec Yds", player_receptions: "Receptions",
};

export async function buildCandidates(week: number, season = 2026): Promise<Candidate[]> {
  const out: Candidate[] = [];

  // ---- Game lines: both spread sides + total over/under, best price each ----
  try {
    const board = buildBoard(await fetchWeek(week, season));
    for (const g of board) {
      const mk = `${g.away} @ ${g.home}`;
      const push = (id: string, group: CandGroup, market: string, title: string, l: { point: number | null; price: number; books: string[]; byBook: Record<string, number> } | null) => {
        if (l && l.point !== null && Number.isFinite(l.price)) {
          out.push({ id, kind: "line", group, market, title: title.replace("{pt}", fmtPt(l.point)), detail: mk, price: l.price, books: l.books, byBook: l.byBook });
        }
      };
      push(`sp-${g.eventId}-h`, "spread", "spread", `${g.home} {pt}`, g.spread.home);
      push(`sp-${g.eventId}-a`, "spread", "spread", `${g.away} {pt}`, g.spread.away);
      push(`tot-${g.eventId}-o`, "total", "total", `${mk}: Over {pt}`, g.total.over);
      push(`tot-${g.eventId}-u`, "total", "total", `${mk}: Under {pt}`, g.total.under);
      // Moneylines — needed to reach long parlay targets (underdogs can be +150…+600).
      for (const [team, ml] of Object.entries(g.ml)) {
        if (ml && Number.isFinite(ml.price)) {
          out.push({ id: `ml-${g.eventId}-${slug(team)}`, kind: "line", group: "moneyline", market: "moneyline", title: `${team} ML`, detail: mk, price: ml.price, books: ml.books, byBook: ml.byBook });
        }
      }
    }
  } catch { /* odds not up */ }

  // ---- Player props: anytime-TD (with model %) + core yardage/reception overs ----
  try {
    const games = await weekProps(week, season);
    const td = tdModelMap();
    for (const pg of games) {
      const mk = `${pg.away} @ ${pg.home}`;
      for (const mb of pg.markets) {
        const group = PROP_CAT[mb.market];
        if (!group) continue;
        const isTd = mb.market === "player_anytime_td";
        // Cap each market to keep the candidate list bounded; TD keeps more (ranking pool).
        for (const q of mb.quotes.slice(0, isTd ? 24 : 8)) {
          if (!Number.isFinite(q.price)) continue;
          if (!isTd && q.side !== "Over") continue; // only the over side for yardage/receptions
          const title = isTd
            ? `${q.player} Anytime TD`
            : `${q.player} o${q.line} ${PROP_LABEL[mb.market] ?? mb.market}`;
          out.push({
            id: `pr-${slug(q.player)}-${mb.market}-${q.side}`,
            kind: "prop", group, market: mb.market, title, detail: mk,
            price: q.price, books: q.books, byBook: q.byBook,
            ...(isTd && td.has(normName(q.player)) ? { model: td.get(normName(q.player)) } : {}),
          });
        }
      }
    }
  } catch { /* props not up */ }

  return out;
}

// ================================================================================
// NCAAF candidates. Game lines come from the /ncaaf card's CONSENSUS spread/total
// (no per-book NCAAF game odds are captured, so those legs price at the standard -110
// with no best-book shopping). Player props come from cfb_prop_snapshots (real per-book
// prices, best across books) — the same table the CFB prop capture writes. There is no
// NCAAF anytime-TD model %, so "highest-% scorer" gracefully ranks by price instead.
// ================================================================================
interface CfbPropRow {
  event_id: string; commence: string | null; home_team: string | null; away_team: string | null;
  book: string; market: string; player: string | null; side: string | null; line: number | null; price: number;
}

async function cfbLatestProps(): Promise<CfbPropRow[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/cfb_prop_snapshots`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const latRes = await fetch(`${base}?select=snapshot_at&order=snapshot_at.desc&limit=1`, { headers, next: { revalidate: 120 } });
  if (!latRes.ok) throw new Error(`Supabase ${latRes.status}`);
  const lat = (await latRes.json()) as { snapshot_at: string }[];
  if (!lat.length) return [];
  const snap = encodeURIComponent(lat[0].snapshot_at);
  const res = await fetch(
    `${base}?snapshot_at=eq.${snap}&select=event_id,commence,home_team,away_team,book,market,player,side,line,price&limit=5000`,
    { headers, next: { revalidate: 120 } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return (await res.json()) as CfbPropRow[];
}

export async function buildCandidatesNcaaf(): Promise<Candidate[]> {
  const out: Candidate[] = [];

  // ---- Game lines from the card's consensus spread/total (priced at -110) ----
  for (const g of NCAAF_MODEL.card.games) {
    const mk = `${g.away} @ ${g.home}`;
    const gk = `${slug(g.away)}-${slug(g.home)}`;
    if (g.marketSpread) {
      const { fav, num } = g.marketSpread;                 // num is the favorite's line (negative)
      const dog = fav === g.home ? g.away : g.home;
      out.push({ id: `ncsp-${gk}-f`, kind: "line", group: "spread", market: "spread", title: `${fav} ${fmtPt(num)}`, detail: mk, price: -110, books: [], byBook: {}, off: g.off });
      out.push({ id: `ncsp-${gk}-d`, kind: "line", group: "spread", market: "spread", title: `${dog} ${fmtPt(-num)}`, detail: mk, price: -110, books: [], byBook: {}, off: g.off });
    }
    if (g.marketTotal != null) {
      out.push({ id: `nctot-${gk}-o`, kind: "line", group: "total", market: "total", title: `${mk}: Over ${g.marketTotal}`, detail: mk, price: -110, books: [], byBook: {} });
      out.push({ id: `nctot-${gk}-u`, kind: "line", group: "total", market: "total", title: `${mk}: Under ${g.marketTotal}`, detail: mk, price: -110, books: [], byBook: {} });
    }
  }

  // ---- Player props from cfb_prop_snapshots (best price across books) ----
  try {
    const rows = await cfbLatestProps();
    // Best price per book for each (event, market, player, side, line).
    const agg = new Map<string, { r: CfbPropRow; byBook: Record<string, number> }>();
    for (const r of rows) {
      if (!r.player || !r.side || !Number.isFinite(r.price)) continue;
      const k = `${r.event_id}|${r.market}|${r.player}|${r.side}|${r.line}`;
      let a = agg.get(k);
      if (!a) { a = { r, byBook: {} }; agg.set(k, a); }
      if (a.byBook[r.book] === undefined || r.price > a.byBook[r.book]) a.byBook[r.book] = r.price;
    }
    // One candidate per player+market (the bettor's side): TD "Yes", yardage/receptions "Over".
    // Keep the best-priced line per player for a market, then cap the pool per market.
    const bestByKey = new Map<string, { r: CfbPropRow; byBook: Record<string, number>; best: number }>();
    for (const a of agg.values()) {
      const group = PROP_CAT[a.r.market];
      if (!group) continue;
      const isTd = a.r.market === "player_anytime_td";
      if (isTd ? a.r.side !== "Yes" : a.r.side !== "Over") continue;
      const best = Math.max(...Object.values(a.byBook));
      const pk = `${a.r.market}|${normName(a.r.player!)}`;
      const prev = bestByKey.get(pk);
      // For TD the longer price is the "better bet" the member wants shopped; for yardage
      // prefer the lower line, then better price — same idea as props.collapseBest.
      const better = !prev || (isTd ? best > prev.best
        : (a.r.line ?? 1e9) < (prev.r.line ?? 1e9) || ((a.r.line ?? 1e9) === (prev.r.line ?? 1e9) && best > prev.best));
      if (better) bestByKey.set(pk, { r: a.r, byBook: a.byBook, best });
    }
    const perMarket = new Map<string, number>();
    for (const { r, byBook, best } of [...bestByKey.values()].sort((x, y) => y.best - x.best)) {
      const isTd = r.market === "player_anytime_td";
      const n = perMarket.get(r.market) ?? 0;
      if (n >= (isTd ? 30 : 12)) continue;
      perMarket.set(r.market, n + 1);
      const books = Object.entries(byBook).filter(([, p]) => p === best).map(([b]) => b).sort();
      const mk = `${r.away_team} @ ${r.home_team}`;
      const title = isTd ? `${r.player} Anytime TD` : `${r.player} o${r.line} ${PROP_LABEL[r.market] ?? r.market}`;
      out.push({ id: `ncpr-${slug(r.player!)}-${r.market}`, kind: "prop", group: PROP_CAT[r.market], market: r.market, title, detail: mk, price: best, books, byBook });
    }
  } catch { /* props not up yet */ }

  return out;
}

// ---- odds math over a set of chosen candidates ----
export function combinedDecimal(legs: Candidate[]): number {
  return legs.reduce((acc, l) => acc * toDecimal(l.price), 1);
}
export function combinedAmerican(legs: Candidate[]): string {
  return legs.length ? decToAmerican(combinedDecimal(legs)) : "—";
}

// ---- deterministic MENU builder ----
export interface MenuOpts {
  markets: string[];        // which markets to draw from ("spread","total","player_pass_yds",…)
  legs: number;             // how many legs
  targetOdds?: number | null; // american target for the whole parlay (e.g. 1500), or null
  rankByModel?: boolean;    // TD: prefer highest model %
}

export function buildMenuSlip(cands: Candidate[], opts: MenuOpts): Candidate[] {
  const pool = cands.filter((c) => opts.markets.includes(c.market));
  const n = Math.max(1, Math.min(opts.legs, 8));
  // one leg per game/player so we don't stack correlated legs from the same matchup
  const seen = new Set<string>();
  const key = (c: Candidate) => (c.kind === "line" ? c.detail : c.title.split(" ").slice(0, 2).join(" "));

  // Target-odds: adaptive greedy. After each pick, recompute the per-leg decimal STILL
  // needed to hit the target and take the closest available — so it reaches for longer
  // legs when it's behind, instead of averaging toward the short middle.
  if (!opts.rankByModel && opts.targetOdds && opts.targetOdds > 0) {
    const targetDec = toDecimal(opts.targetOdds);
    const picked: Candidate[] = [];
    let running = 1;
    for (let i = 0; i < n; i++) {
      const need = Math.pow(Math.max(1.001, targetDec / running), 1 / (n - i));
      const options = pool.filter((c) => !seen.has(key(c)));
      if (!options.length) break;
      options.sort((a, b) => Math.abs(toDecimal(a.price) - need) - Math.abs(toDecimal(b.price) - need));
      const chosen = options[0];
      picked.push(chosen); seen.add(key(chosen)); running *= toDecimal(chosen.price);
    }
    return picked;
  }

  // rankByModel (highest TD %) or plain (shortest/most-likely prices), one per matchup/player.
  // If ranking by model was asked but no leg carries a model % (e.g. NCAAF has no TD model),
  // fall back to shortest-price = most-likely, which is the same intent ("best scorers").
  const modelPool = pool.filter((c) => c.model !== undefined);
  const ranked = opts.rankByModel && modelPool.length
    ? modelPool.sort((a, b) => (b.model ?? 0) - (a.model ?? 0))
    : pool.slice().sort((a, b) => toDecimal(a.price) - toDecimal(b.price));
  const picked: Candidate[] = [];
  for (const c of ranked) {
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k); picked.push(c);
    if (picked.length >= n) break;
  }
  return picked;
}
