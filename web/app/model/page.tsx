import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, fetchCalibration, type ModelPrediction } from "@/lib/model";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { weekRefs } from "@/lib/refAssignments";
import { Brand, FlowSteps, ModelSubnav, WeekBadge } from "../Nav";
import { WeekNav } from "../WeekNav";
import Tip from "../Tip";
import AddToSlip from "../AddToSlip";

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

function ImpTable({ rows, refs, moreFrom }: { rows: Env[]; refs: Awaited<ReturnType<typeof weekRefs>>; moreFrom?: number }) {
  return (
    <div className="imptable" role="table" aria-label="Lines and the model's read">
      <div className="improw improw--head" role="row">
        <span>game</span><span>spread</span>
        <span className="improw__modh">model spread</span><span>total</span>
        <span className="improw__modh">model total</span>
      </div>
      {rows.map((e, i) => {
        const bl = bottomLine(e);
        const crew = refs.get(e.home);
        return (
          <div className={moreFrom !== undefined && i >= moreFrom ? "impgame hb-row--more" : "impgame"} key={e.eventId}>
            <div className="improw" role="row">
              <span className="improw__g">
                {e.away}<span className="at">@</span>{e.home}
                {e.neutral && <span className="badge neutral">NEUTRAL</span>}
              </span>
              <span className="improw__sp">
                {e.favLabel}
                {e.spreadKey && <span className="ssmark" title={`Sweet spot — key number ${e.spreadKey.num} (½pt ≈ ${e.spreadKey.cost.toFixed(0)}%)`}>◆</span>}
              </span>
              <span className="improw__mod">
                {e.modelSpread ?? "—"}
                {e.modelDisagree && <span className="offcmark" title="Off consensus — our model favors a different side than the market">⚑</span>}
              </span>
              <span className="improw__tot">
                {e.total!.toFixed(1)}
                {e.totalKey && <span className="ssmark" title={`Sweet spot — key total ${e.totalKey.num} (½pt ≈ ${e.totalKey.cost.toFixed(0)}%)`}>◆</span>}
              </span>
              <span className="improw__mod">{e.modelTotal !== null ? e.modelTotal.toFixed(1) : "—"}</span>
            </div>
            <div className="impbottom">
              <span className="impbottom__k">Bottom line</span>
              {bl
                ? <span className="impbottom__txt"><b>{bl.spread}</b>{bl.total && <> and <b>{bl.total}</b></>}</span>
                : <span className="impbottom__txt impbottom__none">No model read yet</span>}
              {crew && (
                <span className="impbottom__crew">
                  Crew: <b>{crew.referee}</b> ({crew.tendency}, {crew.pen} pen/g)
                </span>
              )}
            </div>
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
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

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

      {preds.length === 0 ? (
        <p className="foot">No reads published for Week {week} yet.</p>
      ) : (
        <details className="hb-panel hb-panel--card" open>
          <summary className="hb-bar">
            <span className="hb-bar__title hb-bar__title--gold">Week {week} Full Model</span>
            <span className="hb-bar__count">{preds.length} games</span>
            <span className="hb-bar__chev" aria-hidden="true">▾</span>
          </summary>
          <div className="hb-body">
            <section className="grid">
              {preds.slice(0, 6).map((p) => <PredictionCard key={p.eventId} p={p} slipPick={slipPickByEvent.get(p.eventId)} />)}
            </section>
            {preds.length > 6 && (
              <details className="hb-more">
                <summary className="hb-more__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  See more ({preds.length - 6} more games)
                </summary>
                <section className="grid">
                  {preds.slice(6).map((p) => <PredictionCard key={p.eventId} p={p} slipPick={slipPickByEvent.get(p.eventId)} />)}
                </section>
              </details>
            )}
          </div>
        </details>
      )}

      {/* Week's numbers crunched — market spread/total beside our line-blind projection. */}
      <details className="hb-panel hb-panel--card" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Week {week} numbers crunched</span>
          <span className="hb-bar__count">{scored.length} games</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
        <p className="ctxsec__d">
          The market&apos;s <b>spread</b> and <b>total</b> for each game, with our <b>line-blind model&apos;s</b>
          own read of each sitting right beside it.
        </p>

        {scored.length === 0 ? (
          <p className="foot">No lines captured for Week {week} yet.</p>
        ) : (
          <div className="imp-wrap hb-moretbl">
            <input type="checkbox" id="imp-more" className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            <p className="imp-scrollhint" aria-hidden="true">
              Swipe for totals <span className="imp-scrollhint__a">→</span>
            </p>
            <ImpTable rows={scored} refs={refs} moreFrom={6} />
            {scored.length > 6 && (
              <label htmlFor="imp-more" className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                <span className="hb-moretbl__more">See more ({scored.length - 6} more games)</span>
                <span className="hb-moretbl__less">See less</span>
              </label>
            )}
          </div>
        )}
        </div>
      </details>

      <a href="/model/players" className="soonpanel soonpanel--link" id="player-model">
        <span className="soonpanel__tag">Player Prop Model</span>
        <h2 className="soonpanel__h soonpanel__cta">
          Click here to see our Player Prop Model projections <span aria-hidden="true">→</span>
        </h2>
      </a>

      <section className="calib">
        <h2 className="calib__h">Calibration</h2>
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
