import { weekRange } from "@/lib/board";
import { fetchModelWeek, fetchCalibration, MODEL_VERSION, type ModelPrediction } from "@/lib/model";

export const revalidate = 300;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function Tabs() {
  return (
    <nav className="tabs" aria-label="View">
      <a href="/" className="tab">Value Finder</a>
      <a href="/props" className="tab">Player Props</a>
      <a href="/model" className="tab active" aria-current="page">The Model</a>
    </nav>
  );
}

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
  const pct = Math.round(favProb * 100);
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
        <div className="pred__row">
          <span className="pred__label">Model</span>
          <span className="pred__pick"><b>{p.favored}</b> by {Math.abs(p.predMargin).toFixed(1)}</span>
          <span className="pred__prob">{pct}% to win</span>
        </div>
        <div className="probbar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>

        {p.marketFavored && mktPct !== null && (
          <>
            <div className="pred__row pred__row--mkt">
              <span className="pred__label">Market</span>
              <span className="pred__pick"><b>{p.marketFavored}</b> favored</span>
              <span className="pred__prob">{mktPct}% to win</span>
            </div>
            <div className="pred__take">
              {p.disagree
                ? <>Our model likes <b>{p.favored}</b> — the market likes <b>{p.marketFavored}</b>.</>
                : <>Model and market agree: <b>{p.favored}</b> is the side.</>}
            </div>
          </>
        )}

        {p.neutral && <div className="pred__note">Neutral site — {p.venue}. No home-field edge applied.</div>}
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

  const preds = await fetchModelWeek(week, SEASON);
  const calibration = await fetchCalibration(SEASON);
  const published = preds[0]?.publishedAt;

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">STATSEER</span>
          <span className="brand__sub">The Model · line-blind predictions · Week {week}, {SEASON} · {MODEL_VERSION}</span>
        </div>
        {published && <div className="asof">published<br /><b>{et(published)}</b></div>}
      </header>

      <Tabs />
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
