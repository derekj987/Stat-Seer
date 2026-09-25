// The landing's heart: the Model → Context → Value flow with an NFL | NCAAF toggle that
// also drives the live snapshot (The Model Card, Players We Like, Upsets). Implemented as
// a pure-CSS radio toggle so it never depends on client hydration — both sports render
// server-side and CSS shows the selected one. ?sport=ncaaf sets the initial pick.
import type { CardRow, UpsetRow, PlayerPick } from "@/lib/home";
import type { NcaafCardGame, NcaafUpset } from "./ncaaf/model-data";
import { NCAAF_MODEL } from "./ncaaf/model-data";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { NcaafCardHead, NcaafGameCell } from "./ncaaf/CardCells";
import { GAME_WEATHER, type GameWeather } from "@/lib/weatherData";
import { SpecialConsiderations, type SpecialCtx } from "./SpecialConsiderations";
import { PLAYER_PROJECTIONS, type PlayerProj } from "@/lib/playerProjections";
import { INCENTIVE_WATCH } from "@/lib/incentiveWatch";
import { COACH_TENDENCIES } from "@/lib/coachTendencies";
import { CONTENTION } from "@/lib/contention";
import { DEPTH } from "@/lib/depthChart";
import { MLB_GAMES } from "@/lib/mlbGameModel";
import { HighlightBanner } from "./HighlightBanner";
import PinButton from "./PinButton";
import type { Pin } from "@/lib/dashboard";
import CoachTable from "./CoachTable";
import Tip from "./Tip";
import { MoreTable } from "./Nav";
import { bookName } from "@/lib/slipPricing";
import { booksCode } from "@/lib/bookLabel";

// Plain-English explanations shown behind each section's medieval "?" seal.
const TIPS = {
  gameModel: <>Every game this week with the book&apos;s <b>Market Spread</b> and <b>Market O/U</b> beside our own <b>Model Spread</b> and <b>Model O/U</b> — our line-blind projection (the model never sees the betting line), shown so you can compare it to the market. A ◆ marks an <b>off-consensus</b> game. Published line-blind and <b>graded in public</b>.</>,
  passing: <>Each starting QB&apos;s sportsbook <b>passing-yards line</b> vs <b>our line-blind projection</b> (▲ = we lean over, ▼ = under). <b>Career&nbsp;% over</b> = how often they&apos;ve cleared a similar line across their career; <b>Prior szn&nbsp;% over</b> = last season only; <b>Home&nbsp;% over</b> / <b>Road&nbsp;% over</b> = that same rate split by venue. Higher means they go over more often.</>,
  playerModel: <>Our <b>line-blind</b> player-prop projections shown beside the book&apos;s line. The ▲/▼ shows whether our number lands over or under it. Published and graded in public — not sold as locks.</>,
  fan: <>Players surfaced from fan forums, beat writers and RSS feeds, then <b>hype-rated</b> with a plain bottom line (e.g. take the over on receptions). For discovery — not a graded pick.</>,
  considNfl: <>Per-game context that can move a number but isn&apos;t itself an edge: the <b>site &amp; roof</b>, the <b>weather</b> (⚑ marks notable wind), and the <b>referee crew</b>.</>,
  considNcaaf: <>Durable context for the slate: <b>home-field</b> value, <b>conference strength</b>, and game-week items (weather, injuries) as they firm up.</>,
  valueFinder: <>Line shopping in action: the <b>best price</b> for each game&apos;s main spread across the US sportsbooks we track, and which book has it. That&apos;s <b>Value Finder</b> — the same bet, a better number, so you never leave value on the table.</>,
  upsets: <>Games where the market has a team losing but <b>our model has them winning outright</b>. The number shown is how much more likely our model thinks they are to win than the market implies.</>,
  referee: <>Each crew&apos;s tendencies. The one thing that carries over year to year is <b>penalties per game</b> — the O/U and ATS leans are historical context, not a lean.</>,
} as const;

