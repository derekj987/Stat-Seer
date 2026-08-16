import { weekRange } from "@/lib/board";
import { fetchModelWeek, fetchCalibration, MODEL_VERSION, type ModelPrediction } from "@/lib/model";
import { Brand, FlowSteps } from "../Nav";
import AddToSlip from "../AddToSlip";

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
    <details className={p.disagree ? "game offc predcard" : "game predcard"}>
      <summary className="game__head predcard__head">
        <span className="matchup">{p.away}<span className="at">@</span>{p.home}</span>
        {p.disagree && <span className="badge offc">OFF CONSENSUS</span>}
        {p.neutral && <span className="badge neutral">NEUTRAL</span>}
        <span className="predcard__sum">
          {pickem
            ? <b>Pick&apos;em</b>
            : <><b>{p.favored}</b> by {Math.abs(p.predMargin).toFixed(1)} · {pct}%</>}
        </span>
        <span className="predcard__chev" aria-hidden="true">▸</span>
      </summary>
      <div className="pred">
        <time className="kick">{et(p.commence)}</time>
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
    </details>
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

  const preds = await fetchModelWeek(week, SEASON);
  const calibration = await fetchCalibration(SEASON);
  const published = preds[0]?.publishedAt;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Analyze · The Model · line-blind predictions · Week ${week}, ${SEASON} · ${MODEL_VERSION}`} />
        {published && <div className="asof">published<br /><b>{et(published)}</b></div>}
      </header>

      <FlowSteps active="analyze" />
      <WeekNav min={min} max={max} current={week} />

      <section className="explainer">
        <p>
          Our prediction model never sees the betting line — it reads each game from team strength alone,
          then we show you <b>where it agrees with the market and where it doesn&apos;t.</b> An
          <span className="chip offc">Off Consensus</span> game is one where the model likes a different
          side than Vegas. Every prediction is <b>published and locked before kickoff</b>, and the
          calibration below grades every one in public — so the track record is yours to check, not ours
          to claim.
        </p>
      </section>

      {preds.length === 0 ? (
        <p className="foot">No predictions published for Week {week} yet.</p>
      ) : (
        <section className="grid">
          {preds.map((p) => <PredictionCard key={p.eventId} p={p} />)}
        </section>
      )}

      <section className="soonpanel">
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
            No graded predictions yet — calibration begins once Week&nbsp;1 games are played and graded.
            The {preds.length || ""} predictions above are locked in the ledger; they can&apos;t be edited,
            so what you see now is exactly what will be scored.
          </p>
        ) : (
          <div className="calib__table" role="table">
            <div className="calib__row calib__row--head" role="row">
              <span>predicted</span><span>actual</span><span>n</span><span>avg CLV</span>
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
