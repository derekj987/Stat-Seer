"use client";

// Special Considerations, organized like Local Intelligence: pick a conference (Power Four /
// Group of Five / Independent) then a team, or limit to this week's slate, and every matching
// game shows a context card — site, poll stakes, our power read, scoring, and the weather
// (with a wind flag). Client-side filtering over the full slate the server passed.
import { useMemo, useState } from "react";
import { NCAAF_CONF, NCAAF_CONF_TIERS } from "@/lib/ncaafConferences";
import { CFB_GAME_WEATHER, type CfbGameWeather } from "@/lib/cfbWeatherData";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { kickET } from "../CardCells";
import type { NcaafCardGame } from "../model-data";
import { groupByGameDay, dayBasis } from "@/lib/gameDays";
import { DayHeader } from "../../DayHeader";

type Rating = { rank: number; rating: number };
const WX = new Map(CFB_GAME_WEATHER.map((w) => [w.game, w]));

function weatherCell(w: CfbGameWeather): string {
  if (w.indoor) return "Indoor — weather is a non-factor";
  if (w.status === "ok") {
    const bits = [
      `${w.windMph} mph wind${w.gustMph ? ` (${w.gustMph} gust)` : ""}`,
      w.tempF != null ? `${w.tempF}°` : "", w.conditions ?? "",
    ].filter(Boolean);
    return bits.join(" · ") + (w.precipPct != null && w.precipPct >= 40 ? ` · ${w.precipPct}% precip` : "");
  }
  return "Forecast arrives ~2 weeks out";
}

function ConsiderationCard({ g, hfa, ratings }: { g: NcaafCardGame; hfa: number; ratings: Record<string, Rating> }) {
  const ranked = Boolean(g.apAway || g.apHome);
  const wx = WX.get(`${g.away} @ ${g.home}`);
  const rc = (team: string) => {
    const r = ratings[team];
    return r
      ? <>{abbrevTeam(team)} <b>{r.rating > 0 ? "+" : ""}{r.rating}</b> <span className="cxrank">(#{r.rank})</span></>
      : <>{abbrevTeam(team)} <span className="muted">outside top 25</span></>;
  };
  const poll = (team: string, ap?: number | null) => ap ? <><b>#{ap}</b> {abbrevTeam(team)}</> : <>{abbrevTeam(team)} <span className="muted">unranked</span></>;
  return (
    <article className={`cxcard${wx?.windFlag ? " cxcard--wind" : ""}`}>
      <header className="cxcard__head">
        <span className="matchup">{abbrevTeam(g.away)}<span className="at">@</span>{abbrevTeam(g.home)}</span>
        {g.commence && <time className="kick">{kickET(g.commence)}</time>}
        {g.neutral ? <span className="badge neutral">NEUTRAL</span> : null}
        {g.off ? <span className="badge neutral" title="off consensus">◆ OFF</span> : null}
      </header>
      <dl className="cxcard__rows">
        <div className="cxrow">
          <dt className="cxrow__k">Site</dt>
          <dd className="cxrow__v">
            {wx?.venue ? <>{wx.venue}{wx.city ? ` · ${wx.city}, ${wx.state}` : ""}</> : (g.neutral ? "Neutral site" : `${abbrevTeam(g.home)} — home`)}
            {g.neutral ? <span className="cxroof"> · no home edge</span> : <span className="cxroof"> · +{hfa}</span>}
          </dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Poll</dt>
          <dd className="cxrow__v">
            {ranked
              ? <>{poll(g.away, g.apAway)} <span className="at">vs</span> {poll(g.home, g.apHome)} <span className="cxinc__prog">AP Top 25</span></>
              : <span className="muted">Unranked matchup</span>}
          </dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Power</dt>
          <dd className="cxrow__v">{rc(g.away)} · {rc(g.home)} <span className="cxinc__prog">our rating</span></dd>
        </div>
        <div className={`cxrow${wx?.windFlag ? " cxrow--wind" : ""}`}>
          <dt className="cxrow__k">Weather</dt>
          <dd className="cxrow__v">{wx ? <>{wx.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {weatherCell(wx)}</> : <span className="muted">Forecast arriving</span>}</dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Scoring</dt>
          <dd className="cxrow__v">our total <b>{g.projTotal}</b>{g.marketTotal != null ? <> · market <b>{g.marketTotal}</b></> : null} <span className="cxinc__prog">implied</span></dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Conference</dt>
          <dd className="cxrow__v">{g.conf}</dd>
        </div>
      </dl>
    </article>
  );
}

const inConf = (g: NcaafCardGame, conf: string) => NCAAF_CONF[g.home] === conf || NCAAF_CONF[g.away] === conf;

export default function NcaafConsiderationsView({ games, ratings, hfa, slate, today, tomorrow }: {
  games: NcaafCardGame[]; ratings: Record<string, Rating>; hfa: number; slate: string[]; today: string; tomorrow: string;
}) {
  const [conf, setConf] = useState("");
  const [team, setTeam] = useState("");
  const [slateOnly, setSlateOnly] = useState(false);
  const slateSet = useMemo(() => new Set(slate), [slate]);

  const teamOptions = useMemo(() => {
    let ts = Object.keys(NCAAF_CONF);
    if (conf) ts = ts.filter((t) => NCAAF_CONF[t] === conf);
    if (slateOnly) ts = ts.filter((t) => slateSet.has(t));
    return ts.sort();
  }, [conf, slateOnly, slateSet]);
  const gameTeams = useMemo(() => new Set(games.flatMap((g) => [g.home, g.away])), [games]);

  const shown = useMemo(() => {
    let gs = games;
    if (team) gs = gs.filter((g) => g.home === team || g.away === team);
    else if (conf) gs = gs.filter((g) => inConf(g, conf));
    if (slateOnly) gs = gs.filter((g) => slateSet.has(g.home) || slateSet.has(g.away));
    return gs;
  }, [games, conf, team, slateOnly, slateSet]);

  return (
    <>
      <div className="lictl">
        <label className="lictl__f">
          <span className="lictl__k">Conference</span>
          <select className="lictl__sel" value={conf} onChange={(e) => { setConf(e.target.value); setTeam(""); }}>
            <option value="">All conferences</option>
            {NCAAF_CONF_TIERS.map((t) => (
              <optgroup key={t.tier} label={t.tier}>{t.confs.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label className="lictl__f">
          <span className="lictl__k">Team</span>
          <select className="lictl__sel" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">{conf ? `All ${conf} teams` : "All teams"}</option>
            {teamOptions.map((t) => <option key={t} value={t}>{gameTeams.has(t) ? `● ${t}` : t}</option>)}
          </select>
        </label>
        <label className="lictl__slate">
          <input type="checkbox" checked={slateOnly} onChange={(e) => setSlateOnly(e.target.checked)} />
          This week&apos;s slate
        </label>
        {(conf || team || slateOnly) && (
          <button type="button" className="lictl__clear" onClick={() => { setConf(""); setTeam(""); setSlateOnly(false); }}>Clear</button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="foot">No games match this filter — try another conference, or clear it.</p>
      ) : (
        <div aria-label="Game considerations">
          <div className="daygrid">
            {groupByGameDay(shown, (g) => g.commence, today, tomorrow).map((grp) => (
              <div className="daygrid__day" key={grp.key} style={dayBasis(grp.items.length, 2, 476, 16)}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                <section className="cxgrid">
                  {grp.items.map((g) => <ConsiderationCard key={`${g.away}-${g.home}`} g={g} hfa={hfa} ratings={ratings} />)}
                </section>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
