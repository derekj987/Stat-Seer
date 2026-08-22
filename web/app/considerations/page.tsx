import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, type ModelPrediction } from "@/lib/model";
import { weekRefs } from "@/lib/refAssignments";
import { REF_STATS, REF_LEAGUE } from "@/lib/refStats";
import { GAME_WEATHER, WEATHER_WEEK, WEATHER_UPDATED, type GameWeather } from "@/lib/weatherData";
import { INCENTIVE_WATCH } from "@/lib/incentiveWatch";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";

// ---- per-game card fields (CONTEXT, never a pick) ----
const wxSite = (w: GameWeather) => `${w.venue}${w.city ? ` · ${w.city}, ${w.state}` : ""}`;
const roofLabel = (roof: string) => roof === "dome" ? "Dome" : roof === "retractable" ? "Retractable roof" : "Outdoor";

/** Short weather line for the card. */
function weatherCell(w: GameWeather): string {
  if (w.indoor) return "Indoor — weather is a non-factor";
  if (w.status === "ok") {
    const bits = [`${w.windMph} mph wind${w.gustMph ? ` (${w.gustMph} gust)` : ""}`, `${w.tempF}°`, w.conditions].filter(Boolean);
    return bits.join(" · ") + (w.precipPct != null && w.precipPct >= 40 ? ` · ${w.precipPct}% precip` : "");
  }
  return "Forecast arrives ~2 weeks out";
}

/** Referee read — the persistent tendency is penalty rate; the rest is historical context. */
function refereeCell(crew: { referee: string; tendency: string; pen: number }): string {
  const s = refByName.get(crew.referee);
  const read = crew.tendency === "flag-happy" ? "flag-heavy" : crew.tendency === "flag-light" ? "lets them play" : "average flags";
  let t = `${crew.referee} — ${read}, ~${crew.pen}/g`;
  if (s) t += ` · games avg ${s.total} pts (${s.over}% over), context not a lean`;
  return t;
}

const refByName = new Map(REF_STATS.map((s) => [s.name, s]));

/** The ONE crew tendency that persists year-to-year is the penalty rate. */
function crewFlag(pen: number): { label: string; tone: "hot" | "cool" } | null {
  if (pen >= REF_LEAGUE.pen + 0.8) return { label: "Flag-heavy", tone: "hot" };
  if (pen <= REF_LEAGUE.pen - 0.8) return { label: "Lets them play", tone: "cool" };
  return null;
}

/** One crew row in the featured referee table. */
function refRow(r: (typeof REF_STATS)[number]) {
  const flag = crewFlag(r.pen);
  const ou = r.over >= 50 ? { d: "Over", p: r.over } : { d: "Under", p: 100 - r.over };
  const ats = r.atsFav >= 50 ? { d: "Fav", p: r.atsFav } : { d: "Dog", p: 100 - r.atsFav };
  return (
    <div className="refrow" key={r.name}>
      <span className="refrow__name">{r.name} <span className="refrow__n">({r.games})</span></span>
      <span className="refrow__v">{r.total}</span>
      <span className="reflean"><b className="reflean__d">{ou.d}</b> <span className="reflean__p">({ou.p}%)</span></span>
      <span className="reflean"><b className="reflean__d">{ats.d}</b> <span className="reflean__p">({ats.p}%)</span></span>
      <span className={r.pen >= REF_LEAGUE.pen ? "refrow__v hot" : "refrow__v cool"}>{r.pen}</span>
      <span className="refrow__read">
        {flag ? <b className={flag.tone}>{flag.label}</b> : <span className="muted">Average flags</span>}
      </span>
    </div>
  );
}

export const revalidate = 300;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/considerations?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

