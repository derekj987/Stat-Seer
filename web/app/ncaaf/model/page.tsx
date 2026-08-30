import { Brand, FlowSteps, ModelSubnav, MoreTable, WeekBadge } from "../../Nav";
import Tip from "@/app/Tip";
import { NCAAF_MODEL, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { NcaafCardHead, NcaafGameCell } from "../CardCells";
import { fetchCfbScores, scoreFor, type CfbScores } from "@/lib/cfbScores";
import { NcaafWeekNav, NcaafOffWeek, readNcaafWeek } from "../NcaafWeek";
import { marketGap, LeanTag } from "../lean";

// College Football — The Model. Mirrors the NFL Model page: the full model-vs-market
// table leads, the honest track record (predicts as well as Elo, doesn't beat the spread)
// is tucked into a dropdown, and college player projections are flagged as arriving.
export const metadata = {
  title: "StatSeer — College Football Model",
  description: "The full college-football model — our line-blind read beside the market on every game, with the honest track record.",
};

const M = NCAAF_MODEL;

// Full-model table is grouped by GAME DAY (Eastern) in chronological order, so today's games lead
// and the slate reads the way it's played out rather than burying today under a conference wall.
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const ET_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const kickKey = (iso?: string) => iso || "9999";   // games with no kickoff sort last

function groupByDay(games: readonly NcaafCardGame[]): { key: string; label: string; games: NcaafCardGame[] }[] {
  const by = new Map<string, NcaafCardGame[]>();
  for (const g of games) {
    const k = g.commence ? ET_DAY.format(new Date(g.commence)) : "TBD";
    (by.get(k) ?? by.set(k, []).get(k)!).push(g);
  }
  for (const gs of by.values()) gs.sort((a, b) => kickKey(a.commence).localeCompare(kickKey(b.commence)));
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))   // ISO day keys sort chronologically; "TBD" sorts last
    .map(([key, gs]) => ({
      key,
      label: key === "TBD" ? "Date TBD" : ET_LABEL.format(new Date(gs[0].commence!)),
      games: gs,
    }));
}

