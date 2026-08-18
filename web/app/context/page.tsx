import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, type ModelPrediction } from "@/lib/model";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { REF_STATS, REF_LEAGUE } from "@/lib/refStats";
import { weekRefs } from "@/lib/refAssignments";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";

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

/** Plain-English read: which side of the MARKET spread the model favors (cover, not
 * just winner), and its over/under lean. */
function bottomLine(e: Env): { spread: string; total: string | null } | null {
  if (e.spread === null || e.modelMarginHome === null) return null;
  const mag = Math.abs(e.spread);
  const marketFavHome = e.spread < 0;
  const dog = marketFavHome ? e.away : e.home;
  const modelMarginForFav = marketFavHome ? e.modelMarginHome : -e.modelMarginHome;
  const spread = mag < 0.5
    ? "neither side (it's a pick'em)"
    : modelMarginForFav >= mag
      ? `the ${e.favLabel} side`
      : `the underdog ${dog} +${mag.toFixed(1)}`;
  let total: string | null = null;
  if (e.modelTotal !== null && e.total !== null) {
    const d = e.modelTotal - e.total;
    total = Math.abs(d) < 1 ? null : d < 0 ? "the under" : "the over";
  }
  return { spread, total };
}

function favLabel(home: string, away: string, spread: number | null): string {
  if (spread === null) return "—";
  if (spread === 0) return "PK";
  return spread < 0 ? `${home} ${spread.toFixed(1)}` : `${away} -${spread.toFixed(1)}`;
}

/** The ONE crew tendency that persists year-to-year is the penalty rate. Score/ATS
 * history is noise (tested), so the plain-English read is about flags only. */
