"use client";

// The dashboard's AI Robot Knight — greets the member with a speech bubble, and on click
// expands to explain how it can build charts/tables for them (and the honest caveat that AI
// makes mistakes). "Chat with the assistant" opens the shared AI Slip Assistant panel.
import { useState } from "react";

export default function DashboardAssistant() {
  const [open, setOpen] = useState(false);
  const openAssistant = () => { try { window.dispatchEvent(new CustomEvent("ss:open-assistant")); } catch { /* SSR */ } };

  return (
    <div className="dashai">
      <button className="dashai__robot" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={open ? "Hide assistant help" : "What can the assistant do?"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/chatbot.png?v=3" alt="StatSeer AI assistant" className="dashai__img" width={132} height={132} />
      </button>

      <div className="dashai__bubble">
        {!open ? (
          <>
            <p className="dashai__say">
              Want to create your own dashboard to analyze the data <em>you</em> want to see?
            </p>
            <button type="button" className="dashai__more" onClick={() => setOpen(true)}>Tell me more →</button>
          </>
        ) : (
          <div className="dashai__detail">
            <p className="dashai__say"><b>I can build your dashboard with you.</b> Just tell me what you want to see — for example:</p>
            <ul className="dashai__ex">
              <li>&ldquo;Build a table of the best deals on the Pick Auditor.&rdquo;</li>
              <li>&ldquo;Chart this week&apos;s biggest line-shopping edges.&rdquo;</li>
              <li>&ldquo;Show Josh Allen&apos;s passing-yards line vs our projection.&rdquo;</li>
            </ul>
            <p className="dashai__say">I&apos;ll pull the numbers from across StatSeer and lay them out right here, your way.</p>
            <p className="dashai__warn">
              <b>Heads up — AI can make mistakes.</b> Always review the data. If something&apos;s off — a table
              that doesn&apos;t line up, a cosmetic tweak, or a data issue — just ask me to fix it and I&apos;ll
              correct it.
            </p>
            <div className="dashai__actions">
              <button type="button" className="btn btn--primary dashai__cta" onClick={openAssistant}>Chat with the assistant</button>
              <button type="button" className="dashai__less" onClick={() => setOpen(false)}>Maybe later</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
