import { weekRange, fetchWeek, buildBoard, currentWeek } from "@/lib/board";
import { fetchModelWeek, fetchCalibration, type ModelPrediction } from "@/lib/model";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { weekRefs } from "@/lib/refAssignments";
import { GAME_WEATHER, WEATHER_WEEK } from "@/lib/weatherData";
import { weekInjuries, type InjuryNote } from "@/lib/nflInactives";
import { SpecialConsiderations, type SpecialCtx } from "../SpecialConsiderations";
import { upsetMeter } from "@/lib/upsetMeter";
import { TEAM_RATINGS } from "@/lib/teamRatings";
import { REF_LEAGUE, REF_STATS } from "@/lib/refStats";
import { NFL_CHAOS, NFL_IMPROVE, NFL_ENV } from "@/lib/chaosTraits";
import { scoreChaos, returnFromSpread, comfortInfo } from "@/lib/chaos";
import { Brand, FlowSteps, ModelSubnav, WeekBadge } from "../Nav";
import { WeekNav } from "../WeekNav";
import Tip from "../Tip";
import AddToSlip from "../AddToSlip";
import { capDayGroups, etToday, groupByGameDay, dayBasis, type DayGroup } from "@/lib/gameDays";
import { DayHeader } from "../DayHeader";
import PinButton from "../PinButton";

export const revalidate = 300;
const SEASON = 2026;

// --- "Lines & the model's read": the market's spread/total beside our line-blind
// projection, with a plain-English cover lean. Moved here from Upset Watch so all
// model detail lives on The Model page. ---
interface Env {
  eventId: string; home: string; away: string;
  commence: string;               // kickoff ISO — for date ordering
  spread: number | null;          // home perspective; negative = home favored
  favLabel: string;               // "PIT -3"
  spreadKey: { num: number; cost: number } | null;
  total: number | null;
  totalKey: { num: number; cost: number } | null;
  modelTotal: number | null;      // our line-blind projected total (weak; not an edge)
  neutral: boolean;
  modelSpread: string | null;     // our model's projected spread, e.g. "DET -7.2"
  modelMarginHome: number | null;
  modelDisagree: boolean;
}

function favLabel(home: string, away: string, spread: number | null): string {
  if (spread === null) return "—";
  if (spread === 0) return "PK";
  return spread < 0 ? `${home} ${spread.toFixed(1)}` : `${away} -${spread.toFixed(1)}`;
}

/** Which side of the MARKET spread the model favors (cover, not just winner) + O/U lean. */
function bottomLine(e: Env): { spread: string; total: string | null } | null {
  if (e.spread === null || e.modelMarginHome === null) return null;
  const mag = Math.abs(e.spread);
  const marketFavHome = e.spread < 0;
  const dog = marketFavHome ? e.away : e.home;
  const modelMarginForFav = marketFavHome ? e.modelMarginHome : -e.modelMarginHome;
  const spread = mag < 0.5
    ? "pick'em"
    : modelMarginForFav >= mag ? e.favLabel : `${dog} +${mag.toFixed(1)}`;
  let total: string | null = null;
  if (e.modelTotal !== null && e.total !== null) {
    const d = e.modelTotal - e.total;
    total = Math.abs(d) < 1 ? null : d < 0 ? "the under" : "the over";
  }
  return { spread, total };
}

