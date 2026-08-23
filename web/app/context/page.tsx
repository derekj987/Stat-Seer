import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, type ModelPrediction } from "@/lib/model";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";
import Tip from "@/app/Tip";

export const revalidate = 300;
const SEASON = 2026;

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/context?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

interface Env {
  eventId: string;
  home: string;
  away: string;
  commence: string;
  spread: number | null;   // home perspective; negative = home favored
  favLabel: string;        // e.g. "PIT -3"  (favorite + line)
  spreadKey: { num: number; cost: number } | null;
  total: number | null;
  totalKey: { num: number; cost: number } | null;
  modelTotal: number | null;   // our line-blind projected total (weak; not an edge)
  neutral: boolean;
  venue: string | null;
  modelSpread: string | null;   // our model's projected spread, e.g. "DET -7.2"
  modelFav: string | null;      // team the model favors
  modelMarginHome: number | null; // model predicted margin, home perspective
  modelDisagree: boolean;       // model favors a different side than the market
}

function favLabel(home: string, away: string, spread: number | null): string {
  if (spread === null) return "—";
  if (spread === 0) return "PK";
  return spread < 0 ? `${home} ${spread.toFixed(1)}` : `${away} -${spread.toFixed(1)}`;
}

export default async function Page({ searchParams }: PageProps<"/context">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const board = buildBoard(await fetchWeek(week, SEASON));

  // Locked model predictions: neutral/venue (schedule truth) + projected spread.
  const modelById = new Map<string, ModelPrediction>();
  try {
    for (const p of await fetchModelWeek(week, SEASON)) modelById.set(p.eventId, p);
  } catch { /* predictions may not be published for this week yet */ }

  const envs: Env[] = board.map((g) => {
    const total = g.total.consensus;
    const spread = g.spread.consensus; // home perspective; negative = home favored
    const mp = modelById.get(g.eventId);
    return {
      eventId: g.eventId,
      home: g.home,
      away: g.away,
      commence: g.commence,
      spread,
      favLabel: favLabel(g.home, g.away, spread),
      spreadKey: g.spread.key,
      total,
      totalKey: g.total.key,
      modelTotal: MODEL_TOTALS[`${week}-${g.away}-${g.home}`] ?? null,
      neutral: mp?.neutral ?? false,
      venue: mp?.venue ?? null,
      modelSpread: mp ? `${mp.favored} -${Math.abs(mp.predMargin).toFixed(1)}` : null,
      modelFav: mp ? mp.favored : null,
      modelMarginHome: mp ? mp.predMargin : null,
      modelDisagree: mp?.disagree ?? false,
    };
  });

  const upsets = envs.filter((e) => e.modelDisagree && e.modelFav); // model likes the market's dog

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Upset Watch · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />
      <ContextSubnav active="upset" />
      <WeekNav min={min} max={max} current={week} />

      {/* --- Upset Watch: where our model likes the underdog --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Upset watch</h2>
        <p className="ctxsec__d">
          Games where our <b>line-blind model likes the underdog</b> the market favors. These aren&apos;t locks —
          the market is usually right — but they&apos;re where a surprise is most in play by our independent read.
        </p>
        <div className="tblhelp">
          <Tip text={<>Games where our <b>line-blind model likes the underdog</b> that the market favors — shown with our model&apos;s pick &amp; projected spread next to the market&apos;s favorite. Not locks (the market is usually right); these are our independent <b>disagreements</b>, not graded picks.</>} />
        </div>
        {upsets.length === 0 ? (
          <p className="foot">No upset flags this week — our model agrees with the market&apos;s favorite in every game.</p>
        ) : (
          <div className="upsets">
            {upsets.map((e) => (
              <div className="upset" key={e.eventId}>
                <span className="upset__game">{e.away} @ {e.home}{e.neutral && <span className="badge neutral">NEUTRAL</span>}</span>
                <span className="upset__pick">model likes <b>{e.modelFav}</b> <span className="upset__mspread">({e.modelSpread})</span></span>
                <span className="upset__mkt">market: {e.favLabel}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="ctxsec__d">
        Looking for the market&apos;s line beside our read on every game? That full model view now
        lives on <a href="/model">The Model</a>.
      </p>

      {/* --- Honest roadmap: data-dependent panels not yet live --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Arriving this season</h2>
        <p className="ctxsec__d">
          The panels below need live in-season data we&apos;re capturing as the year runs. We&apos;d rather
          show nothing than fake it — here&apos;s what&apos;s coming and why it isn&apos;t here yet.
        </p>
        <div className="soongrid">
          <div className="soon">
            <span className="soon__h">Weather</span>
            <p>Wind is the one measured lead — the market under-sets totals ~1.3 pts at 15+ mph. Wires in once we pull game-site forecasts.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Injury &amp; practice trajectory</span>
            <p>The Wed/Thu/Fri practice sequence (DNP → Limited → Full) can&apos;t be backfilled — daily capture starts with the first reports in September.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Referee crews</span>
            <p>Penalty tendencies persist crew-to-crew (r ≈ +0.27); game outcomes don&apos;t. Display-only, once weekly assignments post.</p>
          </div>
          <div className="soon">
            <span className="soon__h">New starter / QB change</span>
            <p>Flags a team handing Week 1 to an unproven starter — a marker of <em>uncertainty</em>, not a direction to bet. (Tested: no forecastable edge.)</p>
          </div>
        </div>
      </section>
    </main>
  );
}
