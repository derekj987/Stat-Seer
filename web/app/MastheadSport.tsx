"use client";

// Sport wayfinding badge for the inner-page masthead. When you're inside a section
// (The Model / Context / Value Finder), this sits in the masthead's open band so it's
// obvious WHICH sport's section you're on — NFL vs College Football. Route-driven, the
// same nfl/ncaaf detection the sports strip uses; renders nothing on non-sport pages.
import { usePathname } from "next/navigation";

const NFL_PREFIXES = [
  "/model", "/context", "/considerations", "/tailgate", "/lines", "/props", "/best", "/preseason",
];

function activeSport(path: string): "nfl" | "ncaaf" | null {
  if (path === "/ncaaf" || path.startsWith("/ncaaf/")) return "ncaaf";
  if (path === "/nfl") return "nfl";
  if (NFL_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return "nfl";
  return null;
}

const LABEL: Record<"nfl" | "ncaaf", string> = { nfl: "NFL", ncaaf: "NCAAF" };

function Football() {
  return (
    <svg className="msport__ball" viewBox="0 0 60 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 17 C6 5.5 54 5.5 54 17 C54 28.5 6 28.5 6 17 Z"
        fill="#8a5a2c" stroke="#5c3a19" strokeWidth="1.6" />
      {/* tip stitches */}
      <line x1="9" y1="17" x2="14.5" y2="17" stroke="#f4e9d6" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="45.5" y1="17" x2="51" y2="17" stroke="#f4e9d6" strokeWidth="1.7" strokeLinecap="round" />
      {/* center laces */}
      <line x1="24" y1="17" x2="36" y2="17" stroke="#f4e9d6" strokeWidth="2.1" strokeLinecap="round" />
      <line x1="26.5" y1="13.5" x2="26.5" y2="20.5" stroke="#f4e9d6" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="30" y1="13" x2="30" y2="21" stroke="#f4e9d6" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="33.5" y1="13.5" x2="33.5" y2="20.5" stroke="#f4e9d6" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function MastheadSport() {
  const sport = activeSport(usePathname() || "/");
  if (!sport) return null;
  return (
    <div className={`msport msport--${sport}`} role="img" aria-label={`${LABEL[sport]} section`}>
      <Football />
      <span className="msport__name">{LABEL[sport]}</span>
    </div>
  );
}
