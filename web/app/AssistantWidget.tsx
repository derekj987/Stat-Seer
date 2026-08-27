"use client";

// AI Slip Assistant panel — the launcher now lives in the shared Dock (bottom-right).
// This renders just the panel, opened/closed by the Dock. Shown to everyone: members
// build slips; guests get a log-in nudge inside the panel.
import AssistantPanel from "./AssistantPanel";

export default function AssistantWidget({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="aiw aiw--open">
      <div className="aiw__panel" role="dialog" aria-label="AI Slip Assistant">
        <div className="aiw__hd">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/chatbot-icon.png?v=3" alt="" className="aiw__hdic" width={30} height={30} />
          <span className="aiw__title">AI Slip Assistant</span>
          <button className="aiw__min" onClick={onClose} aria-label="Close">–</button>
        </div>
        <div className="aiw__body">
          <AssistantPanel />
        </div>
      </div>
    </div>
  );
}
