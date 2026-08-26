"use client";
import { useEffect, useRef, useState } from "react";

// A team selector that mirrors the week wheel (WeekNav): a horizontal sliding track
// of team chips with ‹ › controls, ~4 visible before it scrolls. Selecting a team
// FILTERS the wall to just that team — only the selected team's section shows, the rest
// are hidden. Alphabetical, so members can find their favorite team fast. The team
// sections are plain server-rendered siblings (not inside this island), so we toggle
// their display directly; if the JS never runs, every team stays visible (safe fallback).
export type TeamNavItem = { team: string; color: string; id: string; count: number };

export function TeamNav({ teams }: { teams: TeamNavItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [active, setActive] = useState<string | null>(teams[0]?.id ?? null);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    setOverflow(el.scrollWidth - el.clientWidth > 2);
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 2);
  };

  useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show only the selected team's section; hide the rest.
  useEffect(() => {
    teams.forEach((t) => {
      const el = document.getElementById(t.id);
      if (el) el.style.display = t.id === active ? "" : "none";
    });
    // On unmount, restore every section so other views aren't left hidden.
    return () => { teams.forEach((t) => { const el = document.getElementById(t.id); if (el) el.style.display = ""; }); };
  }, [active, teams]);

  // Keep the active chip within view in the track.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".teamnav__t.active")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  const slide = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(180, el.clientWidth * 0.7), behavior: "smooth" });
  };

  if (!teams.length) return null;

  return (
    <nav className={`teamnav${overflow ? " teamnav--slide" : ""}`} aria-label="Jump to team">
      <span className="teamnav__label">Team</span>
      {overflow && (
        <button type="button" className="teamnav__arw" onClick={() => slide(-1)} disabled={atStart} aria-label="Previous teams">‹</button>
      )}
      <div className="teamnav__list" ref={ref} onScroll={sync}>
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={t.id === active ? "teamnav__t active" : "teamnav__t"}
            aria-current={t.id === active ? "true" : undefined}
          >
            <span className="teamnav__dot" style={{ background: t.color }} aria-hidden="true" />
            {t.team}
          </button>
        ))}
      </div>
      {overflow && (
        <button type="button" className="teamnav__arw" onClick={() => slide(1)} disabled={atEnd} aria-label="More teams">›</button>
      )}
    </nav>
  );
}