const PROP_LABEL: Record<string, string> = { rush_yds: "Rush Yds", rec_yds: "Rec Yds", receptions: "Rec", pass_yds: "Pass Yds", pass_tds: "Pass TDs", anytime_td: "ATTD" };
// unit appended to the book/proj number for a market ("%" for the anytime-TD probability)
const PROP_UNIT: Record<string, string> = { anytime_td: "%", rush_yds: " yds", rec_yds: " yds", pass_yds: " yds" };
// position + depth-chart tag, e.g. "RB1", "WR3" (from the nflverse depth chart)
function depthTag(player: string, pos: string): string {
  const e = DEPTH[player.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim()];
  return e ? `${e.pos}${e.rank}` : pos;
}

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

/** One team's playoff-picture line (CONTEXT; flags reduced-stakes games). */
function cxStake(team: string) {
  const c = CONTENTION[team];
  if (!c) return null;
  const caution = c.status === "Clinched" || c.status === "Eliminated";
  return (
    <span className="cxstake__t" key={team}>
      {team} <span className="cxstake__rec">({c.record})</span> — <b className={caution ? "cxstake__s cxstake__s--caution" : "cxstake__s"}>{c.status}</b>
    </span>
  );
}

/** One per-game consideration card (site + weather). */
function cxCardEl(w: GameWeather) {
  const incs = INCENTIVE_WATCH.filter((it) => it.team === w.home || it.team === w.away);
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
        {(COACH_TENDENCIES[w.away] || COACH_TENDENCIES[w.home]) && (
          <div className="cxrow cxrow--coach cxrow--wide"><dt className="cxrow__k">Coaching</dt><dd className="cxrow__v"><CoachTable away={w.away} home={w.home} /></dd></div>
        )}
        {(CONTENTION[w.away] || CONTENTION[w.home]) && (
          <div className="cxrow cxrow--stake"><dt className="cxrow__k">Stakes</dt><dd className="cxrow__v cxcoach">{cxStake(w.away)}{cxStake(w.home)}</dd></div>
        )}
        <div className="cxrow"><dt className="cxrow__k">Incentives</dt><dd className="cxrow__v">{incs.length ? <>{incs.length} player{incs.length === 1 ? "" : "s"} near an incentive</> : <span className="muted">Player incentives coming soon</span>}</dd></div>
      </dl>
    </article>
  );
}

/** NFL considerations snapshot: a few curated per-game context cards — the whole slate
 *  lives on the Context page, so no in-panel "see more" dump. */
function NflConsiderations({ limit = 3 }: { limit?: number }) {
  const lead = GAME_WEATHER.slice(0, limit);
  if (!lead.length) return <p className="hb-empty">Considerations load with the week&apos;s board — see <a href="/model">The Model</a>.</p>;
  return (
    <>
      <div className="cxgrid cxgrid--snap">{lead.map(cxCardEl)}</div>
      <p className="lp-cardfoot"><a href="/model">See every game&apos;s considerations →</a></p>
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
      <p className="lp-cardfoot"><a href="/ncaaf/model">See every game&apos;s considerations →</a></p>
    </>
  );
}

type Sport = "nfl" | "ncaaf" | "mlb";
type NflData = { week: number; card: CardRow[]; upsets: UpsetRow[]; players: PlayerPick[] };
type NcaafData = { week: number; games: NcaafCardGame[]; upsets: NcaafUpset[] };
export type VfRow = { eventId: string; away: string; home: string; line: string; price: number; books: string[] };

const numStr = (v: number | null) => (v === null ? "—" : String(v));

