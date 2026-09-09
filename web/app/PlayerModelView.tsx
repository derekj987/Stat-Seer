// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav, ScrollHint, WeekBadge } from "./Nav";
import { WeekNav } from "./WeekNav";
import Tip from "./Tip";
import { PLAYER_PROJECTIONS, PROJ_WEEK, PROJ_PRIOR, PROJ_SEASON, type PlayerProj } from "@/lib/playerProjections";
import { weekInjuries, injuryKey, SUPPRESSES, type InjuryNote } from "@/lib/nflInactives";
import { NCAAF_PLAYER_PROJECTIONS, NCAAF_PROJ_WEEK } from "@/lib/ncaafPlayerProjections";
import { isRealistic } from "@/lib/depthChart";
import { projLean, leanCentres, hasProjSample, MIN_PROJ_GAMES } from "@/lib/projLean";
import PropAdd, { type PricedSide } from "./PropAdd";
import PinButton from "./PinButton";
import { playerSlot, normName } from "@/lib/playerSlot";
import { weekProps, fanduelLines } from "@/lib/props";
import { cfbWeekProps } from "@/lib/cfbProps";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "./DayHeader";
import { abbrevTeam } from "@/lib/ncaafAbbrev";

// Sportsbook slugs as the books spell themselves, for the book-line tooltip.
const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel", draftkings: "DraftKings", betmgm: "BetMGM", betrivers: "BetRivers",
  bovada: "Bovada", betonlineag: "BetOnline", fanatics: "Fanatics", williamhill_us: "Caesars",
};

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


// Measured size of the matchup effect, per sport, in yards a player beats his own baseline by
// between the worst and best tercile. Different numbers because they were measured separately —
// college defences vary far more than NFL ones, so the tag carries more there.
//   NFL   2021-25: RB +5.6 / TE +3.6 / WR +1.0   (overall corr +0.058)
//   NCAAF 2024-25: passing +/-10.8, rushing +/-5.4, receiving +/-1.8  (overall corr +0.084)
const MATCHUP_SIZE: Record<"nfl" | "ncaaf", string> = {
  nfl: "Worth about +5.6 yards for a running back, +3.6 for a tight end and +1.0 for a receiver.",
  ncaaf: "Worth about 10.8 yards on passing, 5.4 on rushing and 1.8 on receiving.",
};

// WHICH DEFENCE the tag is about. It was labelled "good/bad matchup" under the player's name,
// which reads as a verdict on HIM — and therefore as a contradiction whenever our projection went
// over on the same row. It never was that: it is one fact about the OPPONENT's defence last
// season, and it is deliberately not an input to the projection. So the label now names the thing
// it describes, and the two numbers stop looking like they disagree.
// Mirrors MARKET_GRP / POS_GRP in cfb_player_proj.py — if those change, change these together or
// the pill will describe a different defence than the one it was computed from.
const MARKET_D: Record<string, string> = {
  pass_yds: "pass D", pass_tds: "pass D",
  rush_yds: "run D", rec_yds: "pass D", receptions: "pass D",
};
const POS_D: Record<string, string> = {
  QB: "run D", RB: "run D", FB: "run D", WR: "pass D", TE: "pass D",
};
const defenceLabel = (market: string, pos?: string | null) =>
  MARKET_D[market] ?? POS_D[pos ?? ""] ?? "defence";

