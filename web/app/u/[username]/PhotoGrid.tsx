"use client";

// Renders a set of image URLs as a grid with a click-to-open lightbox. Two layouts:
// "post" (1–4+ mosaic inside a feed post) and "gallery" (uniform square thumbnails for the Media tab).
import { useCallback, useEffect, useState } from "react";

export default function PhotoGrid({ urls, variant = "post" }: { urls: string[]; variant?: "post" | "gallery" }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = urls.length;

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + count) % count)), [count]);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (count === 0) return null;

  // In a post, cap the mosaic at 4 tiles and badge the overflow on the last one.
  const shown = variant === "post" ? urls.slice(0, 4) : urls;
  const extra = variant === "post" ? count - shown.length : 0;
  const gridCls = variant === "gallery"
    ? "pgrid pgrid--gallery"
    : `pgrid pgrid--post pgrid--n${Math.min(count, 4)}`;

  return (
    <>
      <div className={gridCls}>
        {shown.map((u, i) => (
          <button type="button" key={u + i} className="pgrid__cell" onClick={() => setOpen(i)}
            aria-label={`Open image ${i + 1} of ${count}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" loading="lazy" />
            {extra > 0 && i === shown.length - 1 && <span className="pgrid__more">+{extra}</span>}
          </button>
        ))}
      </div>

      {open != null && (
        <div className="lbox" role="dialog" aria-modal="true" onClick={close}>
          <button type="button" className="lbox__x" onClick={close} aria-label="Close">×</button>
          {count > 1 && (
            <button type="button" className="lbox__nav lbox__nav--prev"
              onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous">‹</button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lbox__img" src={urls[open]} alt="" onClick={(e) => e.stopPropagation()} />
          {count > 1 && (
            <button type="button" className="lbox__nav lbox__nav--next"
              onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next">›</button>
          )}
          {count > 1 && <span className="lbox__count">{open + 1} / {count}</span>}
        </div>
      )}
    </>
  );
}
