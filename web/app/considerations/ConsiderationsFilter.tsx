"use client";

// AFC/NFC → division → team navigator for NFL Special Considerations. The cards are rendered
// server-side (they carry data-confs / data-teams); this control just filters which show, via
// a scoped <style> rule — so the complex card (weather, refs, incentives, coaching) stays put.
import { useMemo, useState } from "react";
import { NFL_DIV, type Conf } from "./nflDiv";

const DIVS = ["East", "North", "South", "West"] as const;

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