function CardRows({ games, moreFrom, scores }: { games: readonly NcaafCardGame[]; moreFrom?: number; scores?: CfbScores }) {
  return (
    <>
      {games.map((g, i) => {
        const ms = g.marketSpread;
        return (
          <tr key={`${g.away}-${g.home}`} className={[g.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
            <NcaafGameCell g={g} score={scores ? scoreFor(scores, g.away, g.home) : null} />
            <td className="hb-num">{ms ? `${abbrevTeam(ms.fav)} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-num hb-model">{abbrevTeam(g.projSpread.fav)} {g.projSpread.num}
              <LeanTag g={g} />
            </td>
            <td className="hb-num hb-model">{g.projTotal}</td>
          </tr>
        );
      })}
    </>
  );
}

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const v = M.validation;
  const a = M.ats;
  const beatsMarket = a.atsPct > a.breakeven;
  const c = M.card;
  const week = readNcaafWeek((await searchParams).week, c.week);
  // Live/final scores for this week (server-fetched, ~30s ISR) — rendered right in the game cells.
  const scores = await fetchCfbScores(week);
  // Lead with the games where our line-blind read DIVERGES MOST from the market — that's where the
  // model actually has an independent opinion. On big favorites we defer to the efficient market
  // (proven: they cover ~50%, we don't beat the spread), so those agree by design; the interesting
  // reads are the disagreements. Sorted by |our margin − market margin|, biggest first.
  const diverged = c.games
    .filter((g) => g.marketSpread)
    .map((g) => ({ g, gap: Math.abs(marketGap(g) ?? 0) }))
    .sort((a, b) => b.gap - a.gap)
    .map((x) => x.g);
  const lead = diverged.slice(0, 12);        // the 12 biggest divergences lead the board
  const leadRest = lead.slice(6);            // beyond the first 6 (see-more)
  // The marquee AP Top 25 board — ranked games in kickoff order (the recognizable poll view).
  const ranked = c.games.filter((g) => g.apAway || g.apHome)
    .sort((a, b) => kickKey(a.commence).localeCompare(kickKey(b.commence)));
  const rankedRest = ranked.slice(3);        // ranked games beyond the first 3 (see-more)

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">NCAAF</span> · The Model</>} art={{ src: "/heisman.png?v=1", alt: "Heisman Trophy" }} />
      </header>

      <WeekBadge week={c.week} />
      <FlowSteps active="analyze" base="ncaaf" />
      <ModelSubnav active="game" base="ncaaf" />
      <NcaafWeekNav base="/ncaaf/model" week={week} />
      <NcaafOffWeek current={c.week} week={week} />

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

      {/* Marquee AP Top 25 board — the ranked matchups, in kickoff order. */}
      <details className="hb-panel hb-panel--card" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">The Model — AP Top 25 Matchups</span>
          <Tip text={<>Every <b>ranked game</b> — one with an <b>AP Top 25</b> team (its poll rank shown beside it) — on the Week {c.week} board, in kickoff order, with the market&apos;s <b>Spread</b> and <b>O/U</b> beside <b>Our Projection</b>, our own line-blind spread &amp; total. A ◆ marks an <b>off-consensus</b> game. On big favorites we defer to the efficient market, so these mostly agree — the games where our read genuinely differs are in <b>Where We Differ Most</b> below. Context you can check, <b>not a pick</b> (our rating ties Elo but doesn&apos;t beat the spread).</>} />
          <span className="hb-bar__hint">AP Top 25 games, earliest kickoff first · Week {c.week}</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <div className="hb-legend">
            <span className="hb-lean hb-lean--defer">≈ market</span> on a big favorite we defer to the efficient line (it&apos;s not an underdog pick) ·{" "}
            <span className="hb-lean hb-lean--fav">fav</span> / <span className="hb-lean hb-lean--dog">dog</span> our line-blind lean on a closer game, with the margin — <b>context, not a pick</b> (our rating doesn&apos;t beat the spread). Hover any tag for detail.
          </div>
          <MoreTable id="ncaaf-ranked-more" head={<NcaafCardHead />} extra={rankedRest.length} noun="ranked games" cls="hb-form--mkt">
            <CardRows games={ranked} moreFrom={3} scores={scores} />
          </MoreTable>
        </div>
      </details>

      {/* Then the biggest market divergences — where the model has an independent opinion. */}
      <details className="hb-panel hb-panel--card" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">The Model — Where We Differ Most</span>
          <Tip text={<>The games where our <b>line-blind number is furthest from the market</b> — a <b>Δ</b> beside our projection shows how many points apart we are. This is where the model has an <b>independent opinion</b>. On big favorites we <b>defer to the market</b> (it&apos;s efficient there — heavy favorites cover about half the time — and our rating doesn&apos;t beat the spread), so those agree by design and don&apos;t lead here. Still <b>context, not a pick</b>: a divergence isn&apos;t a proven edge (we tested — the rating doesn&apos;t beat the closing line). The complete slate is in <b>Full Model — every game</b> below.</>} />
          <span className="hb-bar__hint">our line-blind read vs the market, biggest gaps first · Week {c.week}</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <div className="hb-legend">
            <span className="hb-dia">Δ</span> How far our line-blind number sits from the market on this game.
            <span className="hb-x"> · Big favorites don&apos;t appear here — on blowouts the market is efficient and we
              defer to it. The games that lead are where <b>our read genuinely differs</b>. It&apos;s <b>context you can
              check, not a pick</b> — our rating predicts about as well as Elo but doesn&apos;t beat the spread (see the
              record above).</span>
            {c.preseasonSeeded && (
              <span className="hb-x"> · <b>Preseason note:</b> with no {c.season} games played yet, these projections
                are seeded with published preseason ratings (SP+) blended with our own carryover, so the early number is
                credible instead of leaning on last season alone. As real games are played our in-season rating takes
                over and the seed washes out by about week 5.</span>
            )}
          </div>
          <MoreTable id="ncaaf-snap-more" head={<NcaafCardHead />} extra={leadRest.length} noun="more divergences" cls="hb-form--mkt">
            <CardRows games={lead} moreFrom={6} scores={scores} />
          </MoreTable>
        </div>
      </details>

      {/* The FULL model — every game on the board, collapsed. */}
      <details className="hb-panel">
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Full Model — every game</span>
          <span className="hb-bar__count">{c.games.length} games</span>
          <span className="hb-bar__hint">the complete slate, by game day — today first</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {groupByDay(c.games).map((grp) => (
            <section className="ncf-confgrp" key={grp.key}>
              <h3 className="ncf-confgrp__h">{grp.label}<span className="ncf-confgrp__n">{grp.games.length} game{grp.games.length === 1 ? "" : "s"}</span></h3>
              <div className="hb-formwrap">
                <table className="hb-form hb-form--mkt"><NcaafCardHead /><tbody><CardRows games={grp.games} scores={scores} /></tbody></table>
              </div>
            </section>
          ))}
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
