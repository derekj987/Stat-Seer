// NFL conference/division map. Plain (non-"use client") module so BOTH the server component
// (page.tsx, which tags each card with data-confs) and the client filter can import the real
// object. If this lived in the "use client" ConsiderationsFilter, the server would receive a
// client-reference proxy and every NFL_DIV[team] lookup would be undefined — leaving data-confs
// empty and breaking conference filtering.
export type Conf = "AFC" | "NFC";

export const NFL_DIV: Record<string, { conf: Conf; div: string }> = {
  BUF: { conf: "AFC", div: "East" }, MIA: { conf: "AFC", div: "East" }, NE: { conf: "AFC", div: "East" }, NYJ: { conf: "AFC", div: "East" },
  BAL: { conf: "AFC", div: "North" }, CIN: { conf: "AFC", div: "North" }, CLE: { conf: "AFC", div: "North" }, PIT: { conf: "AFC", div: "North" },
  HOU: { conf: "AFC", div: "South" }, IND: { conf: "AFC", div: "South" }, JAX: { conf: "AFC", div: "South" }, TEN: { conf: "AFC", div: "South" },
  DEN: { conf: "AFC", div: "West" }, KC: { conf: "AFC", div: "West" }, LV: { conf: "AFC", div: "West" }, LAC: { conf: "AFC", div: "West" },
  DAL: { conf: "NFC", div: "East" }, NYG: { conf: "NFC", div: "East" }, PHI: { conf: "NFC", div: "East" }, WAS: { conf: "NFC", div: "East" },
  CHI: { conf: "NFC", div: "North" }, DET: { conf: "NFC", div: "North" }, GB: { conf: "NFC", div: "North" }, MIN: { conf: "NFC", div: "North" },
  ATL: { conf: "NFC", div: "South" }, CAR: { conf: "NFC", div: "South" }, NO: { conf: "NFC", div: "South" }, TB: { conf: "NFC", div: "South" },
  ARI: { conf: "NFC", div: "West" }, LA: { conf: "NFC", div: "West" }, SF: { conf: "NFC", div: "West" }, SEA: { conf: "NFC", div: "West" },
};
