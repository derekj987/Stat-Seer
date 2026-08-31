"use client";

// Renders the member's pinned views as quick-access cards. Empty state coaches them on how
// to pin. (Live-embedding the actual chart on the card, and the AI chart builder, are the
// next phases — this ships the pin loop + quick access first.)
import { useDashboard, type PinKind } from "@/lib/dashboard";

const KIND_ICON: Record<PinKind, string> = {
  auditor: "🎯", model: "📊", props: "🎲", lines: "💰", sweetspots: "🍬",
  considerations: "🧭", chart: "📈", view: "🔖",
};

export default function DashboardView() {
  const { pins, remove } = useDashboard();

  if (!pins.length) {
    return (
      <div className="dash__empty" role="note">
        <span className="dash__emptyicon" aria-hidden="true">📌</span>
        <h3 className="dash__emptyh">Nothing pinned yet</h3>
        <p className="dash__emptyp">
          Explore the app and tap <b>📌 Pin to dashboard</b> on any board you love — the Pick Auditor,
          the Model, Sweet Spots, your props. They&apos;ll land right here for quick access.
        </p>
        <div className="dash__emptycta">
          <a href="/audit" className="btn btn--primary">Open the Pick Auditor</a>
          <a href="/model" className="btn">See the Model</a>
        </div>
      </div>
    );
  }

  return (
    <div className="dash__grid">
      {pins.map((p) => (
        <div className="dashcard" key={p.id}>
          <a href={p.href} className="dashcard__main">
            <span className="dashcard__icon" aria-hidden="true">{KIND_ICON[p.kind] ?? "🔖"}</span>
            <span className="dashcard__text">
              <span className="dashcard__label">{p.label}</span>
              {p.detail && <span className="dashcard__detail">{p.detail}</span>}
            </span>
            <span className="dashcard__go" aria-hidden="true">→</span>
          </a>
          <button type="button" className="dashcard__x" title="Remove from dashboard"
            aria-label={`Remove ${p.label}`} onClick={() => remove(p.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
