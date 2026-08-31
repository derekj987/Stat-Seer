import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildChart, CHART_SOURCES, type ChartSpec, type ChartSourceId } from "@/lib/chartSources";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = "claude-sonnet-5";
const SOURCE_IDS = Object.keys(CHART_SOURCES) as ChartSourceId[];

function isSpec(x: unknown): x is ChartSpec {
  const s = x as ChartSpec;
  return !!s && typeof s.source === "string" && (SOURCE_IDS as string[]).includes(s.source);
}

export async function POST(request: Request) {
  // Members only.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch { /* env not configured */ }
  if (!userId) return NextResponse.json({ error: "Please log in to build a dashboard chart." }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  // Re-render mode: a pinned chart asks for fresh data from its saved spec — no model call.
  if (isSpec(body?.spec)) {
    try {
      const chart = await buildChart(body.spec as ChartSpec);
      return NextResponse.json({ chart });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't build that chart." }, { status: 200 });
    }
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "The chart builder isn't configured yet." }, { status: 200 });

  // Conversation history: [{role, content}]. Accept a single `prompt` as a one-message fallback.
  type Msg = { role: "user" | "assistant"; content: string };
  const rawMsgs: Msg[] = Array.isArray(body?.messages)
    ? (body.messages as unknown[]).filter((m): m is Msg => {
        const x = m as Msg; return !!x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string" && !!x.content.trim();
      })
    : (typeof body?.prompt === "string" ? [{ role: "user", content: body.prompt }] : []);
  const convo = rawMsgs.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 700) }));
  if (!convo.length || convo[convo.length - 1].role !== "user") {
    return NextResponse.json({ error: "Ask me to build a chart, or a question about it." }, { status: 200 });
  }

  // The chart currently on screen — so questions about it can be answered without rebuilding.
  const cur = body?.currentChart as { title?: string; columns?: string[]; rows?: (string | number)[][] } | undefined;
  const curCtx = cur?.title
    ? `\n\nThe member currently has THIS chart on screen — answer questions about it from here:\nTitle: ${cur.title}\nColumns: ${(cur.columns || []).join(" | ")}\nRows:\n${(cur.rows || []).slice(0, 20).map((r) => r.join(" | ")).join("\n")}`
    : "\n\n(The member has no chart on screen yet.)";

  const sources = SOURCE_IDS.map((id) => `- ${id}: ${CHART_SOURCES[id]}`).join("\n");
  const system =
    "You are StatSeer's dashboard assistant. You do TWO things: (1) BUILD charts/tables from a fixed set of real " +
    "StatSeer data sources, and (2) ANSWER questions about the chart on screen and how StatSeer's numbers work. You " +
    "never invent data — to build or change a chart you pick a source + options and we fetch the real numbers.\n\n" +
    "DECIDE each turn: if the member asks you to BUILD or CHANGE a chart, set `source` to the matching id. If they ask a " +
    "QUESTION (about the current chart, a specific row, or a concept) or are just chatting, set `source` to \"\" and " +
    "answer in `reply` — do NOT rebuild or replace their chart when they are only asking a question.\n\n" +
    "CONCEPTS you can explain: the de-vigged FAIR price (strip the book's vig off both sides to get the true no-vig " +
    "number), a VALUE/green (price beats the fair number OR beats the field on line-shopping), OVERPRICED/red (worse " +
    "than a normal hold), line-shopping edge (best book vs the field), and the line-blind model.\n" +
    "IMPORTANT — the MODEL's projections are publishable: StatSeer's line-blind model is our PUBLISHED, publicly-graded " +
    "output. When a member asks what the model projects — who it has covering the spread, who it projects to win, the " +
    "model's spread or win % — you SHOULD show it plainly (build a model_covers chart, or state it: 'the model projects " +
    "the Colts to cover and win'). That is reporting our own model, NOT a personal betting tip, so do not refuse it. " +
    "What you must NOT do: tell the member what THEY should bet, promise/guarantee an outcome, or claim an edge the data " +
    "doesn't support. Keep answers short and factual. STAY ON TOPIC: only StatSeer charts, data, and concepts; for " +
    "anything else set source \"\" and give a brief friendly decline.\n\n" +
    "AVAILABLE SOURCES:\n" + sources + "\n" +
    "When building: chartType 'table' unless they clearly ask for a bar chart (only best_props supports 'bar'); default " +
    "sport nfl unless they say college/NCAAF; default limit 12; write a short `title`." + curCtx +
    "\nALWAYS respond by calling build_chart.";

  const req = {
    model: MODEL,
    max_tokens: 500,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: convo,
    tools: [{
      name: "build_chart",
      description: "Either build/replace a chart (set a source) or just answer the member (source \"\").",
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string", enum: [...SOURCE_IDS, ""], description: "a data source id to BUILD/CHANGE a chart, or \"\" to only answer (keeps the current chart)" },
          chartType: { type: "string", enum: ["table", "bar"] },
          sport: { type: "string", enum: ["nfl", "ncaaf"] },
          limit: { type: "number", description: "how many rows (3-40)" },
          market: { type: "string", description: "model_props only: focus one prop market, e.g. 'receptions', 'receiving yards', 'rushing yards', 'passing yards', 'passing TDs'" },
          direction: { type: "string", enum: ["over", "under"], description: "model_props only: players the model projects to go over or under the line (default over)" },
          title: { type: "string", description: "a short chart title (when building)" },
          reply: { type: "string", description: "your conversational reply: a confirmation when building, or the answer to their question" },
        },
        required: ["source", "reply"],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: "tool", name: "build_chart" },
  };

  let input: { source?: string; chartType?: string; sport?: string; limit?: number; market?: string; direction?: string; title?: string; reply?: string } = {};
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    const tool = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    input = tool?.input ?? {};
  } catch {
    return NextResponse.json({ error: "The chart builder is busy — try again in a moment." }, { status: 200 });
  }

  if (!input.source || !(SOURCE_IDS as string[]).includes(input.source)) {
    return NextResponse.json({ reply: input.reply || "I can only build charts from StatSeer's own data (the Pick Auditor, props, and line-shopping value). Try asking for one of those." }, { status: 200 });
  }

  const spec: ChartSpec = {
    title: input.title || "Custom chart",
    chartType: input.chartType === "bar" ? "bar" : "table",
    source: input.source as ChartSourceId,
    sport: input.sport === "ncaaf" ? "ncaaf" : "nfl",
    limit: typeof input.limit === "number" ? input.limit : 12,
    ...(input.market ? { market: input.market } : {}),
    ...(input.direction === "under" ? { direction: "under" as const } : input.direction === "over" ? { direction: "over" as const } : {}),
  };
  try {
    const chart = await buildChart(spec);
    return NextResponse.json({ spec, chart, reply: input.reply || "" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't build that chart." }, { status: 200 });
  }
}
