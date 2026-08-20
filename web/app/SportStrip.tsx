"use client";

// Global sports strip — a thin bar under the site header, on every page. Live sports
// link to their home; the current sport is underlined; the rest read as "Soon". This
// is the single sport switcher for the app (replaces the old per-page SportTabs).
import { usePathname } from "next/navigation";
import { SPORTS } from "./Nav";

// NFL owns the root and the un-prefixed section routes; NCAAF lives under /ncaaf.
const NFL_PREFIXES = [
  "/model", "/context", "/considerations", "/tailgate", "/lines", "/props", "/best", "/preseason",
];

function activeSport(path: string): string | null {
  if (path === "/ncaaf" || path.startsWith("/ncaaf/")) return "ncaaf";
  if (path === "/nfl") return "nfl";
  if (NFL_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return "nfl";
  return null; // non-sport pages (forum, settings, auth, …) highlight nothing
}

export default function SportStrip() {
  const path = usePathname() || "/";
  const active = activeSport(path);
  return (
    <nav className="sportstrip" aria-label="Sports">
      <div className="sportstrip__in">
        {SPORTS.map((s) => {
          if (!s.live) {
            return (
              <span key={s.key} className="sportstrip__i sportstrip__i--soon">
                {s.label}<em className="sportstrip__soon">Soon</em>
              </span>
            );
          }
          const isActive = s.key === active;
          return (
            <a key={s.key} href={s.home}
              className={isActive ? "sportstrip__i sportstrip__i--active" : "sportstrip__i"}
              aria-current={isActive ? "page" : undefined}>{s.label}</a>
          );
        })}
      </div>
    </nav>
  );
}
