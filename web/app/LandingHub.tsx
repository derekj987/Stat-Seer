// The landing's heart: the Model → Context → Value flow with an NFL | NCAAF toggle that
// also drives the live snapshot (The Model Card, Players We Like, Upsets). Implemented as
// a pure-CSS radio toggle so it never depends on client hydration — both sports render
// server-side and CSS shows the selected one. ?sport=ncaaf sets the initial pick.
import type { CardRow, UpsetRow, PlayerPick } from "@/lib/home";
import type { NcaafCardGame, NcaafUpset } from "./ncaaf/model-data";
import { NCAAF_MODEL } from "./ncaaf/model-data";
import { GAME_WEATHER, type GameWeather } from "@/lib/weatherData";
import { PLAYER_PROJECTIONS, PROJ_PRIOR, type PlayerProj } from "@/lib/playerProjections";
import { REF_STATS, REF_LEAGUE } from "@/lib/refStats";
import { isRealistic } from "@/lib/depthChart";
import Tip from "./Tip";
import { ScrollHint, MoreTable } from "./Nav";

// Plain-English explanations shown behind each section's medieval "?" seal.
const TIPS = {
  gameModel: <>Every game this week with the book&apos;s <b>Market Spread</b> and <b>Market O/U</b> beside <b>Our Model Suggests</b> — our line-blind lean (the model never sees the betting line). A ◆ marks an <b>off-consensus</b> game where we disagree with the market. Snapshots graded in public, not guaranteed picks.</>,
  passing: <>Each starting QB&apos;s sportsbook <b>passing-yards line</b> vs <b>our line-blind projection</b> (▲ = we lean over, ▼ = under). <b>Career&nbsp;% over</b> = how often they&apos;ve cleared a similar line across their career; <b>Prior szn&nbsp;% over</b> = last season only; <b>Home&nbsp;% over</b> / <b>Road&nbsp;% over</b> = that same rate split by venue. Higher means they go over more often.</>,
  playerModel: <>Our line-blind player-prop projections: we project <b>volume</b> (carries, targets) first, then apply a regressed efficiency baseline. The ▲/▼ shows whether our number lands over or under the book&apos;s line.</>,
  fan: <>Players surfaced from fan forums, beat writers and RSS feeds, then <b>hype-rated</b> with a plain bottom line (e.g. take the over on receptions). For discovery — not a graded pick.</>,
  considNfl: <>Per-game context that can move a number but isn&apos;t itself an edge: the <b>site &amp; roof</b>, the <b>weather</b> (⚑ marks notable wind), and the <b>referee crew</b>.</>,
  considNcaaf: <>Durable context for the slate: <b>home-field</b> value, <b>conference strength</b>, and game-week items (weather, injuries) as they firm up.</>,
  upsets: <>Games where the market has a team losing but <b>our model has them winning outright</b>. The number shown is how much more likely our model thinks they are to win than the market implies.</>,
  referee: <>Each crew&apos;s tendencies. The one thing that carries over year to year is <b>penalties per game</b> — the O/U and ATS leans are historical context, not a lean.</>,
} as const;

const PROP_LABEL: Record<string, string> = { rush_yds: "Rush Yds", rec_yds: "Rec Yds", receptions: "Rec", pass_yds: "Pass Yds" };

const cxKickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const cxKick = (iso: string) => cxKickFmt.format(new Date(iso)) + " ET";
const cxSite = (w: GameWeather) => `${w.venue}${w.city ? ` · ${w.city}, ${w.state}` : ""}`;
const cxRoof = (r: string) => r === "dome" ? "Dome" : r === "retractable" ? "Retractable roof" : "Outdoor";
function cxWeather(w: GameWeather): string {
  if (w.indoor) return "Indoor — weather is a non-factor";
  if (w.status === "ok") return `${w.windMph} mph wind · ${w.tempF}°${w.conditions ? ` · ${w.conditions}` : ""}`;
  return "Forecast arrives ~2 weeks out";
}

/** The one crew tendency that carries over year to year is the penalty rate. */
function refFlag(pen: number): { label: string; tone: "hot" | "cool" } | null {
  if (pen >= REF_LEAGUE.pen + 0.8) return { label: "Flag-heavy", tone: "hot" };
  if (pen <= REF_LEAGUE.pen - 0.8) return { label: "Lets them play", tone: "cool" };
  return null;
}

