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

// AP-style short forms for the state word, applied ONLY in "<State> State" — so "Florida State"
// becomes "Fla St" while the University of Florida stays "Florida". Shortening the standalone
// school name would be both unnecessary and ambiguous; it is the two-word names that overrun the
// player column ("Ashton Daniels (QB1, Florida St)" measured 223px in a 158px cell).
const STATE_WORD: Record<string, string> = {
  Florida: "Fla", Washington: "Wash", Michigan: "Mich", Mississippi: "Miss",
  Tennessee: "Tenn", Kentucky: "Ky", Louisiana: "La", Oklahoma: "Okla",
  Colorado: "Colo", Arizona: "Ariz", Georgia: "Ga", Virginia: "Va",
  Pennsylvania: "Penn", Illinois: "Ill", Indiana: "Ind", Minnesota: "Minn",
  Wisconsin: "Wis", Missouri: "Mo", Alabama: "Ala", Arkansas: "Ark",
  Nebraska: "Neb", Oregon: "Ore", Kansas: "Kan", California: "Cal",
};

/** 🚨 ABBREVIATING AN ALREADY-ABBREVIATED NAME MUST BE A NO-OP, and it was not.
 *
 *  Two curated entries produce a name the generic rules then shorten AGAIN:
 *
 *      "Appalachian State" -> "App State" -> re-applied -> "App St"
 *      "Jacksonville State" -> "Jax State" -> re-applied -> "Jax St"
 *
 *  That matters because the two names reaching this function are not always the same spelling
 *  of a school. CFBD — and so the generated projections file — calls the school "App State",
 *  while the odds feed calls it "Appalachian State Mountaineers". Run both through here and
 *  one came out "App St" and the other "App State", so one game rendered as TWO cards on
 *  /ncaaf/model/players: "App St @ Coastal Car." and "App State @ Coastal Car.".
 *
 *  Treating every curated OUTPUT as a fixed point makes the function idempotent, so a name
 *  that has already been through it is returned unchanged however many times it is applied. */
const SHORT = new Set(Object.values(ABBR));

export function abbrevTeam(name: string): string {
  if (!name) return name;
  if (ABBR[name]) return ABBR[name];
  if (SHORT.has(name)) return name;
  let s = name.replace(/^(\w+) State$/, (m, w: string) => `${STATE_WORD[w] ?? w} State`);
  s = s.replace(/\bState\b/g, "St");
  s = s
    .replace(/^North /, "N. ").replace(/^South /, "S. ")
    .replace(/^East /, "E. ").replace(/^West /, "W. ")
    .replace(/^Central /, "C. ")
    .replace(/^Northern /, "N. ").replace(/^Southern /, "S. ")
    .replace(/^Eastern /, "E. ").replace(/^Western /, "W. ");
  return s;
}
