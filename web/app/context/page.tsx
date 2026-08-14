import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, type ModelPrediction } from "@/lib/model";
import { MODEL_TOTALS } from "@/lib/modelTotals";
import { TopNav, Brand } from "../Nav";

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
      modelDisagree: mp?.disagree ?? false,
    };
  });

  const scored = envs.filter((e) => e.total !== null).sort((a, b) => (b.total! - a.total!));
  const neutrals = envs.filter((e) => e.neutral);
  const hi = scored[0];
  const lo = scored[scored.length - 1];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Context · what to understand · Week ${week}, ${SEASON}`} />
      </header>

      <TopNav active="context" />
      <WeekNav min={min} max={max} current={week} />

      <section className="explainer">
        <p>
          <b>This page helps you understand a game — it is not our prediction and not a pick.</b> Every number
          here is the <b>market&apos;s</b>, not ours: the same lines the sportsbooks post, just broken down so
          you can see what they imply about how a game is expected to play out. We are <b>not</b> telling you to
          bet a side or that a game will hit a number.
        </p>
        <p className="explainer__p2">
          The other two sections do the deciding: <a href="/best">Value Finder</a> tells you <b>where the price
          is wrong</b> (what to actually bet), and <a href="/model">The Model</a> is <b>our own independent
          prediction</b>. Context is just the backdrop — read it to understand the game, then act over there.
        </p>
      </section>

      {/* --- Scoring environment: implied team totals --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Lines &amp; the model&apos;s read</h2>
        <p className="ctxsec__d">
          The market&apos;s <b>spread</b> and <b>total</b> for each game, with our <b>line-blind model&apos;s</b>
          own read of each sitting right beside it.
        </p>
        <div className="readbox">
          <span className="readbox__h">How to read a row</span>
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
            spread or total on a key number; act on it in <a href="/best">Best Bets</a>.
          </p>
        </div>

        {scored.length === 0 ? (
          <p className="foot">No lines captured for Week {week} yet.</p>
        ) : (
          <>
            <div className="envcards">
              {hi && (
                <div className="envcard hi">
                  <span className="envcard__k">Highest total</span>
                  <span className="envcard__g">{hi.away} @ {hi.home}</span>
                  <span className="envcard__v">{hi.total!.toFixed(1)}</span>
                </div>
              )}
              {lo && lo !== hi && (
                <div className="envcard lo">
                  <span className="envcard__k">Lowest total</span>
                  <span className="envcard__g">{lo.away} @ {lo.home}</span>
                  <span className="envcard__v">{lo.total!.toFixed(1)}</span>
                </div>
              )}
            </div>

            <div className="imptable" role="table" aria-label="Lines and implied team totals">
              <div className="improw improw--head" role="row">
                <span>game</span><span>spread</span>
                <span className="improw__modh">model</span><span>total</span>
                <span className="improw__modh">model</span>
              </div>
              {scored.map((e) => (
                <div className="improw" role="row" key={e.eventId}>
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
              ))}
            </div>
          </>
        )}
      </section>

      {/* --- Travel & site --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Travel &amp; site</h2>
        {neutrals.length === 0 ? (
          <p className="ctxsec__d">All Week {week} games are at the home team&apos;s own venue — no neutral-site or international games.</p>
        ) : (
          <>
            <p className="ctxsec__d">
              Neutral-site games — the &quot;home&quot; team is nominal, so The Model applies <b>no home-field
              edge</b>. Long travel and body-clock effects are real but too small and varied to model honestly,
              so they live here as context, not as a number.
            </p>
            <ul className="travellist">
              {neutrals.map((e) => (
                <li key={e.eventId}>
                  <span className="travellist__g">{e.away} @ {e.home}</span>
                  <span className="travellist__v">{e.venue ?? "neutral site"}</span>
                  <span className="travellist__t">{et(e.commence)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

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
