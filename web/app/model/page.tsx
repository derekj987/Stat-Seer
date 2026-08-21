import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, fetchCalibration, type ModelPrediction } from "@/lib/model";
import { fetchHome, type CardRow } from "@/lib/home";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { weekRefs } from "@/lib/refAssignments";
import { Brand, FlowSteps, ModelSubnav } from "../Nav";
import AddToSlip from "../AddToSlip";
import ModelClock from "../ModelClock";
import NflModelCard from "../NflModelCard";

export const revalidate = 300;
const SEASON = 2026;

// --- "Lines & the model's read": the market's spread/total beside our line-blind
// projection, with a plain-English cover lean. Moved here from Upset Watch so all
// model detail lives on The Model page. ---
interface Env {
  eventId: string; home: string; away: string;
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

function ImpTable({ rows, refs }: { rows: Env[]; refs: Awaited<ReturnType<typeof weekRefs>> }) {
  return (
    <div className="imptable" role="table" aria-label="Lines and the model's read">
      <div className="improw improw--head" role="row">
        <span>game</span><span>spread</span>
        <span className="improw__modh">model spread</span><span>total</span>
        <span className="improw__modh">model total</span>
      </div>
      {rows.map((e) => {
        const bl = bottomLine(e);
        const crew = refs.get(e.home);
        return (
          <div className="impgame" key={e.eventId}>
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

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/model?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

function PredictionCard({ p }: { p: ModelPrediction }) {
  const favProb = p.favored === p.home ? p.homeWinProb : 1 - p.homeWinProb;
  const rawPct = Math.round(favProb * 100);
  // Near-even games: a ~0 margin can map just under 50% — show it honestly as a toss-up
  // instead of the contradictory "X by 0.1 · 49%".
  const pickem = Math.abs(p.predMargin) < 0.5 || rawPct <= 50;
  const pct = pickem ? 50 : rawPct;
  const mktPct = p.marketFavProb === null ? null : Math.round(p.marketFavProb * 100);
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
            {p.disagree
              ? <>Our model likes <b>{p.favored}</b> — the market likes <b>{p.marketFavored}</b>.</>
              : <>Model and market agree: <b>{p.favored}</b> is the side.</>}
          </div>
        )}

        {p.neutral && <div className="pred__note">Neutral site — {p.venue}. No home-field edge applied.</div>}

        {!pickem && (
          <div className="pred__slip">
            <AddToSlip
              item={{
                id: `model-${p.eventId}`, kind: "model",
                title: `${p.favored} by ${Math.abs(p.predMargin).toFixed(1)}`,
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
  let cardRows: CardRow[] = [];
  try { cardRows = (await fetchHome(SEASON)).card; } catch { cardRows = []; }

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
      eventId: g.eventId, home: g.home, away: g.away, spread,
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
  const scored = envs.filter((e) => e.total !== null).sort((a, b) => (b.total! - a.total!));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub="" />
        <div className="masthead__clock"><ModelClock /></div>
      </header>

      <FlowSteps active="analyze" />
      <ModelSubnav active="game" />
      <p className="sportnote">
        <b>NFL first.</b> We perfect one sport before adding the next — MLB, NBA, College Football and NHL
        will turn on here once each has its own line-blind model with a public track record.
      </p>
      <WeekNav min={min} max={max} current={week} />

      <section className="explainer explainer--wide">
        <p>
          Our model never sees the betting line — it reads each game from team strength alone,
          then we show you <b>where it agrees with the market and where it doesn&apos;t.</b> An
          <span className="chip offc">Off Consensus</span> game is one where the model likes a different
          side than Vegas. Every read is <b>published and locked before kickoff</b>, and the
          calibration below grades every one in public — so the track record is yours to check, not ours
          to claim.
        </p>
      </section>

      {/* The Model Card — same model-vs-market snapshot as the home page, above the reads. */}
      <NflModelCard rows={cardRows} />

      {preds.length === 0 ? (
        <p className="foot">No reads published for Week {week} yet.</p>
      ) : (
        <details className="gamesdrop" open>
          <summary className="gamesdrop__h">
            Week {week} Full Model
            <span className="gamesdrop__n">{preds.length} games</span>
            <span className="gamesdrop__chev" aria-hidden="true">▾</span>
          </summary>
          <section className="grid">
            {preds.slice(0, 6).map((p) => <PredictionCard key={p.eventId} p={p} />)}
          </section>
          {preds.length > 6 && (
            <details className="hb-more">
              <summary className="hb-more__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                See more ({preds.length - 6} more games)
              </summary>
              <section className="grid">
                {preds.slice(6).map((p) => <PredictionCard key={p.eventId} p={p} />)}
              </section>
            </details>
          )}
        </details>
      )}

      {/* Week's numbers crunched — market spread/total beside our line-blind projection. */}
      <details className="gamesdrop" open>
        <summary className="gamesdrop__h">
          Week {week} numbers crunched
          <span className="gamesdrop__n">{scored.length} games</span>
          <span className="gamesdrop__chev" aria-hidden="true">▾</span>
        </summary>
        <p className="ctxsec__d">
          The market&apos;s <b>spread</b> and <b>total</b> for each game, with our <b>line-blind model&apos;s</b>
          own read of each sitting right beside it.
        </p>

        {scored.length === 0 ? (
          <p className="foot">No lines captured for Week {week} yet.</p>
        ) : (
          <>
            <ImpTable rows={scored.slice(0, 6)} refs={refs} />
            {scored.length > 6 && (
              <details className="hb-more">
                <summary className="hb-more__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  See more ({scored.length - 6} more games)
                </summary>
                <ImpTable rows={scored.slice(6)} refs={refs} />
              </details>
            )}
          </>
        )}
      </details>

      <section className="soonpanel" id="player-model">
        <span className="soonpanel__tag">Arriving Week 1</span>
        <h2 className="soonpanel__h">Player projections</h2>
        <p className="soonpanel__p">
          The layer that projects <b>player prop numbers</b> — rushing and receiving yards, receptions,
          touches — from our snap-share model, the one measured edge we&apos;ve found. It needs live
          in-season usage to project honestly, so it turns on with <b>Week&nbsp;1</b>. Until then, see which
          players fans are buzzing about in <a href="/tailgate">Fan Analysis</a>.
        </p>
      </section>

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
