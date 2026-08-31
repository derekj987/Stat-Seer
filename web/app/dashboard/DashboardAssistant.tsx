"use client";

// The "Dashboard Creation Center" hero — the headline attraction at the top of the dashboard.
// The AI Robot Knight sits in a clean framed mascot spot beside the title; "How it works" expands
// the examples + the honest AI-makes-mistakes caveat. "Build a chart" jumps to the AI builder.
import { useState } from "react";

export default function DashboardAssistant() {
  const [open, setOpen] = useState(false);
  const startBuilding = () => {
    try {
      const el = document.getElementById("cbuild");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.querySelector<HTMLInputElement>(".cbuild__in")?.focus();
    } catch { /* SSR */ }
  };

  return (
    <section className="dashhero">
      <div className="dashhero__mascot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/chatbot-knight.png?v=1" alt="StatSeer AI assistant" className="dashhero__img" width={120} height={120} />
      </div>

      <div className="dashhero__body">
        <span className="dashhero__kicker">Your space</span>
        <h1 className="dashhero__title">Dashboard Creation Center</h1>
        <p className="dashhero__sub">
          Build your own view of StatSeer — pin any chart into a board, or tell the AI knight what you
          want to see and he&apos;ll lay it out for you, your way.
        </p>

        {!open ? (
          <div className="dashhero__row">
            <button type="button" className="btn btn--primary dashhero__cta" onClick={startBuilding}>Build a chart with AI →</button>
            <button type="button" className="dashhero__more" onClick={() => setOpen(true)}>How does this work?</button>
          </div>
        ) : (
          <div className="dashhero__detail">
            <p className="dashhero__say"><b>I can build your dashboard with you.</b> Just tell me what you want to see — for example:</p>
            <ul className="dashhero__ex">
              <li>&ldquo;Build a table of the best deals on the Pick Auditor.&rdquo;</li>
              <li>&ldquo;Chart this week&apos;s biggest line-shopping edges.&rdquo;</li>
              <li>&ldquo;Show Josh Allen&apos;s passing-yards line vs our projection.&rdquo;</li>
            </ul>
            <p className="dashhero__warn">
              <b>Heads up — AI can make mistakes.</b> Always review the data. If something&apos;s off — a table
              that doesn&apos;t line up, a cosmetic tweak, or a data issue — just ask me to fix it and I&apos;ll correct it.
            </p>
            <div className="dashhero__row">
              <button type="button" className="btn btn--primary dashhero__cta" onClick={startBuilding}>Build a chart →</button>
              <button type="button" className="dashhero__more" onClick={() => setOpen(false)}>Got it</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
