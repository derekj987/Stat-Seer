// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav, ScrollHint, WeekBadge } from "./Nav";
import { WeekNav } from "./WeekNav";
import Tip from "./Tip";
import { PLAYER_PROJECTIONS, PROJ_WEEK, PROJ_PRIOR, type PlayerProj } from "@/lib/playerProjections";
import { NCAAF_PLAYER_PROJECTIONS, NCAAF_PROJ_WEEK } from "@/lib/ncaafPlayerProjections";
import { isRealistic } from "@/lib/depthChart";
import { projLean, leanCentres } from "@/lib/playerProjections";
import PropAdd, { type PricedSide } from "./PropAdd";
import PinButton from "./PinButton";
import { playerSlot, normName } from "@/lib/playerSlot";
import { weekProps } from "@/lib/props";
import { cfbWeekProps } from "@/lib/cfbProps";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "./DayHeader";

export interface PlayerCat {
  key: string;
  label: string;
}

// Method/blurb text intentionally omitted — how each number is calculated is not published
// on the public pages (see the pending "How we make our calculations" decision).
export const PLAYER_CATS: PlayerCat[] = [
  { key: "td", label: "Touchdowns" },
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "receptions", label: "Receptions" },
];

export const playerCatByKey = (k: string): PlayerCat =>
  PLAYER_CATS.find((c) => c.key === k) ?? PLAYER_CATS[0];