export default async function PlayerModelView({ base, cat, week }: { base: "nfl" | "ncaaf"; cat: string; week: number }) {
  const active = playerCatByKey(cat);
  // Live book market per (player, market, side) — so the ＋ chips add the real best price +
  // every book (byBook), exactly like Value Finder. Missing → PropAdd uses consensus.
  const priceIx = new Map<string, PricedSide>();
  // FanDuel's CURRENT line per (player, market), read live. The `book` column baked into the
  // projections file is only as fresh as the last export (twice daily), which is how a line that
  // had moved to 228.5 was still being shown at 230.5. This overrides it on a 120s cache, so the
  // column tracks the book between builds rather than only at them.
  //
  // It CANNOT come from weekProps: that collapses each player to the line most favourable to the
  // bettor across books, which is the right answer for the ＋ chips and the wrong one for a column
  // that is meant to show what FanDuel shows.
  const liveLine = base === "ncaaf" ? new Map<string, number>() : await fanduelLines(week);
  try {
    const priced = base === "ncaaf" ? await cfbWeekProps(week) : await weekProps(week);
    for (const pg of priced) for (const m of pg.markets) for (const q of m.quotes) {
      // A book posts a LADDER of alternate lines on the same (player, market, side), so a plain
      // set() keeps whichever arrived last — an arbitrary rung, not the main line. Prefer the
      // quote FanDuel is on; failing that, the one priced closest to even money, since an
      // alternate is priced away from even by construction.
      const k = `${normName(q.player)}|${m.market}|${q.side}`;
      const prev = priceIx.get(k);
      const fd = (q.byBook as Record<string, number> | undefined)?.fanduel !== undefined;
      const evenness = (x: PricedSide | undefined) =>
        x ? Math.abs(x.price ?? 0) : Number.POSITIVE_INFINITY;
      const prevFd = prev ? (prev.byBook as Record<string, number> | undefined)?.fanduel !== undefined : false;
      if (!prev || (fd && !prevFd) || (fd === prevFd && Math.abs(q.price ?? 0) < evenness(prev))) {
        priceIx.set(k, { line: q.line, price: q.price, books: q.books, byBook: q.byBook });
      }
    }
  } catch { /* no market yet — chips fall back to consensus pricing */ }
  // player+market key that matches the generated rows' market names ("rush_yds" -> "player_rush_yds")
  // fanduelLines keys on the RAW player name the book posts; the board's rows carry the roster
  // spelling, so normalise both sides before comparing.
  const liveByKey = new Map<string, number>();
  for (const [k, v] of liveLine) {
    const [nm, mkt] = k.split("|");
    liveByKey.set(`${normName(nm)}|${mkt}`, v);
  }
  const liveFor = (player: string, mkt: string): number | null =>
    liveByKey.get(`${normName(player)}|player_${mkt}`) ?? null;
  const priceFor = (player: string, mkt: string, side: string): PricedSide | null =>
    priceIx.get(`${normName(player)}|player_${mkt}|${side}`) ?? null;

  // Live availability, on the same 120s window as the prices above, so a row's designation and its
  // book line are never more than two minutes out of step. NFL only: the NCAAF side has no
  // equivalent feed. Never fatal — an empty map just means no tags.
  const injuries = base === "ncaaf" ? new Map<string, InjuryNote>() : await weekInjuries(PROJ_SEASON, week);
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
  // A player ruled OUT / IR / suspended is dropped from the board entirely — Derek's call: "if a
  // player is injured and out for the game, we do not even need to list them." Only the
  // not-playing designations remove a row; QUESTIONABLE and DOUBTFUL are game-time decisions, so
  // those players stay and carry a tag instead.
  // Trade-off worth knowing: a removed row is invisible, so if a designation is reversed the
  // player silently returns rather than visibly changing. That is why the feed is read live on a
  // 120s cache instead of baked at build time — a reversal shows up within two minutes.
  const isOut = (p: PlayerProj): boolean => {
    const n = injuries.get(injuryKey(p.player, p.team));
    return !!n && SUPPRESSES.has(n.status);
  };
  const rows: PlayerProj[] = onProjWeek
    ? projections.filter((p) => p.cat === active.key
        && (base === "nfl" ? isRealistic(p.player) && !isOut(p) : true))
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
  // College names are long enough to wrap the player cell and the game header ("Florida State"
  // pushed "(QB1, Florida State)" onto two lines). lib/ncaafAbbrev already shortens them for the
  // NCAAF boards; this view had simply never used it.
  // DISPLAY ONLY — `r.game` is also the React key, the moreId, and the PropAdd payload, so the
  // abbreviation is applied where it is rendered and nowhere else. NFL rows already carry short
  // codes (NE, SEA), so they are left untouched.
  const shortTeam = (t: string) => (base === "ncaaf" ? abbrevTeam(t) : t);
  const shortGame = (g: string) => g.split(" @ ").map(shortTeam).join(" @ ");
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
            {groupByGameDay(games, (g) => gameKick[g] ?? null, todayEt, tomorrowEt).map((grp, gi) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                {grp.items.map((g, i) => (
              /* The FIRST card opens. Every card closed means nothing on the board reads without a
                 click, which is what all-cards-collapsed flags — and the row caps inside each card
                 are worthless if you have to open something to see them. Only the first: 16 open
                 cards at ~19 rows each is a different wall. Same shape as /audit. */
              <details className="pmgame" key={g} open={gi === 0 && i === 0}>
                <summary className="pmgame__h">{shortGame(g)}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
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
                        <span className="pmcell pmcell--career"
                          title={isTd ? undefined : `How often each player has cleared his own line. Green/▲ and red/▼ compare against the TYPICAL rate for this market rather than a flat 50%, because these lines are not set at a coin flip — so a rate below 50% can still be an above-typical one.`}>
                          {isTd ? "Career TD rate" : "Career % over"}</span>
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
                        // Colour these against the SAME baseline the lean uses, not a flat 50%.
                        // Mixing the two encodings is what made the board look broken: a college QB
                        // clearing his line 30% of the time is ABOVE the 22% typical for that market,
                        // so the arrow said "over" while a 50%-threshold colour said "under" in the
                        // very next column. One yardstick per row, named in the header tooltip.
                        const base50 = Math.round(100 * (centres.get(r.cat) ?? 0.5));
                        const cls = (v: number | null) => v === null ? "" : v >= base50 ? "pmread--over" : "pmread--under";
                        // No book line yet (line-blind projection ahead of the market) → show "—"
                        // for the book number and drop the over/under arrow (nothing to compare to).
                        const hasBook = r.book !== null;
                        // The live line wins over the baked one whenever the market has moved
                        // since the last export. Same source (FanDuel), fresher read.
                        const live = liveFor(r.player, r.market);
                        const shownLine = live ?? r.book;
                        // The lean comes from the player's own exceedance rate at this line, NOT
                        // from proj vs book — see projLean. `proj` is a mean and the line sits near
                        // the median, so the old comparison leaned OVER on 90-100% of continuous
                        // markets. A row with too little history now shows no arrow at all.
                        // Thin own-history gates the LEAN (a claim), not the PROJECTION (a number).
                        // The projection used to be dashed too, on a measurement that has since been
                        // shown to be an artifact: median(proj/line) by sample size was read off a
                        // board where a 1000-row truncation left only 7 of 35 games visible. Measured
                        // again on the corrected board, 0-2 games came in at 0.88 — the BEST bucket —
                        // while the 5-9 bucket we were publishing sat at 1.31. Games played simply
                        // does not separate a good projection from a bad one here, and the gate was
                        // blanking Keelon Russell at 1.00 against his line while passing 42 worse rows.
                        // The games count is already on the row ("0/2 gm"), so the reader can discount
                        // a thin number themselves rather than be shown nothing.
                        // The lean stays gated: it IS a claim, and projLean already shrinks a thin
                        // rate toward the category baseline, so the two guards work together.
                        // Availability. Anyone ruled out has already been filtered off the board
                        // above, so what survives here is a game-time decision — Questionable or
                        // Doubtful. Those keep their projection (they may well play) and carry a
                        // tag so the reader can price the risk themselves.
                        const inj = injuries.get(injuryKey(r.player, r.team)) ?? null;
                        const enough = hasProjSample(r);
                        const lean = enough ? projLean(r, centres) : null;
                        // A continuation row (same player as the row above, e.g. a QB's TD line
                        // under his yards line) blanks the name/team so the block reads as one.
                        const cont = ri > 0 && sec.rows[ri - 1].player === r.player;
                        const isMore = grpIndex[r.player] >= LEAD;
                        // Depth-chart slot (RB1/WR2) when we have it, else the player's plain
                        // position (RB/WR/QB) — so every player carries a position tag.
                        const slot = playerSlot(r.player, base) ?? r.pos;
                        return (
                          <div className={`pmrow pmrow--data${isMore ? " hb-row--more" : ""}${cont ? " pmrow--cont" : ""}`} role="row" key={`${r.player}-${r.market}`}>
                            <span className="pmcell pmcell--player">{cont ? "" : <>{r.player}<span className="pmslot"> ({[slot, shortTeam(r.team)].filter(Boolean).join(", ")})</span>
                              {/* The designation, read live from ESPN on the same 120s window as the
                                  book line beside it. Red for anyone not dressing, amber for a
                                  game-time decision — a bettor needs those to look different. */}
                              {inj && (
                                <span className="pminj pminj--iffy"
                                  title={`${r.player} is listed ${inj.label.toLowerCase()}${inj.detail ? ` — ${inj.detail.toLowerCase()}` : ""}. Read live from the league's injury report, refreshed every 2 minutes.`}>
                                  {inj.label}{inj.detail ? ` · ${inj.detail}` : ""}
                                </span>
                              )}
                              {/* Matchup, not "spot". The old pill was built on envDelta — the change
                                  in a team's implied total vs the player's prior-season norm — which
                                  measured corr +0.0053 against how much a player beat his OWN
                                  baseline, i.e. nothing. Opponent defence vs his POSITION measured
                                  +0.0581 over 2021-25, so that is what the tag now says. Three
                                  states, because "toss-up" is the honest answer for most rows and a
                                  binary forced every player into a verdict. */}
                              {r.matchup && (
                                <span className={`pmmatch pmmatch--${r.matchup}`}
                                  title={r.matchup === "toss"
                                    ? `Context, not a pick: this opponent handled this about like an average defence last season. Nothing to read into either way.`
                                    : `Context, not a pick: this opponent gave up ${r.matchup === "good" ? "more" : "less"} than an average defence last season. ${MATCHUP_SIZE[base]} Measured on how much a player beats his OWN baseline — real, small, and deliberately NOT built into our projection.`}>
                                  {/* NO ARROW. The row already carries a ▲/▼ on the "% over" cell,
                                      which is a claim about the PLAYER. A second arrow on a pill
                                      about the OPPONENT put a ▼ and a ▲ side by side meaning
                                      different things — the same contradiction the wording fixed,
                                      re-introduced by the glyph. "tough"/"soft" plus the pill's
                                      red/green already say it. */}
                                  {r.matchup === "good" ? `soft ${defenceLabel(r.market, r.pos)}`
                                    : r.matchup === "bad" ? `tough ${defenceLabel(r.market, r.pos)}`
                                    : `average ${defenceLabel(r.market, r.pos)}`}
                                </span>
                              )}</>}</span>
                            {/* Shown on EVERY row (not blanked on continuations) — it's what
                                distinguishes a player's stacked rows from each other. */}
                            <span className="pmcell pmcell--team">{propLabel(r.market)}</span>
                            {/* Name the book. This column used to print a cross-book MEDIAN, which
                                is a number nobody can bet and sometimes one nobody even posts
                                (books at 64.5 and 65.5 median to 65.0, not a real receiving-yards
                                line). It is FanDuel's line wherever FanDuel posts one. */}
                            <span className="pmcell pmcell--num"
                              title={hasBook
                                ? (live !== null
                                    ? `FanDuel's line for ${r.player}, read live and refreshed every 2 minutes.`
                                    : `${r.src ? BOOK_LABEL[r.src] ?? r.src : "The market"}'s posted line for ${r.player}, from our latest capture of the board.`)
                                : undefined}>
                              {hasBook ? <>{shownLine}{unitFor(r.market)}</> : "—"}
                            </span>
                            {/* NO arrow here. The lean is not a claim about THIS number: `proj` is an
                                average and the book's line sits near the median, so a projection can
                                sit above the line while the player rarely clears it. An arrow inside
                                this cell reads as "our projection is under the line" and flatly
                                contradicted the figure beside it (proj 193.2 vs a 180.5 line, arrow
                                down). It now lives on the % over column it is actually computed from. */}
                            <span className={`pmcell pmcell--num pmcell--proj${enough ? "" : " pmcell--thin"}`}
                              title={r.proj === null
                                ? `No projection: ${r.player} has no prior-season NFL history, so there is nothing to build one from. He is on the board because a sportsbook priced him — that is the market saying he matters, and omitting him was worse than showing you an honest blank.`
                                : enough
                                ? `Our line-blind projection: ${r.player}'s expected ${propLabel(r.market).toLowerCase()}, an AVERAGE. Averages sit above the middle on these markets, so this can read higher than the book's line even when he clears that line less than half the time — the % over columns are what say how often he actually gets there.`
                                : `Our line-blind projection, built on only ${r.g} game${r.g === 1 ? "" : "s"} of ${r.player}'s own history — read it as a thin one. We publish it rather than hide it, and we hold back the over/under lean until ${MIN_PROJ_GAMES} games, because a lean is a claim and a projection is a measurement.`}>
                              {/* A rookie has a posted line and no history. Dashing the projection
                                  says so; dropping the row said nothing, and hid the market's
                                  shortest price on the slate. */}
                              {r.proj === null ? "—" : <>{r.proj}{unitFor(r.market)}</>}
                            </span>
                            {/* The lean sits HERE, on the number it is derived from, so the arrow, the
                                colour and the figure are one statement instead of three. */}
                            <span className={`pmcell pmcell--career ${cls(cpct)}`}
                              title={cpct === null ? undefined
                                : `${r.player} has cleared ${r.book ?? "this line"} in ${r.cOver} of ${r.cG} games (${cpct}%). Typical for ${propLabel(r.market).toLowerCase()} is ${base50}%, which is what the arrow and the colour compare against — a relative read, not a probability of winning the bet.`}>
                              {cpct === null ? "—" : <>
                                {lean && <span className={`pmarrow ${lean === "over" ? "pmarrow--up" : "pmarrow--down"}`} aria-hidden="true">{lean === "over" ? "▲" : "▼"}</span>}
                                {lean ? " " : ""}{cpct}% <small className="pmcell__sub">{r.cOver}/{r.cG} gm</small>
                              </>}
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
