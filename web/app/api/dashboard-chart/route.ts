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

  const prompt = String(body?.prompt ?? "").slice(0, 400).trim();
  if (!prompt) return NextResponse.json({ error: "Tell me what chart to build." }, { status: 200 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "The chart builder isn't configured yet." }, { status: 200 });

  const sources = SOURCE_IDS.map((id) => `- ${id}: ${CHART_SOURCES[id]}`).join("\n");
  const system =
    "You are StatSeer's dashboard chart builder. A member describes a chart, table, or graph they want; " +
    "you map it to ONE of a fixed set of real StatSeer data sources and a title. You do NOT invent data or numbers — " +
    "you only choose the source, chart type, sport, and how many rows. " +
    "STAY ON TOPIC: only build charts from these StatSeer sources. If the member asks for anything the sources can't " +
    "provide (unrelated data, general knowledge, live scores, etc.), set source to \"\" and put a brief friendly reason in `reply`.\n\n" +
    "AVAILABLE SOURCES:\n" + sources + "\n\n" +
    "Pick the source that best matches the request. Use chartType 'table' unless they clearly ask for a bar chart/graph " +
    "(only best_props supports 'bar'). Default sport nfl unless they say college/NCAAF. Default limit 12. Write a short, " +
    "clear `title` for the chart. ALWAYS respond by calling build_chart.";

  const req = {
    model: MODEL,
    max_tokens: 400,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
    tools: [{
      name: "build_chart",
      description: "Choose a StatSeer data source + options to build the member's chart.",
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string", enum: [...SOURCE_IDS, ""], description: "the data source id, or \"\" if none fits" },
          chartType: { type: "string", enum: ["table", "bar"] },
          sport: { type: "string", enum: ["nfl", "ncaaf"] },
          limit: { type: "number", description: "how many rows (3-40)" },
          title: { type: "string", description: "a short chart title" },
          reply: { type: "string", description: "one friendly sentence — a confirmation, or why the request can't be built" },
        },
        required: ["source", "title", "reply"],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: "tool", name: "build_chart" },
  };

  let input: { source?: string; chartType?: string; sport?: string; limit?: number; title?: string; reply?: string } = {};
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
  };
  try {
    const chart = await buildChart(spec);
    return NextResponse.json({ spec, chart, reply: input.reply || "" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't build that chart." }, { status: 200 });
  }
}
