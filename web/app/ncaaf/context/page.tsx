import { Brand, FlowSteps, ContextSubnav } from "../../Nav";
import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "../model-data";

// College Football — Context · Upset Watch (Context landing). Mirrors the NFL Context
// page: underdogs our line-blind rating backs against the market, then every game's line
// beside our own read, then the honest roadmap of what's still arriving. The rating is
// compressed and doesn't beat the spread, so nothing here is a cover pick — it flags
// where our independent read diverges, to arm your judgment. Panels inform; they don't vote.
export const metadata = {
  title: "StatSeer — CFB Upset Watch",
  description: "College-football underdogs our model backs against the market, plus every game's line beside our line-blind read.",
};

const M = NCAAF_MODEL;

/** Honest per-game read. The CFB rating is compressed and verified NOT to beat the
 *  spread, so we never emit a cover pick — we state agreement/disagreement on the
 *  favorite and show our line-blind number beside the market's. */
function bottomLine(g: NcaafCardGame): string {
  const ps = g.projSpread;
  const ms = g.marketSpread;
  const tl = g.totalLean;
  const totalBit = tl ? ` Total read leans ${tl.dir === "OVER" ? "over" : "under"} ${tl.num}.` : "";
  if (!ms) return `Our line-blind read: ${ps.fav} ${ps.num}.${totalBit}`;
  if (g.off) return `Off consensus — the market favors ${ms.fav}, our rating leans ${ps.fav}. A divergence to understand, not a bet.${totalBit}`;
  return `Model and market agree ${ms.fav} is the side; our line-blind margin is ${Math.abs(ps.num)} vs the market's ${Math.abs(ms.num)}.${totalBit}`;
}

