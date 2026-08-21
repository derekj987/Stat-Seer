// Players who are OUT for the season (IR / season-ending injury). Fan buzz surfaces them
// (a hurt player "trends"), and with no prop posted they read as a false "under" — so we
// drop them from the fan-analysis picks. Add names as injuries happen; matched loosely
// (case / punctuation / suffix-insensitive). Until a live injury feed is wired, this is the
// hand-maintained guard. See [[practice-data-feed]] for the eventual automated status source.
export const IR_OUT: string[] = [
  "Jayden Higgins",   // Texans WR — torn ACL, 2026 preseason
];

const norm = (n: string) =>
  n.toLowerCase().replace(/[.'-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

const IR_SET = new Set(IR_OUT.map(norm));

/** Is this player out for the season (on our IR-out list)? */
export const isSeasonOut = (player: string): boolean => IR_SET.has(norm(player));
