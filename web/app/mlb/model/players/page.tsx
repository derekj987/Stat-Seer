import { Brand, FlowSteps, ModelSubnav } from "../../../Nav";
import PinButton from "../../../PinButton";
import { DayHeader } from "../../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { MLB_PROPS, MLB_PROP_SCORES, type MlbProp } from "@/lib/mlbPlayerProps";
import { MLB_K } from "@/lib/mlbStrikeouts";
import { propLines, propBookProb, norm } from "@/lib/mlbProps";

// MLB · Player Model (props).
//
// Categories mirror how a sportsbook splits its baseball board, and how the football player board
// splits its own: a tab per market family rather than one undifferentiated wall.
//
// HONESTY IS THE DESIGN CONSTRAINT HERE, not a disclaimer bolted on. Measured on 10,272 held-out
// batter-games, the batting props barely beat "this batter gets a hit in 62% of his games":
// hits +1.8%, home runs +1.1%, stolen bases -0.4%. Pitcher strikeouts is +3.1%. So the board
// publishes CALIBRATED PROBABILITIES to price a book line against — the Pick Auditor idea,
// arithmetic not prediction — and says so on every tab rather than implying a read it does not
// have. Stolen bases are absent entirely: a measured zero is a reason not to ship a number.

export const metadata = {
  title: "StatSeer — MLB Player Props Model",
  description:
    "Calibrated MLB prop probabilities: will he record a hit, go deep, or how many strikeouts — published, graded, and line-blind.",
};
export const revalidate = 300;

type CatKey = "hits" | "hr" | "pitching";
const CATS: { key: CatKey; label: string }[] = [
  { key: "hits", label: "Hits" },
  { key: "hr", label: "Home Runs" },
  { key: "pitching", label: "Pitching" },
];

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

/** How good the number on this tab actually is, in one sentence, in the reader's terms. */
function Honest({ cat }: { cat: CatKey }) {
  if (cat === "pitching") {
    return (
      <p className="ctxsec__d">
        Batters faced × strikeout rate, adjusted for how often the opposing lineup strikes out.
        Over <b>925 held-out starts</b> this lands <b>0.06 strikeouts closer</b> than the
        pitcher&apos;s own season average — <b>+3.1%</b>. The strongest of the prop models here,
        because strikeout rate is the most persistent skill in baseball.
      </p>
    );
  }
  const s = cat === "hits" ? MLB_PROP_SCORES.hits : MLB_PROP_SCORES.hr;
  const what = cat === "hits" ? "records a hit" : "hits a home run";
  return (
    <p className="ctxsec__d">
      The chance this batter <b>{what}</b> tonight: his own rate per plate appearance, shrunk toward
      league, nudged by the opposing pitching staff, and raised to the <b>plate appearances his
      batting slot gets</b> — leading off is 4.5, batting ninth is 3.4.{" "}
      <b>Be clear about what this is worth.</b> Against simply knowing how often he does it, the
      model gains <b>{s.gain}%</b>. That is small, and it is the honest number: what separates a hit
      from an out is mostly where the ball lands, which does not carry between games. The
      probability is <b>well calibrated</b>, so it is a fair figure to price a book line against —
      not a claim that we know something the market doesn&apos;t.
    </p>
  );
}

