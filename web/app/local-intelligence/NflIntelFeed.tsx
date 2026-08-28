"use client";

// The NFL Local Intelligence feed with a conference/team navigator: pick AFC or NFC, then a
// team (grouped by division), and filter the Fan Stock feed to it. A ● marks teams with buzz
// this week. Client-side filtering over the buzz the server already loaded for the week.
import { useMemo, useState } from "react";
import { stockLabel, stockArrows, type Buzz } from "@/lib/tailgate";
import AddToSlip from "../AddToSlip";

type Conf = "AFC" | "NFC";
const DIVS = ["East", "North", "South", "West"] as const;
// nickname (Buzz.team) -> { conference, division }
const NFL_TEAMS: Record<string, { conf: Conf; div: string }> = {
  Bills: { conf: "AFC", div: "East" }, Dolphins: { conf: "AFC", div: "East" }, Patriots: { conf: "AFC", div: "East" }, Jets: { conf: "AFC", div: "East" },
  Ravens: { conf: "AFC", div: "North" }, Bengals: { conf: "AFC", div: "North" }, Browns: { conf: "AFC", div: "North" }, Steelers: { conf: "AFC", div: "North" },
  Texans: { conf: "AFC", div: "South" }, Colts: { conf: "AFC", div: "South" }, Jaguars: { conf: "AFC", div: "South" }, Titans: { conf: "AFC", div: "South" },
  Broncos: { conf: "AFC", div: "West" }, Chiefs: { conf: "AFC", div: "West" }, Raiders: { conf: "AFC", div: "West" }, Chargers: { conf: "AFC", div: "West" },
  Cowboys: { conf: "NFC", div: "East" }, Giants: { conf: "NFC", div: "East" }, Eagles: { conf: "NFC", div: "East" }, Commanders: { conf: "NFC", div: "East" },
  Bears: { conf: "NFC", div: "North" }, Lions: { conf: "NFC", div: "North" }, Packers: { conf: "NFC", div: "North" }, Vikings: { conf: "NFC", div: "North" },
  Falcons: { conf: "NFC", div: "South" }, Panthers: { conf: "NFC", div: "South" }, Saints: { conf: "NFC", div: "South" }, Buccaneers: { conf: "NFC", div: "South" },
  Cardinals: { conf: "NFC", div: "West" }, Rams: { conf: "NFC", div: "West" }, "49ers": { conf: "NFC", div: "West" }, Seahawks: { conf: "NFC", div: "West" },
};

const TEAM_COLOR: Record<string, string> = {
  Cardinals: "#e04f6e", Falcons: "#e24857", Ravens: "#9b7be8", Bills: "#4a8fe0",
  Panthers: "#35b4e8", Bears: "#e8792e", Bengals: "#fb6a2e", Browns: "#e8843c",
  Cowboys: "#7aa5e8", Broncos: "#fb7a3c", Lions: "#4aa8e0", Packers: "#5cb06a",
  Texans: "#e24857", Colts: "#5a9ae0", Jaguars: "#2fb6be", Chiefs: "#e8455a",
  Chargers: "#35a8e0", Rams: "#6a9ae8", Raiders: "#b3bac0", Dolphins: "#2ec6ce",
  Vikings: "#8a6fe0", Patriots: "#6a9ae8", Saints: "#cbab52", Giants: "#5a8fe8",
  Jets: "#4fa872", Eagles: "#2fae90", Steelers: "#e8c342", Seahawks: "#69be28",
  "49ers": "#cb5a6e", Buccaneers: "#d84a3c", Titans: "#4aace0", Commanders: "#cf7a5c",
};
const teamColor = (t: string) => TEAM_COLOR[t] ?? "var(--ink)";