function WeatherSpotlight({ spot, week }: { spot: SpotlightProp | null; week: number | string }) {
  if (!spot) return null;
  const { ctx, row } = spot;
  const wx = ctx.wx!;
  const bits = [
    wx.windMph != null ? `${wx.windMph} mph wind${wx.gustMph ? ` (${wx.gustMph} gust)` : ""}` : null,
    wx.tempF != null ? `${wx.tempF}°` : null,
    wx.conditions,
    (wx.precipPct ?? 0) >= 40 ? `${wx.precipPct}% precip` : null,
  ].filter(Boolean);
  const read = (wx.windMph ?? 0) >= 15
    ? "Enough wind to shrink the passing game — deep throws and kicks are the first to go."
    : (wx.precipPct ?? 0) >= 40 ? "Rain on the ball: more of the run game than a box score usually shows."
    : (wx.tempF ?? 99) <= 32 ? "Cold enough to matter for the kicking game and ball security."
    : "Worth knowing before you read the total.";
  const bottom = [row.spreadLean ? `${row.spreadLean.side} ${row.spreadLean.num}` : null,
                  row.totalLean ? `the ${row.totalLean.dir.toLowerCase()}` : null]
    .filter(Boolean).join(" and ");
  // Say the quiet part. Our total is weather-BLIND on purpose -- weather is context here, never a
  // model input -- while the market has already marked a windy game's total down. So on exactly
  // these games our number sits above theirs, and a reader who spots "wind shrinks the passing
  // game" next to a model total 8 points OVER the market is right to be suspicious.
  const windy = (wx.windMph ?? 0) >= 15 || (wx.precipPct ?? 0) >= 40;
  const gap = row.modelTotal != null && row.marketTotal != null
    ? row.modelTotal - row.marketTotal : null;
  const caveat = windy && gap != null && gap > 2
    ? "Note the gap: the market has already marked this total down for the weather. Our number "
      + "does not — we keep the model weather-blind and publish the forecast beside it, so you "
      + "can apply it yourself rather than have it baked in where you cannot see it."
    : null;
  return (
    <Panel title={`Week ${week} numbers crunched`} count="weather game" hint={TIPS.gameModel} open>
      <div className="lpwx">
        <div className="lpwx__head">
          <span className="lpwx__game">{row.away} @ {row.home}</span>
          {wx.windFlag && <span className="lpwx__flag">⚑&nbsp;WIND</span>}
          <span className="lpwx__venue">{wx.venue}{wx.city ? `, ${wx.city}` : ""}</span>
        </div>
        <div className="lpwx__cond">{bits.join(" · ")}</div>
        <p className="lpwx__read">{read}</p>
        <div className="lpwx__grid">
          <span className="lpwx__k">Market</span>
          <span>{row.marketSpread ?? "—"}</span>
          <span>{row.marketTotal != null ? `O/U ${row.marketTotal}` : "—"}</span>
          <span className="lpwx__k">Our model</span>
          <span className="lpwx__ours">{row.modelSpread ?? "—"}</span>
          <span className="lpwx__ours">{row.modelTotal != null ? `O/U ${row.modelTotal}` : "—"}</span>
        </div>
        {bottom && <p className="lpwx__bottom"><b>Bottom line:</b> {bottom}</p>}
        {caveat && <p className="lpwx__caveat">{caveat}</p>}
      </div>
      {/* The SAME block the model board shows for this game -- scoring, weather, referee, both
          injury lists and who is back. Rendered from the shared component rather than rebuilt, so
          the homepage can never drift from /model. */}
      <SpecialConsiderations ctx={ctx} />
      <p className="lp-cardfoot"><a href="/model">See every game, with injuries and the referee →</a></p>
    </Panel>
  );
}

function Panel({ title, count, hint, open, pin, children }: { title: string; count: React.ReactNode; hint: React.ReactNode; open?: boolean; pin?: Pin; children: React.ReactNode }) {
  return (
    <details className="hb-panel" open={open}>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">{title}</span>
        <Tip text={hint} />
        <span className="hb-bar__count hb-bar__count--gold">{count}</span>
        {pin && <PinButton size="sm" pin={pin} />}
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {children}
      </div>
    </details>
  );
}

