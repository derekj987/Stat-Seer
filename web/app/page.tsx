// Landing hub — the multi-sport front door. A snapshot of the whole app: the seer hero,
// the Model-vs-Market Card for each live sport (NFL, then NCAAF) as dropdowns, the
// players the model likes, the bet-slip invite, a sport picker, and a tour of the three
// tools. Individual sports live at /nfl, /ncaaf, … and the sport strip (global) links to
// each. The sports themselves link back up here via the logo.
import { fetchHome, type CardRow, type PlayerPick } from "@/lib/home";
import { NCAAF_MODEL, type NcaafCardGame } from "./ncaaf/model-data";
import { SPORTS } from "./Nav";
import HomePromo from "./HomePromo";

export const revalidate = 120;
export const metadata = {
  title: "StatSeer — the model vs the market, every sport",
  description: "One line-blind model read beside the market on every game — NFL and College Football now, more coming. Published probabilities, an honest track record, the best price on every pick.",
};

const SEASON = 2026;
const numStr = (v: number | null) => (v === null ? "—" : String(v));

/* ---- NFL Card (from the live board) ---- */
function NflCard({ rows, week }: { rows: CardRow[]; week: number }) {
  return (
    <details className="hb-panel hb-panel--card" open>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">NFL{week ? ` · Week ${week}` : ""}</span>
        <span className="hb-bar__count">{rows.length} games</span>
        <span className="hb-bar__hint">The Card — our model&apos;s read beside the market&apos;s</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {rows.length === 0 ? (
          <p className="hb-empty">The NFL board opens when this week&apos;s odds and reads post. See the latest in <a href="/model">The Model</a>.</p>
        ) : (
          <div className="hb-formwrap">
            <table className="hb-form">
              <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.eventId} className={r.off ? "hb-off" : undefined}>
                    <td className="hb-l">
                      <span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>
                      {r.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
                    </td>
                    <td className="hb-num">{r.marketSpread ?? "—"}</td>
                    <td className="hb-num hb-tot">{numStr(r.marketTotal)}</td>
                    <td className="hb-suggest">
                      {r.spreadLean || r.totalLean ? (
                        <span className="hb-sugwrap">
                          {r.spreadLean && <span className="hb-sug"><span className="hb-sug__t">{r.spreadLean.side} {r.spreadLean.num}</span></span>}
                          {r.totalLean && <span className="hb-sug"><span className="hb-sug__t">{r.totalLean.dir === "OVER" ? "Over" : "Under"} {r.totalLean.num}</span></span>}
                        </span>
                      ) : <span className="hb-leannone">even</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="lp-cardfoot">Full board, kickoffs, and one-tap slip on <a href="/nfl">the NFL page →</a></p>
      </div>
    </details>
  );
}

/* ---- NCAAF Card (from the frozen model data; featured = top-25 matchups) ---- */
function NcaafCard({ games, week }: { games: readonly NcaafCardGame[]; week: number }) {
  const featured = games.filter((g) => g.featured);
  const show = (featured.length ? featured : games).slice(0, 12);
  return (
    <details className="hb-panel hb-panel--card">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">NCAAF{week ? ` · Week ${week}` : ""}</span>
        <span className="hb-bar__count">{show.length} ranked</span>
        <span className="hb-bar__hint">The Card — our line-blind projection beside the market</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <div className="hb-formwrap">
          <table className="hb-form">
            <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>
            <tbody>
              {show.map((g) => {
                const ms = g.marketSpread; const ps = g.projSpread; const tl = g.totalLean;
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
                        <span className="hb-sug"><span className="hb-sug__t">{ps.fav} {ps.num}</span></span>
                        {tl && <span className="hb-sug"><span className="hb-sug__t">{tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span></span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="lp-cardfoot">Full slate and the honest track record on <a href="/ncaaf">the College Football page →</a></p>
      </div>
    </details>
  );
}

/* ---- Players the model likes ---- */
function NflPlayers({ players }: { players: PlayerPick[] }) {
  return (
    <details className="hb-panel">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">Players the model likes — NFL</span>
        <span className="hb-bar__count hb-bar__count--gold">{players.length || "—"}</span>
        <span className="hb-bar__hint">rising on the fan boards this week</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {players.length === 0 ? (
          <p className="hb-empty">Player reads post with the week&apos;s props — check <a href="/tailgate">Fan Analysis</a>.</p>
        ) : (
          <div className="hb-players__grid">
            {players.slice(0, 6).map((p) => (
              <a className="hb-plr" href="/tailgate" key={p.id}>
                <span className="hb-plr__name">{p.player}</span>
                <span className="hb-plr__team">{p.team}</span>
                <span className="hb-plr__angle">{p.side}{p.line != null ? ` ${p.line}` : ""} {p.marketLabel ?? ""}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function NcaafPlayers() {
  return (
    <details className="hb-panel">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">Players the model likes — NCAAF</span>
        <span className="hb-bar__count hb-bar__count--gold">—</span>
        <span className="hb-bar__hint">arriving with the season</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <p className="hb-empty">
          College player reads land here once the CFB fan scan is wired — the same read we run for the NFL on{" "}
          <a href="/ncaaf/tailgate">Fan Analysis</a>. Nothing gathered yet.
        </p>
      </div>
    </details>
  );
}

/* ---- the bet-slip invite (moved above "Pick your sport") ---- */
function Betslip() {
  return (
    <details className="hb-slipf">
      <summary className="hb-slipf__bar">
        <span className="hb-slipf__ic" aria-hidden="true">🎟️</span>
        <span className="hb-slipf__h">Build your own bet slip — we tell you where to place it</span>
        <span className="hb-tav__right">
          <span className="hb-tav__ic hb-tav__ic--shut" aria-hidden="true">🍺</span>
          <span className="hb-tav__ic hb-tav__ic--open" aria-hidden="true">🍻</span>
          <span className="hb-tav__chev" aria-hidden="true">▾</span>
        </span>
      </summary>
      <div className="hb-slipf__body">
        <p className="hb-slipf__p">
          Tap any pick anywhere on StatSeer — a model suggestion, a moneyline, a spread, a prop — and it
          lands on your slip. When you&apos;re ready, we show you the <b>single best sportsbook for every
          leg</b>, and for a parlay, the <b>one book with the best combined price</b>. Same bets, better
          numbers — you never leave value on the table.
        </p>
        <div className="hb-slipf__steps">
          <div className="hb-slipf__step"><span className="hb-slipf__n">1</span><b>Add your picks</b><span>Tap to save anything you like as you read the board.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">2</span><b>We shop it</b><span>StatSeer compares every book and finds the best price.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">3</span><b>You place it</b><span>Bet at the book we name — the same wager at a better number.</span></div>
        </div>
        <div className="hb-slipf__cta">
          <a href="/lines" className="btn btn--primary">Start a slip →</a>
          <a href="/how" className="btn">How it works →</a>
        </div>
      </div>
    </details>
  );
}

export default async function Landing() {
  let nfl: CardRow[] = [];
  let nflPlayers: PlayerPick[] = [];
  let nflWeek = 0;
  try {
    const home = await fetchHome(SEASON);
    nfl = home.card; nflPlayers = home.players; nflWeek = home.week;
  } catch { /* board not up yet */ }

  const cfb = NCAAF_MODEL.card;
  const liveCount = SPORTS.filter((s) => s.live).length;

  return (
    <main className="lp">
      <header className="lp-hero">
        <div className="lp-hero__banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" className="lp-hero__img" width={1983} height={793} />
          <div className="lp-hero__grad" aria-hidden="true" />
          <h1 className="lp-hero__wm">StatSeer</h1>
        </div>
        <p className="lp-hero__tag">
          One model reads every game <b>line-blind</b>, then shows you exactly where it disagrees with the
          market — and the <b>best price</b> on every pick.
        </p>
        <div className="lp-stats">
          <div className="lp-stat"><span className="lp-stat__n">{liveCount}</span><span className="lp-stat__l">sports live</span></div>
          <div className="lp-stat"><span className="lp-stat__n">{nfl.length + cfb.games.length}</span><span className="lp-stat__l">games on the board</span></div>
          <div className="lp-stat"><span className="lp-stat__n">100%</span><span className="lp-stat__l">reads graded in public</span></div>
          <div className="lp-stat lp-stat--wide"><span className="lp-stat__n">Line-blind</span><span className="lp-stat__l">every read, before the line</span></div>
        </div>
      </header>

      <NflCard rows={nfl} week={nflWeek} />
      <NcaafCard games={cfb.games} week={cfb.week} />

      <NflPlayers players={nflPlayers} />
      <NcaafPlayers />

      <Betslip />

      <section className="lp-sports">
        <h2 className="lp-h2">Pick your sport</h2>
        <div className="lp-sports__grid">
          {SPORTS.map((s) => s.live ? (
            <a key={s.key} href={s.home} className="lp-sport lp-sport--live">
              <span className="lp-sport__name">{s.label}</span>
              <span className="lp-sport__meta">
                {s.key === "nfl" ? (nflWeek ? `Week ${nflWeek} board` : "Full board") : `Week ${cfb.week} board`}
              </span>
              <span className="lp-sport__go">Enter →</span>
            </a>
          ) : (
            <span key={s.key} className="lp-sport lp-sport--soon">
              <span className="lp-sport__name">{s.label}</span>
              <span className="lp-sport__meta">building the model</span>
              <span className="lp-sport__soon">Soon</span>
            </span>
          ))}
        </div>
      </section>

      <details className="lp-tools">
        <summary className="lp-tools__sum">
          <span className="lp-tools__h">Three tools, one board</span>
          <span className="lp-tools__hint">how every sport is built — the Model, the Context, the Value Finder</span>
          <span className="lp-tools__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-nav3__grid lp-tools__grid">
          <a href="/model" className="hb-nav3__c">
            <span className="hb-nav3__k">The Model</span>
            <span className="hb-nav3__d">Line-blind reads on every game, published and graded in public — with the calibration to check us. What the data says on its own.</span>
            <span className="hb-nav3__go">See The Model →</span>
          </a>
          <a href="/context" className="hb-nav3__c">
            <span className="hb-nav3__k">Context</span>
            <span className="hb-nav3__d">Upset Watch, situational factors, and fan analysis — everything around a game a single number can&apos;t capture. Informs, never votes.</span>
            <span className="hb-nav3__go">Read the Context →</span>
          </a>
          <a href="/lines" className="hb-nav3__c">
            <span className="hb-nav3__k">Value Finder</span>
            <span className="hb-nav3__d">Once you&apos;ve chosen a bet, the single best sportsbook for it — game lines, player props, and key-number sweet spots. Where the money is.</span>
            <span className="hb-nav3__go">Find the best price →</span>
          </a>
        </div>
      </details>

      <HomePromo />

      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Win more often.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/how">How our model works →</a>
        </p>
      </section>
    </main>
  );
}
