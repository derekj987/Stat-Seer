"use client";

// Conversational AI chart builder. The member can ask to build a chart AND ask follow-up questions
// about it — the current chart stays put while questions are answered, and only changes when they
// ask for a new/different one. Real StatSeer data only (via /api/dashboard-chart).
import { useEffect, useRef, useState } from "react";
import { useDashboard } from "@/lib/dashboard";
import type { ChartData, ChartSpec } from "@/lib/chartSources";
import ChartRender from "./ChartRender";

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = [
  "Build a table of the best deals on the Pick Auditor",
  "Show the biggest prop shopping edges as a bar chart",
  "Table of the best line-shopping value this week",
];

export default function ChartBuilder() {
  const { toggle } = useDashboard();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [added, setAdded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard-chart", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next,
          currentChart: chart ? { title: chart.title, columns: chart.columns, rows: chart.rows } : undefined,
        }),
      });
      const data = await res.json();
      const reply: string = data.reply || data.error || "Done.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (data.chart && data.spec) { setChart(data.chart); setSpec(data.spec); setAdded(false); }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong — try again." }]);
    }
    setLoading(false);
  }

  function addToDashboard() {
    if (!chart || !spec) return;
    toggle({
      id: `chart:${spec.source}:${chart.title}:${Date.now()}`,
      kind: "chart",
      label: chart.title,
      detail: spec.sport === "ncaaf" ? "NCAAF · AI chart" : "NFL · AI chart",
      href: "",
      spec,
    });
    setAdded(true);
  }

  return (
    <div className="cbuild">
      <div className="cbuild__head"><b>Build a chart with AI — and ask me about it</b></div>

      {messages.length > 0 && (
        <div className="cbuild__thread" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`cbmsg cbmsg--${m.role}`}>{m.content}</div>
          ))}
          {loading && <div className="cbmsg cbmsg--assistant cbmsg--typing">…</div>}
        </div>
      )}

      {chart && (
        <div className="cbuild__preview">
          <div className="cbuild__pvhead">
            <span className="cbuild__pvtitle">{chart.title}</span>
            <button type="button" className={`btn btn--sm${added ? "" : " btn--primary"}`} onClick={addToDashboard} disabled={added}>
              {added ? "✓ Added" : "＋ Add to dashboard"}
            </button>
          </div>
          <ChartRender data={chart} />
          <p className="cbuild__warn">AI can make mistakes — give it a look, and just ask me to fix or change anything.</p>
        </div>
      )}

      <form className="cbuild__form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="cbuild__in" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={chart ? "Ask about this chart, or build a new one…" : "e.g. Build a table of the best deals on the Pick Auditor"} />
        <button type="submit" className="btn btn--primary cbuild__go" disabled={loading}>{loading ? "…" : "Send"}</button>
      </form>

      {messages.length === 0 && (
        <div className="cbuild__ex">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="cbuild__exbtn" onClick={() => send(ex)}>{ex}</button>
          ))}
        </div>
      )}
    </div>
  );
}