export default async function Page({ searchParams }: PageProps<"/considerations">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const board = buildBoard(await fetchWeek(week, SEASON));
  const modelById = new Map<string, ModelPrediction>();
  try {
    for (const p of await fetchModelWeek(week, SEASON)) modelById.set(p.eventId, p);
  } catch { /* predictions may not be published yet */ }
  const refs = await weekRefs(week, SEASON);
  const showWeather = week === WEATHER_WEEK;
  const wxByEvent = new Map(GAME_WEATHER.map((w) => [w.eventId, w]));

  // One card per game — all its context rolled together (site + weather, referee, stakes).
  const games = board.map((g) => ({
    g,
    mp: modelById.get(g.eventId),
    crew: refs.get(g.home),
    wx: showWeather ? wxByEvent.get(g.eventId) : undefined,
  }));
  // Lead with the first 6; the rest live behind a centered "see more".
  const lead = games.slice(0, 6);
  const rest = games.slice(6);

  const renderCard = ({ g, mp, crew, wx }: (typeof games)[number]) => {
    const neutral = mp?.neutral;
    // Players in this game who are close to a contract incentive (live context, not a pick).
    const incs = INCENTIVE_WATCH.filter((i) => i.team === g.home || i.team === g.away);
    return (
      <article className={`cxcard${wx?.windFlag ? " cxcard--wind" : ""}`} key={g.eventId}>
        <header className="cxcard__head">
          <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
          <time className="kick">{et(g.commence)}</time>
          {neutral && <span className="badge neutral">NEUTRAL</span>}
        </header>
        <dl className="cxcard__rows">
          <div className="cxrow">
            <dt className="cxrow__k">Site</dt>
            <dd className="cxrow__v">
              {wx ? wxSite(wx) : (mp?.venue ?? g.home)}
              {wx && <span className="cxroof"> · {roofLabel(wx.roof)}</span>}
              {neutral && <span className="cxroof"> · neutral site</span>}
            </dd>
          </div>
          {wx && (
            <div className={`cxrow${wx.windFlag ? " cxrow--wind" : ""}`}>
              <dt className="cxrow__k">Weather</dt>
              <dd className="cxrow__v">{wx.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {weatherCell(wx)}</dd>
            </div>
          )}
          <div className="cxrow">
            <dt className="cxrow__k">Referee</dt>
            <dd className="cxrow__v">{crew ? refereeCell(crew) : <span className="muted">Crew tagged game week</span>}</dd>
          </div>
          <div className="cxrow cxrow--inc">
            <dt className="cxrow__k">Incentive</dt>
            <dd className="cxrow__v">
              {incs.length > 0 ? (
                incs.map((i) => (
                  <span className="cxinc" key={`${i.player}-${i.stat}`}>
                    <b>{i.player}</b> — {i.remaining} {i.stat} from {i.label}{" "}
                    <span className="cxinc__prog">({i.current}/{i.threshold}, {i.pct}%)</span>
                  </span>
                ))
              ) : INCENTIVE_WATCH.length === 0 ? (
                <span className="muted">Player Incentives: coming soon</span>
              ) : (
                <span className="muted">No player near an incentive</span>
              )}
            </dd>
          </div>
        </dl>
      </article>
    );
  };

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Special Considerations · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />

      <section className="explainer explainer--wide">
        <p>
          <b>The stuff that doesn&apos;t fit in a number.</b> One card per game with the situational factors
          around it — site &amp; weather, referee crew, and what&apos;s at stake. These <b>arm your judgment</b>;
          they are <b>not</b> an adjusted line. (How we read each factor is in the reference below.)
        </p>
      </section>

      <ContextSubnav active="special" />
      <WeekNav min={min} max={max} current={week} />

      {games.length === 0 ? (
        <p className="foot">No games captured for Week {week} yet.</p>
      ) : (
        <>
          <section className="cxgrid" aria-label={`Week ${week} considerations`}>
            {lead.map(renderCard)}
          </section>
          {rest.length > 0 && (
            <details className="hb-more cxmore">
              <summary className="hb-more__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                See {rest.length} more {rest.length === 1 ? "game" : "games"}
              </summary>
              <section className="cxgrid" aria-label={`Week ${week} considerations — more games`}>
                {rest.map(renderCard)}
              </section>
            </details>
          )}
        </>
      )}

      {/* --- Featured: the Referee Crews table (pulled up front; the one factor with a
             persistent, called-out tendency). --- */}
      <section className="ctxsec cxfeat" aria-label="Referee crews">
        <div className="cxfeat__bar">
          <h2 className="cxfeat__h">Referee Crew Analysis</h2>
          <p className="cxfeat__sub">
            The one crew tendency that carries over year to year — <b>how many flags they throw</b>. Everything
            else here is historical context, not a lean.
          </p>
        </div>
        <div className="refbottom">
          <span className="refbottom__k">Bottom line — what to actually use</span>
          <p>
            One tendency carries over year to year: <b>how many flags a crew throws</b>.
            <b className="hot"> Flag-heavy</b> means more variance; <b className="cool">Lets them play</b> fewer.
            The rest is <b>historical context, not a reliable lean</b>. Crews are tagged onto each game&apos;s
            card once weekly assignments post.
          </p>
        </div>
        <div className="reftable">
          <div className="refrow refrow--head">
            <span>crew</span><span>avg total</span><span>leans O/U</span><span>leans ATS</span><span>pen/g</span><span>read</span>
          </div>
          {REF_STATS.slice(0, 6).map(refRow)}
        </div>
        {REF_STATS.length > 6 && (
          <details className="hb-more cxmore">
            <summary className="hb-more__sum">
              <span className="hb-more__chev" aria-hidden="true">▸</span>
              See {REF_STATS.length - 6} more crews
            </summary>
            <div className="reftable">
              {REF_STATS.slice(6).map(refRow)}
            </div>
          </details>
        )}
        <p className="ctxsec__note">Historical crew tendencies, 2021–25.</p>
        <div className="ref-soon">
          <span className="ref-soon__tag">Coming soon</span>
          Referee crews will be tagged to the games they&apos;ll be reffing.
        </div>
      </section>

      {/* --- Reference: how we read weather & scoring (collapsed; per-game data is in the cards) --- */}
      <details className="ctxsec ctxdrop reftbl">
        <summary className="ctxsec__h ctxsec__h--big">How we read weather &amp; scoring</summary>
        <p className="ctxsec__d">
          <b>Wind is the one measured signal</b> — the market under-sets totals ~1.3 pts at 15+ mph — but it
          fails the vig bar and uses realized wind, so treat it as <b>context, not a proven edge</b>. Domes are
          weather non-factors; outdoor forecasts fill into the cards about <b>two weeks</b> before kickoff.
        </p>
        <p className="ctxsec__d">
          <b>Domes are higher-scoring — and the market knows.</b> Indoor games average <b>47.4</b> pts vs
          <b> 44.2</b> outdoors (2006–25), but books set dome totals ~2 pts higher, so indoor overs hit just
          <b> 51.8%</b> — <b>below the 52.4% needed to beat the vig</b>. Tested and priced: a scoring environment
          to understand, not an edge to bet.
        </p>
        {showWeather && <p className="ctxsec__note">Weather via Open-Meteo · updated {WEATHER_UPDATED} · indoor status per stadium roof.</p>}
      </details>
    </main>
  );
}
