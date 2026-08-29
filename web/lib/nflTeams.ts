// NFL teams for the profile "favorite teams" picker. Abbreviations match the ones used across the
// board (NFL_DIV, the odds feed). We use a team COLOR + name — not logos — on purpose: team logos
// are trademarks, and we already chose to skip copyrighted marks (see the player-photo call). A
// colored dot + name reads cleanly and carries no IP risk.
export interface NflTeam { abbr: string; name: string; color: string }

export const NFL_TEAMS: NflTeam[] = [
  { abbr: "ARI", name: "Cardinals", color: "#97233F" },
  { abbr: "ATL", name: "Falcons", color: "#A71930" },
  { abbr: "BAL", name: "Ravens", color: "#241773" },
  { abbr: "BUF", name: "Bills", color: "#00338D" },
  { abbr: "CAR", name: "Panthers", color: "#0085CA" },
  { abbr: "CHI", name: "Bears", color: "#0B162A" },
  { abbr: "CIN", name: "Bengals", color: "#FB4F14" },
  { abbr: "CLE", name: "Browns", color: "#311D00" },
  { abbr: "DAL", name: "Cowboys", color: "#003594" },
  { abbr: "DEN", name: "Broncos", color: "#FB4F14" },
  { abbr: "DET", name: "Lions", color: "#0076B6" },
  { abbr: "GB", name: "Packers", color: "#203731" },
  { abbr: "HOU", name: "Texans", color: "#03202F" },
  { abbr: "IND", name: "Colts", color: "#002C5F" },
  { abbr: "JAX", name: "Jaguars", color: "#006778" },
  { abbr: "KC", name: "Chiefs", color: "#E31837" },
  { abbr: "LV", name: "Raiders", color: "#333333" },
  { abbr: "LAC", name: "Chargers", color: "#0080C6" },
  { abbr: "LAR", name: "Rams", color: "#003594" },
  { abbr: "MIA", name: "Dolphins", color: "#008E97" },
  { abbr: "MIN", name: "Vikings", color: "#4F2683" },
  { abbr: "NE", name: "Patriots", color: "#002244" },
  { abbr: "NO", name: "Saints", color: "#9F8958" },
  { abbr: "NYG", name: "Giants", color: "#0B2265" },
  { abbr: "NYJ", name: "Jets", color: "#125740" },
  { abbr: "PHI", name: "Eagles", color: "#004C54" },
  { abbr: "PIT", name: "Steelers", color: "#B8860B" },
  { abbr: "SF", name: "49ers", color: "#AA0000" },
  { abbr: "SEA", name: "Seahawks", color: "#002244" },
  { abbr: "TB", name: "Buccaneers", color: "#D50A0A" },
  { abbr: "TEN", name: "Titans", color: "#0C2340" },
  { abbr: "WAS", name: "Commanders", color: "#5A1414" },
];

export const NFL_TEAM = new Map(NFL_TEAMS.map((t) => [t.abbr, t]));
