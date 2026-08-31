"use client";

// Renders each pinned view as a LIVE embed — the actual chart, in an iframe of its page in
// chrome-less embed mode (?embed=1), auto-sized to the whole chart via postMessage. Not a link.
import { useEffect, useRef, useState } from "react";
import { useDashboard, type Pin, type PinKind } from "@/lib/dashboard";

const KIND_ICON: Record<PinKind, string> = {
  auditor: "🎯", model: "📊", props: "🎲", lines: "💰", sweetspots: "🍬",
  considerations: "🧭", chart: "📈", view: "🔖",
};

function embedSrc(href: string): string {
  return href + (href.includes("?") ? "&" : "?") + "embed=1";
}

function EmbedCard({ pin, onRemove }: { pin: Pin; onRemove: (id: string) => void }) {
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
    <div className="dashembed">
      <div className="dashembed__bar">
        <span className="dashembed__icon" aria-hidden="true">{KIND_ICON[pin.kind] ?? "🔖"}</span>
        <span className="dashembed__label">{pin.label}</span>
        {pin.detail && <span className="dashembed__detail">{pin.detail}</span>}
        <a href={pin.href} className="dashembed__open" title="Open the full page">Open ↗</a>
        <button type="button" className="dashembed__x" title="Remove from dashboard"
          aria-label={`Remove ${pin.label}`} onClick={() => onRemove(pin.id)}>✕</button>
      </div>
      <div className="dashembed__frame">
        <iframe ref={ref} src={embedSrc(pin.href)} title={pin.label} loading="lazy" style={{ height: h }} />
      </div>
    </div>
  );
}

export default function DashboardView() {
  const { pins, remove } = useDashboard();

  if (!pins.length) {
    return (
      <div className="dash__empty" role="note">
        <span className="dash__emptyicon" aria-hidden="true">📌</span>
        <h3 className="dash__emptyh">Nothing pinned yet</h3>
        <p className="dash__emptyp">
          Explore the app and tap <b>＋ Add to dashboard</b> on any board you love — the Pick Auditor,
          the Model, Sweet Spots, your props. The <b>whole chart</b> lands right here, live.
        </p>
        <div className="dash__emptycta">
          <a href="/audit" className="btn btn--primary">Open the Pick Auditor</a>
          <a href="/model" className="btn">See the Model</a>
        </div>
      </div>
    );
  }

  return (
    <div className="dash__embeds">
      {pins.map((p) => <EmbedCard key={p.id} pin={p} onRemove={remove} />)}
    </div>
  );
}