/** One per-game consideration card (site + weather). */
function cxCardEl(w: GameWeather) {
  return (
    <article className={`cxcard${w.windFlag ? " cxcard--wind" : ""}`} key={w.eventId}>
      <header className="cxcard__head">
        <span className="matchup">{w.away}<span className="at">@</span>{w.home}</span>
        <time className="kick">{cxKick(w.commence)}</time>
        {w.neutral && <span className="badge neutral">NEUTRAL</span>}
      </header>
      <dl className="cxcard__rows">
        <div className="cxrow"><dt className="cxrow__k">Site</dt><dd className="cxrow__v">{cxSite(w)}<span className="cxroof"> · {cxRoof(w.roof)}</span></dd></div>
        <div className="cxrow"><dt className="cxrow__k">Weather</dt><dd className="cxrow__v">{w.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {cxWeather(w)}</dd></div>
        <div className="cxrow"><dt className="cxrow__k">Referee</dt><dd className="cxrow__v"><span className="muted">Crew tagged game week</span></dd></div>
      </dl>
    </article>
  );
}

/** One crew row in the referee snapshot table. */
function refRowEl(r: (typeof REF_STATS)[number]) {
  const flag = refFlag(r.pen);
  const ou = r.over >= 50 ? { d: "Over", p: r.over } : { d: "Under", p: 100 - r.over };
  const ats = r.atsFav >= 50 ? { d: "Fav", p: r.atsFav } : { d: "Dog", p: 100 - r.atsFav };
  return (
    <div className="refrow" key={r.name}>
      <span className="refrow__name">{r.name} <span className="refrow__n">({r.games})</span></span>
      <span className="refrow__v">{r.total}</span>
      <span className="reflean"><b className="reflean__d">{ou.d}</b> <span className="reflean__p">({ou.p}%)</span></span>
      <span className="reflean"><b className="reflean__d">{ats.d}</b> <span className="reflean__p">({ats.p}%)</span></span>
      <span className={r.pen >= REF_LEAGUE.pen ? "refrow__v hot" : "refrow__v cool"}>{r.pen}</span>
      <span className="refrow__read">{flag ? <b className={flag.tone}>{flag.label}</b> : <span className="muted">Average flags</span>}</span>
    </div>
  );
}

/** NFL considerations snapshot: first 3 per-game cards, "see more" for the rest. */
function NflConsiderations() {
  const all = GAME_WEATHER;
  if (!all.length) return <p className="hb-empty">Considerations load with the week&apos;s board — see <a href="/considerations">Special Considerations</a>.</p>;
  const lead = all.slice(0, 3);
  const rest = all.slice(3);
  return (
    <>
      <div className="cxgrid cxgrid--snap">{lead.map(cxCardEl)}</div>
      {rest.length > 0 && (
        <details className="hb-more">
          <summary className="hb-more__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            See more ({rest.length} more games)
          </summary>
          <div className="cxgrid cxgrid--snap lp-moregrid">{rest.map(cxCardEl)}</div>
        </details>
      )}
      <p className="lp-cardfoot"><a href="/considerations">See our Context Model →</a></p>
    </>
  );
}

/** Referee Crew Analysis snapshot — first 3 crews, "see more" for the rest, link to the
 *  full breakdown. Its own panel on the landing page (under Potential Upsets). */
function RefereeAnalysis() {
  const lead = REF_STATS.slice(0, 3);
  const rest = REF_STATS.slice(3);
  return (
    <>
      <p className="lp-refsnap__sub">The one crew tendency that carries over year to year — <b>how many flags they throw</b>. Everything else is historical context, not a lean.</p>
      <div className="reftable">
        <div className="refrow refrow--head">
          <span>crew</span><span>avg total</span><span>leans O/U</span><span>leans ATS</span><span>pen/g</span><span>read</span>
        </div>
        {lead.map(refRowEl)}
      </div>
      {rest.length > 0 && (
        <details className="hb-more">
          <summary className="hb-more__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            See {rest.length} more crews
          </summary>
          <div className="reftable lp-moretbl">{rest.map(refRowEl)}</div>
        </details>
      )}
      <p className="lp-cardfoot"><a href="/considerations">Review our Special Considerations →</a></p>
    </>
  );
}

/** NCAAF: the durable context (home field, league strength) as 3 cards + a button. */
function NcaafConsiderations() {
  const cx = NCAAF_MODEL.context;
  const top = cx.conferences[0];
  const items = [
    { k: "Home field", v: `+${cx.hfa}`, note: "points, dropped to zero at neutral sites (bowls, kickoff classics)" },
    { k: "Strongest league", v: top.conf, note: `top conference by our rating (avg +${top.avgRating} per team)` },
    { k: "Game-week items", v: "Arriving", note: "weather, injuries & specific matchups fill in as the season runs" },
  ];
  return (
    <>
      <div className="cxgrid cxgrid--snap">
        {items.map((it) => (
          <article className="cxcard cxcard--stat" key={it.k}>
            <span className="cxcard__statv">{it.v}</span>
            <span className="cxcard__statk">{it.k}</span>
            <p className="cxcard__statnote">{it.note}</p>
          </article>
        ))}
      </div>
      <p className="lp-cardfoot"><a href="/ncaaf/considerations">See our Context Model →</a></p>
    </>
  );
}

type Sport = "nfl" | "ncaaf";
type NflData = { week: number; card: CardRow[]; upsets: UpsetRow[]; players: PlayerPick[] };
type NcaafData = { week: number; games: NcaafCardGame[]; upsets: NcaafUpset[] };

const numStr = (v: number | null) => (v === null ? "—" : String(v));

const STEPS = [
  { n: 1, key: "model", title: "The Model", lead: "What the data says.", href: { nfl: "/model", ncaaf: "/ncaaf/model" } },
  { n: 2, key: "context", title: "Read the Room", lead: "The factors you may not have thought of.", href: { nfl: "/considerations", ncaaf: "/ncaaf/considerations" } },
  { n: 3, key: "value", title: "Find the Value", lead: "Decide your picks — we tell you where to place them.", href: { nfl: "/lines", ncaaf: "/ncaaf/lines" } },
] as const;

function Flow({ sport, label }: { sport: Sport; label: string }) {
  return (
    <div className="lpf__steps">
      {STEPS.map((s) => (
        <a key={s.key} href={s.href[sport]} className={`lpf__step lpf__step--${s.key}`}>
          <span className="lpf__toprow">
            <span className="lpf__title">{s.title}</span>
            <span className="lpf__n">{s.n}</span>
          </span>
          <span className="lpf__lead">{s.lead}</span>
          <span className="lpf__go">Open {label} →</span>
        </a>
      ))}
    </div>
  );
}

function Panel({ title, count, hint, open, children }: { title: string; count: React.ReactNode; hint: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="hb-panel" open={open}>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">{title}</span>
        <Tip text={hint} />
        <span className="hb-bar__count hb-bar__count--gold">{count}</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {children}
      </div>
    </details>
  );
}

function NflHead() {
  return <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>;
}
function NflRows({ rows, moreFrom }: { rows: CardRow[]; moreFrom?: number }) {
  return (
    <>
      {rows.map((r, i) => (
        <tr key={r.eventId} className={[r.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
          <td className="hb-l"><span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>{r.off && <span className="hb-dia hb-dia--end">◆</span>}</td>
          <td className="hb-num">{r.marketSpread ?? "—"}</td>
          <td className="hb-num hb-tot">{numStr(r.marketTotal)}</td>
          <td className="hb-suggest">
            {r.spreadLean || r.totalLean ? (
              <span className="hb-sugwrap">
                {r.spreadLean && <span className="hb-sug"><span className="hb-sug__t">{r.spreadLean.side} {r.spreadLean.num}</span></span>}
                {r.totalLean && <span className="hb-sug"><span className="hb-sug__t"><span className={`pmarrow pmarrow--${r.totalLean.dir === "OVER" ? "up" : "down"}`} aria-hidden="true">{r.totalLean.dir === "OVER" ? "▲" : "▼"}</span> {r.totalLean.dir === "OVER" ? "Over" : "Under"} {r.totalLean.num}</span></span>}
              </span>
            ) : <span className="hb-leannone">even</span>}
          </td>
        </tr>
      ))}
    </>
  );
}
function NflCardTable({ rows }: { rows: CardRow[] }) {
  if (!rows.length) return <p className="hb-empty">The NFL board opens when this week&apos;s odds and reads post.</p>;
  return (
    <MoreTable id="gm-more-nfl" head={<NflHead />} extra={Math.max(0, rows.length - 3)} noun="games">
      <NflRows rows={rows} moreFrom={3} />
    </MoreTable>
  );
}

function NcaafHead() {
  return <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>;
}
function NcaafRows({ games, moreFrom }: { games: readonly NcaafCardGame[]; moreFrom?: number }) {
  return (
    <>
      {games.map((g, i) => {
        const ms = g.marketSpread; const ps = g.projSpread; const tl = g.totalLean; const pk = g.pick;
        const pick = pk ? `${pk.side} ${pk.num > 0 ? "+" : ""}${pk.num}` : `${ps.fav} ${ps.num}`;
        return (
          <tr key={`${g.away}-${g.home}`} className={[g.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
            <td className="hb-l"><span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>{g.neutral ? <span className="ncf-site"> · N</span> : null}{g.off && <span className="hb-dia hb-dia--end">◆</span>}</td>
            <td className="hb-num">{ms ? `${ms.fav} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-suggest"><span className="hb-sugwrap"><span className="hb-sug"><span className="hb-sug__t">{pick}</span></span>{tl && <span className="hb-sug"><span className="hb-sug__t"><span className={`pmarrow pmarrow--${tl.dir === "OVER" ? "up" : "down"}`} aria-hidden="true">{tl.dir === "OVER" ? "▲" : "▼"}</span> {tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span></span>}</span></td>
          </tr>
        );
      })}
    </>
  );
}
function NcaafCardTable({ games }: { games: NcaafCardGame[] }) {
  const featured = games.filter((g) => g.featured);
  const src = featured.length ? featured : games;
  return (
    <MoreTable id="gm-more-ncaaf" head={<NcaafHead />} extra={Math.max(0, src.length - 3)} noun="games">
      <NcaafRows games={src} moreFrom={3} />
    </MoreTable>
  );
}

function playLine(p: PlayerPick): string {
  if (p.side === "Yes") { const l = p.marketLabel ?? "anytime TD"; return l.charAt(0).toUpperCase() + l.slice(1); }
  return [p.side, p.line != null ? String(p.line) : null, p.marketLabel].filter(Boolean).join(" ");
}
function PlrHead() {
  return <thead><tr><th className="hb-l">Player</th><th>Team</th><th>Wk</th><th>The play</th><th>Best book</th><th>Trending on</th></tr></thead>;
}
function PlrRows({ players, moreFrom }: { players: PlayerPick[]; moreFrom?: number }) {
  return (
    <>
      {players.map((p, i) => (
        <tr key={p.id} className={moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : undefined}>
          <td className="hb-l"><a className="hb-plrlink" href="/tailgate">{p.player}</a></td>
          <td className="hb-num">{p.team}</td>
          <td className="hb-num">{p.week}</td>
          <td><span className={p.dir === "down" ? "hb-plr__up hb-plr__down" : "hb-plr__up"} aria-hidden="true">{p.dir === "down" ? "▼" : "▲"}</span> {playLine(p)}</td>
          <td>{p.book ?? "—"}</td>
          <td className="hb-plr__srccell">{p.sources.length ? [...new Set(p.sources)].join(" · ") : "—"}</td>
        </tr>
      ))}
    </>
  );
}
function PlayersTable({ players }: { players: PlayerPick[] }) {
  if (!players.length) return <p className="hb-empty">Player reads post with the week&apos;s props — see <a href="/tailgate">Fan Analysis</a>.</p>;
  const capped = players.slice(0, 14);
  return (
    <MoreTable id="fanmore-nfl" head={<PlrHead />} extra={Math.max(0, capped.length - 3)} noun="players" plr>
      <PlrRows players={capped} moreFrom={3} />
    </MoreTable>
  );
}

function FanAnalysisNote() {
  return (
    <p className="hb-note">
      We scour the fan forums, RSS feeds, and beat writers to surface players you may not have heard about —
      then apply a <b>hype rating</b> and give you the bottom line, like <b>take the over on their receptions</b>{" "}
      or <b>the over on their rushing yards</b>.
    </p>
  );
}

// Player Model snapshot — a few of our line-blind prop reads with "Our Model Suggests"
// (the prior-season hit rate over the posted line). NFL only; NCAAF has no projections yet.
function PlayerSnapshot({ base }: { base: Sport }) {
  const href = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const rows = base === "nfl"
    ? [...PLAYER_PROJECTIONS]
        .filter((r) => r.book > 0 && isRealistic(r.player))
        .sort((a, b) => Math.abs(b.proj / b.book - 1) - Math.abs(a.proj / a.book - 1))
        .slice(0, 6)
    : [];
  if (!rows.length) {
    return (
      <>
        <div className="hb-formwrap">
          <table className="hb-form">
            <thead><tr><th className="hb-l">Player</th><th>Team</th><th>Prop</th><th>Our Model Suggests</th></tr></thead>
            <tbody><tr className="hb-off"><td className="hb-l" colSpan={4}>Projections publish here as the season&apos;s usage is captured.</td></tr></tbody>
          </table>
        </div>
        <p className="hb-empty">See the <a href={href}>Player Model →</a></p>
      </>
    );
  }
  const psnapRow = (r: (typeof rows)[number], i: number) => {
    const over = r.proj >= r.book;
    return (
      <tr key={`${r.player}-${r.market}`} className={i >= 3 ? "hb-row--more" : undefined}>
        <td className="hb-l"><a className="hb-plrlink" href={href}>{r.player}</a></td>
        <td className="hb-num">{r.team}</td>
        <td>{PROP_LABEL[r.market] ?? r.market} {r.book}</td>
        <td className="hb-suggest"><span className="hb-sugwrap"><span className="hb-sug"><span className={`hb-sug__t pmarrow--${over ? "up" : "down"}`}>{over ? "▲ Over" : "▼ Under"} · proj {r.proj}</span></span></span></td>
      </tr>
    );
  };
  return (
    <>
      <MoreTable id={`psnap-more-${base}`} head={<thead><tr><th className="hb-l">Player</th><th>Team</th><th>Prop</th><th>Our Model Suggests</th></tr></thead>} extra={Math.max(0, rows.length - 3)} noun="picks">
        {rows.map(psnapRow)}
      </MoreTable>
      <p className="lp-cardfoot"><a href={href}>See the full Player Model →</a></p>
    </>
  );
}

// Quarterback Passing snapshot — the rich per-QB passing table from the Player Model,
// surfaced on the homepage right under the game-line snapshot. Book line vs our
// line-blind projection, plus career / prior-season / home / road over-rates. The
// same markup + styling as /model/players?cat=passing so it reads identically.
function pmPct(over: number, g: number): number | null { return g ? Math.round((100 * over) / g) : null; }
function pmCls(v: number | null): string { return v === null ? "" : v >= 50 ? "pmread--over" : "pmread--under"; }

function PassingSnapshot() {
  const rows = PLAYER_PROJECTIONS.filter((r) => r.cat === "passing" && r.book > 0 && isRealistic(r.player));
  if (!rows.length) {
    return <p className="hb-empty">Passing projections publish here as the season&apos;s usage is captured — see the <a href="/model/players?cat=passing">Player Model →</a></p>;
  }
  const games: string[] = [];
  const byGame: Record<string, PlayerProj[]> = {};
  for (const r of rows) {
    if (!byGame[r.game]) { byGame[r.game] = []; games.push(r.game); }
    byGame[r.game].push(r);
  }
  const gameTable = (g: string) => (
    <div className="pmgame" key={g}>
      <div className="pmgame__h">{g}</div>
      <ScrollHint />
      <div className="pmscroll">
        <div className="pmtable pmtable--data pmtable--ha" role="table" aria-label={`${g} passing projections`}>
          <div className="pmrow pmrow--head pmrow--data" role="row">
            <span className="pmcell pmcell--player">Player</span>
            <span className="pmcell">Team</span>
            <span className="pmcell pmcell--num">Book line</span>
            <span className="pmcell pmcell--num">Our proj</span>
            <span className="pmcell pmcell--career">Career % over</span>
            <span className="pmcell pmcell--career">Prior szn % over</span>
            <span className="pmcell pmcell--career">Home % over</span>
            <span className="pmcell pmcell--career">Road % over</span>
          </div>
          {byGame[g].map((r) => {
            const cpct = pmPct(r.cOver, r.cG), ppct = pmPct(r.pOver, r.pG);
            const hpct = pmPct(r.hOver, r.hG), rpct = pmPct(r.rOver, r.rG);
            return (
              <div className="pmrow pmrow--data" role="row" key={`${r.player}-${r.market}`}>
                <span className="pmcell pmcell--player">{r.player}</span>
                <span className="pmcell pmcell--team">{r.team}</span>
                <span className="pmcell pmcell--num">{r.book} yds</span>
                <span className="pmcell pmcell--num pmcell--proj">
                  {r.proj} yds{" "}
                  <span className={`pmarrow ${r.proj >= r.book ? "pmarrow--up" : "pmarrow--down"}`} aria-hidden="true">{r.proj >= r.book ? "▲" : "▼"}</span>
                </span>
                <span className={`pmcell pmcell--career ${pmCls(cpct)}`}>
                  {cpct === null ? "—" : <>{cpct}% <small className="pmcell__sub">{r.cOver}/{r.cG} gm</small></>}
                </span>
                <span className={`pmcell pmcell--career ${pmCls(ppct)}`}>
                  {ppct === null ? <span className="pmcell__sub">no {PROJ_PRIOR}</span> : <>{ppct}% <small className="pmcell__sub">{r.pOver}/{r.pG} gm</small></>}
                </span>
                <span className={`pmcell pmcell--career ${pmCls(hpct)}`}>
                  {hpct === null ? "—" : <>{hpct}% <small className="pmcell__sub">{r.hOver}/{r.hG} gm</small></>}
                </span>
                <span className={`pmcell pmcell--career ${pmCls(rpct)}`}>
                  {rpct === null ? "—" : <>{rpct}% <small className="pmcell__sub">{r.rOver}/{r.rG} gm</small></>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
  const lead = games.slice(0, 2);
  const rest = games.slice(2);
  return (
    <>
      {lead.map(gameTable)}
      {rest.length > 0 && (
        <details className="hb-more">
          <summary className="hb-more__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            See more ({rest.length} more {rest.length === 1 ? "game" : "games"})
          </summary>
          {rest.map(gameTable)}
        </details>
      )}
      <p className="lp-cardfoot"><a href="/model/players?cat=passing">See the full Player Model →</a></p>
    </>
  );
}

function UpsetCards({ children }: { children: React.ReactNode }) { return <div className="hb-cols">{children}</div>; }

// Show the first 2 upset cards, tuck the rest behind a "see more" dropdown like the tables.
function UpsetSplit({ cards }: { cards: React.ReactNode[] }) {
  const lead = cards.slice(0, 2);
  const rest = cards.slice(2);
  return (
    <>
      <UpsetCards>{lead}</UpsetCards>
      {rest.length > 0 && (
        <details className="hb-more">
          <summary className="hb-more__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            See more ({rest.length} more {rest.length === 1 ? "game" : "games"})
          </summary>
          <UpsetCards>{rest}</UpsetCards>
        </details>
      )}
    </>
  );
}

export default function LandingHub({ initialSport, nfl, ncaaf }: { initialSport: Sport; nfl: NflData; ncaaf: NcaafData }) {
  return (
    <section className="lp-hub" id="lp-board" aria-label="This week's board">
      {/* pure-CSS sport toggle — no client JS needed */}
      <input type="radio" name="lpsport" id="lps-nfl" className="lp-r" defaultChecked={initialSport === "nfl"} />
      <input type="radio" name="lpsport" id="lps-ncaaf" className="lp-r" defaultChecked={initialSport === "ncaaf"} />

      <div className="lpf__head lpf__head--notitle">
        <div className="lpf__toggle" role="tablist" aria-label="Choose a sport">
          <label htmlFor="lps-nfl" className="lpf__t">NFL</label>
          <label htmlFor="lps-ncaaf" className="lpf__t">NCAAF</label>
        </div>
      </div>

      {/* NFL panel */}
      <div className="lp-sport lp-sport--nfl">
        <div className="lp-snaplabel">NFL WEEK {nfl.week} SNAPSHOT</div>
        <Panel title="The Model — Snapshot View" count={`${nfl.card.length} games`} hint={TIPS.gameModel} open>
          <NflCardTable rows={nfl.card} />
          <p className="lp-cardfoot"><a href="/model">See the full model →</a></p>
        </Panel>
        <Panel
          title="Quarterback Passing Props — Snapshot"
          count={`${PLAYER_PROJECTIONS.filter((r) => r.cat === "passing" && r.book > 0 && isRealistic(r.player)).length} QBs`}
          hint={TIPS.passing}
          open
        >
          <PassingSnapshot />
        </Panel>
        <Panel title="Player Model snapshot — NFL" count="props" hint={TIPS.playerModel} open>
          <PlayerSnapshot base="nfl" />
        </Panel>
        <Panel title="Check out our fan analysis." count={nfl.players.length || "—"} hint={TIPS.fan} open>
          <FanAnalysisNote />
          <PlayersTable players={nfl.players} />
        </Panel>
        <Panel title="Check out our special considerations" count={`${GAME_WEATHER.length || 3} games`} hint={TIPS.considNfl} open>
          <NflConsiderations />
        </Panel>
        <Panel title="Potential Upsets of the Week — NFL" count={nfl.upsets.length} hint={TIPS.upsets} open>
          {nfl.upsets.length === 0 ? <p className="hb-empty">No upset alerts this week — our model and the market agree on every game&apos;s side.</p> : (
            <UpsetSplit cards={nfl.upsets.map((u) => (
              <div className="hb-up" key={u.eventId}>
                <div className="hb-up__hd"><span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span>{u.spread && <span className="hb-up__spread">{u.spread}</span>}</div>
                <div className="hb-up__note">The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.</div>
                <div className="hb-up__ft"><span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span></div>
              </div>
            ))} />
          )}
        </Panel>
        <Panel title="Referee Crew Analysis" count={`${REF_STATS.length} crews`} hint={TIPS.referee} open>
          <RefereeAnalysis />
        </Panel>
        {/* How to use it — moved below the board, so the value + data lead. */}
        <div className="lpf__flowhead">
          <h2 className="lpf__h">Three steps, in order.</h2>
          <p className="lpf__sub">Read what the model sees, weigh what it can&apos;t, then find the best price. Each opens the full section.</p>
        </div>
        <Flow sport="nfl" label="NFL" />
      </div>

      {/* NCAAF panel */}
      <div className="lp-sport lp-sport--ncaaf">
        <div className="lp-snaplabel">COLLEGE FOOTBALL WEEK {ncaaf.week} SNAPSHOT</div>
        <Panel title="The Model — Snapshot View" count={`${ncaaf.games.length} ranked`} hint={TIPS.gameModel} open>
          <NcaafCardTable games={ncaaf.games} />
          <p className="lp-cardfoot"><a href="/ncaaf/model">See the full model →</a></p>
        </Panel>
        <Panel title="Player Model snapshot — NCAAF" count="props" hint={TIPS.playerModel} open>
          <PlayerSnapshot base="ncaaf" />
        </Panel>
        <Panel title="Check out our fan analysis." count="—" hint={TIPS.fan} open>
          <FanAnalysisNote />
          <p className="hb-empty">College player reads land here once the CFB fan scan is wired — the same read we run for the NFL on <a href="/ncaaf/tailgate">Fan Analysis</a>.</p>
        </Panel>
        <Panel title="Check out our special considerations" count="context" hint={TIPS.considNcaaf} open>
          <NcaafConsiderations />
        </Panel>
        <Panel title="Potential Upsets of the Week — NCAAF" count={ncaaf.upsets.length} hint={TIPS.upsets} open>
          {ncaaf.upsets.length === 0 ? <p className="hb-empty">No upset alerts this week — our rating agrees with the market&apos;s favorite on the board.</p> : (
            <UpsetSplit cards={ncaaf.upsets.map((u) => (
              <div className="hb-up" key={`${u.dog}-${u.matchup}`}>
                <div className="hb-up__hd"><span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span><span className="hb-up__spread">{u.spread}</span></div>
                <div className="hb-up__note">The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.</div>
                <div className="hb-up__ft"><span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span></div>
              </div>
            ))} />
          )}
        </Panel>
        <div className="lpf__flowhead">
          <h2 className="lpf__h">Three steps, in order.</h2>
          <p className="lpf__sub">Read what the model sees, weigh what it can&apos;t, then find the best price. Each opens the full section.</p>
        </div>
        <Flow sport="ncaaf" label="College Football" />
      </div>
    </section>
  );
}