function ImpTable({ rows, refs, spec, today, tomorrow, cap }: {
  rows: Env[]; refs: Awaited<ReturnType<typeof weekRefs>>;
  spec: Map<string, SpecialCtx>; today: string; tomorrow: string; cap?: number;
}) {
  // `cap` shows the first N games and marks the rest `hb-row--more`, which the surrounding
  // hb-moretbl checkbox reveals — all in ONE table so the day headers never split and the
  // collapse control stays at the bottom (a two-table slice duplicated the day header and
  // stranded the toggle mid-list). `gi` counts games across day groups to apply the cap.
  let gi = 0;
  return (
    <div className="imptable" role="table" aria-label="Lines and the model's read">
      {groupByGameDay(rows, (e) => e.commence, today, tomorrow).map((grp) => {
        const groupHidden = cap != null && gi >= cap; // every game in this day group is past the cap
        return (
        <div key={grp.key} className={groupHidden ? "hb-row--more" : undefined}>
          <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
          {grp.items.map((e) => {
        const rowHidden = cap != null && gi >= cap && !groupHidden;
        gi++;
        const bl = bottomLine(e);
        return (
          <div className={rowHidden ? "impgame hb-row--more" : "impgame"} key={e.eventId}>
            {/* Each game carries its own column header. One header per BOARD is the house rule,
                and it is the right one for a plain list — but the games are now separated by a
                tall Special Considerations block, so a single header at the top of the day is off
                screen by the second game. Derek: "Each game should have the Game, Spread, Total,
                Model Spread, and Model Total headers to start." Bottom line joins them as a
                sixth column rather than the loose strip it was underneath. */}
            <h4 className="impsec impsec--first">Market vs model breakdown</h4>
            <div className="improw improw--head" role="row">
              <span>game</span><span>spread</span><span>total</span>
              <span className="improw__modh improw__modstart">model spread</span>
              <span className="improw__modh">model total</span>
              <span className="improw__blh">bottom line</span>
            </div>
            <div className="improw" role="row">
              <span className="improw__g">
                {e.away}<span className="at">@</span>{e.home}
                {e.neutral && <span className="badge neutral">NEUTRAL</span>}
              </span>
              <span className="improw__sp">
                {e.favLabel}
                {e.spreadKey && <span className="ssmark" title={`Sweet spot — key number ${e.spreadKey.num} (½pt ≈ ${e.spreadKey.cost.toFixed(0)}%)`}>◆</span>}
              </span>
              <span className="improw__tot">
                {e.total!.toFixed(1)}
                {e.totalKey && <span className="ssmark" title={`Sweet spot — key total ${e.totalKey.num} (½pt ≈ ${e.totalKey.cost.toFixed(0)}%)`}>◆</span>}
              </span>
              <span className="improw__mod improw__modstart">
                {e.modelSpread ?? "—"}
                {e.modelDisagree && <span className="offcmark" title="Off consensus — our model favors a different side than the market">⚑</span>}
              </span>
              <span className="improw__mod">{e.modelTotal !== null ? e.modelTotal.toFixed(1) : "—"}</span>
              <span className="improw__bl">
                {bl
                  ? <><b>{bl.spread}</b>{bl.total && <> and <b>{bl.total}</b></>}</>
                  : <span className="impbottom__none">No model read yet</span>}
              </span>
            </div>
            {/* The Context page's Special Considerations, moved under the line it informs — the
                crew line that used to sit in the Bottom Line is one of its rows now. */}
            {spec.get(e.eventId) && <SpecialConsiderations ctx={spec.get(e.eventId)!} />}
          </div>
        );
      })}
        </div>
        );
      })}
    </div>
  );
}

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";


