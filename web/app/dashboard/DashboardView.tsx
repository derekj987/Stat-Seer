"use client";

// The Custom Dashboard canvas. Multiple named boards (tabs), each a grid of LIVE cards the member
// arranges: every pin renders the real thing — a chart-less embed (iframe of its page in ?embed=1,
// auto-sized via postMessage) or an AI-built chart — that they can drag to reorder and resize
// (column span). Board/layout/size state lives in the localStorage dashboard store.
import { useEffect, useRef, useState } from "react";
import { useDashboard, type Pin, type PinKind, type PinSize } from "@/lib/dashboard";
import type { ChartData } from "@/lib/chartSources";
import ChartRender from "./ChartRender";

const KIND_ICON: Record<PinKind, string> = {
  auditor: "🎯", model: "📊", props: "🎲", lines: "💰", sweetspots: "🍬",
  considerations: "🧭", chart: "📈", view: "🔖", widget: "🧩",
};

const SIZES: { key: PinSize; label: string; title: string }[] = [
  { key: "sm", label: "S", title: "Small (1 column)" },
  { key: "md", label: "M", title: "Medium (2 columns)" },
  { key: "lg", label: "L", title: "Large (3 columns)" },
  { key: "full", label: "▭", title: "Full width" },
];

function embedSrc(href: string): string {
  return href + (href.includes("?") ? "&" : "?") + "embed=1";
}

function SizeControl({ size, onSize }: { size: PinSize; onSize: (s: PinSize) => void }) {
  return (
    <span className="dashsize" role="group" aria-label="Card size">
      {SIZES.map((s) => (
        <button key={s.key} type="button" title={s.title} aria-pressed={size === s.key}
          className={`dashsize__b${size === s.key ? " on" : ""}`} onClick={() => onSize(s.key)}>{s.label}</button>
      ))}
    </span>
  );
}

