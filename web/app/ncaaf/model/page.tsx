import { Brand, FlowSteps, ModelSubnav } from "../../Nav";
import { NCAAF_MODEL, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — The Model. Mirrors the NFL Model page: the full model-vs-market
// table leads, the honest track record (predicts as well as Elo, doesn't beat the spread)
// is tucked into a dropdown, and college player projections are flagged as arriving.
export const metadata = {
  title: "StatSeer — College Football Model",
  description: "The full college-football model — our line-blind read beside the market on every game, with the honest track record.",
};

const M = NCAAF_MODEL;

function pickTxt(g: NcaafCardGame): string {
  const pk = g.pick;
  return pk ? `${pk.side} ${pk.num > 0 ? "+" : ""}${pk.num}` : `${g.projSpread.fav} ${g.projSpread.num}`;
}

function CardHead() {
  return (
    <thead>
      <tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr>
    </thead>
  );
}

function CardRows({ games }: { games: readonly NcaafCardGame[] }) {
  return (
    <>
      {games.map((g) => {
        const ms = g.marketSpread; const tl = g.totalLean;
        return (
          <tr key={`${g.away}-${g.home}`} className={g.off ? "hb-off" : undefined}>
            <td className="hb-l">
              <span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>
              {g.neutral ? <span className="ncf-site"> · N</span> : null}
              {g.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
            </td>
            <td className="hb-num">{ms ? `${ms.fav} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-suggest">
              <span className="hb-sugwrap">
                <span className="hb-sug"><span className="hb-sug__t">{pickTxt(g)}</span></span>
                {tl && <span className="hb-sug"><span className="hb-sug__t">{tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span></span>}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export default function Page() {
  const v = M.validation;
  const a = M.ats;
  const beatsMarket = a.atsPct > a.breakeven;
  const c = M.card;
  const featured = c.games.filter((g) => g.featured);
  const ranked = featured.length ? featured : c.games;   // marquee games for the snapshot
  const snapshot = ranked.slice(0, 5);                    // first 5 — a clean teaser
  const snapshotRest = ranked.slice(5);                   // the rest of the ranked games

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Model · College Football · line-blind power rating · ${M.season}`} />
      </header>

      <FlowSteps active="analyze" base="ncaaf" />
      <ModelSubnav active="game" base="ncaaf" />

      {/* The honest record — what it is, how well it does, and why we show it — folded away. */}
      <details className="ncf-method ncf-about">
        <summary className="ncf-method__h">How good is it? — the model&apos;s honest track record</summary>
        <div className="ncf-method__b">
          <p className="ncf-about__p">
            <b>The Model, for college football.</b> A line-blind power rating — every team&apos;s strength from
            point differential alone (never win-loss), with home field and prior-season carryover baked in.
            It is <b>published and gradeable</b>, and it drives <b>no picks</b>. Here&apos;s exactly how good it
            is, measured out of sample — the good and the inconvenient.
          </p>
          <div className="ncf-cards">
            <StatCard tone="good" label="Predicts as well as Elo"
              value={`${v.ourSU}%`}
              sub={`straight-up, ${v.games.toLocaleString()} games out of sample — vs CFBD Elo ${v.eloSU}% and a ${v.homeSU}% home-team baseline`} />
            <StatCard tone="good" label="Margin error (RMSE)"
              value={`${v.ourRMSE}`}
              sub={`points per game — right with CFBD Elo (${v.eloRMSE}). A competent, honest rating.`} />
            <StatCard tone="flat" label="Against the closing spread"
              value={`${a.atsPct}%`}
              sub={`${a.bets.toLocaleString()} bets — below the ${a.breakeven}% a −110 bettor must clear. It does ${beatsMarket ? "" : "NOT "}beat the market.`} />
          </div>
          <div className="ncf-honest" role="note">
            <span className="ncf-honest__tag">Why we show you this</span>
            <p>
              Most sites would bury that last number. We lead with it. Our CFB model reads games as well as the
              best public systems — but we <b>tested it against the closing line and it doesn&apos;t beat the
              number</b>, the same result we found for NFL game lines. So we publish it as <b>context you can
              trust</b>, graded in the open — <b>not</b> as a pick. A rating that can&apos;t beat the market is
              still a great way to understand one. Panels inform; they don&apos;t vote.
            </p>
          </div>
        </div>
      </details>

      {/* Snapshot — the first few ranked games, with a "see more" for the rest. */}
      <section className="ncf-sec">
        <h2 className="ncf-h">The Model — Snapshot View
          <span className="ncf-h__note">our line-blind read beside the market&apos;s number · Week {c.week}</span></h2>
        <div className="hb-legend">
          <span className="hb-dia">◆</span> Off-consensus — our read is on the other side from the market.
          <span className="hb-x"> · <b>Our Model Suggests</b> is the side our line-blind rating covers —
            informative, <b>not a guaranteed bet</b> (the rating doesn&apos;t beat the spread; see the record above).</span>
        </div>
        <div className="hb-formwrap">
          <table className="hb-form"><CardHead /><tbody><CardRows games={snapshot} /></tbody></table>
        </div>
        {snapshotRest.length > 0 && (
          <details className="hb-more">
            <summary className="hb-more__sum">
              <span className="hb-more__chev" aria-hidden="true">▸</span>
              See more ({snapshotRest.length} more ranked games)
            </summary>
            <div className="hb-formwrap">
              <table className="hb-form"><CardHead /><tbody><CardRows games={snapshotRest} /></tbody></table>
            </div>
          </details>
        )}
      </section>

      {/* The FULL model — every game on the board, collapsed. */}
      <details className="hb-panel">
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Full Model — every game</span>
          <span className="hb-bar__count">{c.games.length} games</span>
          <span className="hb-bar__hint">the complete slate, not just the ranked snapshot</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <div className="hb-formwrap">
            <table className="hb-form"><CardHead /><tbody><CardRows games={c.games} /></tbody></table>
          </div>
        </div>
      </details>

      {/* College player props — the same layer we're building for the NFL, arriving with data. */}
      <section className="soonpanel" id="player-model">
        <span className="soonpanel__tag">Arriving with the season</span>
        <h2 className="soonpanel__h">College player props</h2>
        <p className="soonpanel__p">
          The same player-level layer we&apos;re building for the NFL — projected <b>rushing and receiving yards,
          receptions, and touches</b> for college players. It needs live in-season usage and a prop feed to
          project honestly, so it turns on as the season&apos;s data flows. Until then, see{" "}
          <a href="/ncaaf/props">Player Props</a>.
        </p>
      </section>

      <details className="ncf-method">
        <summary className="ncf-method__h">How the rating is built</summary>
        <div className="ncf-method__b">
          <ul>
            <li><b>Point differential, never win-loss.</b> A 3-point win and a 30-point win are different evidence; a win and a loss on the scoreboard hide it.</li>
            <li><b>Ridge-regularized</b> so a team with a thin or lopsided early schedule is pulled toward the mean instead of ballooning on noise.</li>
            <li><b>Prior-season carryover.</b> Each season starts from last year&apos;s regressed rating, then the new games take over — so week 3 isn&apos;t a coin flip.</li>
            <li><b>Blowouts capped</b> at {28} points — running up the score is barely more information than a comfortable win.</li>
            <li><b>Home field = {M.hfa} points</b>, estimated from the data, dropped entirely at neutral sites.</li>
            <li><b>Fit on {M.seasons}</b>, {M.teamsRated} FBS teams, tested walk-forward (each week predicted only from earlier weeks).</li>
          </ul>
        </div>
      </details>

      <footer className="foot">
        <p>
          <b>Line-blind and graded in public.</b> These reads never see the betting line before they&apos;re set,
          and we publish the track record — including where it falls short. For where the price is actually
          wrong, that lives in <a href="/ncaaf/lines">Value Finder</a>; the NFL model is on <a href="/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
