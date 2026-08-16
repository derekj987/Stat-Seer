"use client";

// The single slip bar, rendered globally (in layout) so it follows the member
// across every section. Groups items by where they came from; for the priced
// bets (lines/props) it points at the single book that covers the most.
import { useState } from "react";
import { useSlip, type SlipKind } from "@/lib/slip";

const fmtOdds = (p?: number) => (p === undefined ? "" : p > 0 ? `+${p}` : String(p));
const KIND_LABEL: Record<SlipKind, string> = {
  line: "Game Lines", prop: "Player Props", model: "The Model", fan: "Fan Analysis",
};
const ORDER: SlipKind[] = ["line", "prop", "model", "fan"];

export default function SlipBar() {
  const { items, remove, clear } = useSlip();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!items.length) return null;

  const priced = items.filter((i) => i.books && i.books.length);
  const tally: Record<string, number> = {};
  for (const i of priced) for (const b of i.books!) tally[b] = (tally[b] ?? 0) + 1;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;

  const groups = ORDER
    .map((k) => [k, items.filter((i) => i.kind === k)] as const)
    .filter(([, list]) => list.length);

  async function copySlip() {
    const lines = items.map((i) =>
      `• [${KIND_LABEL[i.kind]}] ${i.title}` +
      (i.detail ? ` — ${i.detail}` : "") +
      (i.price !== undefined ? `  ${fmtOdds(i.price)}` : "") +
      (i.books?.length ? `  (best: ${i.books.join(" / ")})` : ""));
    const text =
      `My StatSeer slip — ${items.length} pick${items.length === 1 ? "" : "s"}\n` +
      `${lines.join("\n")}\n\nBuild your own at statseer.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="slipbar">
      <div className="slipbar__inner">
        <button className="slipbar__summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="slipbar__count">{items.length}</span>
          <span>slip</span>
          {top && priced.length > 0 && (
            <span className="slipbar__rec">best book: <b>{top[0]}</b> · {top[1]}/{priced.length}</span>
          )}
          <span className="slipbar__chev">{open ? "▾" : "▴"}</span>
        </button>
        {open && (
          <div className="slipbar__panel">
            {groups.map(([kind, list]) => (
              <div key={kind} className="slipgrp">
                <div className="slipgrp__h">{KIND_LABEL[kind]}</div>
                <ul className="slipbar__list">
                  {list.map((i) => (
                    <li key={i.id}>
                      <span className="slipbar__g">{i.title}</span>
                      {i.detail && <span className="slipbar__p">{i.detail}</span>}
                      {i.price !== undefined && <span className="odds">{fmtOdds(i.price)}</span>}
                      {i.books?.length ? <span className="book">{i.books.join(" / ")}</span> : null}
                      <button className="slipbar__x" onClick={() => remove(i.id)} title="Remove">×</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="slipbar__note">
              Your running slip across every section.{" "}
              {top && priced.length > 0 && <>For the priced bets, <b>{top[0]}</b> covers the most legs. </>}
              Model reads and fan buzz are here for reference — <b>not a pick, not graded</b>. Line-shopping only.
            </p>
            <div className="slipbar__actions">
              <button className="slipbar__copy" onClick={copySlip}>{copied ? "Copied ✓" : "Copy slip"}</button>
              <button className="slipbar__clear" onClick={clear}>Clear slip</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
