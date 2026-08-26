"use client";
import { useEffect, useRef, useState } from "react";

// The week selector, as a sliding toolbar: a horizontal track of weeks with ‹ › controls
// that scroll it, the active week auto-centered, and the arrows hidden when everything fits.
// Shared across every section page (NFL) and both sports. Links are plain <a> so week state
// still lives in the URL (?week=N) and the page re-renders server-side.
export function WeekNav({
  min = 1,
  max = 18,
  current,
  base,
  params,
}: {
  min?: number;
  max?: number;
  current: number;
  base: string; // path, e.g. "/context" or "/model/players"
  params?: string; // extra query, e.g. "cat=rush" (week= is always appended)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    setOverflow(el.scrollWidth - el.clientWidth > 2);
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 2);
  };

  useEffect(() => {
    sync();
    ref.current
      ?.querySelector<HTMLElement>(".weeknav__w.active")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slide = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(140, el.clientWidth * 0.7), behavior: "smooth" });
  };

  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  const href = (w: number) => `${base}?${params ? params + "&" : ""}week=${w}`;

  return (
    <nav className={`weeknav${overflow ? " weeknav--slide" : ""}`} aria-label="Select week">
      <span className="weeknav__label">Week</span>
      {overflow && (
        <button type="button" className="weeknav__arw" onClick={() => slide(-1)} disabled={atStart} aria-label="Earlier weeks">
          ‹
        </button>
      )}
      <div className="weeknav__list" ref={ref} onScroll={sync}>
        {weeks.map((w) => (
          <a
            key={w}
            href={href(w)}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}
          >
            {w}
          </a>
        ))}
      </div>
      {overflow && (
        <button type="button" className="weeknav__arw" onClick={() => slide(1)} disabled={atEnd} aria-label="Later weeks">
          ›
        </button>
      )}
    </nav>
  );
}
