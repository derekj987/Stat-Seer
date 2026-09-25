import { Brand, FlowSteps, ModelSubnav } from "../../Nav";
import PinButton from "../../PinButton";
import { DayHeader } from "../../DayHeader";
import Tip from "../../Tip";
import { etToday, etDayKey, groupByGameDay } from "@/lib/gameDays";
import { MLB_GAMES, MLB_GAME_SCORES } from "@/lib/mlbGameModel";
import { MLB_AVAIL, type MlbAvail } from "@/lib/mlbAvailability";
import { mlbBoard } from "@/lib/mlbBoard";
import type { Game } from "@/lib/board";

// MLB · Game Model — the spreads/totals half of the section, beside Player Props.
//
// A CHART rather than the football boards' cards, and that is a data decision, not a style one:
// baseball plays fifteen games a night against football's sixteen a WEEK, so a card layout that
// reads well on Sunday becomes four screens of scrolling on a Tuesday. Everything else is kept
// identical to NFL/NCAAF on purpose — same masthead, FlowSteps, ModelSubnav, day grouping, hb-panel
// shells and pm* table classes. Every sport reading the same way is the product.
//
// NO SIDE PICK. Our spread is an expected MARGIN in runs, never a bet.
//
// THE MARKET COLUMN IS THE RUN LINE WITH ITS PRICE. This went round twice. A bare run-line column
// printed -1.5 down every row and read as "we make everyone a favourite" while saying nothing, so it
// was replaced with the moneyline converted to runs (marketMargin). Derek: "they would never be
// listed as -.9 or -.6 in a sports book. It's almost always -1.5." Right — a book posts -1.5 and the
// INFORMATION is in the price beside it: the Yankees laying 1.5 at +150 is a slight favourite; a
// heavy favourite lays 1.5 at -150. Measured across one sweep: 163 rows at -1.5, 163 at +1.5, and
// two at 2.0. So the column now shows exactly what the book shows — the favourite's run line and
// FanDuel's price for it — with the market's de-vigged cover chance underneath.
//
// OURS IS A CALL, IN THE SAME CURRENCY. The bare margin beside that line was misread within a day
// ("3 of 12 games favour taking the points": a margin of 1.3 against a 1.5 line looks like a lean
// to the dog), and a cover % on the market's favourite read as "based off the market". So our
// columns now say what Derek asked for outright — who we have winning (with our chance) and which
// run-line side we have covering (with our chance) — computed from our margin alone, with the
// margin underneath as the graded, line-blind quantity it always was. See ourCall().
//
// COPY LIVES IN THE SCROLL. One legend line on the board; the caveats, the measured gain and the
// calibration go in the Tip. Paragraphs of hedging stacked above a chart are a wall nobody reads,
// which is worse for honesty than one line plus a click.

export const metadata = {
  title: "StatSeer — MLB Game Model",
  description:
    "Line-blind MLB run projections published beside the market's total, grouped by day and graded after.",
};
export const revalidate = 300;

const S = MLB_GAME_SCORES;
// Measured on 2026: 30 teams, 4,464 completed team-games, 21,304 held-out candidate rows.
const BRIER = { model: 0.16102, persistence: 0.22894, gain: 29.7 };
// A lineup IS nine. The rest of the candidate pool folds away behind the standard control.
const LU_CAP = 9;
// Games shown per day before the dropdown. A full MLB day is 15, which runs the card well past a
// screen.
const GAME_CAP = 4;

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** First pitch, Eastern, compact — the day is already the group header, so the date would repeat. */
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
});
const kickTime = (iso: string) => timeFmt.format(new Date(iso)).replace(/\s?([AP])M/, (_m, x) => x.toLowerCase());
/** A margin as a bettor reads it: how many runs, and WHO is getting them.
 *
 *  A bare "-1.3" was unreadable twice over. MLB posts no such number (the run line is a fixed
 *  ±1.5; this is a margin derived from the moneyline), and nothing on the row said which club it
 *  belonged to — so the reader could not tell a home favourite from an away one. The sign carried
 *  the answer and the sign was invisible.
 *
 *  Our convention is home MINUS away, so POSITIVE = home favoured. The legend used to claim the
 *  opposite ("-0.6 means the home club is favoured"), which contradicted every row on the board.
 *  Naming the club removes the need to know the convention at all. */
