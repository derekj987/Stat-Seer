"use client";

// A scroll "?" that explains a table/section. Lives in the panel BODY (never inside a
// <summary>), so tapping it can't toggle the surrounding expand/collapse. Hover on
// desktop, tap on phones; the bubble is position:fixed and clamped to the viewport, so it
// can't be clipped by a panel's overflow or run off the screen edge. Tap the scrim (or
// scroll / Esc) to dismiss.
import { useState, useRef, useEffect, useCallback } from "react";

export default function Tip({ text, label = "What am I looking at?" }: { text: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const half = Math.min(300, vw - 24) / 2;
    const left = Math.max(12 + half, Math.min(r.left + r.width / 2, vw - 12 - half));
    setPos({ top: r.bottom + 8, left });
  }, []);

  const show = useCallback(() => { place(); setOpen(true); }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="tip">
      <button
        ref={ref}
        type="button"
        className="tip__seal"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); open ? hide() : show(); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scroll1.png?v=1" alt="" className="tip__icon" width={22} height={22} />
      </button>
      {open && (
        <>
          <span className="tip__scrim" onClick={(e) => { e.preventDefault(); e.stopPropagation(); hide(); }} aria-hidden="true" />
          <span className="tip__bubble" role="tooltip" style={{ top: pos.top, left: pos.left }}>{text}</span>
        </>
      )}
    </span>
  );
}
