"use client";

// Floating gold "AI Slip Assistant" bubble — sits by the Friends chat (bottom-right).
// Clicking opens the assistant inline (same builder as the /assistant page). Shown to
// everyone: members build slips; guests get a log-in nudge inside the panel.
import { useEffect, useState } from "react";
import AssistantPanel from "./AssistantPanel";

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);

  // Only one floating panel open at a time — close when another (Friends) opens.
  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== "assistant") setOpen(false); };
    window.addEventListener("ss:widget-open", onOther);
    return () => window.removeEventListener("ss:widget-open", onOther);
  }, []);
  const openPanel = () => { setOpen(true); window.dispatchEvent(new CustomEvent("ss:widget-open", { detail: "assistant" })); };

  return (
    <div className={open ? "aiw aiw--open" : "aiw"}>
      {!open ? (
        <button className="aiw__launch" onClick={openPanel} aria-label="Open the AI Slip Assistant">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/chatbot-icon.png?v=1" alt="" className="aiw__ic" width={34} height={34} />
          <span className="aiw__lab">Don&apos;t feel like thinking? <b>Use our AI Slip Assistant</b></span>
        </button>
      ) : (
        <div className="aiw__panel" role="dialog" aria-label="AI Slip Assistant">
          <div className="aiw__hd">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/chatbot-icon.png?v=1" alt="" className="aiw__hdic" width={26} height={26} />
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