const spread = (x: number, homeAbbr: string, awayAbbr: string) => {
  if (Math.abs(x) < 0.05) return "pick";
  return `−${Math.abs(x).toFixed(1)} (${x > 0 ? homeAbbr : awayAbbr})`;
};

const fmtPrice = (p: number) => (p > 0 ? `+${p}` : `−${Math.abs(p)}`);
/** The posted run line as a sportsbook shows it: the favourite laying 1.5, with the price.
 *  FanDuel's price where FanDuel posts one — the book Derek reads beside this board — else the
 *  best available, which is what the board's shopping logic already picked. `fair` is the
 *  market's own de-vigged chance the favourite covers (Pick Auditor arithmetic, averaged across
 *  books) — the chance the MARKET's favourite covers, which is the side named in the text. */
type RunLine = { text: string; fair: number | null; homeFav: boolean; point: number };
const runLine = (m: Game, homeAbbr: string, awayAbbr: string): RunLine | null => {
  const h = m.spread.home, a = m.spread.away;
  const fav = h?.point != null && h.point < 0 ? { line: h, abbr: homeAbbr, homeFav: true }
            : a?.point != null && a.point < 0 ? { line: a, abbr: awayAbbr, homeFav: false } : null;
  if (!fav) return null;
  const price = fav.line.byBook?.fanduel ?? fav.line.price;
  return {
    text: `−${Math.abs(fav.line.point!).toFixed(1)} (${fav.abbr}) ${fmtPrice(price)}`,
    fair: fav.line.fairProb ?? null, homeFav: fav.homeFav, point: fav.line.point!,
  };
};

/** OUR chance a side wins by 2+ (covers −1.5), from our margin FOR THAT SIDE.
 *
 *  This is the column Derek asked for after reading the bare margin as a side ("3 of 12 games
 *  favour taking the points") — a margin of 1.3 against a run line of 1.5 looks like a lean to the
 *  dog, and it isn't, because the price is what makes the run line fair. So ours is shown in the
 *  market's currency instead. It is NOT the normal on the margin that was first proposed: that ran
 *  four points high held out. It is a logistic fitted on the train split, both sides of every game
 *  (mlb_game_model.py, SCORES["cover"]), Brier +0.9% over the base rate and calibrated within 3
 *  points below 46%. Nearly flat by design — our favourite covers in 39% of held-out games, and
 *  that base rate is most of what any honest number here can say. */
const C = S.cover;
const coverProb = (marginForSide: number) => 1 / (1 + Math.exp(-(C.a + C.b * marginForSide)));

/** OUR chance a side WINS, from our margin for that side: Phi(m / sd). Held out, Brier +1.4% over
 *  the home base rate and our favourite won 55% (SCORES["win"]). */
