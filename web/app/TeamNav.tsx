"use client";
import { useEffect, useRef, useState } from "react";

// A team selector that mirrors the week wheel (WeekNav): a horizontal sliding track
// of team chips with ‹ › controls, ~4 visible before it scrolls. Unlike the week nav
// this jumps WITHIN the page — each chip smooth-scrolls to that team's section — and a
// scroll-spy highlights whichever team is currently in view. Alphabetical, so members
// can find their favorite team fast instead of scrolling the whole wall.
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

  // Scroll-spy: highlight the team section nearest the top of the viewport.
  useEffect(() => {
    const secs = teams.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    if (!secs.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    secs.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [teams]);

  // Keep the active chip within view in the track.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".teamnav__t.active")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  const slide = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(180, el.clientWidth * 0.7), behavior: "smooth" });
  };
  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            onClick={() => jump(t.id)}
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