// Shared chrome for every card: drag grip, label, size control, open/remove — plus the drag
// wiring so cards can be reordered within a board.
function CardShell({ pin, index, drag, onRemove, onSize, showOpen, children }: {
  pin: Pin; index: number; showOpen?: boolean; children: React.ReactNode;
  onRemove: (id: string) => void; onSize: (id: string, s: PinSize) => void;
  drag: {
    onDragStart: (i: number) => void; onDragEnterCard: (i: number) => void;
    onDrop: () => void; onEnd: () => void; over: number | null; from: number | null;
  };
}) {
  const isOver = drag.over === index && drag.from !== null && drag.from !== index;
  return (
    <div
      className={`dashembed dashembed--${pin.size ?? "lg"}${drag.from === index ? " dashembed--dragging" : ""}${isOver ? " dashembed--over" : ""}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; drag.onDragStart(index); }}
      onDragEnter={() => drag.onDragEnterCard(index)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(); }}
      onDragEnd={drag.onEnd}
    >
      <div className="dashembed__bar">
        <span className="dashembed__grip" title="Drag to reorder" aria-hidden="true">⠿</span>
        <span className="dashembed__icon" aria-hidden="true">{KIND_ICON[pin.kind] ?? "🔖"}</span>
        <span className="dashembed__label">{pin.label}</span>
        {pin.detail && <span className="dashembed__detail">{pin.detail}</span>}
        <SizeControl size={pin.size ?? "lg"} onSize={(s) => onSize(pin.id, s)} />
        {showOpen && pin.href && <a href={pin.href} className="dashembed__open" title="Open the full page">Open ↗</a>}
        <button type="button" className="dashembed__x" title="Remove from dashboard"
          aria-label={`Remove ${pin.label}`} onClick={() => onRemove(pin.id)}>✕</button>
      </div>
      {children}
    </div>
  );
}

function EmbedCard(props: CardProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [h, setH] = useState(560);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; height?: number } | null;
      if (d?.type === "ss-embed-height" && typeof d.height === "number" && ref.current
          && e.source === ref.current.contentWindow) {
        setH(Math.min(Math.max(Math.round(d.height) + 8, 160), 2400));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return (
    <CardShell {...props} showOpen>
      <div className="dashembed__frame">
        <iframe ref={ref} src={embedSrc(props.pin.href)} title={props.pin.label} loading="lazy" style={{ height: h }} />
      </div>
    </CardShell>
  );
}

function ChartCard(props: CardProps) {
  const [data, setData] = useState<ChartData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard-chart", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: props.pin.spec }),
        });
        const j = await res.json();
        if (!alive) return;
        if (j.chart) setData(j.chart); else setErr(j.error || "Couldn't load this chart.");
      } catch { if (alive) setErr("Couldn't load this chart."); }
    })();
    return () => { alive = false; };
  }, [props.pin.spec]);
  return (
    <CardShell {...props}>
      <div className="dashchart">
        {data ? <ChartRender data={data} /> : err ? <p className="chartrender__empty">{err}</p> : <p className="chartrender__empty">Loading…</p>}
      </div>
    </CardShell>
  );
}

interface CardProps {
  pin: Pin; index: number; showOpen?: boolean;
  onRemove: (id: string) => void; onSize: (id: string, s: PinSize) => void;
  drag: React.ComponentProps<typeof CardShell>["drag"];
}

function BoardTabs() {
  const { boards, activeId, setActive, addBoard, renameBoard, deleteBoard } = useDashboard();
  return (
    <div className="dashtabs" role="tablist" aria-label="Dashboard boards">
      {boards.map((b) => (
        <span key={b.id} className={`dashtab${b.id === activeId ? " active" : ""}`}>
          <button type="button" className="dashtab__name" role="tab" aria-selected={b.id === activeId}
            onClick={() => setActive(b.id)}
            onDoubleClick={() => { const n = window.prompt("Rename board", b.name); if (n != null) renameBoard(b.id, n.trim()); }}
            title="Click to switch · double-click to rename">
            {b.name}<span className="dashtab__n">{b.pins.length}</span>
          </button>
          {b.id === activeId && boards.length > 1 && (
            <button type="button" className="dashtab__del" title="Delete this board"
              aria-label={`Delete board ${b.name}`}
              onClick={() => { if (window.confirm(`Delete board "${b.name}"? Its pins are removed.`)) deleteBoard(b.id); }}>✕</button>
          )}
        </span>
      ))}
      <button type="button" className="dashtab dashtab--add" title="New board" aria-label="New board"
        onClick={() => addBoard()}>＋ Board</button>
    </div>
  );
}

export default function DashboardView() {
  const { pins, remove, setSize, reorder } = useDashboard();
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const drag = {
    from, over,
    onDragStart: (i: number) => setFrom(i),
    onDragEnterCard: (i: number) => setOver(i),
    onDrop: () => { if (from !== null && over !== null && from !== over) reorder(from, over); setFrom(null); setOver(null); },
    onEnd: () => { setFrom(null); setOver(null); },
  };

  return (
    <>
      <BoardTabs />
      {!pins.length ? (
        <div className="dash__empty" role="note">
          <span className="dash__emptyicon" aria-hidden="true">📌</span>
          <h3 className="dash__emptyh">This board is empty</h3>
          <p className="dash__emptyp">
            Explore the app and tap <b>＋ Add to dashboard</b> on any board you love — the Pick Auditor,
            the Model, Sweet Spots, your props. The <b>whole chart</b> lands right here, live. Then
            <b> drag to rearrange</b> and use <b>S / M / L / ▭</b> to resize each card.
          </p>
          <div className="dash__emptycta">
            <a href="/audit" className="btn btn--primary">Open the Pick Auditor</a>
            <a href="/model" className="btn">See the Model</a>
          </div>
        </div>
      ) : (
        <div className={`dash__grid${from !== null ? " dash__grid--dragging" : ""}`}>
          {pins.map((p, i) => {
            const common: CardProps = { pin: p, index: i, onRemove: remove, onSize: setSize, drag };
            return p.kind === "chart" && p.spec
              ? <ChartCard key={p.id} {...common} />
              : <EmbedCard key={p.id} {...common} />;
          })}
        </div>
      )}
    </>
  );
}
