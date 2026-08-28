"use client";

// AFC/NFC → division → team navigator for NFL Special Considerations. The cards are rendered
// server-side (they carry data-confs / data-teams); this control just filters which show, via
// a scoped <style> rule — so the complex card (weather, refs, incentives, coaching) stays put.
import { useMemo, useState } from "react";

type Conf = "AFC" | "NFC";
const DIVS = ["East", "North", "South", "West"] as const;
export const NFL_DIV: Record<string, { conf: Conf; div: string }> = {
  BUF: { conf: "AFC", div: "East" }, MIA: { conf: "AFC", div: "East" }, NE: { conf: "AFC", div: "East" }, NYJ: { conf: "AFC", div: "East" },
  BAL: { conf: "AFC", div: "North" }, CIN: { conf: "AFC", div: "North" }, CLE: { conf: "AFC", div: "North" }, PIT: { conf: "AFC", div: "North" },
  HOU: { conf: "AFC", div: "South" }, IND: { conf: "AFC", div: "South" }, JAX: { conf: "AFC", div: "South" }, TEN: { conf: "AFC", div: "South" },
  DEN: { conf: "AFC", div: "West" }, KC: { conf: "AFC", div: "West" }, LV: { conf: "AFC", div: "West" }, LAC: { conf: "AFC", div: "West" },
  DAL: { conf: "NFC", div: "East" }, NYG: { conf: "NFC", div: "East" }, PHI: { conf: "NFC", div: "East" }, WAS: { conf: "NFC", div: "East" },
  CHI: { conf: "NFC", div: "North" }, DET: { conf: "NFC", div: "North" }, GB: { conf: "NFC", div: "North" }, MIN: { conf: "NFC", div: "North" },
  ATL: { conf: "NFC", div: "South" }, CAR: { conf: "NFC", div: "South" }, NO: { conf: "NFC", div: "South" }, TB: { conf: "NFC", div: "South" },
  ARI: { conf: "NFC", div: "West" }, LAR: { conf: "NFC", div: "West" }, SF: { conf: "NFC", div: "West" }, SEA: { conf: "NFC", div: "West" },
};

export default function ConsiderationsFilter({ gameTeams, gridId = "cxgames" }: { gameTeams: string[]; gridId?: string }) {
  const [conf, setConf] = useState<"" | Conf>("");
  const [team, setTeam] = useState("");
  const have = useMemo(() => new Set(gameTeams), [gameTeams]);

  const groups = useMemo(() => {
    const confs: Conf[] = conf ? [conf] : ["AFC", "NFC"];
    return confs.flatMap((c) => DIVS.map((d) => ({
      label: conf ? d : `${c} ${d}`,
      teams: Object.keys(NFL_DIV).filter((t) => NFL_DIV[t].conf === c && NFL_DIV[t].div === d).sort(),
    })));
  }, [conf]);

  // Hide the cards that don't match. data-confs/data-teams are space-separated (a game has two
  // teams, possibly two conferences), so match with the ~= word selector.
  const rule = useMemo(() => {
    if (team) return `#${gridId} > article:not([data-teams~="${team}"]){display:none!important}`;
    if (conf) return `#${gridId} > article:not([data-confs~="${conf}"]){display:none!important}`;
    return "";
  }, [conf, team, gridId]);

  return (
    <div className="lictl">
      <style>{rule}</style>
      <label className="lictl__f">
        <span className="lictl__k">Conference</span>
        <select className="lictl__sel" value={conf} onChange={(e) => { setConf(e.target.value as "" | Conf); setTeam(""); }}>
          <option value="">Both conferences</option>
          <option value="AFC">AFC</option>
          <option value="NFC">NFC</option>
        </select>
      </label>
      <label className="lictl__f">
        <span className="lictl__k">Team</span>
        <select className="lictl__sel" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">{conf ? `All ${conf} teams` : "All teams"}</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.teams.map((t) => <option key={t} value={t}>{have.has(t) ? `● ${t}` : t}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {(conf || team) && (
        <button type="button" className="lictl__clear" onClick={() => { setConf(""); setTeam(""); }}>Clear</button>
      )}
    </div>
  );
}
