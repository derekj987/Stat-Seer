"use client";

// The AI chart builder on the dashboard: the member describes a chart in words, Claude maps it to a
// real StatSeer data source, and we preview it. "Add to dashboard" pins it (the spec re-fetches live).
import { useState } from "react";
import { useDashboard } from "@/lib/dashboard";
import type { ChartData, ChartSpec } from "@/lib/chartSources";
import ChartRender from "./ChartRender";

const EXAMPLES = [
  "Build a table of the best deals on the Pick Auditor",
  "Show the biggest prop shopping edges as a bar chart",
  "Table of the best line-shopping value this week",
];

export default function ChartBuilder({ onClose }: { onClose?: () => void }) {
  const { toggle } = useDashboard();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ spec: ChartSpec; chart: ChartData } | null>(null);
  const [added, setAdded] = useState(false);

  async function build(p: string) {
    const q = p.trim();
    if (!q) return;
    setLoading(true); setMsg(""); setResult(null); setAdded(false);
    try {
      const res = await fetch("/api/dashboard-chart", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: q }),
      });
      const data = await res.json();
      if (data.error) { setMsg(data.error); }
      else if (data.chart && data.spec) { setResult({ spec: data.spec, chart: data.chart }); if (data.reply) setMsg(data.reply); }
      else { setMsg(data.reply || "I couldn't build that one — try one of the examples."); }
    } catch { setMsg("Something went wrong — try again."); }
    setLoading(false);
  }

  function addToDashboard() {
    if (!result) return;
    toggle({
      id: `chart:${result.spec.source}:${result.chart.title}:${Date.now()}`,
      kind: "chart",
      label: result.chart.title,
      detail: result.spec.sport === "ncaaf" ? "NCAAF · AI chart" : "NFL · AI chart",
      href: "",
      spec: result.spec,
    });
    setAdded(true);
  }

  return (
    <div className="cbuild">
      <div className="cbuild__head">
        <b>Build a chart with AI</b>
        {onClose && <button type="button" className="cbuild__x" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      <form className="cbuild__form" onSubmit={(e) => { e.preventDefault(); build(prompt); }}>
        <input className="cbuild__in" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Build a table of the best deals on the Pick Auditor" />
        <button type="submit" className="btn btn--primary cbuild__go" disabled={loading}>
          {loading ? "Building…" : "Build"}
        </button>
      </form>
      <div className="cbuild__ex">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="cbuild__exbtn" onClick={() => { setPrompt(ex); build(ex); }}>{ex}</button>
        ))}
      </div>

      {msg && <p className="cbuild__msg">{msg}</p>}

      {result && (
        <div className="cbuild__preview">
          <div className="cbuild__pvhead">
            <span className="cbuild__pvtitle">{result.chart.title}</span>
            <button type="button" className={`btn btn--sm${added ? "" : " btn--primary"}`} onClick={addToDashboard} disabled={added}>
              {added ? "✓ Added" : "＋ Add to dashboard"}
            </button>
          </div>
          <ChartRender data={result.chart} />
          <p className="cbuild__warn">AI can make mistakes — give it a look, and just ask me to fix anything that&apos;s off.</p>
        </div>
      )}
    </div>
  );
}
