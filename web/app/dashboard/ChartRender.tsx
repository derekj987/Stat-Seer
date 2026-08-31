"use client";

// Renders an AI-built chart's data — a table, or a simple horizontal bar chart. Pure presentation;
// the data comes from /api/dashboard-chart (real StatSeer numbers).
import type { ChartData } from "@/lib/chartSources";

export default function ChartRender({ data }: { data: ChartData }) {
  if (!data.rows.length) {
    return <p className="chartrender__empty">{data.note || "No rows to show right now."}</p>;
  }

  if (data.chartType === "bar") {
    // Bar chart: first column = label, last column = numeric value.
    const vals = data.rows.map((r) => Number(r[r.length - 1]) || 0);
    const max = Math.max(...vals.map((v) => Math.abs(v)), 1);
    return (
      <div className="chartbars">
        {data.rows.map((r, i) => (
          <div className="chartbar" key={i}>
            <span className="chartbar__lbl">{String(r[0])}</span>
            <span className="chartbar__track">
              <span className="chartbar__fill" style={{ width: `${(Math.abs(vals[i]) / max) * 100}%` }} />
            </span>
            <span className="chartbar__val">{r[r.length - 1]}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="chartscroll">
      <table className="charttbl">
        <thead>
          <tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>{r.map((cell, j) => <td key={j} className={typeof cell === "number" ? "charttbl__num" : undefined}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {data.note && <p className="chartrender__note">{data.note}</p>}
    </div>
  );
}
