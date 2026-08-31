// Site-visits trend — a server-rendered SVG line chart of daily hits over time. No client JS:
// it's static SVG (same approach as the cost/usage bars), so it renders inside the auth gate.
// Interior gaps in the recorded range are filled with 0 so the daily axis stays continuous.

const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthOf = (iso: string) => iso.slice(0, 7);

/** Every calendar day from `a` to `b` inclusive (ISO yyyy-mm-dd). */
function dayRange(a: string, b: string): string[] {
  const out: string[] = [];
  const cur = new Date(a + "T00:00:00Z");
  const end = new Date(b + "T00:00:00Z");
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function VisitsChart({ series }: { series: { day: string; hits: number }[] }) {
  if (!series.length) return null;

  // Fill interior gaps with 0 so the line is a true daily series.
  const known = new Map(series.map((r) => [r.day, r.hits]));
  const days = dayRange(series[0].day, series[series.length - 1].day);
  const pts = days.map((d) => ({ day: d, hits: known.get(d) ?? 0 }));

  const W = 720, H = 220, PL = 38, PR = 14, PT = 16, PB = 30;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const rawMax = Math.max(1, ...pts.map((p) => p.hits));
  // Round the axis top up to a clean number.
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil(rawMax / pow) * pow || 1;
  const peak = pts.reduce((m, p) => (p.hits > m.hits ? p : m), pts[0]);

  const n = pts.length;
  const x = (i: number) => (n === 1 ? PL + plotW / 2 : PL + (i / (n - 1)) * plotW);
  const y = (h: number) => PT + plotH - (h / niceMax) * plotH;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.hits).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(PT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PT + plotH).toFixed(1)} Z`;

  // Y gridlines at 0 / 50% / 100% of the axis.
  const yTicks = [0, niceMax / 2, niceMax];
  // X labels: month boundaries + first/last, then thin to avoid crowding.
  const labelIdx: number[] = [];
  pts.forEach((p, i) => {
    if (i === 0 || i === n - 1 || monthOf(p.day) !== monthOf(pts[i - 1].day)) labelIdx.push(i);
  });
  const targetLabels = 7;
  const stride = Math.max(1, Math.ceil(n / targetLabels));
  for (let i = 0; i < n; i += stride) if (!labelIdx.includes(i)) labelIdx.push(i);
  const labels = [...new Set(labelIdx)].sort((a, b) => a - b)
    .filter((i, k, arr) => k === 0 || x(i) - x(arr[k - 1]) > 52);  // keep ≥52px apart

  const total = pts.reduce((a, p) => a + p.hits, 0);

  return (
    <div className="cvchart">
      <div className="cvchart__head">
        <span className="cvchart__title">Site visits over time</span>
        <span className="cvchart__meta">{fmtDay(pts[0].day)} – {fmtDay(pts[n - 1].day)} · {total.toLocaleString()} hits · peak {peak.hits.toLocaleString()} on {fmtDay(peak.day)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="cvchart__svg" role="img"
        aria-label={`Daily site visits from ${fmtDay(pts[0].day)} to ${fmtDay(pts[n - 1].day)}, ${total} total hits, peaking at ${peak.hits} on ${fmtDay(peak.day)}.`}>
        {/* horizontal gridlines + y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className="cvchart__grid" />
            <text x={PL - 6} y={y(t) + 3} className="cvchart__ylab" textAnchor="end">{Math.round(t).toLocaleString()}</text>
          </g>
        ))}
        {/* area under the line */}
        <path d={area} className="cvchart__area" />
        {/* the line */}
        <path d={line} className="cvchart__line" />
        {/* peak marker */}
        <circle cx={x(pts.indexOf(peak))} cy={y(peak.hits)} r={3.5} className="cvchart__peak" />
        {/* x labels */}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - 10} className="cvchart__xlab"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{fmtDay(pts[i].day)}</text>
        ))}
      </svg>
    </div>
  );
}