function PredictionCard({ p, slipPick }: { p: ModelPrediction; slipPick?: string }) {
  const favProb = p.favored === p.home ? p.homeWinProb : 1 - p.homeWinProb;
  const rawPct = Math.round(favProb * 100);
  // Near-even games: a ~0 margin can map just under 50% — show it honestly as a toss-up
  // instead of the contradictory "X by 0.1 · 49%".
  const pickem = Math.abs(p.predMargin) < 0.5 || rawPct <= 50;
  const pct = pickem ? 50 : rawPct;
  const mktPct = p.marketFavProb === null ? null : Math.round(p.marketFavProb * 100);
  // Actionable read: the model's straight-up pick (moneyline) + its side of the MARKET
  // spread (slipPick, e.g. "CAR +2.5"). A "+" cover side means the model has the favorite
  // winning but NOT covering — so the value is the dog's points, not laying the number.
  const ml = `${p.favored} ML`;
  const coverIsDog = !!slipPick?.includes("+");
  return (
    <article className={p.disagree ? "game offc" : "game"}>
      <header className="game__head">
        <span className="matchup">{p.away}<span className="at">@</span>{p.home}</span>
        <time className="kick">{et(p.commence)}</time>
        {p.disagree && <span className="badge offc">OFF CONSENSUS</span>}
        {p.neutral && <span className="badge neutral">NEUTRAL</span>}
      </header>
      <div className="pred">
        <div className="cmp">
          <div className="cmp__side">
            <div className="cmp__head">
              <span className="cmp__lab">Our model</span>
              {pickem
                ? <span className="cmp__pick"><b>Pick&apos;em</b> — too close to call</span>
                : <span className="cmp__pick"><b>{p.favored}</b> by {Math.abs(p.predMargin).toFixed(1)}</span>}
            </div>
            <div className="cmp__bar">
              <div className="cmp__track"><span className="cmp__fill cmp__fill--model" style={{ width: `${pct}%` }} /></div>
              <span className="cmp__pct cmp__pct--model">{pickem ? "~50" : pct}%</span>
            </div>
          </div>

          {p.marketFavored && mktPct !== null && (
            <div className="cmp__side">
              <div className="cmp__head">
                <span className="cmp__lab">The market</span>
                <span className="cmp__pick"><b>{p.marketFavored}</b> favored</span>
              </div>
              <div className="cmp__bar">
                <div className="cmp__track"><span className="cmp__fill cmp__fill--mkt" style={{ width: `${mktPct}%` }} /></div>
                <span className="cmp__pct cmp__pct--mkt">{mktPct}%</span>
              </div>
            </div>
          )}
        </div>

        {p.marketFavored && mktPct !== null && (
          <div className="pred__take">
            {pickem ? (
              <>Model sees a <b>coin flip</b> — no side worth laying.</>
            ) : p.disagree ? (
              <>Off consensus — our model likes <b>{p.favored}</b> where the market likes <b>{p.marketFavored}</b>: take <b>{ml}</b>{slipPick && <> or <b>{slipPick}</b></>}.</>
            ) : slipPick ? (
              coverIsDog ? (
                <>Model has <b>{p.favored}</b> winning but <b>not covering</b> — take <b>{ml}</b>, or the points with <b>{slipPick}</b>.</>
              ) : (
                <>Model has <b>{p.favored}</b> covering — <b>{slipPick}</b>, or just <b>{ml}</b>.</>
              )
            ) : (
              <>Model and market agree on <b>{p.favored}</b> — take <b>{ml}</b>.</>
            )}
          </div>
        )}

        {p.neutral && <div className="pred__note">Neutral site — {p.venue}. No home-field edge applied.</div>}

        {!pickem && (
          <div className="pred__slip">
            <AddToSlip
              item={{
                id: `model-${p.eventId}`, kind: "model",
                // A real bet: the model's side of the MARKET spread, else the moneyline pick.
                title: slipPick ?? `${p.favored} ML`,
                detail: `${p.away} @ ${p.home} · model read`,
              }}
            />
          </div>
        )}
      </div>
    </article>
  );
}