function NflHead() {
  return <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Model Spread</th><th>Model O/U</th></tr></thead>;
}
function NflRows({ rows, moreFrom }: { rows: CardRow[]; moreFrom?: number }) {
  return (
    <>
      {rows.map((r, i) => (
        <tr key={r.eventId} className={[r.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
          <td className="hb-l"><span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>{r.off && <span className="hb-dia hb-dia--end">◆</span>}<span className="hb-gkick">{cxKick(r.commence)}</span></td>
          <td className="hb-num">{r.marketSpread ?? "—"}</td>
          <td className="hb-num hb-tot">{numStr(r.marketTotal)}</td>
          <td className="hb-num hb-model">{r.modelSpread ?? "—"}</td>
          <td className="hb-num hb-model">{numStr(r.modelTotal)}</td>
        </tr>
      ))}
    </>
  );
}
function NflCardTable({ rows }: { rows: CardRow[] }) {
  if (!rows.length) return <p className="hb-empty">The NFL board opens when this week&apos;s odds and reads post.</p>;
  return (
    <MoreTable id="gm-more-nfl" head={<NflHead />} extra={Math.max(0, rows.length - 3)} noun="games" cls="hb-form--mkt">
      <NflRows rows={rows} moreFrom={3} />
    </MoreTable>
  );
}

function NcaafHead() {
  return <NcaafCardHead />;
}
function NcaafRows({ games, moreFrom }: { games: readonly NcaafCardGame[]; moreFrom?: number }) {
  return (
    <>
      {games.map((g, i) => {
        const ms = g.marketSpread;
        return (
          <tr key={`${g.away}-${g.home}`} className={[g.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
            <NcaafGameCell g={g} />
            <td className="hb-num">{ms ? `${abbrevTeam(ms.fav)} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-num hb-model">{abbrevTeam(g.projSpread.fav)} {g.projSpread.num}</td>
            <td className="hb-num hb-model">{g.projTotal}</td>
          </tr>
        );
      })}
    </>
  );
}
function NcaafCardTable({ games }: { games: NcaafCardGame[] }) {
  // Lead with the games being played soonest (the source orders by kickoff), so the
  // opening-weekend slate shows first; the rest sit behind "see all".
  const src = games;
  return (
    <MoreTable id="gm-more-ncaaf" head={<NcaafHead />} extra={Math.max(0, src.length - 3)} noun="games" cls="hb-form--mkt">
      <NcaafRows games={src} moreFrom={3} />
    </MoreTable>
  );
}

// Player Model snapshot — a few of our line-blind prop reads with "Our Model Suggests"
// (the prior-season hit rate over the posted line). NFL only; NCAAF has no projections yet.
// A starter / primary contributor (depth rank <= 2); unknown players pass (don't over-filter).
function isStarter(player: string): boolean {
  const e = DEPTH[player.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim()];
  return !e || e.rank <= 2;
}
function PlayerSnapshot({ base }: { base: Sport }) {
  const href = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  // One row per starter — their biggest book-vs-projection gap — so we don't repeat a
  // player or surface deep-backup noise. Sorted by that gap, top 6.
  let rows: PlayerProj[] = [];
  if (base === "nfl") {
    // Only meaningful yardage/passing props — a real yardage line or a QB passing number.
    // Anytime-TD is deliberately EXCLUDED here (not shown on the homepage). Floors are per
    // market so the book value is comparable within it.
    const MIN_BOOK: Record<string, number> = { rush_yds: 40, rec_yds: 40, receptions: 3, pass_yds: 200, pass_tds: 1 };
    const PASS_MKTS = new Set(["pass_yds", "pass_tds"]);
    // A rookie has a posted line and no projection, so there is no gap to rank him by.
    const gap = (r: PlayerProj) => (r.book === null || r.proj === null) ? 0 : Math.abs(r.proj / r.book - 1);
    const best = new Map<string, PlayerProj>();
    for (const r of PLAYER_PROJECTIONS) {
      if (!(r.market in MIN_BOOK)) continue; // skips anytime_td + anything unlisted
      if (!isStarter(r.player) || r.book === null || r.book < MIN_BOOK[r.market]) continue;
      const cur = best.get(r.player);
      if (!cur || gap(r) > gap(cur)) best.set(r.player, r);
    }
    const pool = [...best.values()].sort((a, b) => gap(b) - gap(a));
    // Reserve up to 2 slots for QB passing props so quarterbacks always appear, then fill
    // the rest with the biggest non-passing gaps (at most 2 per market for a varied mix).
    const passing = pool.filter((r) => PASS_MKTS.has(r.market)).slice(0, 2);
    const perMkt: Record<string, number> = {};
    for (const r of pool.filter((r) => !PASS_MKTS.has(r.market))) {
      if (passing.length + rows.length >= 6) break;
      if ((perMkt[r.market] ?? 0) >= 2) continue;
      perMkt[r.market] = (perMkt[r.market] ?? 0) + 1;
      rows.push(r);
    }
    rows = [...passing, ...rows].sort((a, b) => gap(b) - gap(a));
  }
  if (!rows.length) {
    return (
      <>
        <div className="hb-formwrap">
          <table className="hb-form">
            <thead><tr><th className="hb-l">Player</th><th>Team</th><th>Prop</th><th>Market #</th><th>Our proj</th></tr></thead>
            <tbody><tr className="hb-off"><td className="hb-l" colSpan={5}>Projections publish here as the season&apos;s usage is captured.</td></tr></tbody>
          </table>
        </div>
        <p className="hb-empty">See the <a href={href}>Player Model →</a></p>
      </>
    );
  }
  const psnapRow = (r: PlayerProj, i: number) => {
    const unit = PROP_UNIT[r.market] ?? "";
    const over = r.book === null || r.proj === null || r.proj >= r.book;
    return (
      <tr key={`${r.player}-${r.market}`} className={i >= 3 ? "hb-row--more" : undefined}>
        <td className="hb-l"><a className="hb-plrlink" href={href}>{r.player}</a> <span className="hb-plrpos">{depthTag(r.player, r.pos)}</span></td>
        <td className="hb-num">{r.team}</td>
        <td>{PROP_LABEL[r.market] ?? r.market}</td>
        <td className="hb-num hb-tot">{r.book}{unit}</td>
        <td className="hb-num"><span className={`hb-model${over ? "" : " hb-model--down"}`}>{r.proj}{unit} {over ? "▲" : "▼"}</span></td>
      </tr>
    );
  };
  return (
    <>
      <MoreTable id={`psnap-more-${base}`} cls="hb-form--psnap" head={<thead><tr><th className="hb-l">Player</th><th>Team</th><th>Prop</th><th>Market #</th><th>Our proj</th></tr></thead>} extra={Math.max(0, rows.length - 3)} noun="players">
        {rows.map(psnapRow)}
      </MoreTable>
      <p className="lp-cardfoot"><a href={href}>See the full Player Model →</a></p>
    </>
  );
}

function NflValueTable({ rows }: { rows: VfRow[] }) {
  if (!rows.length) {
    return <p className="hb-empty">Live line shopping opens with the week&apos;s odds — see the <a href="/lines">Value Finder →</a></p>;
  }
  return (
    <div className="hb-formwrap">
      <table className="hb-form">
        <thead><tr><th className="hb-l">Game</th><th>Best line</th><th>Best price</th><th>Book</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.eventId}>
              <td className="hb-l">{r.away}<span className="at">@</span>{r.home}</td>
              <td className="hb-num">{r.line}</td>
              <td className="hb-num"><b className="hb-model">{r.price > 0 ? `+${r.price}` : r.price}</b></td>
              {/* A tie at several books makes this the longest cell on the board
                  ("BetOnline / BetUS / Bovada / Fanatics / LowVig"). .hb-form td is nowrap, so it
                  overflowed its 34% column and gave the whole table a horizontal scrollbar — only
                  on slates where a line happened to be tied that widely. Let this one wrap. */}
              {/* Phone: book CODES (DK / MGM) on one line — the wrapped names made a tied row 50px
                  against 34px for its neighbours (audit, chart-rows-uneven at 375). */}
              <td className="hb-books" title={r.books.map(bookName).join(" / ")}>
                <span className="hb-books__long">{r.books.map(bookName).join(" / ")}</span>
                <span className="hb-books__short">{booksCode(r.books)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** MLB snapshot: tonight's slate with our line-blind projected score.
 *
 *  Deliberately NOT a "where we disagree" panel like the football ones. Our totals currently sit a
 *  measured 0.74 runs above the book's on essentially every game -- a LEVEL offset in the feed, not
 *  a per-game read (see the note on /mlb/model) -- so a disagreement panel would rank games by an
 *  artefact and present one constant as fifteen findings. Our own numbers, and a link. */
function MlbSnapshot() {
  const now = new Date().toISOString();
  const games = MLB_GAMES.filter((g) => g.commence > now)
    .sort((a, b) => a.commence.localeCompare(b.commence))
    .slice(0, 4);
  if (!games.length) return <p className="lp-cardfoot">No games projected yet — the board fills as probable starters post.</p>;
  const sp = (n: string | null) => {
    if (!n) return "not posted";
    const parts = n.trim().split(/\s+/);
    return parts.length < 2 ? n : `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
  };
  return (
    <>
      <div className="hb-formwrap">
        <table className="hb-form hb-form--mkt">
          <thead><tr><th className="hb-l">Game</th><th>Starting pitchers</th><th>Our score</th><th>Our total</th></tr></thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.gameKey}>
                <td className="hb-l"><span className="hb-game">{g.awayAbbr}<span className="hb-at">at</span>{g.homeAbbr}</span></td>
                <td>{sp(g.awaySpName)} / {sp(g.homeSpName)}</td>
                <td className="hb-num hb-model">{g.awayRuns.toFixed(1)}&ndash;{g.homeRuns.toFixed(1)}</td>
                <td className="hb-num hb-model">{g.total.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-cardfoot"><a href="/mlb/model">See the full MLB model &rarr;</a></p>
    </>
  );
}

export interface SpotlightProp { ctx: SpecialCtx; row: CardRow }

export default function LandingHub({ initialSport, nfl, ncaaf, vf, isMember, spotlight }: { initialSport: Sport; nfl: NflData; ncaaf: NcaafData; vf: VfRow[]; isMember?: boolean; spotlight?: SpotlightProp | null }) {
  // AP Top 25 matchups this week (either team ranked), kept in kickoff order — the
  // homepage's ranked-games snapshot, mirroring the full table on /ncaaf/model.
  const ncaafRanked = ncaaf.games.filter((g) => g.apAway || g.apHome)
    .slice().sort((a, b) => (a.commence || "9999").localeCompare(b.commence || "9999")); // soonest first
  // Members can pin any homepage panel to their Custom Dashboard (signed-out visitors don't see ＋).
  const pin = (kind: Pin["kind"], label: string, href: string): Pin | undefined =>
    isMember ? { id: href, kind, label, href } : undefined;
  return (
    <section className="lp-hub" id="lp-board" aria-label="This week's board">
      {/* pure-CSS sport toggle — no client JS needed */}
      <input type="radio" name="lpsport" id="lps-nfl" className="lp-r" defaultChecked={initialSport === "nfl"} />
      <input type="radio" name="lpsport" id="lps-ncaaf" className="lp-r" defaultChecked={initialSport === "ncaaf"} />
      <input type="radio" name="lpsport" id="lps-mlb" className="lp-r" defaultChecked={initialSport === "mlb"} />


      {/* NFL panel */}
      <div className="lp-sport lp-sport--nfl">
        {/* The sport toggle sits ABOVE the banner: it switches this entire panel, so it has to be
            the first thing you see rather than something you find after scrolling past the art. */}
        <div className="lpf__sportbar">
          <div className="lpf__toggle" role="tablist" aria-label="Choose a sport">
            <label htmlFor="lps-nfl" className="lpf__t">NFL</label>
            <label htmlFor="lps-ncaaf" className="lpf__t">NCAAF</label>
            <label htmlFor="lps-mlb" className="lpf__t">MLB</label>
          </div>
        </div>
        <HighlightBanner sport="nfl" />
        <div className="lpf__head lpf__head--snap">
          <div className="lp-snaplabel">NFL WEEK {nfl.week} SNAPSHOT</div>
        </div>
        {/* Aggressive curation: 3 disagreements + 3 player reads + 1 context. Everything else
            lives on its own section page (linked from each panel + the feature cards below). */}
        <WeatherSpotlight spot={spotlight ?? null} week={nfl.week} />
        <Panel title="Where the model disagrees most" count={`${nfl.card.filter((r) => r.off).length || "—"} off-consensus`} hint={TIPS.gameModel} open
          pin={pin("model", "The Model · Game Model", "/model")}>
          <NflCardTable rows={[...nfl.card].sort((a, b) => Number(b.off) - Number(a.off)).slice(0, 3)} />
          <p className="lp-cardfoot"><a href="/model">See the full model →</a></p>
        </Panel>
        <Panel title="This week&apos;s player reads" count="props" hint={TIPS.playerModel} open
          pin={pin("model", "Player Prop Model", "/model/players")}>
          <PlayerSnapshot base="nfl" />
        </Panel>
        <Panel title="The context a number misses" count="context" hint={TIPS.considNfl} open
          pin={pin("considerations", "Special Considerations", "/model")}>
          <NflConsiderations limit={2} />
        </Panel>
        <Panel title="Where the value is" count="line shopping" hint={TIPS.valueFinder} open
          pin={pin("lines", "Value Finder · Line Shopping", "/lines")}>
          <NflValueTable rows={vf} />
          <p className="lp-cardfoot"><a href="/lines">Shop every line in Value Finder →</a></p>
        </Panel>
        {/* Referee, Local Intelligence, Upsets & QB passing now live on their section pages. */}
      </div>

      {/* NCAAF panel */}
      <div className="lp-sport lp-sport--ncaaf">
        {/* Mirrors the NFL panel — the toggle leads, above the banner. Both panels carry their own
            copy because only one panel is ever displayed, and the labels drive the same radios. */}
        <div className="lpf__sportbar">
          <div className="lpf__toggle" role="tablist" aria-label="Choose a sport">
            <label htmlFor="lps-nfl" className="lpf__t">NFL</label>
            <label htmlFor="lps-ncaaf" className="lpf__t">NCAAF</label>
            <label htmlFor="lps-mlb" className="lpf__t">MLB</label>
          </div>
        </div>
        <HighlightBanner sport="ncaaf" />
        <div className="lpf__head lpf__head--snap">
          <div className="lp-snaplabel">COLLEGE FOOTBALL WEEK {ncaaf.week} SNAPSHOT</div>
        </div>
        {ncaafRanked.length > 0 && (
          <Panel title="AP Top 25 matchups" count={`${ncaafRanked.length} ranked`} hint={<>This week&apos;s games with an <b>AP Top 25</b> team, in kickoff order, each ranked side showing its poll rank. The market&apos;s <b>Spread</b> and <b>O/U</b> sit beside <b>Our Projection</b> — our <b>line-blind</b> read, published for context.</>} open
            pin={pin("model", "NCAAF · AP Top 25 Matchups", "/ncaaf/model")}>
            <MoreTable id="gm-ranked-ncaaf" head={<NcaafHead />} extra={Math.max(0, ncaafRanked.length - 3)} noun="ranked games" cls="hb-form--mkt">
              <NcaafRows games={ncaafRanked} moreFrom={3} />
            </MoreTable>
            <p className="lp-cardfoot"><a href="/ncaaf/model">See all ranked games →</a></p>
          </Panel>
        )}
        <Panel title="Where the model disagrees most" count={`${ncaaf.games.filter((g) => g.off).length || "—"} off-consensus`} hint={TIPS.gameModel} open
          pin={pin("model", "NCAAF Model · Game Model", "/ncaaf/model")}>
          <NcaafCardTable games={[...ncaaf.games].sort((a, b) => Number(b.off) - Number(a.off)).slice(0, 3)} />
          <p className="lp-cardfoot"><a href="/ncaaf/model">See the full model →</a></p>
        </Panel>
        <Panel title="This week&apos;s player reads" count="props" hint={TIPS.playerModel} open
          pin={pin("model", "NCAAF Player Prop Model", "/ncaaf/model/players")}>
          <PlayerSnapshot base="ncaaf" />
        </Panel>
        <Panel title="The context a number misses" count="context" hint={TIPS.considNcaaf} open
          pin={pin("considerations", "NCAAF · Special Considerations", "/ncaaf/considerations")}>
          <NcaafConsiderations />
        </Panel>
      </div>

      {/* MLB panel (Derek: "also place the MLB toggle on the homepage"). Leaner than the two
          football panels on purpose: baseball is a nightly slate rather than a weekly board, and
          the model's own held-out card is honest that only the starting pitcher moves its number —
          so the snapshot is tonight's games, their starters, and our score. No disagreement panel
          here; see MlbSnapshot for why that would rank games by an artefact. */}
      <div className="lp-sport lp-sport--mlb">
        <div className="lpf__sportbar">
          <div className="lpf__toggle" role="tablist" aria-label="Choose a sport">
            <label htmlFor="lps-nfl" className="lpf__t">NFL</label>
            <label htmlFor="lps-ncaaf" className="lpf__t">NCAAF</label>
            <label htmlFor="lps-mlb" className="lpf__t">MLB</label>
          </div>
        </div>
        <div className="lpf__head lpf__head--snap">
          <div className="lp-snaplabel">MLB &mdash; TONIGHT&apos;S SLATE</div>
        </div>
        <Panel title="Tonight&apos;s games" count="line-blind" hint={TIPS.gameModel} open
          pin={pin("model", "MLB · Game Model", "/mlb/model")}>
          <MlbSnapshot />
        </Panel>
      </div>
    </section>
  );
}