export default function Page() {
  const c = M.card;
  const games: readonly NcaafCardGame[] = c.games;
  const upsets: readonly NcaafUpset[] = c.upsets;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · College Football · Upset Watch · Week ${c.week}, ${c.season}`} />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <ContextSubnav active="upset" base="ncaaf" />

      <details className="explainer explainer--drop">
        <summary className="explainer__sum">
          <b>Step 2: pressure-test your pick</b> — how Upset Watch works
        </summary>
        <p>
          Upset Watch shows where a game could go <em>sideways</em> — where our line-blind rating disagrees with
          the market. It arms <b>your</b> judgment; it does not fake an &quot;adjusted number.&quot;
        </p>
        <p className="explainer__p2">
          The durable, measured context — home field and conference strength — lives one tab over in{" "}
          <a href="/ncaaf/considerations">Special Considerations</a>. Our rating predicts as well as Elo but{" "}
          <b>does not beat the closing spread</b> (<a href="/ncaaf/model">verified on The Model</a>), so we flag{" "}
          <b>divergence</b>, never a &quot;lock.&quot; Then head to <a href="/ncaaf/best">Sweet Spots</a> for the numbers to pay up for.
        </p>
      </details>

      {/* --- Upset Watch: where our rating backs the market's underdog --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Upset watch</h2>
        <p className="ctxsec__d">
          Games where our <b>line-blind rating outright picks the underdog</b> the market favors — on a competitive
          line. These aren&apos;t locks (the market is usually right, and our rating doesn&apos;t beat it against the
          number); they&apos;re where a surprise is most in play by our independent read.
        </p>
        {upsets.length === 0 ? (
          <p className="foot">No upset flags this week — our rating agrees with the market&apos;s favorite in every game on the board.</p>
        ) : (
          <div className="upsets">
            {upsets.map((u) => (
              <div className="upset" key={`${u.dog}-${u.matchup}`}>
                <span className="upset__game">{u.dog} <span className="upset__mspread">{u.matchup}</span></span>
                <span className="upset__pick">
                  model: win <b>{u.modelPct}%</b> <span className="upset__mspread">(by {u.byPoints.toFixed(1)})</span>
                </span>
                <span className="upset__mkt">market: {u.spread} · {u.marketPct}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- Lines & the model's read: every game, market beside our projection --- */}
      <details className="ctxsec ctxdrop" open>
        <summary className="ctxsec__h">Lines &amp; the model&apos;s read <span className="ctxsec__n">{games.length} games</span></summary>
        <p className="ctxsec__d">
          The market&apos;s <b>spread</b> and <b>total</b> for each game, with our <b>line-blind rating&apos;s</b> own
          read of each sitting right beside it — top-25 matchups first.
        </p>
        <details className="readbox">
          <summary className="readbox__h">How to read a row</summary>
          <p>
            Take a game with the market at <b>Georgia −6.5</b> and a <b>52.5</b> total: our rating, which never sees
            the line, independently reads it <b>Georgia −3.2</b>. That&apos;s our read <em>next to</em> the
            market&apos;s — for understanding where we agree and differ, not a bet.
          </p>
          <p className="readbox__note">
            The <b className="modh">model</b> columns are <b>our own line-blind projected spread and total</b>, shown
            next to the market&apos;s for comparison — <b>not</b> sharper than the market (our rating is compressed and
            doesn&apos;t beat the number; see <a href="/ncaaf/model">The Model</a>).
            &nbsp;<span className="offcmark">⚑</span> means our rating is <b>off consensus</b> on who&apos;s favored.
          </p>
        </details>

        {games.length === 0 ? (
          <p className="foot">No lines on the board for Week {c.week} yet.</p>
        ) : (
          <div className="imptable" role="table" aria-label="Lines and the model's read">
            <div className="improw improw--head" role="row">
              <span>game</span><span>spread</span>
              <span className="improw__modh">model spread</span><span>total</span>
              <span className="improw__modh">model total</span>
            </div>
            {games.map((g) => {
              const ms = g.marketSpread; const ps = g.projSpread;
              return (
                <div className="impgame" key={`${g.away}-${g.home}`}>
                  <div className="improw" role="row">
                    <span className="improw__g">
                      {g.away}<span className="at">@</span>{g.home}
                      {g.neutral ? <span className="badge neutral">NEUTRAL</span> : null}
                    </span>
                    <span className="improw__sp">{ms ? `${ms.fav} ${ms.num}` : "—"}</span>
                    <span className="improw__mod">
                      {ps.fav} {ps.num}
                      {g.off && <span className="offcmark" title="Off consensus — our rating favors a different side than the market">⚑</span>}
                    </span>
                    <span className="improw__tot">{g.marketTotal !== null ? g.marketTotal.toFixed(1) : "—"}</span>
                    <span className="improw__mod">{g.projTotal.toFixed(1)}</span>
                  </div>
                  <div className="impbottom">
                    <span className="impbottom__k">Bottom line</span>
                    <span>{bottomLine(g)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </details>

      {/* --- Honest roadmap: data-dependent panels not yet live for CFB --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Arriving this season</h2>
        <p className="ctxsec__d">
          The panels below need live in-season data we&apos;re capturing as the year runs. We&apos;d rather show
          nothing than fake it — here&apos;s what&apos;s coming and why it isn&apos;t here yet.
        </p>
        <div className="soongrid">
          <div className="soon">
            <span className="soon__h">Weather</span>
            <p>Wind is the one measured lead in football totals — the market under-sets ~1.3 pts at 15+ mph. Wires in once we pull game-site forecasts.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Injury &amp; availability</span>
            <p>College depth charts swing games. Availability can&apos;t be backfilled — the daily capture starts as the season&apos;s reports and two-deeps post.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Live weekly odds</span>
            <p>The board above is a Tuesday snapshot of the openers. The full weekly line — moving through kickoff — turns on as the NCAAF odds capture feeds the site.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Rivalry &amp; letdown spots</span>
            <p>A marker of <em>uncertainty</em> around a game, never a direction to bet — flagged once the schedule context (rivalry weeks, look-aheads) is wired in.</p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Context informs; it doesn&apos;t vote.</b> The measured context — home field and conference strength — is
          live on <a href="/ncaaf/considerations">Special Considerations</a>; the line-blind rating and its honest
          record are on <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
