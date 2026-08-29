import { Brand, FlowSteps, ModelSubnav, MoreTable, WeekBadge } from "../../Nav";
import Tip from "@/app/Tip";
import { NCAAF_MODEL, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { NcaafCardHead, NcaafGameCell } from "../CardCells";
import { NcaafWeekNav, NcaafOffWeek, readNcaafWeek } from "../NcaafWeek";

// College Football — The Model. Mirrors the NFL Model page: the full model-vs-market
// table leads, the honest track record (predicts as well as Elo, doesn't beat the spread)
// is tucked into a dropdown, and college player projections are flagged as arriving.
export const metadata = {
  title: "StatSeer — College Football Model",
  description: "The full college-football model — our line-blind read beside the market on every game, with the honest track record.",
};

const M = NCAAF_MODEL;

// Full-model table is grouped by the HOME team's conference so 50+ games aren't one wall.
const CONF_ORDER = ["SEC", "Big Ten", "Big 12", "ACC", "Pac-12", "American Athletic",
  "Mountain West", "Sun Belt", "Mid-American", "Conference USA", "FBS Independents", "Other"];

function groupByConf(games: readonly NcaafCardGame[]): { conf: string; games: NcaafCardGame[] }[] {
  const by = new Map<string, NcaafCardGame[]>();
  for (const g of games) {
    const k = g.conf || "Other";
    (by.get(k) ?? by.set(k, []).get(k)!).push(g);
  }
  const rank = (c: string) => { const i = CONF_ORDER.indexOf(c); return i === -1 ? CONF_ORDER.length : i; };
  return [...by.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([conf, gs]) => ({ conf, games: gs }));
}

// Home-perspective margin from a favorite-line spread ({fav, num}; num is the favorite's negative
// line). Used to measure how far our line-blind number sits from the market's on a game.
function marginHome(sp: { fav: string; num: number } | null | undefined, home: string): number | null {
  if (!sp) return null;
  return sp.fav === home ? -sp.num : sp.num;
}
function marketGap(g: NcaafCardGame): number | null {
  const m = marginHome(g.marketSpread, g.home), p = marginHome(g.projSpread, g.home);
  return m === null || p === null ? null : p - m;   // + = we're higher on the home team than the market
}

function CardRows({ games, moreFrom, withGap }: { games: readonly NcaafCardGame[]; moreFrom?: number; withGap?: boolean }) {
  return (
    <>
      {games.map((g, i) => {
        const ms = g.marketSpread;
        const gap = withGap ? marketGap(g) : null;
        return (
          <tr key={`${g.away}-${g.home}`} className={[g.off ? "hb-off" : "", moreFrom !== undefined && i >= moreFrom ? "hb-row--more" : ""].filter(Boolean).join(" ") || undefined}>
            <NcaafGameCell g={g} />
            <td className="hb-num">{ms ? `${abbrevTeam(ms.fav)} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-num hb-model">{abbrevTeam(g.projSpread.fav)} {g.projSpread.num}
              {gap !== null && Math.abs(gap) >= 1 && (
                <span className="hb-gap" title={`Our line is ${Math.abs(gap).toFixed(1)} pts off the market — the further apart, the stronger our independent read differs.`}>
                  Δ{Math.abs(gap).toFixed(1)}
                </span>
              )}
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

      {/* Lead with the biggest market divergences — where the model has an independent opinion. */}
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
            <CardRows games={lead} moreFrom={6} withGap />
          </MoreTable>
        </div>
      </details>

      {/* The FULL model — every game on the board, collapsed. */}
      <details className="hb-panel">
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Full Model — every game</span>
          <span className="hb-bar__count">{c.games.length} games</span>
          <span className="hb-bar__hint">the complete slate, not just the ranked snapshot</span>
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {groupByConf(c.games).map((grp) => (
            <section className="ncf-confgrp" key={grp.conf}>
              <h3 className="ncf-confgrp__h">{grp.conf}<span className="ncf-confgrp__n">{grp.games.length} game{grp.games.length === 1 ? "" : "s"}</span></h3>
              <div className="hb-formwrap">
                <table className="hb-form hb-form--mkt"><NcaafCardHead /><tbody><CardRows games={grp.games} /></tbody></table>
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
