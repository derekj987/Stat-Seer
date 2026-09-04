"use client";

// The interactive Local Intelligence feed: pick a conference (grouped Power Four / Group of
// Five / Independent), then a team from that conference, and/or limit to this week's slate.
// Every team in the conference is listed; a ● marks teams with buzz today. Filtering is
// client-side over the buzz the server already loaded.
import { useMemo, useState } from "react";
import { NCAAF_CONF, NCAAF_CONF_TIERS } from "@/lib/ncaafConferences";
import { stockLabel, stockArrows, type Buzz } from "@/lib/cfbTailgate";
import AddToSlip from "../../AddToSlip";

const TEAM_COLOR: Record<string, string> = {
  USC: "#e8455a", TCU: "#8a6fe0", "NC State": "#e24857", "North Carolina": "#4a9fe0",
  Virginia: "#e8843c", "San José State": "#4aa8e0", "Florida State": "#cb5a3c",
  Stanford: "#cb5a6e", UNLV: "#e8c342", Memphis: "#35a8e0", Alabama: "#e8455a",
  Georgia: "#cb5a3c", "Ohio State": "#e24857", Michigan: "#4a8fe0", Texas: "#e8843c",
  Oregon: "#5cb06a", "Notre Dame": "#cbab52", LSU: "#8a6fe0", Tennessee: "#e8843c",
  Clemson: "#e8843c", Miami: "#2fae90",
};
// Team sections shown before the dropdown, in the UNFILTERED view only. Capped on TEAMS rather than
// cards, so a team's buzz is never split across the boundary. Once a conference/team (or the slate)
// is chosen the reader has already narrowed the board deliberately, so everything is shown.
const TEAM_CAP = 2;

const teamColor = (t: string) => TEAM_COLOR[t] ?? "var(--gold)";

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

export default function LocalIntelFeed({ buzz, slate }: { buzz: Buzz[]; slate: string[] }) {
  const [conf, setConf] = useState("");
  const [team, setTeam] = useState("");
  const [slateOnly, setSlateOnly] = useState(false);
  const slateSet = useMemo(() => new Set(slate), [slate]);
  const buzzTeams = useMemo(() => new Set(buzz.map((b) => b.team)), [buzz]);

  // Every team in the picked conference (all of them, not just ones with buzz), slate-limited
  // if that toggle is on. A ● in the option marks teams that actually have buzz today.
  const teamOptions = useMemo(() => {
    let ts = Object.keys(NCAAF_CONF);
    if (conf) ts = ts.filter((t) => NCAAF_CONF[t] === conf);
    if (slateOnly) ts = ts.filter((t) => slateSet.has(t));
    return ts.sort();
  }, [conf, slateOnly, slateSet]);

  const shown = useMemo(() => {
    let rows = buzz;
    if (team) rows = rows.filter((b) => b.team === team);
    else if (conf) rows = rows.filter((b) => NCAAF_CONF[b.team] === conf);
    if (slateOnly) rows = rows.filter((b) => slateSet.has(b.team));
    return rows;
  }, [buzz, conf, team, slateOnly, slateSet]);

  const byTeam = useMemo(() => {
    const m = new Map<string, Buzz[]>();
    for (const b of shown) (m.get(b.team) ?? m.set(b.team, []).get(b.team)!).push(b);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [shown]);

  // The cap applies only when nothing is filtered.
  const unfiltered = !conf && !team && !slateOnly;
  // One team's section. Shared by the visible head and the dropdown tail so both render identically.
  const teamSection = ([tm, items]: [string, Buzz[]]) => (
    <section className="tgteam" id={`tgteam-${tm.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} key={tm} aria-label={`${tm} fan stock`}>
      <h3 className="tgteam__h" style={{ color: teamColor(tm) }}>
        {tm}<span className="tgteam__n">{items.length}</span>
        {NCAAF_CONF[tm] ? <span className="tgteam__conf">{NCAAF_CONF[tm]}</span> : null}
      </h3>
      <div className="tgfeed">
        {[...items].sort((a, b) => b.heat - a.heat || a.player.localeCompare(b.player)).map((b) => <BuzzCard key={b.id} b={b} />)}
      </div>
    </section>
  );
  const head = unfiltered ? byTeam.slice(0, TEAM_CAP) : byTeam;
  const rest = unfiltered ? byTeam.slice(TEAM_CAP) : [];

  return (
    <>
      <div className="lictl">
        <label className="lictl__f">
          <span className="lictl__k">Conference</span>
          <select className="lictl__sel" value={conf} onChange={(e) => { setConf(e.target.value); setTeam(""); }}>
            <option value="">All conferences</option>
            {NCAAF_CONF_TIERS.map((t) => (
              <optgroup key={t.tier} label={t.tier}>
                {t.confs.map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="lictl__f">
          <span className="lictl__k">Team</span>
          <select className="lictl__sel" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">{conf ? `All ${conf} teams` : "All teams"}</option>
            {teamOptions.map((t) => <option key={t} value={t}>{buzzTeams.has(t) ? `● ${t}` : t}</option>)}
          </select>
        </label>
        <label className="lictl__slate">
          <input type="checkbox" checked={slateOnly} onChange={(e) => setSlateOnly(e.target.checked)} />
          This week&apos;s slate
        </label>
        {(conf || team || slateOnly) && (
          <button type="button" className="lictl__clear" onClick={() => { setConf(""); setTeam(""); setSlateOnly(false); }}>
            Clear
          </button>
        )}
      </div>

      {byTeam.length === 0 ? (
        <p className="foot">
          {team
            ? `No buzz for ${team} this week yet — check back closer to kickoff.`
            : "No buzz matches this filter yet — try another conference, or clear the filter."}
        </p>
      ) : (
        <>
          {head.map(teamSection)}
          {rest.length > 0 && (
            <details className="hb-showmore">
              <summary className="hb-showmore__sum">
                <span className="hb-showmore__chev" aria-hidden="true">&#9656;</span>
                <span className="hb-showmore__more">Show {rest.length} more team{rest.length === 1 ? "" : "s"}</span>
                <span className="hb-showmore__less">Collapse</span>
              </summary>
              {rest.map(teamSection)}
            </details>
          )}
        </>
      )}
    </>
  );
}
