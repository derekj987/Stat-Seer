"use client";

// Floating gold "AI Slip Assistant" bubble — sits by the Friends chat (bottom-right).
// Clicking opens the assistant inline (same builder as the /assistant page). Shown to
// everyone: members build slips; guests get a log-in nudge inside the panel.
import { useState } from "react";
import AssistantPanel from "./AssistantPanel";

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="aiw">
      {!open ? (
        <button className="aiw__launch" onClick={() => setOpen(true)} aria-label="Open the AI Slip Assistant">
          <span className="aiw__ic" aria-hidden="true">🤖</span>
          <span className="aiw__lab">Don&apos;t feel like thinking? <b>Use our AI Slip Assistant</b></span>
        </button>
      ) : (
        <div className="aiw__panel" role="dialog" aria-label="AI Slip Assistant">
          <div className="aiw__hd">
            <span className="aiw__hdic" aria-hidden="true">🤖</span>
            <span className="aiw__title">AI Slip Assistant</span>
            <button className="aiw__min" onClick={() => setOpen(false)} aria-label="Close">–</button>
          </div>
          <div className="aiw__body">
            <AssistantPanel />
          </div>
        </div>
      )}
    </div>
  );
}