function crewFlag(pen: number): { label: string; tone: "hot" | "cool" } | null {
  if (pen >= REF_LEAGUE.pen + 0.8) return { label: "Flag-heavy", tone: "hot" };
  if (pen <= REF_LEAGUE.pen - 0.8) return { label: "Lets them play", tone: "cool" };
  return null;
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

  // Per-game referee crew (empty until assignments post game-week).
  const refs = await weekRefs(week, SEASON);

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

  const scored = envs.filter((e) => e.total !== null).sort((a, b) => (b.total! - a.total!));
  const upsets = envs.filter((e) => e.modelDisagree && e.modelFav); // model likes the market's dog

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Upset Watch · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />
      <ContextSubnav active="upset" />
      <WeekNav min={min} max={max} current={week} />

      <details className="explainer explainer--drop">
        <summary className="explainer__sum">
          <b>Step 2: pressure-test your pick</b> — how Upset Watch works
        </summary>
        <p>
          Upset Watch shows what could make a game go <em>sideways</em> — where our model disagrees with the
          market. It arms <b>your</b> judgment; it does not fake an &quot;adjusted number.&quot;
        </p>
        <p className="explainer__p2">
          The situational factors around each game — site, weather, referee crew, incentives — now live in their
          own <a href="/considerations">Special Considerations</a> tab. We tested them against real results: they
          add <b>uncertainty, not a knowable edge</b> (the market already prices them), so we flag <b>risk</b>,
          never a &quot;lock.&quot; Then head to <a href="/best">Sweet Spots</a> to place what survives.
        </p>
      </details>

      {/* --- Upset Watch: where our model likes the underdog --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Upset watch</h2>
        <p className="ctxsec__d">
          Games where our <b>line-blind model likes the underdog</b> the market favors. These aren&apos;t locks —
          the market is usually right — but they&apos;re where a surprise is most in play by our independent read.
        </p>
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

      {/* --- Scoring environment: implied team totals --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Lines &amp; the model&apos;s read</h2>
        <p className="ctxsec__d">
          The market&apos;s <b>spread</b> and <b>total</b> for each game, with our <b>line-blind model&apos;s</b>
          own read of each sitting right beside it.
        </p>
        <details className="readbox">
          <summary className="readbox__h">How to read a row</summary>
          <p>
            Take <b>NO @ DET</b>: the market has set <b>DET −7</b> with a <b>49</b> total; our model, which never
            sees the line, independently reads it <b>DET −8.0</b> with a <b>46.3</b> total. This is our read
            <em> next to</em> the market&apos;s — for understanding where we agree and differ, not a bet.
          </p>
          <p className="readbox__note">
            The <b className="modh">model</b> columns are <b>our own line-blind projected spread and total</b> —
            shown next to the market&apos;s for comparison, not as the market&apos;s numbers. (Our total is
            calibrated but <b>not sharper than the market</b> — an honest read, not an edge.)
            &nbsp;<span className="offcmark">⚑</span> means our model is <b>off consensus</b> on the spread; see
            <a href="/model"> The Model</a>. <span className="ssmark">◆</span> marks a <b>sweet spot</b> — a
            spread or total on a key number; act on it in <a href="/best">Sweet Spots</a>.
          </p>
        </details>

        {scored.length === 0 ? (
          <p className="foot">No lines captured for Week {week} yet.</p>
        ) : (
          <>
            <div className="imptable" role="table" aria-label="Lines and implied team totals">
              <div className="improw improw--head" role="row">
                <span>game</span><span>spread</span>
                <span className="improw__modh">model spread</span><span>total</span>
                <span className="improw__modh">model total</span>
              </div>
              {scored.map((e) => {
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
                    ? <span>Our model favors <b>{bl.spread}</b>{bl.total && <> and <b>{bl.total}</b></>}.</span>
                    : <span className="impbottom__none">No model read for this game yet.</span>}
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
          </>
        )}
      </section>

      {/* --- Referee crews --- */}
      <details className="ctxsec ctxdrop">
        <summary className="ctxsec__h">Referee crews</summary>
        <p className="ctxsec__d">
          Every active crew chief&apos;s tendencies, 2021–25. <b>Penalties are a mild, real crew tendency</b> — a
          flag-happy crew stays flag-happy. <b>Scoring and spread results are not</b>: how a crew&apos;s games land
          against the total or the spread is essentially random and doesn&apos;t carry over — so those columns are
          greyed as trivia, not a signal. League avg: {REF_LEAGUE.pen} penalties, {REF_LEAGUE.total} pts, fav
          covers {REF_LEAGUE.atsFav}%.
        </p>
        <div className="refbottom">
          <span className="refbottom__k">Bottom line — what to actually use</span>
          <p>
            One crew tendency carries over year to year: <b>how many flags they throw</b>. Crews tagged
            <b className="hot"> Flag-heavy</b> throw noticeably more than league average ({REF_LEAGUE.pen}/g) and
            <b className="cool"> Lets them play</b> throw fewer — that&apos;s the real read (more flags = more
            variance: drives extended, drives killed). The rest — a crew&apos;s <b>average total</b>, how often
            their games went <b>over</b>, and how often the <b>favorite</b> vs the <b>underdog</b> covered — is
            <b> historical context</b>, not a reliable lean: it&apos;s mostly noise that doesn&apos;t carry to the
            next game (league avg: {REF_LEAGUE.total} pts, {REF_LEAGUE.over}% over, favorite covers {REF_LEAGUE.atsFav}%).
            Read it for interest, bet it at your own risk.
          </p>
        </div>
        <div className="reftable">
          <div className="refrow refrow--head">
            <span>crew</span><span>read</span><span>pen/g</span><span>avg pts</span><span>over%</span><span>fav/dog ats</span>
          </div>
          {REF_STATS.map((r) => {
            const flag = crewFlag(r.pen);
            return (
            <div className="refrow" key={r.name}>
              <span className="refrow__name">{r.name} <span className="refrow__n">{r.games}g</span></span>
              <span className="refrow__read">
                {flag
                  ? <b className={flag.tone}>{flag.label}</b>
                  : <span className="muted">Average flags</span>}
              </span>
              <span className={r.pen >= REF_LEAGUE.pen ? "refrow__v hot" : "refrow__v cool"}>{r.pen}</span>
              <span className={r.total >= REF_LEAGUE.total ? "refrow__v hot" : "refrow__v cool"}>{r.total}</span>
              <span className="refrow__v">{r.over}%</span>
              <span className="refrow__v" title="favorite covered / underdog covered, ATS">{r.atsFav}/{100 - r.atsFav}</span>
            </div>
            );
          })}
        </div>
        <p className="ctxsec__note">
          Per-game crew assignments post during game week — each week&apos;s games get mapped to their crew, and a
          flag-heavy or lets-them-play crew becomes a line in that game&apos;s Special Considerations.
        </p>
      </details>

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
