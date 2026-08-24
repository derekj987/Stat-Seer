import { Brand, FlowSteps, ShopSubnav, ValueFinderNote } from "../../Nav";
import Tip from "@/app/Tip";
import { NCAAF_MODEL, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — Value Finder · Game Lines. Mirrors the NFL board: every game with
// the market's spread + total beside our line-blind read. NCAAF has a consensus snapshot
// (not yet per-book), so multi-book best-price shopping is the one piece still arriving;
// the durable book-disagreement measurement is shown below.
export const metadata = {
  title: "StatSeer — CFB Game Lines",
  description: "College-football game lines — every game's spread and total beside our model's read, plus how much sportsbooks disagree.",
};

const M = NCAAF_MODEL;

function pickTxt(g: NcaafCardGame): string {
  const pk = g.pick;
  return pk ? `${pk.side} ${pk.num > 0 ? "+" : ""}${pk.num}` : `${g.projSpread.fav} ${g.projSpread.num}`;
}

export default function Page() {
  const bs = M.value.bookShop;
  const c = M.card;
  const games = c.games.filter((g) => g.marketSpread); // only games with a market line

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">NCAAF</span> · Line Shopping</>} />
      </header>

      <section className="explainer explainer--wide">
        <p>
          <b>The board.</b> Every game with the market&apos;s <b>spread</b> and <b>total</b>, beside our
          line-blind read of which side it covers. The market number is a consensus snapshot; the per-book
          best-price shopping turns on as the live NCAAF odds capture feeds the site.
        </p>
      </section>

      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="lines" base="ncaaf" />
      <ValueFinderNote />

      <section className="ncf-sec">
        <h2 className="ncf-h">Game lines — Week {c.week}
          <span className="ncf-h__note">{games.length} games with a market line</span>
          <Tip text={<>Every game with the market&apos;s <b>Spread</b> and <b>O/U</b> beside <b>Our Model Suggests</b> — the side our line-blind rating covers. A ◆ marks an <b>off-consensus</b> game. Our CFB rating ties Elo but doesn&apos;t beat the spread, so treat this as informative context, not a guaranteed bet.</>} />
        </h2>
        <div className="hb-legend">
          <span className="hb-dia">◆</span> Off-consensus — our read is on the other side from the market.
          <span className="hb-x"> · <b>Our Model Suggests</b> is the side our line-blind rating covers — informative,
            not a guaranteed bet (the rating doesn&apos;t beat the spread; see <a href="/ncaaf/model">The Model</a>).</span>
        </div>
        <div className="hb-formwrap">
          <table className="hb-form">
            <thead>
              <tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const ms = g.marketSpread!; const tl = g.totalLean;
                return (
                  <tr key={`${g.away}-${g.home}`} className={g.off ? "hb-off" : undefined}>
                    <td className="hb-l">
                      <span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>
                      {g.neutral ? <span className="ncf-site"> · N</span> : null}
                      {g.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
                    </td>
                    <td className="hb-num">{ms.fav} {ms.num}</td>
                    <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
                    <td className="hb-suggest">
                      <span className="hb-sugwrap">
                        <span className="hb-sug"><span className="hb-sug__t">{pickTxt(g)}</span></span>
                        {tl && <span className="hb-sug"><span className="hb-sug__t"><span className={`pmarrow pmarrow--${tl.dir === "OVER" ? "up" : "down"}`} aria-hidden="true">{tl.dir === "OVER" ? "▲" : "▼"}</span> {tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span></span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ncf-note">
          A consensus snapshot of the openers. When the live odds capture is deployed, this becomes a full
          tap-to-shop board with each book&apos;s number and the single best price per game — like <a href="/lines">the NFL board</a>.
        </p>
      </section>

      <section className="ncf-sec">
        <h2 className="ncf-h">Why the book matters <span className="ncf-h__note">measured across books on {bs.games.toLocaleString()} games</span></h2>
        <div className="ncf-cards">
          <StatCard tone="good" label="Books disagree ≥1 pt" value={`${bs.pctGap1}%`}
            sub="of games — that&apos;s how often shopping the number moves you across a full point or more." />
          <StatCard label="Average spread gap" value={`${bs.avgRange} pt`}
            sub="between the best and worst book on a typical game — small per game, real over a season of bets." />
          <StatCard tone="flat" label="Key numbers matter" value="3 & 7"
            sub="a point of shopping is worth most when it moves you onto a key number — see Sweet Spots." />
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Price, not picks.</b> For which margins to pay up for, see <a href="/ncaaf/best">Sweet Spots</a>; for
          the line-blind read and its honest record, <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
