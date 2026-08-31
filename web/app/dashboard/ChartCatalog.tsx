"use client";

// "Add StatSeer charts to your board" — a browsable catalog of every default chart, grouped by
// sport and category, right on the dashboard. Tapping ＋ Add drops the live chart onto the ACTIVE
// board (the tab currently selected), so members don't have to hunt the site for pin buttons.
import { useState } from "react";
import { useDashboard } from "@/lib/dashboard";
import { CHART_CATALOG, catalogPin } from "@/lib/chartCatalog";

const SPORTS = ["NFL", "NCAAF"] as const;

export default function ChartCatalog() {
  const { has, boardOf, activeId, addToBoard, moveToBoard, remove, active } = useDashboard();
  const [open, setOpen] = useState(false);
  const [sport, setSport] = useState<(typeof SPORTS)[number]>("NFL");
  const groups = CHART_CATALOG.filter((g) => g.sport === sport);

  return (
    <section className="chcat">
      <button type="button" className={`chcat__toggle${open ? " open" : ""}`} aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <span className="chcat__togic" aria-hidden="true">🧩</span>
        <span className="chcat__togtxt">Add StatSeer charts to your board</span>
        <span className="chcat__chev" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="chcat__body">
          <p className="chcat__note">
            Adding to <b>{active?.name ?? "your board"}</b>. Pick charts below to drop them in — switch
            boards with the tabs, or make a new one, then keep adding.
          </p>
          <div className="chcat__sports" role="tablist" aria-label="Sport">
            {SPORTS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={s === sport}
                className={`chcat__sport${s === sport ? " on" : ""}`} onClick={() => setSport(s)}>{s}</button>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.key} className="chcat__grp">
              <h4 className="chcat__grph">{g.category}</h4>
              <div className="chcat__items">
                {g.items.map((it) => {
                  const pin = catalogPin(it);
                  const onThisBoard = boardOf(pin.id) === activeId;
                  const elsewhere = has(pin.id) && !onThisBoard;
                  const act = () => {
                    if (onThisBoard) remove(pin.id);           // already here → remove
                    else if (elsewhere) moveToBoard(pin.id, activeId);  // on another board → move here
                    else addToBoard(pin, activeId);            // add to the active board
                  };
                  const cta = onThisBoard ? "✓ Added" : elsewhere ? "→ Move here" : "＋ Add";
                  return (
                    <button key={it.href} type="button" className={`chcat__item${onThisBoard ? " on" : ""}`}
                      aria-pressed={onThisBoard}
                      title={onThisBoard ? "Remove from this board" : elsewhere ? `Move to ${active?.name ?? "this board"}` : `Add to ${active?.name ?? "this board"}`}
                      onClick={act}>
                      <span className="chcat__itname">{it.label}</span>
                      <span className={`chcat__add${elsewhere ? " move" : ""}`}>{cta}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