const W = S.win;
const erf = (x: number) => {                      // Abramowitz–Stegun 7.1.26, |err| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const winProb = (marginForSide: number) => 0.5 * (1 + erf(marginForSide / W.sd / Math.SQRT2));

/** Who we think wins, and which run-line side we think covers — both from OUR margin alone.
 *
 *  Derek: "I want real analysis of these teams and show who we think will win (ML), cover the
 *  +1.5 or -1.5." The model never sees the market: offence, defence, the starting pitcher and
 *  last season's prior. (Lineup strength from the posted nine, bullpen, recent form and home
 *  field were each tested walk-forward and none improved held-out results — SCORES["tried"].)
 *  The run-line side is whichever of {favourite −1.5, dog +1.5} we give the better chance;
 *  favourites cover only 39% of the time, so the dog +1.5 is our side more often than not, and
 *  that is the sport, not timidity. Whether either side is a good BET is the price's business. */
const ourCall = (os: number, homeAbbr: string, awayAbbr: string, mktHomeFav?: boolean) => {
  const homeFav = os >= 0;
  const fav = homeFav ? homeAbbr : awayAbbr, dog = homeFav ? awayAbbr : homeAbbr;
  const m = Math.abs(os);
  const win = winProb(m);
  // Anchor the run-line read to the MARKET's posted sides, not to our own favourite.
  //
  // Two things were wrong with picking our own. Derek: "our spreads are suggesting to take the
  // +1.5 for every team. This is not correct."
  //
  // 1. IT NAMED SIDES THAT ARE NOT POSTED. With our favourite driving it, a game where we
  //    disagree with the market produced rows like "PIT +1.5" while the book had PIT at −1.5.
  //    There is no such bet. A run line has exactly two sides and both belong to the market.
  // 2. IT MADE THE ROW READ BACKWARDS. The market column shows the de-vigged chance the
  //    MARKET's favourite covers −1.5, and this column showed our chance for whichever side we
  //    rated higher — nearly always the dog, because favourites cover only 39% of the time. So
  //    the row put "fair 37%" beside "BOS +1.5 56%" and a reader compared 37 with 56 and saw a
  //    huge lean to the dog. The two numbers were about OPPOSITE sides. Read properly the market
  //    implied BOS +1.5 at 63% against our 56% — we were LESS keen on that dog than the price
  //    was, on 8 of 11 games. The board said "take the run" on exactly the side where our own
  //    number argued against it.
  //
  // Keyed on the market favourite, both percentages describe the same team at the same number and
  // the comparison is the one the reader thinks they are making.
  const mFav = mktHomeFav === undefined ? homeFav : mktHomeFav;
  const marginForMktFav = mFav ? os : -os;
  const coverMktFav = coverProb(marginForMktFav);
  const mktFavAbbr = mFav ? homeAbbr : awayAbbr, mktDogAbbr = mFav ? awayAbbr : homeAbbr;
  return coverMktFav >= 0.5
    ? { fav, win, rlSide: mktFavAbbr, rlPt: "−1.5", rlProb: coverMktFav, oursIsMktFav: true }
    : { fav, win, rlSide: mktDogAbbr, rlPt: "+1.5", rlProb: 1 - coverMktFav, oursIsMktFav: false };
};

export default async function Page() {
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();
  // Drop games that have already started. The data file is rebuilt once a day, so by the evening it
  // still carried this afternoon's games — and they are worse than clutter: the odds board drops a
  // game at first pitch, so every one of them showed "—" in BOTH market columns, and a pre-game
  // line-blind projection is not something anyone can act on once the game is under way.
  // revalidate=300 means a game leaves the board within five minutes of starting.
  const nowIso = new Date().toISOString();
  const upcoming = MLB_GAMES.filter((g) => g.commence > nowIso);

  // Market numbers. A failure here must not take the model board down with it — the projections
  // are static and the odds are a network read, so the board degrades to "—" in the market column
  // rather than to an error page.
  const { board } = await mlbBoard().catch(() => ({ board: [] as Awaited<ReturnType<typeof mlbBoard>>["board"] }));
  // Joined on the EASTERN day plus the matchup, then FIRST PITCH to separate a doubleheader.
  //
  // The ET day matters because a 9:40pm Pacific first pitch is already tomorrow in UTC, which is
  // the collision that made the model's own game keys wrong. But day-plus-matchup alone is not
  // unique: a doubleheader is two games between the same clubs on the same day, and keying a Map
  // on it silently kept whichever arrived last, so BOTH games rendered ONE game's market numbers.
  //
  // Nearest first pitch separates them, and the two clocks disagree by more than you would guess.
  // BAL @ NYY on 25 September: statsapi lists game 1 at 20:05 and game 2 at 20:10, because game 2
  // starts when game 1 ends and 20:10 is a placeholder. The books post 20:05 and 23:06 — a real
  // estimate. So the pairing has to tolerate a ~3h disagreement while still never crossing games.
  //
  // Hence greedy ONE-TO-ONE on the smallest gap rather than nearest-wins: closest pair is matched
  // first and both sides are then consumed, so game 1 takes 20:05 exactly and game 2 is left with
  // 23:06 — the only remaining candidate — instead of both grabbing the closer one. A model game
  // with no candidate left keeps "—", which is the honest answer and beats another game's price.
  const mktFor = new Map<string, (typeof board)[number]>();
  {
    const byMatchup = new Map<string, (typeof board)[number][]>();
    for (const b of board) {
      const k = `${etDayKey(b.commence)}|${b.matchup}`;
      const list = byMatchup.get(k);
      if (list) list.push(b); else byMatchup.set(k, [b]);
    }
    const pairs: { key: string; b: (typeof board)[number]; gap: number }[] = [];
    for (const g of upcoming) {
      for (const b of byMatchup.get(`${etDayKey(g.commence)}|${g.game}`) ?? []) {
        pairs.push({ key: g.gameKey, b,
                     gap: Math.abs(Date.parse(b.commence) - Date.parse(g.commence)) });
      }
    }
    pairs.sort((x, y) => x.gap - y.gap);
    const takenBoard = new Set<(typeof board)[number]>();
    for (const p of pairs) {
      if (mktFor.has(p.key) || takenBoard.has(p.b)) continue;
      mktFor.set(p.key, p.b);
      takenBoard.add(p.b);
    }
  }

  const keys = upcoming.map((g) => g.gameKey);
  const byKey = new Map(upcoming.map((g) => [g.gameKey, g]));
  const kick = new Map(upcoming.map((g) => [g.gameKey, g.commence]));

  // Lineups, grouped by game underneath the chart.
  const luGames: string[] = [];
  const luByGame: Record<string, MlbAvail[]> = {};
  const luLabel: Record<string, string> = {};
  const luKick: Record<string, string> = {};
  for (const r of MLB_AVAIL) {
    if (r.commence <= nowIso) continue;                  // started — same rule as the chart above
    if (!luByGame[r.gameKey]) { luByGame[r.gameKey] = []; luGames.push(r.gameKey); luLabel[r.gameKey] = r.game; }
    luByGame[r.gameKey].push(r);
    if (!luKick[r.gameKey] || r.commence < luKick[r.gameKey]) luKick[r.gameKey] = r.commence;
  }
  luGames.sort((a, b) => (luKick[a] ?? "9999").localeCompare(luKick[b] ?? "9999"));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · The Model</>} />
      </header>
      <FlowSteps active="analyze" base="mlb" />
      <div className="subnavrow"><ModelSubnav active="game" base="mlb" /></div>

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-game-model" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Runs crunched</span>
          <span className="hb-bar__count">{upcoming.length} game{upcoming.length === 1 ? "" : "s"}</span>
          <Tip label="About the MLB game model" text={<>
              <span className="tip__lead"><span className="lgnd lgnd--mkt">Market</span> run line and total, then{" "}
            <span className="lgnd lgnd--model">ours</span> — who we have winning and which run-line
            side we have covering, with our chance of each. <b>−1.5 (NYY) +150</b> is the Yankees
            laying 1.5 at FanDuel&apos;s price; <i>fair 40%</i> is the market&apos;s vig-free chance
            they cover it. Ours never sees the market.</span><br /><br />
              <b>How it works.</b> Each side&apos;s offence against the other&apos;s defence,
              adjusted for the starting pitcher. Line-blind — it never sees the market columns.<br /><br />
              <b>Reading the run line.</b> Baseball&apos;s run line is ±1.5 on almost every game,
              so the number alone says little — the favourite is in the PRICE. Laying 1.5 at +150
              is a slight favourite; laying 1.5 at −150 is a heavy one. We show the favourite&apos;s
              line with FanDuel&apos;s price, exactly as the book lists it.<br /><br />
              <b>Our winner.</b> The side we have winning and our chance of it, from our expected
              margin (shown underneath). Held out over {W.n} games it scores <b>{W.gain}%</b> better
              than the home-team base rate on Brier and our favourite won <b>{W.favAcc}%</b>;
              within two points of what happened in three of four confidence buckets, five high
              in the 60–65% one. Small and real.<br /><br />
              <b>Our run line.</b> Whichever of the market&apos;s two posted sides — favourite
              −1.5, underdog +1.5 — we give the better chance, with the market&apos;s own fair %
              for <i>that same side</i> printed underneath. Favourites cover −1.5 in only{" "}
              <b>{C.favBase}%</b> of games, so the underdog is the higher number more often than
              not; that is baseball, where a third of games are decided by one run, and it is
              exactly why the run line pays plus money on the favourite. Because the dog side is
              near-automatic, the number that carries information is the <i>gap</i> between the
              two percentages, not which side is named — and the gap runs both ways. Held out over{" "}
              {C.n.toLocaleString()} sides the cover chance scores <b>{C.gain}%</b> better than the
              base rate and lands within three points in every bucket below 46%; above 46% it runs
              high (said 51%, saw 43%), so treat a big number there with extra suspicion.<br /><br />
              <b>What goes in.</b> Each club&apos;s offence and defence this season, its starting
              pitcher, and last season as a prior — all computed from games already played, never
              from the market. Lineup strength from the posted nine, bullpen, recent form and home
              field were each tested the same way and none improved the held-out results, so none
              are in: the ceiling here is the sport, not the feature list.<br /><br />
              <b>What it is worth.</b> Over {S.n} held-out games, <b>{S.gain}%</b> closer than
              assuming {S.meanTotal} runs every time. That is small because of the sport: one game
              averages {S.meanTotal} runs with an SD of <b>{S.sd}</b>. Team quality alone measured{" "}
              <b>0.0%</b> — only the starting pitcher moved the number.<br /><br />
              <b>The gaps you can see.</b> Our totals sit above the market&apos;s on most games,
              and our spreads below it. Neither is us running hot: against real results our total
              averages <b>{S.resid >= 0 ? "+" : ""}{S.resid.toFixed(2)}</b> runs of error and has
              been <i>too low</i> in four of six months, while the market prices this stretch about
              0.8 runs under what the season has produced. Our margins average{" "}
              <b>{S.marMean.toFixed(1)}</b> runs against real margins of <b>{S.marActual.toFixed(1)}</b>{" "}
              — the model is timid, not bold, and beats a coin flip on the margin by{" "}
              <b>{S.marGain}%</b>.<br /><br />
              <b>No pick.</b> Whether we or the market are right is a closing-line question, and we
              only began recording MLB odds on <b>7 September</b>. A gap here is a difference to
              notice, not an edge to act on.
            </>} />
          <PinButton size="sm" pin={{ id: "/mlb/model", kind: "model", label: "MLB · Game Model", detail: "runs + totals", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {/* No copy on the board: the scroll in the panel bar carries the legend and the caveats.
              Derek: "I do not want text like that anywhere." */}

          {upcoming.length === 0 ? (
            <p className="foot">No upcoming games projected yet. The board fills as probable starters post.</p>
          ) : (
            groupByGameDay(keys, (k) => kick.get(k) ?? null, todayEt, tomorrowEt).map((grp) => {
              // Cap INSIDE the one table, never by slicing it into two — a second table would
              // scroll sideways independently of the first and its continuation would have no
              // header. The hidden rows get hb-row--more and the checkbox reveals them in place.
              const moreId = `mlb-gm-${grp.key.replace(/[^a-z0-9]/gi, "")}`;
              const hidden = Math.max(0, grp.items.length - GAME_CAP);
              return (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
                <div className="hb-moretbl">
                  <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                  <div className="pmscroll">
                    <div className="pmtable pmtable--mlbg" role="table">
                      {/* pmrow--data is what carries display:grid — a header with only
                          pmrow--head stays display:flex and its labels pack left, out of line
                          with the numbers underneath. Match PlayerModelView.tsx.
                          Column ORDER is the football boards' order: the two MARKET numbers
                          together, then the two OURS together, so each pair reads as a pair. */}
                      <div className="pmrow pmrow--head pmrow--data" role="row">
                        <span>game</span><span>starting pitchers</span>
                        <span>market run line</span><span>market total</span>
                        <span>our winner</span><span>our run line</span><span>our total</span>
                      </div>
                      {grp.items.map((k, i) => {
                        const g = byKey.get(k)!;
                        const m = mktFor.get(g.gameKey);
                        const mt = m?.total?.consensus ?? null;
                        const rl = m ? runLine(m, g.homeAbbr, g.awayAbbr) : null;
                        // Home minus away, the same sign convention as the market column, so a
                        // reader compares two numbers that mean the same thing.
                        const os = g.homeRuns - g.awayRuns;
                        const call = ourCall(os, g.homeAbbr, g.awayAbbr, rl?.homeFav);
                        // The market's own de-vigged chance for THE SIDE WE NAME. rl.fair is the
                        // favourite covering −1.5, so the dog +1.5 is its complement — the two
                        // posted sides of one run line. Printed beside ours so the row compares
                        // like with like instead of one team against the other.
                        const mktSame = rl?.fair == null ? null
                          : call.oursIsMktFav ? rl.fair : 1 - rl.fair;
                        // First initial plus surname. "Hunter Brown (HOU) / Cristopher Sánchez
                        // (PHI)" is 285px of ink, and no honest budget fits that at 1440 — it was
                        // the one cell on the site that had to wrap, and a wrapping cell is what
                        // makes rows ragged. The club abbreviation already does the identifying.
                        const shortSp = (n: string) => {
                          const parts = n.trim().split(/\s+/);
                          return parts.length < 2 ? n : `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
                        };
                        const sp = [
                          g.awaySpName && `${shortSp(g.awaySpName)} (${g.awayAbbr})`,
                          g.homeSpName && `${shortSp(g.homeSpName)} (${g.homeAbbr})`,
                        ].filter(Boolean).join(" / ");
                        return (
                          <div className={`pmrow pmrow--data${i >= GAME_CAP ? " hb-row--more" : ""}`}
                            role="row" key={k}>
                            {/* Abbreviated, like every other MLB board. Full club names ran to
                                376px of ink in a 318px column, so this cell wrapped and made its
                                row 12px taller than its neighbours — the one uneven-row source
                                left on the site. "CLE @ BAL" also matches the abbreviations the
                                spread and pitcher columns beside it already use. */}
                            <span className="pmcell pmcell--player">
                              {g.awayAbbr} @ {g.homeAbbr}
                              <span className="pmslot"> ({kickTime(g.commence)})</span>
                            </span>
                            <span className="pmcell pmcell--team">{sp || "not posted"}</span>
                            <span className="pmcell pmcell--mkt pmcover">
                              {rl ? <>
                                {rl.text}
                                {rl.fair != null && <span className="pmcover__sub">fair {pct(rl.fair)} to cover</span>}
                              </> : "—"}
                            </span>
                            <span className="pmcell pmcell--mkt">{mt !== null ? mt.toFixed(1) : "—"}</span>
                            <span className="pmcell pmcell--proj pmcover">
                              {call.fav} <span className="pmcover__who">{pct(call.win)}</span>
                              <span className="pmcover__sub">margin {Math.abs(os) < 0.05 ? "pick" : `−${Math.abs(os).toFixed(1)}`}</span>
                            </span>
                            <span className="pmcell pmcell--proj pmcover">
                              {call.rlSide} {call.rlPt} <span className="pmcover__who">{pct(call.rlProb)}</span>
                              {/* Was "take the run" / "lay the run". That is an instruction, and
                                  this panel does not vote — the scroll above it already says "a
                                  gap here is a difference to notice, not an edge to act on", while
                                  the cell underneath told you to act. It now prints the market's
                                  fair % for the SAME side, which is the only thing that makes our
                                  number mean anything. */}
                              {mktSame != null && (
                                <span className="pmcover__sub">market {pct(mktSame)}</span>
                              )}
                            </span>
                            <span className="pmcell pmcell--proj">{g.total.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {hidden > 0 && (
                    <label htmlFor={moreId} className="hb-moretbl__sum">
                      <span className="hb-more__chev" aria-hidden="true">▸</span>
                      <span className="hb-moretbl__more">Show {hidden} more game{hidden === 1 ? "" : "s"}</span>
                      <span className="hb-moretbl__less">Show fewer</span>
                    </label>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>
      </details>

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-availability">
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Who&apos;s playing tonight</span>
          <span className="hb-bar__count">{luGames.length} game{luGames.length === 1 ? "" : "s"}</span>
          <Tip label="About tonight's lineups" text={<>
              <span className="tip__lead">Our estimate of who starts tonight, until the real lineup posts.{" "}
            <b>Start %</b> = chance he plays. <b>Slot</b> = where he bats.</span><br /><br />
              <b>Why this exists.</b> A football team&apos;s starting eleven is the same most weeks.
              A baseball manager rests people constantly — about two of the nine slots turn over
              every night — and the lineup card only posts about three hours before first pitch. So
              at lunchtime nobody knows who is playing.<br /><br />
              <b>Start %</b> is the chance he is in tonight&apos;s lineup. Most books void a prop if
              he never plays, so it is about whether your bet <i>happens</i>, not whether it
              wins.<br /><br />
              <b>Batting slot</b> decides how many times he comes to the plate — leading off is
              about 4.5 chances, batting ninth about 3.4. Both numbers feed every projection on the{" "}
              <a href="/mlb/model/players">Player Props</a> board.<br /><br />
              <b>What it is worth.</b> Over 21,304 held-out player-games it scores a Brier of{" "}
              <b>{BRIER.model.toFixed(3)}</b> against <b>{BRIER.persistence.toFixed(3)}</b> for
              simply repeating last night&apos;s lineup — <b>{BRIER.gain}% better</b>, and
              comfortably the strongest model on this page. Once a lineup posts, the row shows the
              lineup instead of our estimate.
            </>} />
          <PinButton size="sm" pin={{ id: "/mlb/model#lineups", kind: "model", label: "MLB · Lineups", detail: "who starts tonight", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {luGames.length === 0 ? (
            <p className="foot">No games in the window. This board fills as tonight&apos;s slate approaches.</p>
          ) : (
            groupByGameDay(luGames, (g) => luKick[g] ?? null, todayEt, tomorrowEt).map((grp) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
                {grp.items.map((g) => {
                  const rows = luByGame[g].slice(0, 18);
                  const moreId = `mlb-lu-${g.replace(/[^a-z0-9]/gi, "")}`;
                  return (
                    <details className="pmgame" key={g}>
                      <summary className="pmgame__h">{luLabel[g]}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                      <div className="pmgame__body hb-moretbl">
                        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                        <div className="pmscroll">
                          <div className="pmtable pmtable--mlb" role="table">
                            <div className="pmrow pmrow--head pmrow--data" role="row">
                              <span>player</span><span>status</span><span>start %</span>
                              <span>batting slot</span><span>recent</span>
                            </div>
                            {rows.map((r, i) => {
                              // Once a lineup is posted this is a FACT. Publishing "83%" beside a
                              // known answer is the same failure as an arrow that contradicts the
                              // number next to it.
                              const known = r.lineupPosted;
                              const cont = i > 0 && rows[i - 1].player === r.player;
                              return (
                                <div className={`pmrow pmrow--data${i >= LU_CAP ? " hb-row--more" : ""}`}
                                  role="row" key={`${r.player}-${r.team}`}>
                                  <span className="pmcell pmcell--player">
                                    {cont ? "" : <>{r.player}<span className="pmslot"> ({r.pos ?? "—"}, {r.teamAbbr || r.team})</span></>}
                                  </span>
                                  <span className="pmcell pmcell--team">{known ? "in the lineup" : "projected"}</span>
                                  <span className="pmcell">
                                    {known
                                      ? <b className={r.posted ? "mlbin" : "mlbout"}>{r.posted ? "Starting" : "Not starting"}</b>
                                      : <b className="pmproj">{pct(r.pStart)}</b>}
                                  </span>
                                  <span className="pmcell">{r.slot.toFixed(1)}</span>
                                  <span className="pmcell pmcell--hist">{r.starts}/{r.of} gm</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {rows.length > LU_CAP && (
                          <label htmlFor={moreId} className="hb-moretbl__sum">
                            <span className="hb-more__chev" aria-hidden="true">▸</span>
                            <span className="hb-moretbl__more">Show {rows.length - LU_CAP} more candidate{rows.length - LU_CAP === 1 ? "" : "s"}</span>
                            <span className="hb-moretbl__less">Show fewer</span>
                          </label>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </details>

      {/* Say plainly what is not here. A board that looks finished while quietly missing its model
          is the failure mode this section exists to avoid. */}
      <section className="calib">
        <h2 className="calib__h">
          What we don&apos;t publish
          <Tip label="What we don't publish, and why" text={<>
            <b>No side pick.</b> Our total is worth {S.gain}% and our margins average{" "}
            {S.marMean.toFixed(1)} runs against real margins of {S.marActual.toFixed(1)}. Turning
            either into a pick would be inventing precision the model does not have.<br /><br />
            <b>No run line.</b> It is a fixed ±1.5 on every game, so a column of it says nothing
            about who is favoured by how much.<br /><br />
            <b>No home-field adjustment.</b> Measured across 2,165 games at <b>+0.06 runs</b> —
            indistinguishable from zero, and far smaller than football&apos;s.<br /><br />
            <b>No closing-line claim.</b> Everything here is measured against what actually
            happened. MLB price capture began 7 September; beating the market needs history we do
            not have yet.
          </>} />
        </h2>
      </section>
    </main>
  );
}
