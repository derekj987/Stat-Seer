"use client";

// "Pin to dashboard" control for any view/board. With one board it adds straight to it; with
// several it opens a little picker so the member chooses WHICH board (or a brand-new one) the
// chart lands on. When already pinned, the button removes it.
import { useDashboard, type Pin } from "@/lib/dashboard";
import { useEffect, useRef, useState } from "react";

export default function PinButton({ pin, size, label = true }: { pin: Pin; size?: "sm"; label?: boolean }) {
  const { has, boardOf, boards, remove, addToBoard, addToNewBoard } = useDashboard();
  const on = has(pin.id);
  const homeBoardId = boardOf(pin.id);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const stop = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); };

  const onClick = (e: React.MouseEvent) => {
    stop(e);
    if (on) { remove(pin.id); return; }            // already pinned → remove
    if (boards.length === 0) { addToNewBoard(pin); return; }  // pre-hydration safety
    if (boards.length === 1) { addToBoard(pin, boards[0].id); return; }
    setOpen((v) => !v);                             // several boards → let them choose
  };

  return (
    <span className="pinbtn-wrap" ref={wrapRef}>
      <button type="button"
        className={`pinbtn${size === "sm" ? " pinbtn--sm" : ""}${on ? " pinned" : ""}`}
        aria-pressed={on} aria-haspopup={!on && boards.length > 1 ? "menu" : undefined} aria-expanded={open || undefined}
        aria-label={on ? "Remove from your dashboard" : "Add this to your Custom Dashboard"}
        title={on ? "Remove from your dashboard" : "Add this to your Custom Dashboard"}
        onClick={onClick}>
        <span className="pinbtn__ic" aria-hidden="true">{on ? "✓" : "＋"}</span>
        {label && <span className="pinbtn__lbl">{on ? "On dashboard" : "Add to dashboard"}</span>}
      </button>

      {open && !on && (
        <div className="pinmenu" role="menu" aria-label="Choose a board">
          <div className="pinmenu__hd">Add to board</div>
          {boards.map((b) => {
            const here = b.id === homeBoardId;
            return (
              <button key={b.id} type="button" role="menuitem" className="pinmenu__item"
                onClick={(e) => { stop(e); addToBoard(pin, b.id); setOpen(false); }}>
                <span className="pinmenu__name">{b.name}</span>
                <span className="pinmenu__n">{b.pins.length}</span>
                {here && <span className="pinmenu__on" aria-hidden="true">✓</span>}
              </button>
            );
          })}
          <button type="button" role="menuitem" className="pinmenu__item pinmenu__item--new"
            onClick={(e) => { stop(e); addToNewBoard(pin); setOpen(false); }}>
            ＋ New board
          </button>
        </div>
      )}
    </span>
  );
}