export default async function Page({ searchParams }: PageProps<"/model">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch {
    range = null;
  }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  // Default to the CURRENT week (earliest with a game still to play), not the earliest week that
  // has odds — `min` is week 1 all season, so every NFL board opened on the completed week.
  let cur: number | null = null;
  try { cur = await currentWeek(SEASON); } catch { cur = null; }
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : (cur ?? min);

  let preds: ModelPrediction[] = [];
  try { preds = await fetchModelWeek(week, SEASON); } catch { preds = []; }
  let calibration: Awaited<ReturnType<typeof fetchCalibration>> = [];
  try { calibration = await fetchCalibration(SEASON); } catch { calibration = []; }

  // "Lines & the model's read" table data — market lines beside our locked read.
  let board: Awaited<ReturnType<typeof fetchWeek>> = [];
  try { board = await fetchWeek(week, SEASON); } catch { board = []; }
  const built = buildBoard(board);
  const modelById = new Map<string, ModelPrediction>(preds.map((p) => [p.eventId, p]));
  let refs: Awaited<ReturnType<typeof weekRefs>> = new Map();
  try { refs = await weekRefs(week, SEASON); } catch { /* assignments post game-week */ }
  // Special Considerations (referee · weather · injuries · team scoring ratings), one entry per
  // game. Injuries are read LIVE on the same 120s window as the board's market numbers, so a
  // designation that changes on game morning shows without a redeploy; never fatal.
  let injAll: Awaited<ReturnType<typeof weekInjuries>> = new Map();
  try { injAll = await weekInjuries(SEASON, week); } catch { /* no feed — no tags */ }
  const wxByEvent = new Map(GAME_WEATHER.map((w) => [w.eventId, w]));
  const injByTeam = new Map<string, { player: string; team: string; note: InjuryNote }[]>();
  for (const [key, note] of injAll) {
    const team = key.split("|")[1] ?? "";
    (injByTeam.get(team) ?? injByTeam.set(team, []).get(team)!).push({ player: note.player, team, note });
  }
  // The Upset Meter, per game. The chaos index that used to be its own Upset Lab page is one
  // component of it now (see lib/upsetMeter.ts for the weights and the honesty rules).
  const LEAGUE_PTS = 22.5;                       // NFL points per team per game, long-run
  const upsetByEvent = new Map<string, ReturnType<typeof upsetMeter>>();
  for (const g of built) {
    const spread = g.spread.consensus;
    const mp = modelById.get(g.eventId);
    if (spread === null || spread === 0) continue;
    const fav = spread < 0 ? g.home : g.away;
    const dog = spread < 0 ? g.away : g.home;
    const line = Math.abs(spread);
    const wx = week === WEATHER_WEEK ? wxByEvent.get(g.eventId) : undefined;
    const dogMl = g.ml[dog]?.price;
    const profit = typeof dogMl === "number" ? (dogMl > 0 ? dogMl : 10000 / -dogMl) : null;
    const dogEnv = NFL_ENV[dog], venueEnv = NFL_ENV[g.home];
    const cz = dog !== g.home && dogEnv && venueEnv ? comfortInfo(dog, dogEnv, venueEnv, week) : null;
    const chaos = scoreChaos({
      sport: "NFL", away: g.away, home: g.home, dog, fav, line, week,
      dogReturn: profit !== null ? Math.round((100 + profit) / 10) * 10 : returnFromSpread(line, "NFL"),
      returnEst: profit === null,
      favTrait: NFL_CHAOS[fav], dogTrait: NFL_CHAOS[dog],
      windMph: wx && !wx.indoor ? wx.windMph : null,
      comfortPct: cz ? cz.score : dog === g.home ? 100 : undefined,
      comfortNote: cz?.note || undefined,
      improvePct: NFL_IMPROVE[dog]?.improvePct,
    });
    const crew = refs.get(g.home);
    const rs = crew ? REF_STATS.find((x) => x.name === crew.referee) : undefined;
    upsetByEvent.set(g.eventId, upsetMeter({
      marketSpreadHome: spread,
      modelMarginHome: mp ? mp.predMargin : null,
      windMph: wx && !wx.indoor ? wx.windMph : null,
      refPen: crew ? crew.pen : null,
      refLeaguePen: REF_LEAGUE.pen,
      refOverPct: rs ? rs.over : null,
      refLeagueOverPct: REF_LEAGUE.over,
      refFavCoverPct: rs ? rs.atsFav : null,
      refLeagueFavCoverPct: REF_LEAGUE.atsFav,
      dogOff: TEAM_RATINGS[dog]?.off ?? null,
      favDef: TEAM_RATINGS[fav]?.def ?? null,
      leaguePts: LEAGUE_PTS,
      chaosIndex: chaos.index,
    }, dog, fav));
  }
  const spec = new Map<string, SpecialCtx>(built.map((g) => [g.eventId, {
    away: g.away, home: g.home,
    crew: refs.get(g.home),
    wx: week === WEATHER_WEEK ? wxByEvent.get(g.eventId) : undefined,
    injuries: [...(injByTeam.get(g.away) ?? []), ...(injByTeam.get(g.home) ?? [])],
    feedHasAny: injAll.size > 0,
    upset: upsetByEvent.get(g.eventId) ?? null,
  }]));
  // `consensus` is FanDuel's line where posted (lib/board.ts LINE_BOOK), the US-book median only
  // where it is not — so this column matches the app on Derek's phone.
  const fdEvents = new Set(board.filter((r) => r.book === "fanduel" && r.market === "spreads").map((r) => r.event_id));
  const fdGames = built.filter((g) => fdEvents.has(g.eventId)).length;
  const envs: Env[] = built.map((g) => {
    const mp = modelById.get(g.eventId);
    const spread = g.spread.consensus;
    return {
      eventId: g.eventId, home: g.home, away: g.away, commence: g.commence, spread,
      favLabel: favLabel(g.home, g.away, spread),
      spreadKey: g.spread.key,
      total: g.total.consensus, totalKey: g.total.key,
      modelTotal: MODEL_TOTALS[`${week}-${g.away}-${g.home}`] ?? null,
      neutral: mp?.neutral ?? false,
      modelSpread: mp ? `${mp.favored} -${Math.abs(mp.predMargin).toFixed(1)}` : null,
      modelMarginHome: mp ? mp.predMargin : null,
      modelDisagree: mp?.disagree ?? false,
    };
  });
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();
  const scored = envs.filter((e) => e.total !== null)
    .sort((a, b) => (a.commence || "9999").localeCompare(b.commence || "9999")); // soonest kickoff first

  // The bettable side for each game's "Add to slip" — the model's read against the MARKET
  // spread (e.g. "CAR +3.5"), not the raw projected margin ("CHI by 1.9", which isn't a real
  // bet). Falls back to the moneyline on the model's pick when there's no market line yet.
  const slipPickByEvent = new Map<string, string>();
  for (const e of envs) {
    const bl = bottomLine(e);
    if (bl && bl.spread !== "pick'em") slipPickByEvent.set(e.eventId, bl.spread);
  }

  // Full Model board — the day-grouped game cards. Rendered for any slice of the week's reads so
  // we can show a short lead and tuck the rest behind our standard show-more dropdown.
  const modelDayGroups = (items: ModelPrediction[]) => groupByGameDay(items, (p) => p.commence, todayEt, tomorrowEt);
  const modelDayGrid = (groups: DayGroup<ModelPrediction>[]) => (
    <div className="daygrid">
      {groups.map((grp) => (
        <div className="daygrid__day" key={grp.key} style={dayBasis(grp.items.length)}>
          {/* `cont` = tail of a day split across the "show more" boundary — header already drawn. */}
          {!grp.cont && <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />}
          <section className="grid">
            {grp.items.map((p) => <PredictionCard key={p.eventId} p={p} slipPick={slipPickByEvent.get(p.eventId)} />)}
          </section>
        </div>
      ))}
    </div>
  );
  const FULL_MODEL_CAP = 2;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">NFL</span> · The Model</>} art={{ src: "/nflpic.png?v=1", alt: "NFL" }} />
      </header>

      <WeekBadge week={week} tip={
        <Tip label="The Model" text={<>Our model never sees the betting line — it reads each game from team strength alone,
          then we show you <b>where it agrees with the market and where it doesn&apos;t.</b> An{" "}
          <span className="chip offc">Off Consensus</span> game is one where the model likes a different
          side than Vegas. Every read is <b>published and locked before kickoff</b>, and the calibration
          below grades every one in public — so the track record is yours to check, not ours to claim.</>} />
      } />
      <FlowSteps active="analyze" />
      <div className="subnavrow">
        <ModelSubnav active="game" />
      </div>
      <WeekNav min={min} max={max} current={week} base="/model" />

      {/* Week's numbers crunched — market spread/total beside our line-blind projection. */}
      <details className="hb-panel hb-panel--card" data-embedchart="numbers-crunched" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Week {week} numbers crunched</span>
          <span className="hb-bar__count">{scored.length} games</span>
          <Tip label="About this board" text={<>
            <span className="tip__lead">The market&apos;s <b>spread</b> and <b>total</b> for each game — <b>FanDuel&apos;s</b> current line,
            captured through the week — with our <b>line-blind model&apos;s</b> own read of each beside it. Market
            numbers on the left, ours on the right.</span><br /><br />
            {fdGames < scored.length && <>{scored.length - fdGames} game{scored.length - fdGames === 1 ? "" : "s"} FanDuel has not posted
            yet show the median across the other US books instead.<br /><br /></>}
            Line shopping — every book&apos;s number and the best price per side — is on{" "}
            <a href="/lines">Line Shopping</a>.
          </>} />
          <PinButton size="sm" pin={{ id: "/model?only=numbers-crunched", kind: "model", label: "The Model · Numbers Crunched", detail: `NFL · Week ${week}`, href: `/model?week=${week}&only=numbers-crunched` }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">

        {scored.length === 0 ? (
          <p className="foot">No lines captured for Week {week} yet.</p>
        ) : (
          <div className="imp-wrap hb-moretbl">
            <input type="checkbox" id="imp-more" className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            <p className="imp-scrollhint" aria-hidden="true">
              Swipe for totals <span className="imp-scrollhint__a">→</span>
            </p>
            {/* The scroller wraps the TABLE ONLY — the hint above and the "show more" below must
                not scroll with it. .imptable itself must never carry overflow-x (see .imp-scroll
                in globals.css: it makes every row size to the phone, not the content, and the
                model columns then draw outside the card border). */}
            <div className="imp-scroll">
              <ImpTable rows={scored} cap={4} refs={refs} spec={spec} today={todayEt} tomorrow={tomorrowEt} />
            </div>
            {scored.length > 4 && (
              <label htmlFor="imp-more" className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                <span className="hb-moretbl__more">Show {scored.length - 4} more game{scored.length - 4 === 1 ? "" : "s"}</span>
                <span className="hb-moretbl__less">Collapse</span>
              </label>
            )}
          </div>
        )}
        </div>
      </details>


      {preds.length === 0 ? (
        <p className="foot">No reads published for Week {week} yet.</p>
      ) : (
        <details className="hb-panel hb-panel--card" data-embedchart="full-model" open>
          <summary className="hb-bar">
            <span className="hb-bar__title hb-bar__title--gold">Week {week} Full Model</span>
            <span className="hb-bar__count">{preds.length} games</span>
            <PinButton size="sm" pin={{ id: "/model?only=full-model", kind: "model", label: "The Model · Full Model", detail: `NFL · Week ${week}`, href: `/model?week=${week}&only=full-model` }} />
            <span className="hb-bar__chev" aria-hidden="true">▾</span>
          </summary>
          <div className="hb-body">
            {/* Cap on whole day groups, never on a raw game slice — grouping each half separately
                duplicates a day header across the cut and strands this Collapse mid-list. */}
            {(() => {
              const { head, rest, restCount } = capDayGroups(modelDayGroups(preds), FULL_MODEL_CAP);
              return (
                <>
                  {modelDayGrid(head)}
                  {restCount > 0 && (
                    <details className="hb-showmore">
                      <summary className="hb-showmore__sum">
                        <span className="hb-showmore__chev" aria-hidden="true">▸</span>
                        <span className="hb-showmore__more">Show {restCount} more game{restCount === 1 ? "" : "s"}</span>
                        <span className="hb-showmore__less">Collapse</span>
                      </summary>
                      {modelDayGrid(rest)}
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        </details>
      )}

      <section className="calib">
        <h2 className="calib__h">Calibration <a href="/report" className="calib__link">Weekly report card →</a></h2>
        {calibration.length === 0 ? (
          <p className="foot">
            No graded reads yet — calibration begins once Week&nbsp;1 games are played and graded.
            The {preds.length || ""} reads above are locked in the ledger; they can&apos;t be edited,
            so what you see now is exactly what will be scored.
          </p>
        ) : (
          <div className="calib__table" role="table">
            <div className="calib__row calib__row--head" role="row">
              <span>modeled</span><span>actual</span><span>n</span><span>avg CLV</span>
            </div>
            {calibration.map((c) => (
              <div className="calib__row" role="row" key={c.prob_bucket}>
                <span>{Math.round(c.mean_predicted * 100)}%</span>
                <span>{c.actual_rate !== null ? `${Math.round(c.actual_rate * 100)}%` : "—"}</span>
                <span>{c.n}</span>
                <span>{c.mean_clv !== null ? c.mean_clv.toFixed(2) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