export default async function PlayerModelView({ base, cat, week }: { base: "nfl" | "ncaaf"; cat: string; week: number }) {
  const active = playerCatByKey(cat);
  // Live book market per (player, market, side) — so the ＋ chips add the real best price +
  // every book (byBook), exactly like Value Finder. Missing → PropAdd uses consensus.
  const priceIx = new Map<string, PricedSide>();
  try {
    const priced = base === "ncaaf" ? await cfbWeekProps(week) : await weekProps(week);
    for (const pg of priced) for (const m of pg.markets) for (const q of m.quotes) {
      priceIx.set(`${normName(q.player)}|${m.market}|${q.side}`, { line: q.line, price: q.price, books: q.books, byBook: q.byBook });
    }
  } catch { /* no market yet — chips fall back to consensus pricing */ }
  const priceFor = (player: string, mkt: string, side: string): PricedSide | null =>
    priceIx.get(`${normName(player)}|player_${mkt}|${side}`) ?? null;
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const catHref = (c: string) => `${home}?cat=${c}&week=${week}`;

  // Projections: NFL from PLAYER_PROJECTIONS (Week PROJ_WEEK), NCAAF from the CFB export.
  // Group the active category's rows by game. (isRealistic is an NFL depth-chart filter, so
  // it's applied to NFL only — CFB rows are already limited to players with posted props.)
  const projections = base === "ncaaf" ? NCAAF_PLAYER_PROJECTIONS : PLAYER_PROJECTIONS;
  // Baseline over-rate per category for THIS sport — the lean is read relative to it, not to 50%.
  const centres = leanCentres(projections);
  // Both sports gate on the week their projection set was BUILT for. NCAAF used to gate on
  // `projections.length > 0`, which is true for every week — so weeks 2-18 all rendered week 1's
  // games and the board never emptied out as the season moved on. The exporter now stamps
  // NCAAF_PROJ_WEEK so the two sides agree on which week the rows describe.
  const projWeek = base === "ncaaf" ? NCAAF_PROJ_WEEK : PROJ_WEEK;
  const onProjWeek = week === projWeek;
  const rows: PlayerProj[] = onProjWeek
    ? projections.filter((p) => p.cat === active.key && (base === "nfl" ? isRealistic(p.player) : true))
    : [];
  const games: string[] = [];
  const byGame: Record<string, PlayerProj[]> = {};
  const gameKick: Record<string, string> = {};   // earliest kickoff per game, for date ordering
  for (const r of rows) {
    if (!byGame[r.game]) { byGame[r.game] = []; games.push(r.game); }
    byGame[r.game].push(r);
    if (r.commence && (!gameKick[r.game] || r.commence < gameKick[r.game])) gameKick[r.game] = r.commence;
  }
  // Lead with the soonest game so today's matchups are up top (games with no kickoff sort last).
  games.sort((a, b) => (gameKick[a] ?? "9999").localeCompare(gameKick[b] ?? "9999"));
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();
  const LEAD = 4;   // rows shown before "see more"
  // Per-row unit — the passing category mixes markets (yards + TDs); anytime-TD is a %.
  const unitFor = (market: string) =>
    market === "receptions" ? "" : market === "pass_tds" ? " TD" : market === "anytime_td" ? "%" : " yds";
  // Which market each row is — shown in its own column so a player's stacked rows are self-describing
  // ("Drake Maye … Passing yds / Passing TDs") instead of leaving you to infer it from the unit.
  const PROP_LABELS: Record<string, string> = {
    pass_yds: "Passing yds", pass_tds: "Passing TDs", rush_yds: "Rushing yds",
    rec_yds: "Receiving yds", receptions: "Receptions", anytime_td: "Anytime TD",
  };
  const propLabel = (market: string) => PROP_LABELS[market] ?? market.replace(/_/g, " ");
  // The Touchdowns tab is a Yes/No prop: relabel the numeric + hit-rate headers.
  const isTd = active.key === "td";
  // Group each game's rows by player so a player who appears in two markets (e.g. a QB's
  // passing yards + passing TDs) reads as ONE grouped block — adjacent rows under a single
  // name — instead of two separate charts. Single-market categories are unaffected (each
  // player already appears once, so grouping preserves the original order).
  const mktRank = (m: string) => (m === "pass_yds" ? 0 : m === "pass_tds" ? 1 : 0);
  const sectionsFor = (g: string): { label: string | null; rows: PlayerProj[] }[] => {
    const order: string[] = [];
    const byPlayer: Record<string, PlayerProj[]> = {};
    for (const r of byGame[g]) {
      if (!byPlayer[r.player]) { byPlayer[r.player] = []; order.push(r.player); }
      byPlayer[r.player].push(r);
    }
    const rows = order.flatMap((p) =>
      byPlayer[p].slice().sort((a, b) => mktRank(a.market) - mktRank(b.market)));
    return [{ label: active.key === "passing" ? "Passing" : null, rows }];
  };

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">{base === "ncaaf" ? "NCAAF" : "NFL"}</span> · Player Prop Model</>}
          art={{ src: "/player.png?v=1", alt: "Player Prop Model" }}
        />
      </header>

      <WeekBadge week={week} tip={
        <Tip label="Player Prop Model" text={<>Our <b>line-blind player-prop projections</b> — our own number
          for each prop, set without looking at the book&apos;s line, shown beside it with an over/under lean.
          Like the game model, these are <b>published and graded in public</b> — not sold as locks.</>} />
      } />
      <FlowSteps active="analyze" base={base} />
      <div className="subnavrow"><ModelSubnav active="player" base={base} /></div>

      <nav className="catnav" aria-label="Player prop category">
        {PLAYER_CATS.map((c) => (
          <a key={c.key} href={catHref(c.key)}
            className={c.key === active.key ? "catnav__c active" : "catnav__c"}
            aria-current={c.key === active.key ? "page" : undefined}>{c.label}</a>
        ))}
      </nav>

      <WeekNav current={week} base={base === "ncaaf" ? "/ncaaf/model/players" : "/model/players"} params={`cat=${active.key}`} />

      <div className="pinrow">
        <PinButton pin={{ id: `${home}?cat=${active.key}`, kind: "model", label: `Player Prop Model · ${active.label}`, detail: `${base === "ncaaf" ? "NCAAF" : "NFL"} · Week ${week}`, href: `${catHref(active.key)}` }} />
      </div>

      <section className="pmcat">
        {rows.length === 0 ? (
          <div className="pmempty pmempty--solo" role="note">
            <span className="pmempty__tag">Projections arriving</span>
            <p>
              Our line-blind <b>{active.label.toLowerCase()}</b> projections publish here as each
              week&apos;s data comes in — they can&apos;t be filled in before the season runs.
            </p>
          </div>
        ) : (
          <>
            {groupByGameDay(games, (g) => gameKick[g] ?? null, todayEt, tomorrowEt).map((grp) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                {grp.items.map((g) => (
              <details className="pmgame" key={g}>
                <summary className="pmgame__h">{g}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                <div className="pmgame__body">
                <ScrollHint />
                {sectionsFor(g).map((sec, si) => {
                  const moreId = `pm-${base}-${active.key}-${g.replace(/[^a-z0-9]/gi, "")}-${si}`;
                  // "See more" hides by whole player: a player's grouped rows fold together, so
                  // a QB's yards + TD lines never split across the fold. LEAD counts players.
                  const grpIndex: Record<string, number> = {};
                  let gn = 0;
                  for (const r of sec.rows) if (!(r.player in grpIndex)) grpIndex[r.player] = gn++;
                  const extra = Math.max(0, gn - LEAD);
                  return (
                  <div className="hb-moretbl" key={sec.label ?? "all"}>
                    <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                    <div className="pmscroll">
                    {sec.label && <div className="pmsec__h">{sec.label}</div>}
                    <div className={`pmtable pmtable--data${active.key === "passing" ? " pmtable--ha" : ""}`} role="table" aria-label={`${g} ${sec.label ?? active.label} projections`}>
                      <div className="pmrow pmrow--head pmrow--data" role="row">
                        <span className="pmcell pmcell--player">Player</span>
                        <span className="pmcell">Prop</span>
                        <span className="pmcell pmcell--num">{isTd ? "Book %" : "Book line"}</span>
                        <span className="pmcell pmcell--num">{isTd ? "Our %" : "Our proj"}</span>
                        <span className="pmcell pmcell--career">{isTd ? "Career TD rate" : "Career % over"}</span>
                        <span className="pmcell pmcell--career">{isTd ? "Prior szn TD rate" : "Prior szn % over"}</span>
                        {active.key === "passing" && <>
                          <span className="pmcell pmcell--career">Home % over</span>
                          <span className="pmcell pmcell--career">Road % over</span>
                        </>}
                        <span className="pmcell pmcell--add">Add to slip</span>
                      </div>
                      {sec.rows.map((r, ri) => {
                        const cpct = r.cG ? Math.round((100 * r.cOver) / r.cG) : null;
                        const ppct = r.pG ? Math.round((100 * r.pOver) / r.pG) : null;
                        const hpct = r.hG ? Math.round((100 * r.hOver) / r.hG) : null;
                        const rpct = r.rG ? Math.round((100 * r.rOver) / r.rG) : null;
                        const cls = (v: number | null) => v === null ? "" : v >= 50 ? "pmread--over" : "pmread--under";
                        // No book line yet (line-blind projection ahead of the market) → show "—"
                        // for the book number and drop the over/under arrow (nothing to compare to).
                        const hasBook = r.book !== null;
                        // The lean comes from the player's own exceedance rate at this line, NOT
                        // from proj vs book — see projLean. `proj` is a mean and the line sits near
                        // the median, so the old comparison leaned OVER on 90-100% of continuous
                        // markets. A row with too little history now shows no arrow at all.
                        const lean = projLean(r, centres);
                        // A continuation row (same player as the row above, e.g. a QB's TD line
                        // under his yards line) blanks the name/team so the block reads as one.
                        const cont = ri > 0 && sec.rows[ri - 1].player === r.player;
                        const isMore = grpIndex[r.player] >= LEAD;
                        // Depth-chart slot (RB1/WR2) when we have it, else the player's plain
                        // position (RB/WR/QB) — so every player carries a position tag.
                        const slot = playerSlot(r.player, base) ?? r.pos;
                        return (
                          <div className={`pmrow pmrow--data${isMore ? " hb-row--more" : ""}${cont ? " pmrow--cont" : ""}`} role="row" key={`${r.player}-${r.market}`}>
                            <span className="pmcell pmcell--player">{cont ? "" : <>{r.player}<span className="pmslot"> ({[slot, r.team].filter(Boolean).join(", ")})</span>
                              {r.envDelta != null && Math.abs(r.envDelta) >= 2 && (
                                <span className={`pmenv pmenv--${r.envDelta > 0 ? "up" : "down"}`}
                                  title={`Scoring-environment context (not built into our number): ${r.team}'s implied team total this week (${r.env}) is ${Math.abs(r.envDelta).toFixed(1)} pts ${r.envDelta > 0 ? "higher" : "lower"} than ${r.player}'s ${PROJ_PRIOR} norm. Our projection is anchored to last season, so on a ${r.envDelta > 0 ? "much improved" : "tougher"} spot it may run ${r.envDelta > 0 ? "low" : "high"}. Most measurable for QB passing.`}>
                                  {r.envDelta > 0 ? "▲ better spot" : "▼ tougher spot"}
                                </span>
                              )}</>}</span>
                            {/* Shown on EVERY row (not blanked on continuations) — it's what
                                distinguishes a player's stacked rows from each other. */}
                            <span className="pmcell pmcell--team">{propLabel(r.market)}</span>
                            <span className="pmcell pmcell--num">{hasBook ? <>{r.book}{unitFor(r.market)}</> : "—"}</span>
                            <span className={`pmcell pmcell--num pmcell--proj${lean === "under" ? " pmcell--projdown" : ""}`}>
                              {r.proj}{unitFor(r.market)}
                              {lean && (
                                <>{" "}<span className={`pmarrow ${lean === "over" ? "pmarrow--up" : "pmarrow--down"}`}
                                  title={r.cat === "td"
                                    ? "Our projected TD probability vs the book's implied probability."
                                    : `${r.player} has cleared ${r.book} in ${r.cOver} of ${r.cG} games. That is ${lean === "over" ? "more" : "less"} often than a typical ${propLabel(r.market).toLowerCase()} line is cleared (${Math.round(100 * (centres.get(r.cat) ?? 0.5))}% here), which is what this arrow compares against — a relative read, not a probability of winning the bet.`}
                                  aria-hidden="true">{lean === "over" ? "▲" : "▼"}</span></>
                              )}
                            </span>
                            <span className={`pmcell pmcell--career ${cls(cpct)}`}>
                              {cpct === null ? "—" : <>{cpct}% <small className="pmcell__sub">{r.cOver}/{r.cG} gm</small></>}
                            </span>
                            <span className={`pmcell pmcell--career ${cls(ppct)}`}>
                              {ppct === null ? <span className="pmcell__sub">no {PROJ_PRIOR}</span> : <>{ppct}% <small className="pmcell__sub">{r.pOver}/{r.pG} gm</small></>}
                            </span>
                            {active.key === "passing" && <>
                              <span className={`pmcell pmcell--career ${cls(hpct)}`}>
                                {hpct === null ? "—" : <>{hpct}% <small className="pmcell__sub">{r.hOver}/{r.hG} gm</small></>}
                              </span>
                              <span className={`pmcell pmcell--career ${cls(rpct)}`}>
                                {rpct === null ? "—" : <>{rpct}% <small className="pmcell__sub">{r.rOver}/{r.rG} gm</small></>}
                              </span>
                            </>}
                            <span className="pmcell pmcell--add">
                              <PropAdd player={r.player} market={r.market} line={r.book} game={g} slot={slot}
                                over={priceFor(r.player, r.market, "Over")}
                                under={priceFor(r.player, r.market, "Under")}
                                attd={r.market === "anytime_td" ? priceFor(r.player, "anytime_td", "Yes") : null} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                    {extra > 0 && (
                      <label htmlFor={moreId} className="hb-moretbl__sum">
                        <span className="hb-more__chev" aria-hidden="true">▸</span>
                        <span className="hb-moretbl__more">See more ({extra} more player{extra === 1 ? "" : "s"})</span>
                        <span className="hb-moretbl__less">See less</span>
                      </label>
                    )}
                  </div>
                  );
                })}
                </div>
              </details>
                ))}
              </div>
            ))}
          </>
        )}
      </section>

      <footer className="foot foot--pm">
        <p>
          <b>Line-blind and graded in public.</b> These are our own projections, not book lines — for the best
          price on a prop you&apos;ve chosen, that&apos;s Value Finder&apos;s{" "}
          <a href={base === "ncaaf" ? "/ncaaf/props" : "/props"}>Player Props</a>.
        </p>
      </footer>
    </main>
  );
}
