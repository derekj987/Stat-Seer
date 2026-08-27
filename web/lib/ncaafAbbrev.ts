// Compact display names for college-football schools so long names don't overflow the
// board's narrow columns (the GAME cell and the spread cells both show team names).
// A small curated map for the well-known short forms; a generic fallback then trims
// "State" -> "St" and a leading direction word -> its initial. Keep it recognizable —
// this is display-only; the real team name is unchanged in the data.

const ABBR: Record<string, string> = {
  "North Dakota State": "N. Dakota St",
  "South Dakota State": "S. Dakota St",
  "Jacksonville State": "Jax State",
  "North Carolina": "N. Carolina",
  "Middle Tennessee": "Middle Tenn",
  "Massachusetts": "UMass",
  "Florida International": "FIU",
  "Florida Atlantic": "FAU",
  "Louisiana Monroe": "UL Monroe",
  "Louisiana Lafayette": "Louisiana",
  "Appalachian State": "App State",
  "Coastal Carolina": "Coastal Car.",
  "Georgia Southern": "Ga. Southern",
  "Sam Houston State": "Sam Houston",
  "Western Kentucky": "W. Kentucky",
  "San José State": "San José St",
  "San Jose State": "San Jose St",
};

export function abbrevTeam(name: string): string {
  if (!name) return name;
  if (ABBR[name]) return ABBR[name];
  let s = name.replace(/\bState\b/g, "St");
  s = s
    .replace(/^North /, "N. ").replace(/^South /, "S. ")
    .replace(/^East /, "E. ").replace(/^West /, "W. ")
    .replace(/^Central /, "C. ")
    .replace(/^Northern /, "N. ").replace(/^Southern /, "S. ")
    .replace(/^Eastern /, "E. ").replace(/^Western /, "W. ");
  return s;
}