function BuzzCard({ b }: { b: Buzz }) {
  const label = stockLabel(b.direction, b.heat);
  const srcs = [...new Map(b.sources.map((s) => [s.board, s])).values()];
  return (
    <article className={`tgpost tgpost--${b.direction}`}>
      <header className="tgpost__head">
        <span className="tgpost__player" style={{ color: teamColor(b.team) }}>{b.player}</span>
        <span className="tgpost__who">{b.team} fans {b.direction === "up" ? "buying" : "selling"}</span>
        <span className={`tgstock tgstock--${b.direction}`} title={`Fan stock: ${label}`}>
          <span className="tgstock__arw" aria-hidden="true">{stockArrows(b.direction, b.heat)}</span>
          <span className="tgstock__l">{label}</span>
        </span>
      </header>
      <p className="tgpost__body">{b.take}{b.matchup ? ` (${b.matchup})` : ""}</p>
      <div className={`tgverdict tgverdict--${b.direction}`}>
        <span className="tgverdict__call">
          <span className="tgverdict__k">Verdict</span>
          <b className="tgprop">{b.angle}</b>
          <span className="tgverdict__side">{b.direction === "up" ? "▲ over" : "▼ under"}</span>
        </span>
        <AddToSlip item={{ id: `fan-${b.id}`, kind: "fan", title: b.player, detail: `${b.team} — ${b.angle}` }} />
      </div>
      <div className="tgpost__foot">
        Heard on {srcs.map((s, i) => (
          <span key={`${b.id}-${i}`} className="tgsrc">
            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.board}</a> : s.board}
          </span>
        ))}
      </div>
    </article>
  );
}

export default function NflIntelFeed({ buzz }: { buzz: Buzz[] }) {
  const [conf, setConf] = useState<"" | Conf>("");
  const [team, setTeam] = useState("");
  const buzzTeams = useMemo(() => new Set(buzz.map((b) => b.team)), [buzz]);

  // Team dropdown: every team, grouped by division. When a conference is picked, only its
  // four divisions; otherwise all eight (AFC then NFC). A ● marks teams with buzz this week.
  const groups = useMemo(() => {
    const confs: Conf[] = conf ? [conf] : ["AFC", "NFC"];
    const out: { label: string; teams: string[] }[] = [];
    for (const c of confs) {
      for (const d of DIVS) {
        const teams = Object.keys(NFL_TEAMS)
          .filter((t) => NFL_TEAMS[t].conf === c && NFL_TEAMS[t].div === d).sort();
        out.push({ label: conf ? d : `${c} ${d}`, teams });
      }
    }
    return out;
  }, [conf]);

  const shown = useMemo(() => {
    let rows = buzz;
    if (team) rows = rows.filter((b) => b.team === team);
    else if (conf) rows = rows.filter((b) => NFL_TEAMS[b.team]?.conf === conf);
    return rows;
  }, [buzz, conf, team]);

  const byTeam = useMemo(() => {
    const m = new Map<string, Buzz[]>();
    for (const b of shown) (m.get(b.team) ?? m.set(b.team, []).get(b.team)!).push(b);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [shown]);

  return (
    <>
      <div className="lictl">
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
                {g.teams.map((t) => <option key={t} value={t}>{buzzTeams.has(t) ? `● ${t}` : t}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {(conf || team) && (
          <button type="button" className="lictl__clear" onClick={() => { setConf(""); setTeam(""); }}>Clear</button>
        )}
      </div>

      {byTeam.length === 0 ? (
        <p className="foot">
          {team
            ? `No buzz for the ${team} this week yet — check back closer to kickoff.`
            : "No buzz matches this filter yet — try the other conference, or clear the filter."}
        </p>
      ) : (
        byTeam.map(([tm, items]) => (
          <section className="tgteam" id={`tgteam-${tm.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} key={tm} aria-label={`${tm} fan stock`}>
            <h3 className="tgteam__h" style={{ color: teamColor(tm) }}>
              {tm}<span className="tgteam__n">{items.length}</span>
              {NFL_TEAMS[tm] && <span className="tgteam__conf">{NFL_TEAMS[tm].conf} {NFL_TEAMS[tm].div}</span>}
            </h3>
            <div className="tgfeed">
              {[...items].sort((a, b) => b.heat - a.heat || a.player.localeCompare(b.player)).map((b) => <BuzzCard key={b.id} b={b} />)}
            </div>
          </section>
        ))
      )}
    </>
  );
}
