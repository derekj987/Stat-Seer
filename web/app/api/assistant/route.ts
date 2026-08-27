import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { weekRange } from "@/lib/board";
import { buildCandidates, buildMenuSlip, combinedAmerican, combinedDecimal, type Candidate } from "@/lib/assistant";
import { toDecimal } from "@/lib/slipPricing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SEASON = 2026;
const MODEL = "claude-sonnet-5"; // text mode; menu mode calls no model

// The assembled legs, shaped so the client can drop them straight onto the Value Finder slip.
function toLegs(cands: Candidate[]) {
  return cands.map((c) => ({
    id: `ai-${c.id}`,
    kind: (c.kind === "line" ? "line" : "prop") as "line" | "prop",
    title: c.title,
    detail: c.detail,
    price: c.price,
    books: c.books,
    byBook: c.byBook,
  }));
}

function respond(legs: Candidate[], note: string) {
  return NextResponse.json({
    legs: toLegs(legs),
    combined: legs.length > 1 ? { american: combinedAmerican(legs), decimal: combinedDecimal(legs) } : null,
    note,
  });
}

export async function POST(request: Request) {
  // Members only.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch { /* env not configured */ }
  if (!userId) return NextResponse.json({ error: "Please log in to use the slip assistant." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mode: "menu" | "text" = body?.mode === "text" ? "text" : "menu";

  const week = (await weekRange(SEASON).catch(() => null))?.min ?? 1;
  const cands = await buildCandidates(week, SEASON);
  if (!cands.length) {
    return NextResponse.json({ error: "No live betting board yet — the week's odds haven't loaded. Try again closer to kickoff." }, { status: 200 });
  }

  // ---- MENU: deterministic, no model, no cost ----
  if (mode === "menu") {
    const markets = (Array.isArray(body?.markets) ? body.markets : []).filter((m: unknown): m is string => typeof m === "string");
    const legsN = Math.max(1, Math.min(Number(body?.legs) || 4, 8));
    const target = body?.targetOdds ? Number(body.targetOdds) : null;
    const rankByModel = !!body?.rankByModel;
    const picked = buildMenuSlip(cands, { markets: markets.length ? markets : ["spread", "total"], legs: legsN, targetOdds: target, rankByModel });
    if (!picked.length) return NextResponse.json({ error: "Nothing matched those options — try different markets." }, { status: 200 });
    const priced = combinedAmerican(picked);
    let note: string;
    if (rankByModel) {
      note = `Your ${picked.length} highest-model-% picks — parlays to ${priced}.`;
    } else if (target) {
      const off = Math.abs(combinedDecimal(picked) - toDecimal(target)) / toDecimal(target);
      note = off < 0.18
        ? `A ${picked.length}-leg parlay at ${priced} — right around your +${target} target.`
        : `Closest we could get toward +${target} with these markets: ${priced} across ${picked.length} legs. Add moneylines or more legs to go longer.`;
    } else {
      note = `A ${picked.length}-leg parlay at ${priced}.`;
    }
    return respond(picked, note);
  }

  // ---- TEXT: Claude assembles from the candidate menu ----
  const prompt = String(body?.prompt ?? "").slice(0, 600).trim();
  if (!prompt) return NextResponse.json({ error: "Tell the assistant what you'd like." }, { status: 200 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "The chat assistant isn't configured yet. Use the Quick menu for now." }, { status: 200 });

  // Compact menu to keep tokens (and cost) down. `mkt` = market: spread, total, moneyline,
  // player_anytime_td, player_pass_yds, player_pass_tds, player_rush_yds,
  // player_rush_attempts, player_reception_yds, player_receptions.
  const menu = cands.map((c) => ({ id: c.id, mkt: c.market, bet: c.title, odds: c.price, ...(c.model !== undefined ? { modelPct: Math.round(c.model) } : {}) }));
  const system =
    "You assemble sports bet slips for StatSeer from a fixed menu of real, currently-priced bets. " +
    "You are NOT giving betting advice or guaranteeing outcomes — you are assembling picks the member asked for from published numbers. " +
    "Rules: choose ONLY ids from the menu; never invent bets. Prefer at most one leg per game/player unless asked. " +
    "TARGET ODDS MATTER: if the member gives a target parlay price (e.g. +2500), pick legs whose decimal odds MULTIPLY to about that target (a leg's decimal = 1 + odds/100 for + odds, or 1 + 100/|odds| for - odds; the parlay decimal is the product of the legs; +2500 ≈ decimal 26). Do the math and get as close to the target as you can — don't just pick short favorites. " +
    "Note that game spreads and totals are almost all priced near -110 (decimal ~1.9), so a 4-leg parlay of ONLY spreads/totals tops out around +1300-1500 — to reach longer targets (e.g. +2500, +5000, +10000) you MUST use underdog moneylines (mkt 'moneyline', which run +150 to +600) and/or more legs. If the member restricted markets so the target is unreachable, get as close as possible and say so in the note. " +
    "For 'highest % TD scorer' style asks, rank player_anytime_td legs by modelPct (higher is better). " +
    "Respect requested number of legs and market types — filter by the `mkt` field (e.g. only spreads = mkt 'spread'; moneylines = 'moneyline'; QB passing yards = 'player_pass_yds'; receptions = 'player_receptions'). " +
    "Return your picks via the submit_slip tool with the chosen ids and a short one-sentence note that states the resulting parlay odds.\n\n" +
    "MENU (JSON):\n" + JSON.stringify(menu);

  const req = {
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
    tools: [{
      name: "submit_slip",
      description: "Return the chosen bet slip.",
      input_schema: {
        type: "object",
        properties: {
          legIds: { type: "array", items: { type: "string" }, description: "ids from the menu, in order" },
          note: { type: "string", description: "one short sentence describing the slip" },
        },
        required: ["legIds", "note"],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: "tool", name: "submit_slip" },
  };

  let picked: Candidate[] = [];
  let note = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    const tool = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    const ids: string[] = Array.isArray(tool?.input?.legIds) ? tool.input.legIds : [];
    note = typeof tool?.input?.note === "string" ? tool.input.note : "";
    const byId = new Map(cands.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const id of ids) {
      const c = byId.get(id);
      if (c && !seen.has(c.id)) { seen.add(c.id); picked.push(c); }
    }
  } catch {
    return NextResponse.json({ error: "The assistant is busy right now — try the Quick menu, or ask again." }, { status: 200 });
  }
  if (!picked.length) return NextResponse.json({ error: "Couldn't build that from this week's board — try rephrasing, or use the Quick menu." }, { status: 200 });
  return respond(picked, note || "Here's your slip.");
}