export default async function Page({ searchParams }: PageProps<"/mlb/model/players">) {
  const sp = await searchParams;
  const raw = typeof sp.cat === "string" ? sp.cat : "hits";
  const cat: CatKey = CATS.some((c) => c.key === raw) ? (raw as CatKey) : "hits";
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();

  const market = cat === "hits" ? "batter_hits" : cat === "hr" ? "batter_home_runs" : "pitcher_strikeouts";
  // Pitching compares a NUMBER (his K line); hits/HR compare a PROBABILITY, because those markets
  // sit at a 0.5 line where all the information is in the price, not the line.
  const lines = cat === "pitching" ? await propLines(market) : new Map<string, { line: number; books: number }>();
  const bookProb = cat === "pitching" ? new Map<string, number>() : await propBookProb(market);

  // One row shape for both families so the day/game grouping below does not branch.
  type Row = {
    gameKey: string; game: string; commence: string; player: string; team: string; opp: string;
    ours: number | null; oursPct: boolean; book: number | null;
    slot: number | null; pStart: number | null; lineupPosted: boolean; posted: boolean;
    hist: string;
  };
  let rows: Row[];
  if (cat === "pitching") {
    rows = MLB_K.map((r) => ({
      gameKey: r.gameKey, game: r.game, commence: r.commence, player: r.pitcher, team: r.team, opp: r.opp,
      ours: r.proj, oursPct: false, book: lines.get(norm(r.pitcher))?.line ?? null,
      slot: null, pStart: null, lineupPosted: true, posted: true,
      hist: `${(r.kRate * 100).toFixed(1)}% K rate · ${r.starts} starts`,
    }));
  } else {
    const pick = (p: MlbProp) => (cat === "hits" ? p.pHit : p.pHr);
    const rate = (p: MlbProp) => (cat === "hits" ? p.hitRate : p.hrRate);
    rows = MLB_PROPS.filter((p) => pick(p) !== null).map((p) => ({
      gameKey: p.gameKey, game: p.game, commence: p.commence, player: p.player, team: p.team, opp: p.opp,
      ours: pick(p), oursPct: true, book: bookProb.get(norm(p.player)) ?? null,
      slot: p.slot, pStart: p.pStart, lineupPosted: p.lineupPosted, posted: p.posted,
      hist: rate(p) !== null
        ? `${(rate(p)! * 100).toFixed(1)}% per PA · ${p.pa?.toFixed(1) ?? "—"} PA`
        : "—",
    }));
  }
  rows.sort((a, b) => (b.ours ?? 0) - (a.ours ?? 0));

  // Group on gameKey (date + matchup), NOT the matchup string. Baseball plays series, so the same
  // two clubs meet on consecutive nights and a matchup-only key merged them into one card with
  // every player listed twice.
  const games: string[] = [];
  const byGame: Record<string, Row[]> = {};
  const kick: Record<string, string> = {};
  const label: Record<string, string> = {};
  for (const r of rows) {
    if (!byGame[r.gameKey]) { byGame[r.gameKey] = []; games.push(r.gameKey); label[r.gameKey] = r.game; }
    byGame[r.gameKey].push(r);
    if (!kick[r.gameKey] || r.commence < kick[r.gameKey]) kick[r.gameKey] = r.commence;
  }
  games.sort((a, b) => (kick[a] ?? "9999").localeCompare(kick[b] ?? "9999"));
  const CAP = 8;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · Player Props</>} />
      </header>
      <FlowSteps active="analyze" base="mlb" />
      <div className="subnavrow"><ModelSubnav active="player" base="mlb" /></div>

      <nav className="catnav" aria-label="Prop category">
        {CATS.map((c) => (
          <a key={c.key} href={`/mlb/model/players?cat=${c.key}`}
            className={c.key === cat ? "catnav__c active" : "catnav__c"}
            aria-current={c.key === cat ? "page" : undefined}>{c.label}</a>
        ))}
      </nav>

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-props" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">
            {CATS.find((c) => c.key === cat)!.label}
          </span>
          <span className="hb-bar__count">{games.length} game{games.length === 1 ? "" : "s"}</span>
          <PinButton size="sm" pin={{ id: `/mlb/model/players?cat=${cat}`, kind: "model", label: `MLB · ${CATS.find((c) => c.key === cat)!.label}`, detail: "player props", href: `/mlb/model/players?cat=${cat}` }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <Honest cat={cat} />
          {cat !== "pitching" && (
            <p className="ctxsec__d">
              <b>Will he even play?</b> Baseball lineups are not fixed the way a football starting
              line-up is — managers rest people constantly, and lineups only post about three hours
              before first pitch. The <b>start %</b> column is the chance he is in tonight&apos;s
              lineup at all (most books void a prop if he isn&apos;t), and <b>slot</b> is where he
              is likely to bat, which decides how many times he comes up.
            </p>
          )}

          {games.length === 0 ? (
            <p className="foot">Nothing posted for the coming slate yet.</p>
          ) : (
            groupByGameDay(games, (g) => kick[g] ?? null, todayEt, tomorrowEt).map((grp) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                {grp.items.map((g) => {
                  const rs = byGame[g];
                  const moreId = `mlbp-${cat}-${g.replace(/[^a-z0-9]/gi, "")}`;
                  return (
                    <details className="pmgame" key={g} open>
                      <summary className="pmgame__h">{label[g]}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                      <div className="pmgame__body hb-moretbl">
                        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                        <div className="pmscroll">
                          <div className={`pmtable ${cat === "pitching" ? "pmtable--mlbk" : "pmtable--mlbp"}`} role="table">
                            <div className="pmrow pmrow--head" role="row">
                              <span>player</span>
                              {cat === "pitching"
                                ? <><span>opponent</span><span>book line</span><span>our proj</span><span>K rate</span><span>starts</span></>
                                : <><span>start %</span><span>slot</span><span>book %</span><span>our %</span><span>his rate</span></>}
                            </div>
                            {rs.map((r, i) => (
                              <div className={`pmrow pmrow--data${i >= CAP ? " hb-row--more" : ""}`}
                                role="row" key={`${r.player}-${r.game}`}>
                                <span className="pmcell pmcell--player">
                                  {r.player}<span className="pmslot"> ({r.team})</span>
                                </span>
                                {cat === "pitching" ? (
                                  <>
                                    <span className="pmcell pmcell--team">{r.opp}</span>
                                    <span className="pmcell">{r.book !== null ? r.book.toFixed(1) : "—"}</span>
                                    <span className="pmcell"><b className="pmproj">{r.ours!.toFixed(1)}</b></span>
                                    <span className="pmcell pmcell--hist">{r.hist}</span>
                                    <span className="pmcell pmcell--hist" />
                                  </>
                                ) : (
                                  <>
                                    {/* Once the lineup posts this is a fact, so show the fact. */}
                                    <span className="pmcell">
                                      {r.lineupPosted
                                        ? <b className={r.posted ? "mlbin" : "mlbout"}>{r.posted ? "in" : "out"}</b>
                                        : pct(r.pStart!)}
                                    </span>
                                    <span className="pmcell">{r.slot!.toFixed(0)}</span>
                                    <span className="pmcell">{r.book !== null ? pct(r.book) : "—"}</span>
                                    <span className="pmcell"><b className="pmproj">{pct(r.ours!)}</b></span>
                                    <span className="pmcell pmcell--hist">{r.hist}</span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        {rs.length > CAP && (
                          <label htmlFor={moreId} className="hb-moretbl__sum">
                            <span className="hb-more__chev" aria-hidden="true">▸</span>
                            <span className="hb-moretbl__more">Show {rs.length - CAP} more</span>
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

      <section className="calib">
        <h2 className="calib__h">Not modelled, and why</h2>
        <p className="foot">
          <b>Stolen bases</b> measured <b>0.0%</b> better than the base rate over the same held-out
          games — no signal at all — so there is no projection here. <b>Total bases</b> is absent
          because at least one total base is nearly the same event as at least one hit, and the
          model we use for the others is the wrong shape for it. A missing number is a decision, not
          an omission.
        </p>
      </section>
    </main>
  );
}
